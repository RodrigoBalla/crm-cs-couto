# MEMÓRIA DO PROJETO — CRM CS Couto

> Registro descritivo do que foi feito, por quê, e o que ficou pendente.
> Mesma lógica do `MEMORIA_PROJETO.md` do OJNM: quem chegar depois entende o
> estado atual sem precisar reconstituir a conversa.

**Cliente:** CS Couto Treinamentos (Camila Couto, Reposicionamento de Liderança)
**Interlocutor:** Igor Freitas
**Executor:** Rodrigo Balla
**Início dos trabalhos:** 27/08/2026
**Estado hoje:** front funcionando em modo demo, **sem backend, sem Supabase, sem deploy**

---

## 1. O QUE É ESTE PROJETO

Um CRM próprio para substituir o **Kommo** na operação comercial da CS Couto.

O evento comercial central é a **Sessão de Diagnóstico** de 30 minutos, conduzida pela
própria Camila. A agenda dela comporta 2 sessões por dia, teto de 4 — **10 a 20 por semana**.

A frase que define a arquitetura, tirada da especificação do Igor:

> O sistema não precisa escalar volume, precisa **proteger e qualificar** o que chega até essa agenda.

Volume atual: ~850 visitas/semana na página de captura, ~110 formulários/semana,
10 a 15 agendamentos/semana. Seis usuários previstos. **Não é problema de escala, é de precisão.**

### Produtos

| Produto | Ticket | Modelo |
|---|---|---|
| Abre Carteira | R$ 197 | autoguiado, plataforma externa |
| Liderança Blindada Grupo | R$ 2.997 | turma |
| Líder Estrategista | R$ 8.000 | individual, 1 a 1 |
| PLC Corporativa | por proposta | B2B |

---

## 2. DE ONDE O CÓDIGO VEIO

O front **não foi escrito do zero**. Partiu de `CRM BASE/`, uma cópia higienizada do CRM do
projeto **O Jogo Não Mente (OJNM)**, que já roda em produção. Ela veio sem nenhuma chave e
sem dado pessoal — os pontos a preencher estão marcados com `⚠️ PREENCHER`.

Essa base entregou pronto: login por allowlist de e-mail, kanban com arrasta-e-solta,
lista, timeline do lead, painel de equipe, relatórios, painel de tráfego do Meta Ads,
gestão de admins e sincronia automática entre quem está com o painel aberto.

`CRM BASE/` **continua intacta na pasta, como referência**. Nada foi editado lá dentro.

---

## 3. DOCUMENTOS QUE DEFINEM A OPERAÇÃO

Ficam em `DOCUMENTOS/PROCESSOS COMERCIAIS/`:

- **`ESPEC_CRM_CS_COUTO_v1.md`** (26/08/2026) — especificação técnica escrita pelo Igor:
  modelo de dados, máquina de estados, automações, integrações, dedup, indicadores,
  requisitos não funcionais, migração e decisões em aberto.
- **`Comercial_Pocket_v3.html`** — o manual de operação da SDR: régua de tempo, mensagens
  prontas, roteiro da ligação, objeções, Régua Semáforo, quando dar perdido e os números
  que a gestão acompanha toda sexta.

`CRM BASE/ANOTAÇÕES.txt` foi o pedido inicial de métricas, **substituído** pelos dois
documentos acima (ver seção 6, entrada de 27/08).

---

## 4. ESTADO ATUAL DO FRONT (`index.html`)

Página única, HTML/CSS/JS puro, sem build e sem framework. Basta servir o arquivo.

### 4.1. Máquina de estados (ESPEC seção 4)

Os 10 estágios do kanban, com o dono de cada fase:

| # | Estágio | Dono |
|---|---|---|
| 0 | Solicitação | sistema |
| 1 | Novo lead | SDR |
| 2 | Primeiro contato | SDR |
| 3 | Qualificado | SDR |
| 4 | Sessão agendada | SDR |
| 5 | Sessão realizada | Camila |
| 6 | Proposta | Camila |
| 7 | Cliente | Igor |
| 8 | Follow up | SDR |
| 9 | Encerrado | SDR |

### 4.2. Régua Semáforo

Leitura rápida depois da ligação de qualificação, direto do Comercial Pocket. Aparece no
card e tem filtro próprio na barra. A regra de cada cor está no tooltip:

- 🟢 **Verde** — lidera 5+, nomeou um problema concreto, já tentou resolver, quer agora. Mantém a agenda.
- 🟡 **Amarelo** — tem perfil, mas urgência vaga ou a decisão passa por outra pessoa. Mantém e sinaliza.
- 🔴 **Vermelho** — não lidera equipe, está em recolocação, quer só material grátis. Cancela e libera o horário.

### 4.3. Saída do funil separada em dois campos

A especificação marca isso como 🚨 e o motivo é bom: hoje, no Kommo, perda comercial e
arquivamento estão no mesmo campo, **o que destrói a taxa de perda como indicador**.

Aqui, arrastar um card para *Encerrado* abre uma **lista fechada** de motivos, e cada motivo
já carrega seu `tipo_saida` (`perda_comercial` ou `arquivamento`). O KPI de encerrados mostra
os dois separados. Cancelar a escolha **cancela a movimentação** — coerente com a regra 4.1:
o sistema sugere o encerramento, nunca aplica sozinho, porque encerramento automático em base
de ticket alto é perder dinheiro sem perceber.

### 4.4. Contexto da qualificação no card

O documento é enfático: **contexto, não rótulo**. "Problema de tempo" não diz nada para quem
vai conduzir a sessão; "perde duas horas por semana refazendo o trabalho do time e a diretoria
não sabe disso" diz tudo.

O card mostra: quantas pessoas lidera, cargo, empresa, a camada onde a autoridade vaza
(time / pares / diretoria) e *o que está travando* entre aspas, nas palavras da pessoa.

### 4.5. No-show automático

Um lead que continua em *Sessão agendada* 30 minutos depois do horário marcado é contado
como no-show e ganha alerta no card (automação 9 da ESPEC). Não depende de ninguém marcar nada.

### 4.6. Indicadores no topo

**Os três números** do Comercial Pocket, pintados de verde ou vermelho contra a meta:

| Número | Meta |
|---|---|
| Resposta ≤ 5 min | 90% |
| Comparecimento na sessão | 80% |
| Sessão → venda | 33% |

Abaixo, os números da semana, cumulativos na ordem do funil: contactados, qualificados,
agendadas, realizadas, no-show, follow up, clientes e encerrados.

> ⚠️ **"Resposta ≤ 5 min" mostra `—` de propósito.** É o número nº 1 da gestão, mas medir só
> a resposta **humana** exige o log de interações com a trava do `automatica = true`
> (ESPEC 5.1). Preferimos deixar visível e honesto a exibir um número inventado.

### 4.7. Modo demo (temporário)

Bloco `DEMO_MODE = true` isolado no topo do script. Enquanto ligado: **não há tela de login**,
abre direto no CRM, e **nenhuma chamada de rede acontece** — a função `api()` é servida
localmente. O kanban está zerado, sem leads de exemplo.

Para voltar ao normal: trocar para `false`. Nada mais precisa mudar.

---

## 5. O QUE FOI REMOVIDO DA BASE DO OJNM

Tudo que era específico do outro projeto e não faz sentido nesta operação:

| Removido | Por quê |
|---|---|
| Coluna e bloco da extensão **BIA** | extensão de WhatsApp do OJNM, não existe aqui |
| Abas **Motivos (IA)** e **Públicos** | classificavam motivos do quiz do OJNM por IA e mapeavam audiência por DDD |
| **Funil de quiz** | o OJNM tinha quiz de perfil; a CS Couto captura por formulário |
| Botão e tag **Comunidade** | pertencia à Comunidade EJC |
| Marca **EJC / O Jogo Não Mente** | virou CS Couto |
| Fase **Matriculado** | virou *Cliente* |
| Campo `profissao` | virou `cargo` + `empresa` |

---

## 6. HISTÓRICO DAS DECISÕES

### 27/08 — Ponto de partida
A pasta tinha só `LINKS.txt`, apontando `acompanhamento-angelica.netlify.app` como
"referência de pipeline para clonar". Ao abrir, era um **painel de acompanhamento de projeto**,
não um CRM — não serviu de referência de pipeline.

### 27/08 — Cópia fiel do front
Pedido: criar o CRM a partir de `CRM BASE`, **exatamente como está**, só o front, sem publicar
no Supabase. Feito: `index.html` copiado byte a byte (conferido com `cmp`).

### 27/08 — Admins definidos
Três e-mails cadastrados. O primeiro admin terá que entrar por **SQL (seed)**, porque a tela
de cadastro de admin só aparece para quem já está logado como `geral`.

### 27/08 — Login removido
O login não respondia porque `FN_URL` aponta para o placeholder `SEU-PROJETO.supabase.co`
(`ERR_NAME_NOT_RESOLVED` no console). Não era bug: não existe backend. A pedido, foi criado o
modo demo, que entra direto no CRM.

### 27/08 — Limpezas visuais
Kanban e históricos zerados; botão 🎁 Comunidade removido; cabeçalho 🦁 EJC removido do painel.

### 27/08 — Primeira leva de métricas (`ANOTAÇÕES.txt`)
Pedido de fases novas (Follow Up) e métricas de prospecção: abordagens, respostas, novos
seguidores, agendamentos, reuniões, no-show, vendas. Implementado e testado.
**Substituído no mesmo dia** pela especificação real, que chegou depois.

### 27/08 — Reescrita sobre os documentos comerciais
Com os dois documentos em mãos e autorização para "tirar tudo o que não faz sentido", o front
foi reescrito sobre a máquina de estados da ESPEC. É o estado descrito na seção 4.

### 27/08 — Dois bugs próprios, encontrados e corrigidos
1. Ao remover as abas Motivos e Públicos, a função `renderTable()` foi junto por engano —
   estava no meio do trecho removido. O kanban parou de renderizar. Reposta e adaptada às
   colunas novas da Lista.
2. Escapes de emoji escritos como `\U0001f7e2`, que **JavaScript não reconhece** (só aceita
   `\u` minúsculo ou o caractere direto). O card exibia `U0001f7e2 Verde` em vez de 🟢 Verde.
   Todos convertidos para o emoji real.

Depois das correções: `node --check` passa, e um teste com 14 leads espalhados por todas as
fases confirmou cada contagem e cada percentual dos KPIs.

---

## 7. O QUE AINDA NÃO EXISTE

### 7.1. Backend inteiro

Não há Supabase, Edge Function, schema, tabela nem deploy. **Nada foi publicado.**

A referência de como o backend do OJNM funciona está em
`CRM BASE/supabase/functions/ojnm-crm/index.ts`: Edge Function em Deno, conversa direto com o
Postgres via `SUPABASE_DB_URL`, num schema isolado que **não é exposto no PostgREST**.

⚠️ Quando for escrito, a whitelist de status do `lead_move` precisa nascer com os **10 estágios
novos**, senão arrastar card devolve `invalido`.

### 7.2. O coração da especificação depende do backend

Não é escolha de escopo — são itens que só existem com servidor:

| Item | Por quê |
|---|---|
| **Interação automática** (3.3) | ligação e mensagem precisam virar interação **sem digitação**. Palavras do documento: se isso não for nativo, "o resto dos indicadores nasce morto" |
| **Trava do `automatica = true`** (5.1) | resposta do robô não pode contar como atendimento nem parar o relógio dos 5 minutos |
| **Dedup do nono dígito** (7) | WhatsApp entrega número sem o nono dígito quando o DDD é ≥ 31. Exige `telefone_e164` + `telefone_alt_e164` e casamento nas duas direções |
| **Calendly** (prioridade 1) | webhook `invitee.created` / `invitee.canceled`. O campo de sessão existe no card, mas ninguém escreve nele. É "o buraco mais caro" |
| **API de Conversões a partir do lead qualificado** (6.1) | hoje o evento dispara para quem agenda, então o algoritmo aprende a achar "gente que agenda", não gente que qualifica. Maior retorno sobre esforço do documento |
| **Cadência, tarefas e ângulo** (3.5) | a fila do dia se montar sozinha |
| **Auditoria por campo** (9) | histórico com autor e horário de cada alteração |

### 7.3. Limitação conhecida das métricas cumulativas

Sem `lead_events`, o front deduz o passado pela fase atual (follow up ⇒ já respondeu,
encerrado ⇒ já foi abordado). **Um lead que teve sessão e depois foi encerrado conta hoje só
como "contactado"** — subestima quem foi longe e caiu. Com o histórico no banco, trocar essa
dedução pela fase máxima realmente percorrida.

---

## 8. 🚩 PENDÊNCIAS QUE PRECISAM DE DECISÃO DO CLIENTE

### 8.1. Os dois documentos se contradizem sobre o time

- `ESPEC_CRM_CS_COUTO_v1` (26/08) lista **seis usuários**: Camila, Igor, Pricilla, Raquell,
  Andreza e Daniele.
- `Comercial_Pocket_v3` afirma que **Pricilla, Raquell e Andreza saíram**, confirmado em 15/08,
  e trata a Daniele como a única SDR.

Não dá para os dois estarem certos. Muda perfis de acesso, rodízio de leads e painel de Equipe.
**Nenhum dos dois foi assumido.**

### 8.2. Decisões em aberto na própria especificação (seção 11)

| Pendência | Impacto no build |
|---|---|
| Triagem de 10 min com a SDR antes da sessão | **cria um 11º estágio** na máquina de estados |
| Critério exato do corte de qualificação | provável: lidera equipe hoje, mínimo 5 pessoas |
| Antecedência máxima no Calendly | provável: 1 a 2 dias |
| **Tipo de conexão do WhatsApp** | se for não oficial, **não cabe automação de saída** e a seção 5 inteira muda. Precisa ser confirmado antes de qualquer estimativa |

### 8.3. Nome do schema e do projeto Supabase

Ainda não definido (sugestão: `cscouto_crm`). Sem isso não dá para escrever a Edge Function
nem o SQL de criação.

---

## 9. REGRAS DA CASA (não repetir os erros do OJNM)

1. **Nunca apagar leads.** Regra do Balla: dado de lead não se apaga.
2. **Chave nenhuma no código.** Toda credencial se cadastra em *Edge Functions > Secrets* e se
   lê com `Deno.env.get()`. Chave escrita no arquivo vai para o Git; no front, vai para o
   navegador de qualquer visitante.
3. **Se uma chave escapar, girar na origem.** Trocar só no código não adianta — a antiga
   continua valendo. E, se foi para o Git, o histórico guarda: rotacionar é obrigatório.
4. **Chamada externa não pode travar a resposta.** Usar `EdgeRuntime.waitUntil`.
5. **Tag que não é pessoa vira "dono" do lead** e some do kanban de todo mundo. Qualquer tag
   fora da lista de flags é tratada como nome de responsável.
6. **Type-check antes de declarar pronto.** Aqui: `node --check` no JS extraído.

---

## 10. ARQUIVOS DA PASTA

| Arquivo | O que é |
|---|---|
| `index.html` | **o CRM** — front completo, modo demo ligado |
| `index.html.bak` | cópia fiel do front original do OJNM, antes de qualquer alteração |
| `MEMORIA_PROJETO.md` | este arquivo |
| `CONFIG-PENDENTE.md` | admins cadastrados e o que falta definir para o backend |
| `CRM BASE/` | cópia higienizada do CRM do OJNM (front + Edge Function + LEIA-ME) — **referência, não editar** |
| `DOCUMENTOS/PROCESSOS COMERCIAIS/` | a especificação e o manual comercial |
| `LINKS.txt` | link de referência inicial (não serviu) |

### Rodar localmente

```bash
python -m http.server 8123
```

Depois abrir `http://127.0.0.1:8123/index.html`.
