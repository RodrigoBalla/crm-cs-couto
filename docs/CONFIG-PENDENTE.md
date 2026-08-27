# Config pendente — CRM IGOR

Decisões já tomadas que só podem ser aplicadas quando o backend for criado.
(O front sozinho não guarda nada disso: é tudo banco / Secrets.)

## Admins (tabela `admins`)

| E-mail | Papel | Status |
|---|---|---|
| contato@camilacouto.com | `geral` | ⏳ aguardando criação do banco |
| igorfreitasnf@gmail.com | `geral` | ⏳ aguardando criação do banco |
| comercial@camilacouto.com | `diretoria` | ⏳ aguardando criação do banco |

`geral` = admin: vê todos os leads, relatórios, painel de tráfego e gestão de admins.
(`diretoria` = gestão: vê só o pool sem dono + os próprios leads.)

O primeiro admin precisa entrar por SQL (seed), porque a tela de cadastro de admin
só aparece pra quem já está logado como `geral`. Os próximos podem ser cadastrados
pela própria interface (aba de admins).

## O CRM agora segue a ESPEC_CRM_CS_COUTO_v1

O front foi reescrito sobre os dois documentos de PROCESSOS COMERCIAIS.

### Feito no front

- **Máquina de estados da seção 4**, com os 10 estágios e o dono de cada fase:
  `solicitacao → novo → contato → qualificado → agendada → realizada → proposta → cliente`,
  mais `followup` e `encerrado`.
- **Régua Semáforo** (verde/amarelo/vermelho) no card, com a regra de cada cor no tooltip,
  e filtro próprio na barra.
- **`tipo_saida` separado de `motivo_perda`** (seção 3.2). Arrastar para *Encerrado* exige
  escolher um motivo de uma **lista fechada**; perda comercial e arquivamento contam separado
  no KPI. Cancelar o motivo cancela a movimentação — o sistema nunca encerra sozinho (4.1).
- **Contexto da qualificação no card**: quantas pessoas lidera, cargo, empresa, camada onde a
  autoridade vaza e *o que está travando* nas palavras da pessoa (contexto, nunca rótulo).
- **No-show** detectado sozinho: continua em *Sessão agendada* 30 min depois do horário
  (automação 9), com alerta no card.
- **Os três números** do Comercial Pocket no topo, pintados contra a meta:
  resposta ≤ 5 min (90%), comparecimento (80%), sessão → venda (33%).

### Removido (era do OJNM, não desta operação)

Coluna e bloco da extensão BIA · abas Motivos (IA) e Públicos · funil de quiz · botão e tag
Comunidade · marca EJC / O Jogo Não Mente · fase "Matriculado" · campo `profissao`
(virou cargo + empresa).

---

## ⚠️ O que a especificação pede e o front NÃO resolve sozinho

Isto não é escolha de escopo: são itens que **só existem com backend**. Listado aqui para
não parecer entregue.

| Item da ESPEC | Por que depende do backend |
|---|---|
| **Interação automática** (3.3) | Ligação e mensagem precisam virar interação **sem digitação**. Sem isso, todo indicador de produtividade nasce errado — palavras do próprio documento. |
| **Trava do `automatica = true`** (5.1) | O KPI "resposta ≤ 5 min" está no painel mostrando `—` de propósito: exige o log de interações para separar resposta humana de resposta do robô. Não inventei número. |
| **Dedup do nono dígito** (7) | `telefone_e164` + `telefone_alt_e164` e o casamento nas duas direções são regra de gravação. |
| **Calendly** (6, prioridade 1) | Webhook `invitee.created` / `invitee.canceled` preenche `sessao_agendada_para`. Hoje o campo existe no card, mas ninguém escreve nele. |
| **API de Conversões a partir do lead qualificado** (6.1) | Disparo server-side. |
| **Cadência, tarefas e ângulo** (3.5, automação 7) | A fila do dia se montar sozinha exige as tabelas de cadência/passo/tarefa. |
| **Auditoria por campo** (9) | Histórico com autor e horário de cada alteração. |
| **Métricas cumulativas exatas** | Hoje o front deduz o passado pela fase atual (follow up ⇒ já respondeu, encerrado ⇒ já foi abordado). Um lead que teve sessão e foi encerrado conta só como "contactado". Com `lead_events` no ar, trocar pela fase máxima real. |

Além disso, a whitelist de status do `lead_move` na Edge Function precisa nascer com os
10 estágios novos, senão arrastar card devolve `invalido`.

---

## 🚩 Contradição entre os dois documentos — precisa da sua decisão

Os dois arquivos discordam sobre **quem é o time**:

- `ESPEC_CRM_CS_COUTO_v1` (26/08) diz **seis usuários**: Camila, Igor, Pricilla, Raquell,
  Andreza e Daniele.
- `Comercial_Pocket_v3` diz que **Pricilla, Raquell e Andreza saíram**, confirmado em 15/08,
  e trata a Daniele como a única SDR.

Não dá para os dois estarem certos. Isso muda perfis de acesso, o rodízio de leads e o
painel de Equipe. **Não assumi nenhum dos dois** — hoje o CRM tem só os três e-mails da tabela
acima cadastrados.

Outras decisões que o próprio documento marca como em aberto (seção 11) e que mudam o build:
triagem de 10 min com a SDR (**cria um 11º estágio**), critério exato do corte de qualificação
(provável: lidera 5+), antecedência máxima no Calendly e o tipo de conexão do WhatsApp
(se for não oficial, **não cabe automação de saída** e a seção 5 muda).

## Ainda não definido

- Nome do projeto/schema (ex.: `igor_crm`) e nome da Edge Function
- URL da função + publishable key → `index.html`, linhas 406-407
- Equipe do rodízio de WhatsApp (nomes + telefones) → `ATENDENTES` / `RODA`
- Secrets: SUPABASE_DB_URL, GEMINI_API_KEY, META_ADS_TOKEN, META_CAMPAIGN_ID,
  META_AD_ACCOUNT, SHEETS_WEBHOOK_URL, TICKET

⚠️ Nenhuma chave neste arquivo. Chave se cadastra em Edge Functions > Secrets.
