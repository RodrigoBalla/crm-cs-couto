// Edge Function "ojnm-crm" — backend do CRM temporário do site O Jogo Não Mente.
// Isolamento: acessa SOMENTE o schema privado ojnm_crm via conexão direta ao
// Postgres (SUPABASE_DB_URL). O schema NÃO é exposto no PostgREST, então nada
// vaza pra API pública nem se mistura com os outros projetos do banco.
// Auth: allowlist de e-mails (ojnm_crm.admins) + sessão por token opaco.
import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(
    JSON.stringify(b, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), // BigInt não serializa sozinho
    { status: s, headers: { ...CORS, "Content-Type": "application/json" } },
  );

// Atendentes do rodízio do WhatsApp da Comunidade (botão da página de obrigado).
// Também definem o DONO do lead: quem recebe o contato ganha a etiqueta e o lead cai no kanban dele.
// ⚠️ PREENCHER — os telefones reais da equipe foram REMOVIDOS desta cópia (ver LEIA-ME.md).
// Formato do phone: DDI+DDD+numero, só dígitos (ex.: "5511999998888").
const ATENDENTES = [
  { key: "pessoa1", name: "Nome Sobrenome",  phone: "55DDNUMERO" },
  { key: "pessoa2", name: "Nome Sobrenome",  phone: "55DDNUMERO" },
  { key: "pessoa3", name: "Nome Sobrenome",  phone: "55DDNUMERO" },
  { key: "pessoa4", name: "Nome Sobrenome",  phone: "55DDNUMERO" },
];
// DISTRIBUIÇÃO PONDERADA: 80% para o atendente principal, 20% dividido entre os outros 3.
// Roda de 15 posições = 12 do principal (80%) + 1 de cada um dos outros (6,67% cada).
// Para dividir igualmente, basta listar cada key uma vez.
// Os outros ficam ESPALHADOS na roda pra ninguém receber tudo de uma vez.
const RODA = [
  "pessoa1", "pessoa1", "pessoa1", "pessoa1", "pessoa2",
  "pessoa1", "pessoa1", "pessoa1", "pessoa1", "pessoa3",
  "pessoa1", "pessoa1", "pessoa1", "pessoa1", "pessoa4",
];

// Tags que NÃO são pessoas (são marcações do sistema). Nunca contam como dono do lead.
// Uma palavra, sem underline.
const PERFIS_TAG = ["Criador", "Facilitador", "Especialista", "Mobilizador", "Transformador"];
const FAIXAS_TAG = ["Frio", "Curioso", "Potencial", "Qualificado", "Hot"];
const TAGS_FLAG = new Set(
  ["Comunidade", "Quiz"].concat(PERFIS_TAG).concat(FAIXAS_TAG).map((t) => t.toLowerCase()),
);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// manda a tarefa pro segundo plano: a resposta não espera (planilha do Google chega a levar ~5s)
const emBackground = (p: Promise<unknown>) => {
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch (_) { /* roda solto mesmo */ }
};

function newToken(): string {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* vazio */ }
  const action = String(body.action || "");

  const c = new Client(Deno.env.get("SUPABASE_DB_URL"));
  try {
    await c.connect();

    // ---------- ação pública: gravar lead ----------
    if (action === "submit_lead") {
      const ua = req.headers.get("user-agent") || "";
      const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
      const ins = await c.queryObject`
        insert into ojnm_crm.leads (nome, email, whatsapp, profissao, motivo, source, event_id, page_url, user_agent, ip)
        values (${body.nome ?? null}, ${body.email ?? null}, ${body.whatsapp ?? null}, ${body.profissao ?? null}, ${body.motivo ?? null},
                ${body.source ?? "form_candidatura"}, ${body.event_id ?? null}, ${body.page_url ?? null}, ${ua}, ${ip})
        returning id::int as id`;
      const leadId = (ins.rows[0] as any)?.id;
      // espelha o lead na planilha do Google (aba OJNM 6 (NOV26)) — resultado fica auditado em leads.sheet_fwd
      const SHEET = Deno.env.get("SHEETS_WEBHOOK_URL");
      let fwd = "sem_webhook";
      if (SHEET) {
        try {
          const r = await fetch(SHEET, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nome: body.nome ?? "",
              telefone: body.whatsapp ?? "",
              email: body.email ?? "",
              cargo: (Array.isArray(body.profissao) ? body.profissao.join(", ") : (body.profissao ?? "")),
              motivo: body.motivo ?? "",
              anuncio: body.anuncio ?? "",
              status: "",
            }),
          });
          fwd = "ok:" + r.status;
        } catch (e) { fwd = ("erro:" + String(e)).slice(0, 120); /* não bloqueia o lead se a planilha falhar */ }
      }
      if (leadId) { try { await c.queryObject`update ojnm_crm.leads set sheet_fwd = ${fwd} where id = ${leadId}`; } catch (_) {} }
      return json({ ok: true });
    }

    // ---------- ação pública: funil do quiz (início e progresso — mede abandono por pergunta) ----------
    if (action === "quiz_track") {
      const sid = String(body.sid || "").slice(0, 64);
      if (!sid) return json({ ok: false, error: "sem_sid" }, 400);
      const p = Math.max(0, Math.min(8, Math.round(Number(body.progresso) || 0)));
      await c.queryObject`
        insert into ojnm_quiz.sessoes (sid, progresso, page_url, user_agent, ip)
        values (${sid}, ${p}, ${String(body.page_url || "").slice(0,300)},
                ${(req.headers.get("user-agent") || "").slice(0,300)},
                ${(req.headers.get("x-forwarded-for") || "").split(",")[0].trim()})
        on conflict (sid) do update set progresso = greatest(ojnm_quiz.sessoes.progresso, excluded.progresso), ultima_at = now()`;
      return json({ ok: true });
    }

    // ---------- ação pública: assertividade (a pessoa confirma cada slide do resultado) ----------
    if (action === "quiz_feedback") {
      const slide = Math.max(1, Math.min(3, Math.round(Number(body.slide) || 0)));
      const resposta = String(body.resposta || "") === "sim" ? "sim" : "quase";
      const rid = parseInt(String(body.rid), 10) || null;
      await c.queryObject`insert into ojnm_quiz.feedback (resultado_id, sid, slide, resposta)
        values (${rid}, ${String(body.sid || "") || null}, ${slide}, ${resposta})`;
      return json({ ok: true });
    }

    // ---------- ação pública: os 3 slides do diagnóstico, escritos por IA ----------
    // Slide 1 = quem ela é (reforça as escolhas dela). Slide 2 = onde ela está (lê os números).
    // Slide 3 = CID: consciência -> identificação -> decisão, fechando na Imersão.
    if (action === "quiz_texto") {
      const KEY = Deno.env.get("GEMINI_API_KEY");
      const PERFIS_N: Record<string, string> = {
        criador: "Criador — cria experiências, jogos e dinâmicas",
        facilitador: "Facilitador — conduz grupos e processos",
        especialista: "Especialista — domina o conteúdo técnico",
        mobilizador: "Mobilizador — gera energia e engajamento",
        transformador: "Transformador — provoca reflexão e mudança de comportamento",
      };
      const PERFIS_TIT: Record<string, string> = {
        criador: "O Criador", facilitador: "O Facilitador", especialista: "O Especialista",
        mobilizador: "O Mobilizador", transformador: "O Transformador",
      };
      const EIXO_N: Record<string, string> = {
        habilidade: "Habilidade (o quanto já sabe entregar)",
        solucao: "Solução (virar resposta para um problema da empresa)",
        valor: "Valor (mostrar o retorno para quem decide)",
        posicionamento: "Posicionamento (ser visto pelo resultado, não pelo formato)",
        venda: "Venda (levar a conversa até o contrato)",
      };
      const perfil = String(body.perfil || "").toLowerCase();
      const e = (body.eixos && typeof body.eixos === "object") ? body.eixos : {};
      const gap = String(body.gap || "solucao");
      const nome = String(body.nome || "").trim().split(/\s+/)[0] || "";
      if (!PERFIS_N[perfil]) return json({ ok: false, error: "perfil_invalido" }, 400);
      const nomeGap = (EIXO_N[gap] || gap).split(" (")[0];

      // reserva: se a IA falhar, os 3 slides existem do mesmo jeito
      const reserva = [
        { titulo: "Você é " + PERFIS_TIT[perfil],
          texto: (nome ? nome + ", pelas" : "Pelas") + " suas respostas, o seu jeito de trabalhar já está claro. Você tem uma forma própria de conduzir, e isso é matéria-prima de valor.",
          pergunta: "Faz sentido pra você?" },
        { titulo: "Onde você está agora",
          texto: "Você entrega bem, mas " + nomeGap.toLowerCase() + " é o ponto que segura o seu crescimento. É aí que a sua habilidade para de virar contrato.",
          pergunta: "É verdade isso?" },
        { titulo: "O que muda a partir daqui",
          texto: "Você não precisa de mais uma certificação. Precisa aprender a transformar o que já sabe fazer numa solução que a empresa entenda, valorize e contrate. É isso que a Imersão O Jogo Não Mente treina.",
          pergunta: "É isso que você quer?" },
      ];
      if (!KEY) return json({ ok: true, slides: reserva, ia: false });

      const notas = ["habilidade", "solucao", "valor", "posicionamento", "venda"]
        .map((k) => "- " + (EIXO_N[k] || k) + ": " + (Number(e[k]) || 0) + "/100").join("\n");
      const escolhas = Array.isArray(body.escolhas)
        ? body.escolhas.map((x: any, i: number) => (i + 1) + ") " + String(x.p || "").slice(0, 120) + " -> RESPOSTA: " + String(x.r || "").slice(0, 140)).join("\n")
        : "(não informado)";
      const prompt =
        "Você escreve o RESULTADO de um diagnóstico para TREINADORES CORPORATIVOS (quem faz treinamento, dinâmica e palestra para empresas).\n" +
        "O resultado é lido em 3 telas seguidas. Cada tela termina com uma pergunta de confirmação.\n\n" +
        "PESSOA:\n- Primeiro nome: " + (nome || "(sem nome)") + "\n- Perfil: " + PERFIS_N[perfil] + "\n" +
        "- Notas de 0 a 100 (maior = melhor):\n" + notas + "\n- Ponto mais fraco: " + (EIXO_N[gap] || gap) + "\n\n" +
        "O QUE ELA RESPONDEU NO QUIZ (use para ela se reconhecer):\n" + escolhas + "\n\n" +
        "REGRAS DE ESCRITA:\n" +
        "1. Português simples e direto, como uma conversa. Frases curtas.\n" +
        "2. Proibido jargão: nada de potencializar, alavancar, mindset, jornada, expertise, destravar.\n" +
        "3. Fale por voce. Use o primeiro nome no slide 1.\n" +
        "4. CITE as escolhas dela com as palavras dela — ela precisa pensar: isso sou eu.\n" +
        "5. Ela TEM uma força. Nunca diga que ela é ruim nem que tem um problema.\n" +
        "6. NÃO prometa faturamento, valores nem resultado garantido. Não cite preço.\n" +
        "7. Sem emoji, sem markdown, sem aspas.\n\n" +
        "CONTEÚDO DE CADA SLIDE:\n" +
        "- Slide 1 (quem ela é): comece com o nome. Descreva o jeito dela citando 2 escolhas concretas do quiz. 3 a 4 frases.\n" +
        "- Slide 2 (onde ela está): compare a nota ALTA com a BAIXA usando os números. Explique o que o ponto fraco causa no dia a dia. 3 a 4 frases.\n" +
        "- Slide 3 (a decisão): argumento forte e direto. Consciência (o que ela já tem), depois identificação (o que falta de verdade), depois decisão (a Imersão O Jogo Não Mente é onde se aprende essa passagem). 4 a 5 frases. Termine convidando.\n\n" +
        "As perguntas de confirmação devem ser curtas e naturais, diferentes entre si. Exemplos: Faz sentido pra você? / É verdade isso? / É isso que você quer?\n\n" +
        "Responda SOMENTE este JSON:\n" +
        '{"slides":[{"titulo":"curto, ate 6 palavras","texto":"...","pergunta":"..."},{"titulo":"...","texto":"...","pergunta":"..."},{"titulo":"...","texto":"...","pergunta":"..."}]}';

      try {
        const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
        const rr = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent?key=" + KEY,
          { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.8, responseMimeType: "application/json" } }) },
        );
        const jj = await rr.json();
        const out = JSON.parse(jj?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
        const arr = Array.isArray(out.slides) ? out.slides : [];
        const slides = reserva.map((r, i) => ({
          titulo: String(arr[i]?.titulo || r.titulo).slice(0, 90),
          texto: String(arr[i]?.texto || r.texto).slice(0, 900),
          pergunta: String(arr[i]?.pergunta || r.pergunta).slice(0, 90),
        }));
        // guarda os slides no resultado. O `rid` costuma ainda não ter chegado no front
        // (o submit_quiz roda em segundo plano), então achamos pelo sid da sessão.
        let rid = parseInt(String(body.rid), 10) || 0;
        const sidQ = String(body.sid || "");
        if (!rid && sidQ) {
          try {
            const f = await c.queryObject<{ id: number }>`
              select id::int as id from ojnm_quiz.resultados where sid = ${sidQ} order by created_at desc limit 1`;
            rid = f.rows[0]?.id ?? 0;
          } catch (_) {}
        }
        if (rid) {
          try { await c.queryObject`update ojnm_quiz.resultados set slides = ${JSON.stringify(slides)}::jsonb where id = ${rid}`; } catch (_) {}
        }
        return json({ ok: true, slides, ia: true });
      } catch (_) {
        return json({ ok: true, slides: reserva, ia: false });
      }
    }

    // ---------- ação pública: resultado do quiz de diagnóstico ----------
    // O score é RECALCULADO aqui (o cliente pode mandar qualquer coisa; a verdade é do servidor).
    // Regra: o comprador ideal tem HABILIDADE alta + capacidade comercial baixa (é a dor que a
    // imersão resolve). Quem não tem habilidade ainda não está pronto → teto de 49.
    if (action === "submit_quiz") {
      const PERFIS = ["criador", "facilitador", "especialista", "mobilizador", "transformador"];
      const EIXOS = ["habilidade", "solucao", "valor", "posicionamento", "venda"];
      const fone = String(body.whatsapp || "").replace(/\D/g, "");
      if (fone.length < 10) return json({ ok: false, error: "sem_telefone" }, 400);
      const perfil = PERFIS.includes(String(body.perfil || "").toLowerCase()) ? String(body.perfil).toLowerCase() : null;
      if (!perfil) return json({ ok: false, error: "perfil_invalido" }, 400);
      const e: Record<string, number> = {};
      for (const k of EIXOS) {
        const v = Math.round(Number((body.eixos || {})[k]));
        e[k] = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
      }
      const comercial = (e.solucao + e.valor + e.posicionamento + e.venda) / 4;
      let score = Math.round(e.habilidade * 0.4 + (100 - comercial) * 0.6);
      if (e.habilidade < 20) score = Math.min(score, 49); // só quem está começando do zero (nota 0)
      score = Math.max(0, Math.min(100, score));
      const faixa = score < 30 ? "frio" : score < 50 ? "curioso" : score < 70 ? "potencial" : score < 85 ? "qualificado" : "hot";
      // gap = eixo comercial mais fraco (o que a imersão vai destravar)
      let gap = "solucao";
      for (const k of ["solucao", "valor", "posicionamento", "venda"]) if (e[k] < e[gap]) gap = k;

      const nome = String(body.nome || "").trim().slice(0, 120) || null;
      const mail = String(body.email || "").trim().slice(0, 160) || null;
      const tags = ["Quiz", cap(perfil), cap(faixa)];
      const resumo = "Quiz: " + perfil + " · score " + score + " (" + faixa + ") · gap: " + gap;

      // 1 lead por telefone: se já existe, ENRIQUECE (não duplica e não mexe na etapa/dono)
      const ex = await c.queryObject<{ id: number }>`
        select id::int as id from ojnm_crm.leads
        where regexp_replace(coalesce(whatsapp,''),'[^0-9]','','g') = ${fone} order by created_at desc limit 1`;
      let leadId = ex.rows[0]?.id ?? 0;
      if (leadId) {
        await c.queryObject`
          update ojnm_crm.leads set
            nome = coalesce(nullif(${nome}::text,''), nome),
            email = coalesce(nullif(${mail}::text,''), email),
            tags = (select array_agg(distinct x) from unnest(coalesce(tags,'{}'::text[]) || ${tags}::text[]) x)
          where id = ${leadId}`;
      } else {
        const ins = await c.queryObject<{ id: number }>`
          insert into ojnm_crm.leads (nome, email, whatsapp, motivo, source, page_url, user_agent, ip, tags)
          values (${nome}, ${mail}, ${body.whatsapp ?? null}, ${resumo}, 'quiz', ${body.page_url ?? null},
                  ${req.headers.get("user-agent") || ""}, ${(req.headers.get("x-forwarded-for") || "").split(",")[0].trim()},
                  ${tags}::text[])
          returning id::int as id`;
        leadId = (ins.rows[0] as any)?.id ?? 0;
      }
      // o DIAGNÓSTICO mora no schema próprio do quiz; o CRM guarda só o lead + as etiquetas
      const resIns = await c.queryObject<{ id: number }>`
        insert into ojnm_quiz.resultados (sid, nome, whatsapp, email, perfil, perfil_votos, eixos, score, faixa, gap, respostas, page_url, lead_id)
        values (${String(body.sid || "") || null}, ${nome}, ${body.whatsapp ?? null}, ${mail}, ${perfil},
                ${JSON.stringify(body.votos ?? {})}::jsonb, ${JSON.stringify(e)}::jsonb, ${score}, ${faixa}, ${gap},
                ${JSON.stringify(body.respostas ?? [])}::jsonb, ${body.page_url ?? null}, ${leadId || null})
        returning id::int as id`;
      const rid = (resIns.rows[0] as any)?.id ?? null;
      try {
        await c.queryObject`update ojnm_quiz.sessoes set concluiu = true, ultima_at = now(), progresso = 8 where sid = ${String(body.sid || "")}`;
      } catch (_) {}
      if (leadId) {
        try { await c.queryObject`insert into ojnm_crm.lead_events (lead_id, kind, actor, note) values (${leadId}, 'quiz', null, ${resumo})`; } catch (_) {}
        // espelha na planilha (mesma ponte do formulário)
        const SHEET = Deno.env.get("SHEETS_WEBHOOK_URL");
        if (SHEET) {
          emBackground(fetch(SHEET, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome: nome ?? "", telefone: body.whatsapp ?? "", email: mail ?? "",
              cargo: "Perfil: " + perfil, motivo: resumo, anuncio: "quiz", status: faixa }) }).catch(() => {}));
        }
      }
      return json({ ok: true, id: leadId, rid, perfil, score, faixa, gap, eixos: e });
    }

    // ---------- ação pública: registrar visita na LP (métrica de tráfego) ----------
    if (action === "track_visit") {
      const vid = String(body.vid || "").slice(0, 64);
      if (!vid) return json({ ok: false }, 400);
      const page = String(body.page || "/").slice(0, 200);
      const ua = (req.headers.get("user-agent") || "").slice(0, 300);
      const src = body.src === "pago" ? "pago" : "organico"; // origem real (utm/fbclid na URL)
      await c.queryObject`insert into ojnm_crm.visits (vid, page, ua, src) values (${vid}, ${page}, ${ua}, ${src})`;
      return json({ ok: true });
    }

    // ---------- ação pública: lead clicou no botão do WhatsApp p/ liberar a Comunidade EJC → tag "Comunidade" ----------
    if (action === "claim_community") {
      const phone = String(body.whatsapp || "").replace(/\D/g, "");
      if (phone.length < 8) return json({ ok: false, error: "sem_telefone" }, 400);
      // Dono do lead = atendente que o round-robin sorteou. A página manda o TELEFONE do atendente
      // (não o nome), e o servidor resolve — ação pública não pode aceitar nome arbitrário como etiqueta.
      const atendPhone = String(body.atendente_phone || "").replace(/\D/g, "");
      let dono: string | null = ATENDENTES.find((a) => a.phone === atendPhone)?.name ?? null;
      if (dono) { // usa o nome canônico do CRM quando o 1º nome bate com um usuário cadastrado
        try {
          const first = dono.split(/\s+/)[0];
          const ad = await c.queryObject<{ name: string }>`
            select name from ojnm_crm.admins where name is not null and split_part(name,' ',1) ilike ${first} limit 1`;
          if (ad.rows[0]?.name) dono = ad.rows[0].name;
        } catch (_) {}
      }
      const r = await c.queryObject<{ id: number }>`
        update ojnm_crm.leads
        set tags = (select array_agg(distinct e) from unnest(
              coalesce(tags,'{}'::text[]) || 'Comunidade'::text ||
              case when ${dono}::text is null then '{}'::text[] else array[${dono}::text] end) e)
        where regexp_replace(coalesce(whatsapp,''), '[^0-9]', '', 'g') = ${phone}
        returning id::int as id`;
      // histórico: registra o pedido de Comunidade (1x por lead — cliques repetidos não poluem a timeline)
      for (const row of r.rows) {
        try {
          await c.queryObject`insert into ojnm_crm.lead_events (lead_id, kind, note)
            select ${row.id}, 'community', ${'clicou no botão da Comunidade EJC (página de obrigado)' + (dono ? ' · direcionado para ' + dono : '')}
            where not exists (select 1 from ojnm_crm.lead_events where lead_id = ${row.id} and kind = 'community')`;
          if (dono) {
            await c.queryObject`insert into ojnm_crm.lead_events (lead_id, kind, actor, note)
              select ${row.id}, 'assign', ${dono}, 'atribuído pelo rodízio do WhatsApp da Comunidade'
              where not exists (select 1 from ojnm_crm.lead_events where lead_id = ${row.id} and kind = 'assign' and actor = ${dono})`;
          }
        } catch (_) {}
      }
      return json({ ok: true, updated: r.rowCount ?? 0, dono });
    }

    // ---------- ação pública: round-robin do WhatsApp da Comunidade (distribui os leads entre os atendentes) ----------
    // cada acesso à página de obrigado pega a PRÓXIMA posição da roda (rodízio ponderado).
    if (action === "community_number") {
      let idx = 0;
      try {
        const upd = await c.queryObject<{ n: number }>`
          insert into ojnm_crm.meta_cache (k, v, at) values ('community_rr', '{"n":0}'::jsonb, now())
          on conflict (k) do update set v = jsonb_build_object('n', (coalesce((meta_cache.v->>'n')::int,0)+1)), at = now()
          returning (v->>'n')::int as n`;
        idx = Number(upd.rows[0]?.n ?? 0) % RODA.length;
      } catch (_) { idx = 0; }
      const key = RODA[idx];
      const pick = ATENDENTES.find((a) => a.key === key) ?? ATENDENTES[0];
      return json({ ok: true, name: pick.name, phone: pick.phone });
    }

    // ---------- login por e-mail (allowlist) ----------
    if (action === "login") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) return json({ ok: false, error: "email_vazio" }, 400);
      const adm = await c.queryObject<{ role: string; members: string[] | null; name: string | null }>`
        select role, members, name from ojnm_crm.admins where email = ${email}`;
      if (adm.rows.length === 0) return json({ ok: false, error: "nao_autorizado" }, 403);
      const tk = newToken();
      await c.queryObject`insert into ojnm_crm.sessions (token, email, expires_at)
        values (${tk}, ${email}, now() + interval '30 days')`;
      return json({ ok: true, token: tk, email, role: adm.rows[0].role, members: adm.rows[0].members ?? [], name: adm.rows[0].name ?? null });
    }

    // ---------- daqui pra baixo exige sessão válida de admin ----------
    const tk = String(body.token || "");
    if (!tk) return json({ ok: false, error: "sem_sessao" }, 401);
    const sess = await c.queryObject<{ email: string; role: string; members: string[] | null; who: string | null; name: string | null }>`
      select s.email, s.who, a.role, a.members, a.name from ojnm_crm.sessions s
      join ojnm_crm.admins a on a.email = s.email
      where s.token = ${tk} and s.expires_at > now()`;
    const email = sess.rows[0]?.email;
    const role = sess.rows[0]?.role;
    const members = sess.rows[0]?.members ?? [];
    if (!email) return json({ ok: false, error: "sessao_invalida" }, 401);
    // nome de exibição do usuário logado (p/ etiquetas): identidade escolhida > nome do admin > e-mail
    const meuNome = (sess.rows[0]?.who || sess.rows[0]?.name || email) as string;

    // registra quem é (login compartilhado da diretoria) + log de acesso
    if (action === "set_identity") {
      const who = String(body.who || "").trim();
      if (members.length && who && !members.includes(who)) return json({ ok: false, error: "who_invalido" }, 400);
      await c.queryObject`update ojnm_crm.sessions set who = ${who || null} where token = ${tk}`;
      await c.queryObject`insert into ojnm_crm.access_log (email, who) values (${email}, ${who || null})`;
      return json({ ok: true });
    }

    // heartbeat de presença — grava 1 minuto ativo (dedupe por PK). Qualquer sessão válida.
    if (action === "beat") {
      const who = (sess.rows[0]?.who || "") as string;
      await c.queryObject`insert into ojnm_crm.activity (email, who, minute)
        values (${email}, ${who}, date_trunc('minute', now())) on conflict do nothing`;
      return json({ ok: true });
    }

    // relatório completo — SÓ o admin geral
    if (action === "stats") {
      if (role !== "geral") return json({ ok: false, error: "sem_permissao" }, 403);
      const TZ = "America/Sao_Paulo"; // horários em horário de Brasília
      const perUser = await c.queryObject`
        select coalesce(nullif(a.who,''), adm.name, a.email) as label, a.email,
               count(*)::int as min_total,
               count(*) filter (where (a.minute at time zone ${TZ}) >= date_trunc('day', now() at time zone ${TZ}))::int as min_hoje,
               count(*) filter (where a.minute >= now() - interval '7 days')::int  as min_7d,
               count(*) filter (where a.minute >= now() - interval '30 days')::int as min_30d,
               max(a.minute) as last_seen
        from ojnm_crm.activity a
        left join ojnm_crm.admins adm on adm.email = a.email
        group by 1, a.email order by min_total desc`;
      const byDay = await c.queryObject`
        select to_char((minute at time zone ${TZ})::date,'YYYY-MM-DD') as dia, count(*)::int as min
        from ojnm_crm.activity where minute >= now() - interval '30 days' group by 1 order by 1`;
      const byHour = await c.queryObject`
        select extract(hour from (minute at time zone ${TZ}))::int as h, count(*)::int as min
        from ojnm_crm.activity group by 1 order by 1`;
      const byWeekday = await c.queryObject`
        select extract(dow from (minute at time zone ${TZ}))::int as d, count(*)::int as min
        from ojnm_crm.activity group by 1 order by 1`;
      const leadsByStatus = await c.queryObject`
        select coalesce(nullif(status,''),'novo') as status, count(*)::int as n from ojnm_crm.leads group by 1`;
      const leadsByOwner = await c.queryObject`
        select tag, count(*)::int as n from (select unnest(tags) as tag from ojnm_crm.leads where tags is not null) t
        group by tag order by n desc`;
      const leadsByCat = await c.queryObject`
        select coalesce(motive_cat,'❓ Não classificado') as cat, count(*)::int as n from ojnm_crm.leads group by 1 order by n desc`;
      const totals = await c.queryObject`
        select count(*)::int as total,
          count(*) filter (where (created_at at time zone ${TZ}) >= date_trunc('day', now() at time zone ${TZ}))::int as hoje,
          count(*) filter (where created_at >= now() - interval '7 days')::int  as d7,
          count(*) filter (where created_at >= now() - interval '30 days')::int as d30,
          count(*) filter (where status='matriculado')::int as matriculado,
          count(*) filter (where status='perdido')::int     as perdido,
          count(*) filter (where tags is null or array_length(tags,1) is null)::int as sem_dono
        from ojnm_crm.leads`;
      return json({ ok: true, perUser: perUser.rows, byDay: byDay.rows, byHour: byHour.rows,
        byWeekday: byWeekday.rows, leadsByStatus: leadsByStatus.rows, leadsByOwner: leadsByOwner.rows,
        leadsByCat: leadsByCat.rows, totals: totals.rows[0] });
    }

    if (action === "leads") {
      const r = await c.queryObject`
        select l.id::int as id, l.created_at, l.nome, l.whatsapp, l.profissao, l.motivo, l.source, l.event_id,
               l.page_url, l.status, l.tags, l.motive_cat, l.bia_resumo, l.bia_temperatura, l.bia_score,
               q.perfil as quiz_perfil, q.score as quiz_score, q.faixa as quiz_faixa, q.gap as quiz_gap
        from ojnm_crm.leads l
        left join lateral (
          select perfil, score, faixa, gap from ojnm_quiz.resultados r
          where r.lead_id = l.id order by r.created_at desc limit 1
        ) q on true
        order by l.created_at desc limit 5000`;
      let leads = r.rows as any[];
      // visibilidade por dono: admin (geral) vê TUDO; gestão vê o pool NOVO (leads sem dono)
      // + SÓ os leads que ela mesma etiquetou. Ao etiquetar, o lead some do pool das outras pessoas.
      if (role !== "geral") {
        const RESERVED = TAGS_FLAG; // Comunidade/Quiz/perfil/faixa não são donos
        const myFirst = String(meuNome).trim().split(/\s+/)[0].toLowerCase();
        leads = leads.filter((l: any) => {
          const person = (l.tags || []).filter((t: string) => !RESERVED.has(String(t).toLowerCase()));
          if (person.length === 0) return true; // sem dono → pool visível a todos
          return person.some((t: string) => String(t).trim().split(/\s+/)[0].toLowerCase() === myFirst);
        });
      }
      return json({ ok: true, email, meuNome, role, leads });
    }

    // painel de tráfego (campanha) — SÓ o admin geral
    if (action === "traffic_stats") {
      if (role !== "geral") return json({ ok: false, error: "sem_permissao" }, 403);
      const TZ = "America/Sao_Paulo";
      const TICKET = Number(Deno.env.get("OJNM_TICKET") || 4200); // ticket da oferta (receita estimada)
      // exclui robôs/testes da contagem (Lighthouse, headless, browser do Claude, e2e) — nada é apagado
      const vis = await c.queryObject`
        select count(distinct vid)::int as visitantes, count(*)::int as pageviews,
          count(distinct vid) filter (where src = 'pago')::int as pagas,
          count(distinct vid) filter (where (created_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date)::int as hoje,
          count(distinct vid) filter (where src = 'pago' and (created_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date)::int as hoje_pagas,
          min(created_at) as primeira
        from ojnm_crm.visits
        where coalesce(ua,'') not ilike '%headless%' and coalesce(ua,'') not ilike '%lighthouse%'
          and coalesce(ua,'') not ilike '%claude%' and vid not like 'e2e%'
          and coalesce(ua,'') not ilike '%bot%' and coalesce(ua,'') not ilike '%crawler%'
          and coalesce(ua,'') not ilike '%spider%' and coalesce(ua,'') not ilike '%inspectiontool%'`;
      const visDay = await c.queryObject`
        select to_char((created_at at time zone ${TZ})::date,'YYYY-MM-DD') as dia, count(distinct vid)::int as n
        from ojnm_crm.visits where created_at >= now() - interval '30 days'
          and coalesce(ua,'') not ilike '%headless%' and coalesce(ua,'') not ilike '%lighthouse%'
          and coalesce(ua,'') not ilike '%claude%' and vid not like 'e2e%'
          and coalesce(ua,'') not ilike '%bot%' and coalesce(ua,'') not ilike '%crawler%'
          and coalesce(ua,'') not ilike '%spider%' and coalesce(ua,'') not ilike '%inspectiontool%'
        group by 1 order by 1`;
      // lead pago = chegou com marcação de anúncio na URL (utm/fbclid) — dado real, sem modelagem
      const lds = await c.queryObject`
        select count(*)::int as total,
          count(*) filter (where coalesce(page_url,'') ilike '%utm_medium=paid%' or coalesce(page_url,'') ilike '%fbclid=%' or coalesce(page_url,'') ilike '%utm_id=%')::int as pagos,
          count(*) filter (where (created_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date)::int as hoje,
          count(*) filter (where (coalesce(page_url,'') ilike '%utm_medium=paid%' or coalesce(page_url,'') ilike '%fbclid=%' or coalesce(page_url,'') ilike '%utm_id=%')
            and (created_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date)::int as hoje_pagos,
          count(*) filter (where status='matriculado')::int as matriculados,
          min(created_at) as primeiro
        from ojnm_crm.leads`;
      const ldsDay = await c.queryObject`
        select to_char((created_at at time zone ${TZ})::date,'YYYY-MM-DD') as dia, count(*)::int as n
        from ojnm_crm.leads where created_at >= now() - interval '30 days' group by 1 order by 1`;
      const recent = await c.queryObject`
        select id::int as id, created_at, nome, whatsapp, status, motive_cat, profissao,
          case when coalesce(page_url,'') ilike '%utm_medium=paid%' or coalesce(page_url,'') ilike '%fbclid=%' or coalesce(page_url,'') ilike '%utm_id=%'
               then 'pago' else 'organico' end as origem
        from ojnm_crm.leads order by created_at desc limit 10`;

      // Meta Ads (opcional): secrets META_ADS_TOKEN + META_CAMPAIGN_ID (preferido; a conta é
      // compartilhada com outras campanhas) ou META_AD_ACCOUNT. Cache 120s (polling do painel é 60s).
      let meta: unknown = null;
      let metaError: string | null = null;
      const MTK = Deno.env.get("META_ADS_TOKEN");
      const CAMP = Deno.env.get("META_CAMPAIGN_ID");
      const ACCT = Deno.env.get("META_AD_ACCOUNT");
      if (MTK && (CAMP || ACCT)) {
        try {
          const cache = await c.queryObject<{ v: unknown; fresh: boolean }>`
            select v, (at > now() - interval '120 seconds') as fresh from ojnm_crm.meta_cache where k = 'traffic_v3'`;
          if (cache.rows.length && cache.rows[0].fresh) {
            meta = cache.rows[0].v;
          } else {
            const V = Deno.env.get("META_API_VERSION") || "v21.0";
            const gf = (base: string, p: string) => fetch(`https://graph.facebook.com/${V}/${base}/${p}&access_token=${MTK}`).then((r) => r.json());
            // leads do Meta = UMA métrica canônica (o Meta reporta o MESMO lead sob vários rótulos; somar inflava ~4x)
            const leadsOf = (acts: any[]) => {
              const m: Record<string, number> = {};
              for (const a of acts || []) m[String(a.action_type)] = Number(a.value || 0);
              return m["lead"] ?? m["offsite_conversion.fb_pixel_lead"] ?? m["onsite_conversion.lead_grouped"] ?? m["leadgen.other"] ?? 0;
            };
            const lpvOf = (acts: any[]) => {
              let n = 0;
              for (const a of acts || []) if (String(a.action_type) === "landing_page_view") n += Number(a.value || 0);
              return n;
            };
            // leads REAIS por campanha (utm_id no page_url do formulário) — dado do CRM, não atribuição
            const realByCamp = await c.queryObject<{ cid: string; total: number; hoje: number }>`
              select substring(page_url from 'utm_id=([0-9]+)') as cid,
                count(*)::int as total,
                count(*) filter (where (created_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date)::int as hoje
              from ojnm_crm.leads where page_url ~ 'utm_id=[0-9]+' group by 1`;
            const realMap: Record<string, { total: number; hoje: number }> = {};
            for (const r of realByCamp.rows) realMap[String(r.cid)] = { total: Number(r.total), hoje: Number(r.hoje) };

            // uma ou mais campanhas (META_CAMPAIGN_ID pode ser lista separada por vírgula); senão a conta inteira
            const bases = CAMP
              ? String(CAMP).split(",").map((s) => s.trim()).filter(Boolean)
              : ["act_" + String(ACCT).replace(/^act_/, "")];
            async function oneCampaign(base: string) {
              // nome buscado à parte: campanha sem entrega (pausada) não retorna campaign_name no insights
              const nameReq = fetch(`https://graph.facebook.com/${V}/${base}?fields=name&access_token=${MTK}`).then((r) => r.json()).catch(() => ({}));
              const [nm, ji, jt, ja, jd] = await Promise.all([
                nameReq,
                gf(base, "insights?fields=spend,impressions,clicks,actions,campaign_name&date_preset=maximum"),
                gf(base, "insights?fields=spend,impressions,clicks,actions&date_preset=today"),
                gf(base, "ads?fields=name,insights.date_preset(maximum){spend,impressions,clicks,actions}&limit=100"),
                gf(base, "insights?fields=spend,actions&date_preset=maximum&time_increment=1&limit=500"),
              ]);
              if (ji.error) throw new Error(ji.error.message);
              const tot = (ji.data && ji.data[0]) || {};
              const hj = (jt.data && jt.data[0]) || {};
              const ads = (ja.data || []).map((ad: any) => {
                const s = (ad.insights && ad.insights.data && ad.insights.data[0]) || {};
                return { name: ad.name, spend: Number(s.spend || 0), impressions: Number(s.impressions || 0), clicks: Number(s.clicks || 0), leads: leadsOf(s.actions) };
              }).sort((a: any, b: any) => b.leads - a.leads || b.spend - a.spend);
              const nome = (nm && nm.name) || tot.campaign_name || base;
              const mt = String(nome).match(/\bV(\d+)\b/i);
              const tag = mt ? ("V" + mt[1]) : String(nome);
              const real = realMap[base] || { total: 0, hoje: 0 };
              return {
                id: base, nome, tag,
                spend: Number(tot.spend || 0), impressions: Number(tot.impressions || 0), clicks: Number(tot.clicks || 0),
                leads: leadsOf(tot.actions), lpv: lpvOf(tot.actions), since: tot.date_start || null,
                leadsReais: real.total, leadsReaisHoje: real.hoje,
                hoje: { spend: Number(hj.spend || 0), impressions: Number(hj.impressions || 0), clicks: Number(hj.clicks || 0), leads: leadsOf(hj.actions), lpv: lpvOf(hj.actions) },
                porDia: (jd.data || []).map((r: any) => ({ dia: r.date_start, spend: Number(r.spend || 0), leads: leadsOf(r.actions), lpv: lpvOf(r.actions) })),
                ads,
              };
            }
            const campanhas = await Promise.all(bases.map(oneCampaign));
            // agregado (soma das campanhas) pro placar do topo
            const agg: any = { spend: 0, impressions: 0, clicks: 0, leads: 0, lpv: 0, since: null,
              hoje: { spend: 0, impressions: 0, clicks: 0, leads: 0, lpv: 0 }, porDia: [] as any[], ads: [] as any[], campanhas };
            const dayMap: Record<string, any> = {};
            for (const cc of campanhas) {
              agg.spend += cc.spend; agg.impressions += cc.impressions; agg.clicks += cc.clicks; agg.leads += cc.leads; agg.lpv += cc.lpv;
              if (cc.since && (!agg.since || cc.since < agg.since)) agg.since = cc.since;
              agg.hoje.spend += cc.hoje.spend; agg.hoje.impressions += cc.hoje.impressions; agg.hoje.clicks += cc.hoje.clicks; agg.hoje.leads += cc.hoje.leads; agg.hoje.lpv += cc.hoje.lpv;
              for (const dd of cc.porDia) { const e = dayMap[dd.dia] || (dayMap[dd.dia] = { dia: dd.dia, spend: 0, leads: 0, lpv: 0 }); e.spend += dd.spend; e.leads += dd.leads; e.lpv += dd.lpv; }
              for (const a of cc.ads) agg.ads.push({ ...a, campanha: cc.tag });
            }
            agg.porDia = Object.values(dayMap).sort((a: any, b: any) => String(a.dia).localeCompare(String(b.dia)));
            agg.ads.sort((a: any, b: any) => b.leads - a.leads || b.spend - a.spend);
            meta = agg;
            await c.queryObject`insert into ojnm_crm.meta_cache (k, v, at) values ('traffic_v3', ${JSON.stringify(meta)}::jsonb, now())
              on conflict (k) do update set v = excluded.v, at = excluded.at`;
          }
        } catch (e) { metaError = String(e).slice(0, 300); }
      }
      return json({
        ok: true, ticket: TICKET,
        visitas: vis.rows[0], visitasPorDia: visDay.rows,
        leads: lds.rows[0], leadsPorDia: ldsDay.rows, recentes: recent.rows,
        meta, metaError, metaConfigurado: Boolean(MTK && (CAMP || ACCT)),
      });
    }

    // reenviar leads pra planilha (recuperação de falha da ponte) — só geral
    if (action === "sheet_resend") {
      if (role !== "geral") return json({ ok: false, error: "sem_permissao" }, 403);
      const SHEET = Deno.env.get("SHEETS_WEBHOOK_URL");
      if (!SHEET) return json({ ok: false, error: "sem_webhook" }, 400);
      const ids = (Array.isArray(body.ids) ? body.ids : []).map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x));
      if (!ids.length) return json({ ok: false, error: "sem_ids" }, 400);
      const rows = await c.queryObject`
        select id::int as id, nome, email, whatsapp, profissao, motivo, page_url,
          to_char(created_at at time zone 'America/Sao_Paulo','DD/MM HH24:MI') as quando
        from ojnm_crm.leads where id = any(${ids})`;
      const out: any[] = [];
      for (const r of rows.rows as any[]) {
        const pago = /utm_medium=paid|fbclid=|utm_id=/.test(String(r.page_url || ""));
        let fwd = "";
        try {
          const resp = await fetch(SHEET, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nome: r.nome ?? "", telefone: r.whatsapp ?? "", email: r.email ?? "",
              cargo: r.profissao ?? "", motivo: r.motivo ?? "",
              anuncio: pago ? "meta-ads" : "organico",
              status: "recuperado (chegou " + r.quando + ")",
            }),
          });
          fwd = "ok:reenviado:" + resp.status;
        } catch (e) { fwd = ("erro:" + String(e)).slice(0, 120); }
        try { await c.queryObject`update ojnm_crm.leads set sheet_fwd = ${fwd} where id = ${r.id}`; } catch (_) {}
        out.push({ id: r.id, whatsapp: r.whatsapp, fwd });
      }
      return json({ ok: true, enviados: out });
    }

    // mover lead no kanban — geral E diretoria podem
    // painel Equipe (só geral): produtividade por pessoa — leads, fases, tempo de atendimento
    if (action === "team_stats") {
      if (role !== "geral") return json({ ok: false, error: "sem_permissao" }, 403);
      const NOW = Date.now();
      const TERM = ["matriculado", "perdido"];
      const leadsR = await c.queryObject<{ id: number; nome: string | null; whatsapp: string; status: string; motive_cat: string | null; created_ms: number; changed_ms: number; tags: string[] | null }>`
        select id::int as id, nome, whatsapp, coalesce(nullif(status,''),'novo') as status, motive_cat,
          (extract(epoch from created_at)*1000)::double precision as created_ms,
          (extract(epoch from coalesce(status_changed_at, created_at))*1000)::double precision as changed_ms,
          tags
        from ojnm_crm.leads order by created_at desc`;
      const termR = await c.queryObject<{ lead_id: number; closed_ms: number }>`
        select lead_id::int as lead_id, (extract(epoch from min(at))*1000)::double precision as closed_ms
        from ojnm_crm.lead_events where to_status in ('matriculado','perdido') group by lead_id`;
      const admR = await c.queryObject<{ name: string | null; members: string[] | null }>`
        select name, members from ojnm_crm.admins`;

      const closedMap = new Map<number, number>();
      for (const t of termR.rows) closedMap.set(Number(t.lead_id), Number(t.closed_ms));

      // normaliza apelidos → nome canônico do admin (ex.: primeiro nome da etiqueta → nome completo cadastrado)
      const alias = new Map<string, string>();
      const regName = (n: string) => {
        if (!n) return;
        alias.set(n.toLowerCase(), n);
        const first = n.split(/\s+/)[0].toLowerCase();
        if (first && !alias.has(first)) alias.set(first, n);
      };
      for (const a of admR.rows) { if (a.name) regName(a.name); for (const m of (a.members || [])) regName(m); }
      const canon = (t: string) => alias.get(String(t).toLowerCase()) || t;

      const pessoas = new Map<string, any>();
      const ensure = (nome: string) => {
        if (!pessoas.has(nome)) {
          pessoas.set(nome, {
            nome, total: 0,
            porFase: { bia: 0, novo: 0, contato: 0, negociando: 0, matriculado: 0, perdido: 0 },
            _paradoSum: 0, _paradoN: 0, _atendSum: 0, _atendN: 0, leads: [],
          });
        }
        return pessoas.get(nome);
      };
      for (const a of admR.rows) {
        if (a.name) ensure(a.name);
        for (const m of (a.members || [])) ensure(m);
      }

      const fasesGlobais: Record<string, number> = { bia: 0, novo: 0, contato: 0, negociando: 0, matriculado: 0, perdido: 0 };
      let semDono = 0;
      const RESERVED = TAGS_FLAG; // tags-flag (não são pessoas): Comunidade, Quiz, perfil e faixa

      for (const l of leadsR.rows) {
        const st = String(l.status);
        if (st in fasesGlobais) fasesGlobais[st]++;
        const tags = (l.tags || []).filter(Boolean);
        // dono = etiqueta de pessoa (dedup canônico); ignora tags-flag como "Comunidade"
        const donos = Array.from(new Set(tags.map(canon))).filter((n: string) => !RESERVED.has(String(n).toLowerCase()));
        if (!donos.length) { semDono++; continue; }
        const closed = closedMap.get(Number(l.id)) || null;
        for (const nome of donos) {
          const p = ensure(nome);
          p.total++;
          if (st in p.porFase) p.porFase[st]++;
          if (!TERM.includes(st)) { p._paradoSum += (NOW - Number(l.changed_ms)); p._paradoN++; }
          if (closed) { p._atendSum += (closed - Number(l.created_ms)); p._atendN++; }
          p.leads.push({
            id: l.id, nome: l.nome, whatsapp: l.whatsapp, status: st, motive_cat: l.motive_cat,
            created_ms: Number(l.created_ms), changed_ms: Number(l.changed_ms), closed_ms: closed,
          });
        }
      }

      const out = Array.from(pessoas.values()).map((p: any) => ({
        nome: p.nome, total: p.total, porFase: p.porFase,
        paradoMedioMs: p._paradoN ? Math.round(p._paradoSum / p._paradoN) : null,
        atendMedioMs: p._atendN ? Math.round(p._atendSum / p._atendN) : null,
        leads: p.leads,
      })).sort((a: any, b: any) => b.total - a.total || String(a.nome).localeCompare(String(b.nome)));

      return json({ ok: true, pessoas: out, fasesGlobais, semDono, now_ms: NOW });
    }

    if (action === "lead_move") {
      const id = parseInt(String(body.id), 10);
      const st = String(body.status || "");
      const ok = ["bia", "novo", "contato", "negociando", "matriculado", "perdido"].includes(st); // "bia" = coluna de entrada da extensão
      if (!id || !ok) return json({ ok: false, error: "invalido" }, 400);
      const cur = await c.queryObject<{ s: string }>`select coalesce(nullif(status,''),'novo') as s from ojnm_crm.leads where id = ${id}`;
      const old = cur.rows[0]?.s ?? "novo";
      await c.queryObject`update ojnm_crm.leads set status = ${st}, status_changed_at = now() where id = ${id}`;
      if (old !== st) { // histórico p/ métrica de tempo de atendimento (Equipe)
        try { await c.queryObject`insert into ojnm_crm.lead_events (lead_id, kind, from_status, to_status, actor) values (${id}, 'move', ${old}, ${st}, ${meuNome})`; } catch (_) {}
      }
      return json({ ok: true });
    }

    // etiqueta com o nome do usuário logado — geral E diretoria podem
    if (action === "lead_tag_add") {
      const id = parseInt(String(body.id), 10);
      if (!id) return json({ ok: false, error: "id" }, 400);
      // usa o nome do usuário logado (não aceita nome arbitrário do cliente)
      await c.queryObject`update ojnm_crm.leads
        set tags = (select array_agg(distinct e) from unnest(tags || ${meuNome}::text) e)
        where id = ${id}`;
      try { await c.queryObject`insert into ojnm_crm.lead_events (lead_id, kind, actor) values (${id}, 'assign', ${meuNome})`; } catch (_) {}
      return json({ ok: true, tag: meuNome });
    }
    if (action === "lead_tag_remove") {
      const id = parseInt(String(body.id), 10);
      const nome = String(body.tag || "");
      if (!id || !nome) return json({ ok: false, error: "invalido" }, 400);
      await c.queryObject`update ojnm_crm.leads set tags = array_remove(tags, ${nome}) where id = ${id}`;
      try { await c.queryObject`insert into ojnm_crm.lead_events (lead_id, kind, actor, note) values (${id}, 'unassign', ${meuNome}, ${'removeu a etiqueta "' + nome + '"'})`; } catch (_) {}
      return json({ ok: true });
    }

    // painel do funil do quiz + importação pro CRM (SÓ admin)
    // O quiz já cria o lead no CRM na hora; esta ação existe pra RELIGAR resultados órfãos
    // (ex.: lead apagado, ou se um dia o auto-create for desligado).
    if (action === "quiz_stats" || action === "quiz_importar") {
      if (role !== "geral") return json({ ok: false, error: "sem_permissao" }, 403);

      if (action === "quiz_importar") {
        const orfaos = await c.queryObject<{ id: number; nome: string; whatsapp: string; email: string; perfil: string; faixa: string; score: number; gap: string }>`
          select id::int as id, nome, whatsapp, email, perfil, faixa, score, gap
          from ojnm_quiz.resultados where lead_id is null and coalesce(whatsapp,'') <> ''`;
        let criados = 0, religados = 0;
        for (const r of orfaos.rows) {
          const fone = String(r.whatsapp || "").replace(/\D/g, "");
          const tags = ["Quiz", cap(r.perfil), cap(r.faixa)];
          const ex = await c.queryObject<{ id: number }>`
            select id::int as id from ojnm_crm.leads
            where regexp_replace(coalesce(whatsapp,''),'[^0-9]','','g') = ${fone} order by created_at desc limit 1`;
          let lid = ex.rows[0]?.id ?? 0;
          if (lid) {
            await c.queryObject`update ojnm_crm.leads
              set tags = (select array_agg(distinct x) from unnest(coalesce(tags,'{}'::text[]) || ${tags}::text[]) x) where id = ${lid}`;
            religados++;
          } else {
            const ins = await c.queryObject<{ id: number }>`
              insert into ojnm_crm.leads (nome, email, whatsapp, motivo, source, tags)
              values (${r.nome}, ${r.email}, ${r.whatsapp}, ${"Quiz: " + r.perfil + " · score " + r.score + " (" + r.faixa + ") · gap: " + r.gap},
                      'quiz', ${tags}::text[]) returning id::int as id`;
            lid = (ins.rows[0] as any)?.id ?? 0; criados++;
          }
          if (lid) await c.queryObject`update ojnm_quiz.resultados set lead_id = ${lid} where id = ${r.id}`;
        }
        return json({ ok: true, criados, religados });
      }

      const funil = await c.queryObject`
        select count(*)::int as sessoes,
               count(*) filter (where concluiu)::int as concluiram,
               count(*) filter (where not concluiu and progresso = 0)::int as sairam_na_capa
        from ojnm_quiz.sessoes`;
      const abandono = await c.queryObject`
        select progresso, count(*)::int as n from ojnm_quiz.sessoes
        where not concluiu group by 1 order by 1`;
      const perfis = await c.queryObject`
        select perfil, count(*)::int as n from ojnm_quiz.resultados group by 1 order by n desc`;
      const faixas = await c.queryObject`
        select faixa, count(*)::int as n, round(avg(score))::int as score_medio
        from ojnm_quiz.resultados group by 1 order by n desc`;
      const gaps = await c.queryObject`
        select gap, count(*)::int as n from ojnm_quiz.resultados group by 1 order by n desc`;
      const semCrm = await c.queryObject<{ n: number }>`select count(*)::int as n from ojnm_quiz.resultados where lead_id is null`;
      const ultimos = await c.queryObject`
        select created_at, nome, whatsapp, perfil, score, faixa, gap, lead_id
        from ojnm_quiz.resultados order by created_at desc limit 15`;
      return json({ ok: true, funil: funil.rows[0], abandono: abandono.rows, perfis: perfis.rows,
        faixas: faixas.rows, gaps: gaps.rows, semCrm: semCrm.rows[0]?.n ?? 0, ultimos: ultimos.rows });
    }

    // histórico completo de UM lead (timeline) — respeita a visibilidade por dono
    if (action === "lead_history") {
      const id = parseInt(String(body.id), 10);
      if (!id) return json({ ok: false, error: "id" }, 400);
      const lr = await c.queryObject`
        select l.id::int as id, l.created_at, l.nome, l.whatsapp, l.profissao, l.motivo, l.source, l.page_url,
               coalesce(nullif(l.status,''),'novo') as status, l.tags, l.motive_cat,
               l.bia_resumo, l.bia_temperatura, l.bia_score,
               q.perfil as quiz_perfil, q.score as quiz_score, q.faixa as quiz_faixa, q.gap as quiz_gap, q.eixos as quiz_eixos
        from ojnm_crm.leads l
        left join lateral (
          select perfil, score, faixa, gap, eixos from ojnm_quiz.resultados r
          where r.lead_id = l.id order by r.created_at desc limit 1
        ) q on true
        where l.id = ${id}`;
      const lead = lr.rows[0] as any;
      if (!lead) return json({ ok: false, error: "nao_encontrado" }, 404);
      // gestão só vê histórico de lead que ela pode ver (pool ou dela) — mesma regra da ação `leads`
      if (role !== "geral") {
        const RESERVED = TAGS_FLAG;
        const myFirst = String(meuNome).trim().split(/\s+/)[0].toLowerCase();
        const person = (lead.tags || []).filter((t: string) => !RESERVED.has(String(t).toLowerCase()));
        const meu = person.length === 0 || person.some((t: string) => String(t).trim().split(/\s+/)[0].toLowerCase() === myFirst);
        if (!meu) return json({ ok: false, error: "sem_permissao" }, 403);
      }
      const ev = await c.queryObject`
        select kind, from_status, to_status, actor, at, note
        from ojnm_crm.lead_events where lead_id = ${id} order by at asc, id asc`;
      return json({ ok: true, lead, events: ev.rows });
    }

    // excluir lead — SÓ o admin geral
    if (action === "lead_delete") {
      if (role !== "geral") return json({ ok: false, error: "sem_permissao" }, 403);
      const id = parseInt(String(body.id), 10);
      if (!id) return json({ ok: false, error: "id" }, 400);
      await c.queryObject`delete from ojnm_crm.leads where id = ${id}`;
      return json({ ok: true });
    }

    if (action === "admins") {
      const r = await c.queryObject`select email, created_at, added_by, role from ojnm_crm.admins order by created_at`;
      return json({ ok: true, email, admins: r.rows });
    }

    // categorias de motivo descobertas pela IA
    if (action === "motive_cats") {
      const r = await c.queryObject`select name, emoji from ojnm_crm.motive_categories order by name`;
      return json({ ok: true, cats: r.rows });
    }

    // reagrupa do zero (SÓ geral): zera as categorias dos leads (NÃO apaga leads) e limpa as categorias
    if (action === "motives_reset") {
      if (role !== "geral") return json({ ok: false, error: "sem_permissao" }, 403);
      await c.queryObject`update ojnm_crm.leads set motive_cat = null`;
      await c.queryObject`delete from ojnm_crm.motive_categories`;
      return json({ ok: true });
    }

    // classifica os leads pendentes com IA (Gemini) — cria categorias novas quando precisa
    if (action === "classify_pending") {
      const KEY = Deno.env.get("GEMINI_API_KEY");
      if (!KEY) return json({ ok: false, error: "sem_chave_ia" }, 500);
      const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
      const pend = await c.queryObject<{ id: number; motivo: string }>`
        select id::int as id, motivo from ojnm_crm.leads
        where motive_cat is null and coalesce(btrim(motivo),'') <> '' order by created_at desc limit 40`;
      if (pend.rows.length === 0) return json({ ok: true, classified: 0, pending: 0 });
      const cats = await c.queryObject<{ name: string }>`select name from ojnm_crm.motive_categories order by name`;
      const listaCat = cats.rows.length ? cats.rows.map((r) => "- " + r.name).join("\n") : "(nenhuma ainda)";
      const listaMot = pend.rows.map((r) => `- id ${r.id}: ${JSON.stringify(r.motivo)}`).join("\n");
      const prompt =
        `Você agrupa MOTIVOS de pessoas interessadas na imersão "O Jogo Não Mente" (formar treinadores corporativos que vendem para empresas/CNPJ).\n` +
        `Categorias já existentes (reutilize o nome EXATO quando o motivo encaixar):\n${listaCat}\n` +
        `Para cada motivo, defina a categoria: use uma existente se couber; senão CRIE uma nova (nome curto em português, 2 a 4 palavras, em Título; 1 emoji representativo). Motivos vagos/sem sentido vão para "Outros" com emoji ❓.\n` +
        `Responda SOMENTE JSON: [{"id":<n>,"categoria":"<Nome>","emoji":"<emoji>"}]\nMotivos:\n${listaMot}`;
      let arr: any;
      try {
        const rr = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
            }),
          },
        );
        const jj = await rr.json();
        const txt = jj?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
        arr = JSON.parse(txt);
      } catch (e) {
        return json({ ok: false, error: "ia_falhou: " + String(e) }, 502);
      }
      if (!Array.isArray(arr)) return json({ ok: false, error: "resposta_ia_invalida" }, 502);
      let n = 0;
      for (const it of arr) {
        const id = parseInt(String(it?.id), 10);
        const nome = String(it?.categoria || "Outros").trim().slice(0, 60);
        const emoji = String(it?.emoji || "❓").slice(0, 8);
        if (!id || !nome) continue;
        await c.queryObject`insert into ojnm_crm.motive_categories(name, emoji) values(${nome}, ${emoji}) on conflict (name) do nothing`;
        await c.queryObject`update ojnm_crm.leads set motive_cat = ${nome} where id = ${id}`;
        n++;
      }
      return json({ ok: true, classified: n });
    }

    if (action === "admin_add") {
      if (role !== "geral") return json({ ok: false, error: "sem_permissao" }, 403);
      const e2 = String(body.email || "").trim().toLowerCase();
      if (!e2 || !e2.includes("@")) return json({ ok: false, error: "email_invalido" }, 400);
      const novoRole = String(body.role || "diretoria") === "geral" ? "geral" : "diretoria";
      await c.queryObject`insert into ojnm_crm.admins (email, added_by, role) values (${e2}, ${email}, ${novoRole})
        on conflict (email) do update set role = excluded.role`;
      return json({ ok: true });
    }

    if (action === "admin_remove") {
      if (role !== "geral") return json({ ok: false, error: "sem_permissao" }, 403);
      const e2 = String(body.email || "").trim().toLowerCase();
      const cnt = await c.queryObject<{ n: number }>`select count(*)::int as n from ojnm_crm.admins`;
      if ((cnt.rows[0]?.n ?? 0) <= 1) return json({ ok: false, error: "ultimo_admin" }, 400);
      await c.queryObject`delete from ojnm_crm.admins where email = ${e2}`;
      await c.queryObject`delete from ojnm_crm.sessions where email = ${e2}`;
      return json({ ok: true });
    }

    if (action === "logout") {
      await c.queryObject`delete from ojnm_crm.sessions where token = ${tk}`;
      return json({ ok: true });
    }

    return json({ ok: false, error: "acao_desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  } finally {
    try { await c.end(); } catch (_) { /* ignore */ }
  }
});
