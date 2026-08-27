# CRM CS Couto, especificação para implementação
**Versão:** v1
**Data:** 26/08/2026
**Para:** Rodrigo Balla
**De:** Igor Freitas, CS Couto Treinamentos
**Objetivo:** dar contexto suficiente para avaliar escopo, arquitetura e prazo de um CRM próprio que substitua o Kommo.

---

# 1. O NEGÓCIO, EM MEIA PÁGINA

CS Couto Treinamentos. Camila Couto, especialista em Reposicionamento de Liderança. Vende mentoria para líderes de empresa.

| Produto | Ticket | Modelo |
|---|---|---|
| Abre Carteira | R$197 | autoguiado, plataforma externa |
| Liderança Blindada Grupo | R$2.997 | turma |
| Líder Estrategista | R$8.000 | individual, 1 a 1 |
| PLC Corporativa | por proposta | B2B |

**O evento comercial central é a Sessão de Diagnóstico**, 30 minutos, conduzida pela própria Camila. É onde a venda acontece.

**A restrição que define tudo:** a agenda da Camila comporta 2 sessões por dia, teto de 4. **10 a 20 por semana.** O sistema não precisa escalar volume, precisa **proteger e qualificar** o que chega até essa agenda.

**Time que usa o sistema:** Camila (closer), Igor (admin), Pricilla (coordenação), Raquell, Andreza e Daniele (SDR). **Seis usuários. Não é um problema de escala, é um problema de precisão.**

**Volume atual:** cerca de 850 visitas por semana na página de captura, 110 formulários enviados por semana, 10 a 15 agendamentos por semana.

---

# 2. STACK ATUAL E O QUE QUEBRA

| Camada | Ferramenta | Situação |
|---|---|---|
| Anúncios | Meta Ads | ok |
| Captura | página própria com VSL | ok |
| Formulário | Yay Forms | ok, sem lógica de corte |
| Agenda | Calendly | ok, **não integrado ao CRM** |
| CRM | Kommo | a substituir |
| Mensageria | WhatsApp Business e Instagram, via Kommo | funcional |
| Automação | Salesbot do Kommo, n8n | parcial |
| Medição | Meta Pixel | ok na página, ausente no CRM |
| Contrato | ClickSign | manual |
| Reunião | Google Meet com Gemini | manual |

## Os quatro defeitos que motivam a troca

**1. Não existe corte de qualificação.** O formulário coleta cargo, tamanho de equipe e faixa salarial, e **nenhuma dessas respostas é usada para nada**. Qualquer pessoa que preenche consegue reservar a agenda da Camila.

**2. O CRM não sabe quem agendou.** Existe um campo Data da Sessão e ele está vazio em todos os registros, porque o Calendly nunca escreveu nele. Consequência: nenhum lembrete automático, e a SDR precisa abrir o Calendly para escrever qualquer mensagem.

**3. Duplicação sistemática.** A mesma pessoa gera dois registros, um pelo formulário e outro pelo WhatsApp. Causa isolada, ver seção 7.

**4. Nenhum indicador de funil existe pronto.** A operação descobre o que está acontecendo abrindo o Gerenciador de Eventos do Meta, o que é sintoma de que o CRM não é a fonte de verdade.

⚠️ **Observação honesta para você calibrar o escopo:** dos quatro, apenas o terceiro é limitação real de produto. Os outros três são integrações e regras que nunca foram construídas. **Um CRM novo não os resolve por existir, resolve por ser construído com eles dentro.**

---

# 3. MODELO DE DADOS PROPOSTO

## 3.1. Pessoa

```
id
nome_completo
telefone_e164          (normalizado, ver secao 7)
telefone_alt_e164      (variante do nono digito, ver secao 7)
email
instagram
cargo
empresa
tamanho_equipe         (inteiro, numero de liderados)
faixa_salarial         (enum)
cidade, estado
optin_whatsapp         (bool)
optin_whatsapp_em      (timestamp)
criado_em, atualizado_em
```

## 3.2. Oportunidade

```
id, pessoa_id
estagio                (enum, ver secao 4)
dono_id                (usuario)
produto_interesse      (enum)
valor
origem                 (enum)
utm_source, utm_medium, utm_campaign, utm_content
fbclid
regua_semaforo         (verde | amarelo | vermelho)
o_que_esta_travando    (texto livre, palavras da pessoa)
passagem_de_bastao     (texto livre)
compromisso_comparecer (bool)
tentativas_contato     (inteiro, calculado)
primeiro_contato_em    (timestamp)
ultima_tentativa_em    (timestamp)
sessao_agendada_para   (timestamp)
sessao_compareceu      (bool)
resultado_sessao       (enum)
condicao_fechamento    (enum)
metodo_pagamento       (enum)
motivo_perda           (enum, lista fechada)
tipo_saida             (perda_comercial | arquivamento)
proximo_agendamento    (timestamp)
criado_em, atualizado_em
```

🚨 **`tipo_saida` é obrigatório e separado de `motivo_perda`.** Hoje perda comercial e arquivamento estão misturados no mesmo campo, o que destrói a taxa de perda como indicador. São coisas diferentes: perda comercial é quem disse não ou não qualifica. Arquivamento é limpeza de base.

## 3.3. Interação

```
id, oportunidade_id, pessoa_id
tipo        (ligacao_atendida | ligacao_nao_atendida | mensagem_enviada |
             mensagem_recebida | audio | email | reuniao | nota)
canal       (whatsapp | telefone | instagram | email | presencial)
direcao     (entrada | saida)
ocorrido_em (timestamp)
autor_id    (usuario ou 'sistema')
conteudo    (texto ou resumo)
resultado   (enum, opcional)
automatica  (bool)
```

🚨 **Requisito central, e talvez o mais importante do documento inteiro.** Hoje a contagem de tentativas depende de a SDR lembrar de registrar, e por isso todo indicador de produtividade sai errado. **No sistema novo, ligação e mensagem precisam gerar interação automaticamente**, sem depender de digitação. Se isso não for nativo, o resto dos indicadores nasce morto.

E a interação `automatica = true` **não conta** como atendimento para nenhum indicador de tempo de resposta. Ver seção 5, trava.

## 3.4. Sessão

```
id, oportunidade_id
agendada_para, duracao_min
link_reuniao
compareceu             (bool)
gravacao_url, transcricao_url
diagnostico_esfera     (empresa | liderado | lider)
camada                 (time | pares | diretoria)
plano_3_movimentos     (texto)
resultado              (enum)
remarcada_de           (sessao_id, nullable)
```

## 3.5. Cadência e Tarefa

```
cadencia: id, nome, ativa
passo: id, cadencia_id, ordem, dia_offset, canal, angulo, template_id
tarefa: id, oportunidade_id, passo_id, responsavel_id, vence_em,
        concluida_em, resultado
```

**`angulo`** é enum e existe por um motivo específico: a regra operacional proíbe dois toques seguidos com o mesmo ângulo. Valores: `pergunta`, `conteudo`, `pergunta_fechada`, `ligacao_anunciada`, `ruptura`.

---

# 4. MÁQUINA DE ESTADOS

| # | Estágio | Entra quando | Sai quando | Dono |
|---|---|---|---|---|
| 0 | Solicitação | mensagem recebida sem oportunidade aberta | SDR aceita ou sistema funde | sistema |
| 1 | Novo lead | formulário enviado, ou solicitação aceita | primeira interação de saída registrada | SDR |
| 2 | Primeiro contato | primeira tentativa feita | lead respondeu | SDR |
| 3 | Qualificado | 2 perguntas respondidas e Régua Semáforo preenchida | sessão agendada | SDR |
| 4 | Sessão agendada | `sessao_agendada_para` preenchido | sessão acontece ou falta | SDR |
| 5 | Sessão realizada | `compareceu = true` | proposta ou perda | Camila |
| 6 | Proposta | produto e valor definidos | ganho ou perda | Camila |
| 7 | Cliente | contrato assinado e pagamento confirmado | estado final positivo | Igor |
| 8 | Follow up | respondeu e não avançou | volta para 3, ou vai para 9 | SDR |
| 9 | Encerrado | regra 4.1 | reativação manual | SDR |

## 4.1. Regra de encerramento

Encerra quem se encaixa em **qualquer** um destes:

- completou 10 tentativas em pelo menos 2 canais, sem nenhuma resposta
- disse explicitamente que não quer
- não lidera equipe hoje
- não decide e não indica quem decide
- quer produto que a empresa não vende

**Nunca encerrar quem respondeu alguma coisa e depois sumiu.** Esse vai para Follow up com data. Regra da casa: quem já respondeu uma vez converte mais que lead novo.

🚨 **O sistema sugere o encerramento, nunca aplica sozinho.** Encerramento automático em base de ticket alto é como perder dinheiro sem perceber.

---

# 5. AUTOMAÇÕES

| # | Gatilho | Ação | Criticidade |
|---|---|---|---|
| 1 | Formulário enviado | criar pessoa e oportunidade, gravar as 5 UTMs mais `fbclid`, aplicar corte de qualificação | alta |
| 2 | Qualificado | liberar agendamento e **disparar evento de conversão para a Meta** | alta |
| 3 | Não qualificado | direcionar para oferta de R$197, **sem disparar evento de conversão** | alta |
| 4 | Agendamento recebido do Calendly | gravar data e hora, mover para estágio 4, criar tarefa de ligação de confirmação **para o mesmo dia** | alta |
| 5 | Mensagem recebida fora do horário comercial | resposta automática por conteúdo, 5 segundos de atraso | existe hoje |
| 6 | Mensagem recebida em horário comercial | resposta curta assinada pela equipe, mais tarefa imediata | a construir |
| 7 | Passo de cadência vencido | criar tarefa do próximo toque, com canal e **ângulo** definidos | alta |
| 8 | Sessão em D menos 1 | lembrete e tarefa de confirmação | alta |
| 9 | Sessão sem presença marcada 30 min após o horário | marcar falta e abrir recuperação | média |
| 10 | 10 tentativas sem resposta | **sugerir** encerramento | média |
| 11 | Contrato assinado | mover para Cliente e abrir onboarding | média |

## 5.1. A trava que precisa ser nativa

**Resposta automática não conta como atendimento.**

Concretamente: uma interação com `automatica = true` **não pode** marcar a conversa como respondida, **não pode** concluir tarefa, e **não entra** no cálculo de tempo de primeira resposta. O relógio dos 5 minutos conta da mensagem da pessoa até a primeira interação humana.

Sem essa trava, a automação vira desculpa para a demora que ela deveria resolver. Foi o que aconteceu no sistema atual, e por isso está escrito aqui.

---

# 6. INTEGRAÇÕES

| Sistema | Direção | Prioridade | Observação |
|---|---|---|---|
| **Calendly** | entrada e saída | **1** | webhook de `invitee.created` e `invitee.canceled`. Hoje inexistente. É o buraco mais caro |
| **Meta, API de Conversões** | saída | **2** | disparar a partir do lead **qualificado**, não do formulário enviado |
| **WhatsApp Business** | dois sentidos | **3** | tipo de conexão a confirmar, ver seção 11 |
| Yay Forms | entrada | 4 | webhook de submissão, com todos os campos e UTMs |
| Instagram, Direct e comentários | entrada | 5 | via Meta |
| ManyChat | entrada | 5 | qualificação automática no Instagram |
| ClickSign | dois sentidos | 6 | webhook de assinatura |
| Google Meet e Gemini | entrada | 7 | gravação e transcrição da sessão |
| Kiwify | saída | 7 | entrega do produto de R$197 |

## 6.1. Sobre a integração 2, e por que ela é estratégica

Hoje o evento de conversão dispara quando **qualquer pessoa** agenda. O algoritmo do Meta está, portanto, aprendendo a encontrar **gente que agenda**, não gente que qualifica.

Mandar o evento a partir do lead qualificado corrige o sinal na raiz. **É provavelmente o item de maior retorno sobre esforço deste documento inteiro**, e não custa quase nada depois que o corte da seção 5 automação 1 existir.

---

# 7. DEDUPLICAÇÃO

Esta seção tem a causa já isolada, o que deve poupar tempo de investigação.

**Sintoma:** a mesma pessoa gera dois registros, um pelo formulário e outro pelo WhatsApp, e eles não se juntam.

**Causa medida em 23/08/2026.** O telefone que chega pelo WhatsApp vem **sem o nono dígito quando o DDD é 31 ou maior**. Três casos reais do mesmo dia:

| Pessoa | DDD | Formulário | WhatsApp |
|---|---|---|---|
| Leandro | 11 | 941441950 | 941441950 |
| Jeaneide | 85 | 981325076 | 81325076 |
| Giovana | 45 | 999000222 | 99900222 |

## 7.1. Regra de normalização

```
normalizar(numero):
    limpar tudo que nao for digito
    garantir prefixo 55
    resultado -> telefone_e164

derivar_alternativo(telefone_e164):
    extrair ddd
    se ddd >= 31:
        se numero local tem 9 digitos e comeca com 9:
            telefone_alt = numero local sem o 9 inicial
        se numero local tem 8 digitos:
            telefone_alt = '9' + numero local
    senao:
        telefone_alt = null
```

**Casar sempre contra as duas colunas**, `telefone_e164` e `telefone_alt_e164`, em ambas as direções.

## 7.2. Precedência na fusão

O registro do **formulário é o mestre**, porque carrega nome completo, e-mail e as respostas de qualificação. O do WhatsApp entra como canal e histórico. Nenhum dado é descartado, o perdedor vira interação anexada.

## 7.3. Segundo caso de duplicata

A mesma pessoa preenche o formulário duas vezes, observado em 23/08. Regra: **atualizar a oportunidade existente, nunca criar outra**, e registrar a segunda submissão como interação com o conteúdo novo.

---

# 8. INDICADORES QUE O SISTEMA PRECISA PRODUZIR

Nenhum destes existe pronto hoje. **É o principal ganho de construir.**

| Grupo | Indicador |
|---|---|
| Aquisição | custo por lead qualificado por campanha, percentual de qualificados sobre formulários |
| Formulário | começou até enviou |
| Agendamento | qualificado até agendou, tempo médio até agendar, **antecedência média do agendamento** |
| Atendimento | **tempo até primeira resposta humana**, percentual respondido em até 5 min, conversas sem resposta ao fim do dia |
| Comparecimento | **taxa de comparecimento**, taxa de ligação de confirmação realizada, remarcados antes do dia, faltas recuperadas |
| Venda | sessão até proposta, proposta até fechamento, ticket médio, ciclo em dias |
| Produtividade | toques por SDR por dia, ligações por SDR por dia, tarefas vencidas em aberto |

**Duas hipóteses que o sistema precisa permitir testar:**

1. Quem atendeu a ligação de confirmação comparece mais que quem só recebeu mensagem.
2. Antecedência maior do agendamento prevê falta.

Se as duas se confirmarem em três semanas, viram regra operacional. Por isso os dois campos precisam existir desde o dia 1.

---

# 9. REQUISITOS NÃO FUNCIONAIS

**Usuários:** 6, com perfis distintos. SDR não vê o financeiro. Camila vê tudo.

**Volume:** baixo. Cerca de 500 novas oportunidades por mês. Histórico de 4.157 registros que **não serão migrados**, ver seção 10.

**Mobile:** a SDR trabalha muito no celular. **Registrar interação e ver a fila do dia precisam funcionar bem em tela pequena.**

**Auditoria:** todo campo alterado precisa de histórico com autor e horário. Motivo: hoje não se sabe quem mudou o quê, e isso já causou retrabalho.

**LGPD:** consentimento de WhatsApp com data e hora, e mecanismo de exclusão a pedido.

**Disponibilidade:** operação de horário comercial, segunda a sexta das 9h às 18h. Não é sistema crítico 24 por 7, mas **não pode perder mensagem recebida fora do horário**.

---

# 10. MIGRAÇÃO

## O que vem
Pessoas e oportunidades com atividade nos últimos 90 dias. Todos os clientes ativos, com histórico completo. Todas as sessões agendadas no futuro.

## O que não vem
A base histórica de 4.157 registros. Ela tem duplicatas, motivos de perda misturados com arquivamento, e mais de 2.000 conversas marcadas como não respondidas que são entulho de base antiga.

**Recomendação: exportar em CSV, guardar como arquivo morto, não importar.** Importar base suja para sistema novo é a forma mais rápida de o sistema novo nascer sem confiança.

## Faseamento sugerido

| Fase | Escopo | Critério de pronto |
|---|---|---|
| 1 | Modelo de dados, estágios, cadastro manual, tarefas | a SDR consegue trabalhar um lead ponta a ponta |
| 2 | Yay e Calendly entrando, dedup da seção 7 | zero duplicata em uma semana de operação real |
| 3 | WhatsApp integrado com histórico na oportunidade | a SDR para de alternar entre telas |
| 4 | Cadência automática e tarefas geradas | a fila do dia se monta sozinha |
| 5 | API de Conversões e indicadores da seção 8 | os números batem com o Gerenciador de Eventos |

**Rodar em paralelo por duas semanas antes de desligar o Kommo.** A operação comercial não pode parar, e há uma SDR nova entrando em 31/08.

---

# 11. DECISÕES PENDENTES QUE AFETAM O BUILD

Estas ainda não estão fechadas do lado do negócio. Vale saber porque mudam requisito:

1. **Triagem de 10 minutos com a SDR antes da Sessão com a Camila.** Em avaliação. Se for adotado, **surge um segundo tipo de agendamento** e a máquina de estados ganha um estágio.
2. **Critério exato do corte de qualificação.** Provável: lidera equipe hoje, com no mínimo 5 pessoas.
3. **Antecedência máxima permitida no Calendly.** Provável: 1 a 2 dias.
4. **Tipo de conexão do WhatsApp.** Se for API oficial, cabem modelos aprovados e automação de saída. Se for conexão não oficial, **não cabe automação de saída**, e isso muda a seção 5. Este item precisa ser confirmado antes de qualquer estimativa.

---

# 12. PERGUNTAS PARA A REUNIÃO

1. Construir do zero ou sobre alguma base existente? O que muda em prazo?
2. Como você trataria a integração de WhatsApp, dado que o número já sofreu banimento e o histórico de qualidade importa?
3. A regra de deduplicação da seção 7 resolve o caso do nono dígito. Você vê outros casos de colisão que a gente não mapeou?
4. Qual o esforço de manter as duas bases em paralelo por duas semanas na fase de virada?
5. Prefere receber o Calendly por webhook direto ou passando pelo n8n, que já existe aqui?
6. O que você precisa da nossa parte para estimar, além deste documento?
