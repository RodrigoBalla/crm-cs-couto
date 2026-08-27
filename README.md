# CRM CS Couto

CRM próprio da **CS Couto Treinamentos** (Camila Couto, Reposicionamento de Liderança),
construído para substituir o Kommo.

O evento comercial central é a **Sessão de Diagnóstico** de 30 minutos, conduzida pela própria
Camila. A agenda dela comporta 10 a 20 sessões por semana — por isso o sistema não foi feito
para escalar volume, e sim para **proteger e qualificar** o que chega até essa agenda.

> **Estado hoje:** front funcionando em modo demo. **Não existe backend, nem Supabase, nem deploy.**

---

## Como rodar

```bash
python -m http.server 8123
```

Depois abrir **http://127.0.0.1:8123/app/index.html**

Não tem build, não tem dependência, não tem `npm install`. É um arquivo HTML só.

---

## Onde está cada coisa

| Pasta | O que tem |
|---|---|
| `app/` | **O CRM.** `index.html` — front completo, página única |
| `docs/` | O que falta definir para o backend (`CONFIG-PENDENTE.md`) |
| `referencia/crm-base-ojnm/` | Cópia higienizada do CRM do OJNM que serviu de base — **referência, não editar** |
| `referencia/processos-comerciais/` | A especificação do Igor e o manual comercial da SDR |
| `historico/` | O front original do OJNM, antes de qualquer alteração |
| `.local/` | Material local com credenciais — **fora do Git** |

📄 **[MEMORIA_PROJETO.md](MEMORIA_PROJETO.md) — leia antes de mexer.** Tem tudo: o que foi feito,
por quê, o que foi removido, os bugs que apareceram no caminho e o que ainda falta.

---

## Modo demo

O front está com `DEMO_MODE = true` no topo do script. Enquanto ligado:

- não existe tela de login, abre direto no CRM;
- **nenhuma chamada de rede acontece** — a função `api()` é servida localmente;
- o kanban está zerado.

Para voltar ao normal, trocar para `false`. Nada mais precisa mudar — mas o login só volta a
funcionar quando existir backend e as credenciais forem preenchidas.

---

## Regras da casa

1. **Nunca apagar leads.**
2. **Chave nenhuma no código.** Toda credencial vai em *Edge Functions > Secrets* e se lê com
   `Deno.env.get()`.
3. **Se uma chave escapar, girar na origem** — trocar só no código não adianta.
4. **Type-check antes de declarar pronto:** `node --check` no JS extraído.
