# CRM BASE — cópia do CRM do OJNM para reaproveitar

Cópia do CRM em funcionamento, tirada em **27/08/2026**, **sem nenhuma chave ou dado pessoal**
(veja *O que foi removido desta cópia*, mais abaixo). Serve de ponto de partida
para um CRM novo (outro produto/projeto) sem mexer no que está no ar.

> ⚠️ Esta pasta **não vai para o site**. O deploy publica só `index.html`, `imersoes.html`,
> `quiz.html`, `crm/`, `js/`, `img/`, `audio/`, `videos/` e `netlify/`. Se um dia ela for
> publicada, o código do CRM fica exposto na internet.

## O que tem aqui

| Arquivo | O que é |
|---|---|
| `index.html` | O CRM inteiro (front): login, kanban, lista, motivos, públicos, equipe, relatórios, tráfego, timeline do lead. Página única, sem build. |
| `supabase/functions/ojnm-crm/index.ts` | O backend (Supabase Edge Function, Deno). Todas as ações públicas e de admin. |

## Como funciona (resumo)

- **Front**: HTML/CSS/JS puro, um arquivo só. Não tem framework nem build — é só servir o arquivo.
- **Backend**: uma Edge Function que fala **direto com o Postgres** (`SUPABASE_DB_URL`), num
  **schema isolado** (`ojnm_crm`) que **não é exposto no PostgREST**. Nada vaza para a API pública.
- **Login**: allowlist de e-mails na tabela `admins` + sessão por token opaco (sem senha).
- **Papéis**: `geral` (admin, vê tudo) e `diretoria` (gestão, vê o pool + os próprios leads).

## Para reaproveitar em outro projeto — o que trocar

### 1. No `index.html` (front)
Os três valores já estão como placeholder no arquivo (procure por `⚠️ PREENCHER`):

```js
var FN_URL = "https://SEU-PROJETO.supabase.co/functions/v1/SUA-FUNCAO";
var PUBKEY = "SUA_PUBLISHABLE_KEY_AQUI";
var SESS_KEY = "meu_crm_sess";     // chave do localStorage
```
Também revise: `STAGES` (as colunas do kanban), `ORCAMENTO_MES` (verba de mídia),
`CAMP_NOTAS` (notas de campanha) e `PLANO_TESTE` (diagnóstico de criativos).

### 2. No `index.ts` (backend)
- Troque **todas** as referências ao schema `ojnm_crm` pelo schema novo.
- `ATENDENTES` + `RODA`: os números do rodízio de WhatsApp e a proporção (**já estão zerados** — `⚠️ PREENCHER`).
- `TAGS_FLAG`: as tags que **não** são pessoas (senão o lead some do kanban de todo mundo).
- Referências a `ojnm_quiz` só fazem sentido se você levar o funil de quiz junto.

### 3. No Supabase
- Criar o schema e as tabelas: `leads`, `admins`, `sessions`, `lead_events`, `activity`,
  `access_log`, `visits`, `meta_cache`, `motive_categories`.
- Secrets: `SUPABASE_DB_URL` (já existe), `GEMINI_API_KEY` (IA), `META_ADS_TOKEN` +
  `META_CAMPAIGN_ID` (painel de tráfego), `SHEETS_WEBHOOK_URL` (planilha), `OJNM_TICKET`.
- Deployar a função com **`verify_jwt = false`** (as ações públicas do site dependem disso).

## Armadilhas que já custaram caro aqui (não repita)

1. **Tag que não é pessoa vira "dono" do lead.** Qualquer tag fora de `TAGS_FLAG` é tratada como
   nome de responsável — e o lead **some do kanban de quem não é o dono**. Já aconteceu com as
   tags do quiz: o admin via 3 leads, a gestão via 0.
2. **Chamada externa dentro da resposta trava a tela.** O webhook da planilha do Google levava ~5s
   e a página ficava parada. Use `emBackground()` (`EdgeRuntime.waitUntil`) — a resposta não espera.
3. **Colar no editor do dashboard falha em silêncio.** Depois de colar, confirme com
   `monaco.editor.getModels()[0].getValue()` antes de publicar. O `innerText` não serve: o editor
   só desenha as linhas visíveis.
4. **Nunca apagar leads.** Regra do Balla: dado de lead não se apaga; ele mesmo limpa.

---

## 🔐 O QUE FOI REMOVIDO DESTA CÓPIA (leia antes de usar)

Esta cópia foi **higienizada**: nenhuma credencial, chave ou dado pessoal ficou no código.
Ela **não funciona como está** — é um esqueleto. Você precisa preencher os pontos marcados
com `⚠️ PREENCHER` antes de rodar.

| Onde | O que foi tirado | O que ficou no lugar |
|---|---|---|
| `index.html` (~linha 406) | URL do projeto Supabase | `https://SEU-PROJETO.supabase.co/...` |
| `index.html` (~linha 407) | Publishable key | `SUA_PUBLISHABLE_KEY_AQUI` |
| `index.html` (`CAMP_NOTAS`) | Ids reais de campanha do Meta | objeto vazio, com exemplo comentado |
| `index.ts` (`ATENDENTES`) | Nome + WhatsApp reais da equipe | `pessoa1..4` / `55DDNUMERO` |
| `index.ts` (comentários) | Nomes de pessoas do time | texto genérico |

### O backend nunca teve segredo no código — e não pode passar a ter

Todas as chaves são lidas em tempo de execução, dos **Secrets do Supabase**:

```
SUPABASE_DB_URL     conexão com o Postgres      (já vem pronta no projeto)
GEMINI_API_KEY      IA dos textos/diagnósticos
META_ADS_TOKEN      painel de tráfego
META_CAMPAIGN_ID    ids das campanhas, separados por vírgula
META_AD_ACCOUNT     conta de anúncios
SHEETS_WEBHOOK_URL  espelho na planilha do Google
OJNM_TICKET         ticket da oferta (receita estimada)
```

**Regra:** chave se cadastra em *Edge Functions > Secrets* e se lê com `Deno.env.get()`.
Chave escrita direto no arquivo vai para o Git — e, no caso do front, vai para o navegador
de qualquer visitante.

### Sobre a publishable key

Ela é **pública por natureza** (o navegador precisa dela para chamar a função), então não é
"segredo vazado" — mas foi tirada mesmo assim, porque aponta para o projeto real do OJNM.
Quem usar esta base com a key antiga estaria batendo no banco de produção. O que **nunca**
pode aparecer no front é a `service_role` / `sb_secret_...`: essa ignora RLS e dá acesso total.

### Se algum dia uma chave escapar

1. Gire a chave no serviço de origem (Supabase, Google AI Studio, Meta) — trocar só no
   código não adianta, a antiga continua valendo.
2. Atualize o Secret no Supabase e redeploye a função.
3. Se foi para o Git, lembre que o histórico guarda: rotacionar é obrigatório, apagar não basta.

## Referência

O histórico completo de decisões está em `MEMORIA_PROJETO.md`, na raiz do projeto
(entradas #62 em diante cobrem todo o CRM atual).
