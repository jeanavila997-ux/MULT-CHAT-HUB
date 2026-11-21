# Guia rápido — MULT-CHAT-HUB lite

## Abrir o app

Na pasta `C:\Users\Jean\Projetos\MULT-CHAT-HUB`:

```powershell
pnpm dev:lite:electron
```

Abre a janela **MULT-CHAT-HUB** (Electron). Por baixo sobem:

- interface (Vite) em `http://localhost:3001`, só no próprio PC;
- servidor do app em `http://127.0.0.1:3002`, também só no próprio PC (`PORT` no `apps/lite/.env.local`; a 3000 é do Nexus Terminal).

`pnpm dev:lite` sobe **só** a interface, sem o servidor. Use `dev:lite:electron`.
Para fechar, feche a janela e o terminal do `pnpm`.

## Escolher provedor e modelo

- **Topo do chat**: seletor rápido — Agente local (Ollama), 9Router, NVIDIA, Grok, Cloudflare.
  A troca é só sua: o app **nunca** muda sozinho para um provedor pago.
- **Painel lateral → "LLM da Conversa"**: todos os provedores, chave e modelo.
  - Ollama: lista os modelos instalados. "Padrão do servidor" = `OLLAMA_MODEL` do `.env.local`.
  - Outros: campo de texto livre para o modelo (vazio = padrão do servidor).

## Onde colar as chaves

| Onde | Vale quando | Reiniciar? |
|---|---|---|
| Painel lateral → campo "Chave …" | na hora; tem prioridade sobre o `.env.local` | não |
| `apps/lite/.env.local` | depois de reiniciar o servidor | **sim** |

Variáveis de provedor no `.env.local`: `ROUTER_API_KEY`, `NVIDIA_API_KEY`,
`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`, `GROK_API_KEY`.
A Cloudflare só funciona com `CLOUDFLARE_ACCOUNT_ID` no `.env.local` (não há campo na tela).
O `.env.local` é ignorado pelo git. Nunca comite chaves.

## Ferramentas do agente e confirmação

Com **Agente local (Ollama)** e o botão **Ferramentas: ON** no topo do chat, o modelo pode chamar
ferramentas (tool-calling do Ollama):

- **Leitura** (rodam direto): `list_skills`, `load_skill`, `get_current_time`, `calculate_math`,
  `github_list_repos`, `obsidian_search`, `memory_search`, `mestre_system_status`,
  `mestre_list_operations`, `mestre_list_memories`.
- **Escrita/execução/custo** (pedem confirmação): `github_create_issue`, `memory_save`, `hermes_ask`,
  `n8n_trigger`, `mestre_run_operation`, `mestre_optimize_ram_and_temp`, `mestre_save_memory`,
  `mestre_ask_grok`. Aparece um cartão com os argumentos e os botões **Executar** / **Recusar**.
  Recusou, o agente não pergunta de novo naquele pedido.

O painel lateral → **"Skills e ferramentas do agente"** mostra o que está ligado, o que pede
confirmação e por que algo está desligado (botão **Atualizar**).
No máximo 5 rodadas de ferramenta por mensagem (`AGENT_MAX_TOOL_ITERATIONS`, até 10).
Saídas de ferramenta são tratadas como dados, não como instruções.

## Skills

Duas pastas (em `SKILLS_DIRS`, separadas por `;`):

1. `apps/lite/skills/<nome>/SKILL.md` — skills do app (exemplo: `diagnostico-pc`).
2. `C:/Users/Jean/.ollama/agente-model-file/skills/<nome>/SKILL.md` — skills do Jean
   (`codigo`, `revisao`, `criador-de-skills`). Se o nome repetir, a desta pasta ganha.

Formato e passo a passo em `apps/lite/skills/README.md`. A lista é relida a cada mensagem:
não precisa reiniciar. Os arquivos são só lidos.

## Ligar as integrações (`apps/lite/.env.local`, depois reinicie)

- **Mestre do PC**: `MESTRE_MCP_URL="http://127.0.0.1:7777/mcp"`. O launcher precisa estar no ar:
  `C:\Users\Jean\Projetos\ferramentas\Mestre-do-PC-V10\mcp-server\start-launcher.ps1`
  A lista de ferramentas é relida a cada minuto.
  Para mudar quais ferramentas rodam sem confirmação: `MESTRE_MCP_READONLY_TOOLS`.
- **Obsidian**: `OBSIDIAN_VAULT_PATH="C:/Users/Jean/OneDrive/Documents/Obsidian Vault"`.
  Busca de texto só em `.md`, somente leitura; o `COFRE REMOTO` é sempre bloqueado.
- **Supabase (memória)**: aplique a migração `supabase/migrations/20261114120000_agent_memories.sql`
  (SQL Editor do projeto) e preencha `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API).
  `SUPABASE_URL` já aponta para o projeto.
- **Hermes (VPS)**: a API fica em `127.0.0.1:8642` na VPS. Abra um túnel e deixe o terminal aberto:
  `ssh -N -L 8642:127.0.0.1:8642 root@72.62.11.116`; depois `HERMES_BASE_URL="http://127.0.0.1:8642"`
  e `HERMES_API_KEY` = `API_SERVER_KEY` do Hermes.
- **n8n**: `N8N_WEBHOOKS="nome=https://url-do-webhook;outro=https://..."`. Só esses nomes podem ser
  disparados.
- **GitHub (criar issue)**: `GITHUB_TOKEN` (token com permissão de issues no repositório).


## Rotinas (tarefas agendadas)

O agente local roda um prompt sozinho no horário marcado. O resultado aparece no canal **Rotinas** do chat.

**Criar uma rotina:** botão **Rotinas** no topo → **Nova rotina**.

- **Nome** e **Prompt**: o que o agente deve fazer. Exemplo: "Use mestre_system_status e resuma o estado do PC".
- **Agenda** (fuso America/Rio_Branco), em um destes formatos:
  - `diário 07:00`
  - `a cada 30 min` (mínimo 5 min)
  - cron de 5 campos, ex.: `0 8 * * 1-5` (dias úteis às 08:00)
- **Provedor/Modelo**: o padrão é o Ollama local com o modelo do `.env.local` (`OLLAMA_MODEL`).
  - Escolher 9Router, NVIDIA, Grok ou Cloudflare mostra um aviso de custo.
  - Esses provedores usam a chave do `apps/lite/.env.local`, não a colada na tela, e rodam sem ferramentas.
  - Não existe troca automática para outro provedor.
- **Ferramentas de leitura**: liga ou desliga as ferramentas (só no Ollama).
- **Ativa**: desmarque para deixar a rotina pausada.

Em cada rotina há os botões **Rodar agora**, **Pausar/Retomar**, **Editar**, **Histórico** (as últimas 20 execuções) e **Apagar**.

No chat, `/rotinas` lista as rotinas e `/rotina Status do PC` roda uma agora.

**Segurança:**

- Rotina roda sem ninguém olhando, então só usa ferramentas de **leitura**.
- Ferramentas que escrevem, executam ou custam (`mestre_save_memory`, `mestre_run_operation`, `mestre_ask_grok`, `github_create_issue`, `memory_save`, `hermes_ask`, `n8n_trigger`…) são bloqueadas. O bloqueio aparece no resultado ("Bloqueadas (rotina só lê)").
- A mesma rotina nunca roda duas vezes ao mesmo tempo.

**Onde fica salvo:** `apps/lite/data/routines.json` (fora do git), com o histórico.

A rotina de exemplo **Status do PC** (diária 07:00) já vem **pausada**. Para ligar, clique em **Retomar**.

**Limites:**

- O agendador roda dentro do servidor do lite: com o app fechado, nada roda, e horários perdidos não são recuperados.
- O Ollama atende um pedido por vez. Se outro programa estiver usando o Ollama, a rotina espera até 5 min e depois registra erro.

## Gateway externo (NullClaw) — pareamento

1. Inicie o gateway NullClaw neste PC. Ele mostra um **código de pareamento** de 6 dígitos que vale **uma vez só**.
   - A porta padrão do NullClaw é a 3000, que aqui é do Nexus Terminal. Configure outra, ex.: `gateway.port = 3010`.
2. No painel lateral → **Gateway Externo**, coloque a URL (`http://127.0.0.1:3010`) e o código e clique em **Conectar**.
3. O servidor do lite chama `POST /pair` com `X-Pairing-Code`, recebe o token e guarda só no servidor, em `apps/lite/data/gateways.json` (fora do git). O token não vai para o navegador nem para o log.
   - Código errado ou já usado: aparece "Código de pareamento inválido ou já usado".
   - Gateway sem `/pair`: o código é usado como token Bearer e testado com uma mensagem no `/webhook`.
4. Selecione o agente **NullClaw 127.0.0.1:3010** na lista de agentes e converse. As mensagens vão para `POST /webhook` com `Authorization: Bearer <token>`.
5. **Desconectar** (abaixo do botão Conectar) apaga o token. Para trocar de token, desconecte e pareie de novo com um código novo.

Tudo passa pelo servidor do lite, então não há problema de CORS.

Por segurança, só hosts deste PC são aceitos. Gateway em outra máquina: `GATEWAY_ALLOWED_HOSTS="192.168.0.20"` no `.env.local`, depois reinicie o app.

## Problemas conhecidos

- Ferramentas só no **agente local (Ollama)**. 9Router, NVIDIA, Grok e Cloudflare respondem como
  chat simples, sem ferramentas.
- Modelos de 3B às vezes erram argumentos ou repetem uma ferramenta; confira o cartão antes de executar.
- O 9Router precisa estar rodando em `127.0.0.1:20128`; se não estiver, aparece "fetch failed".
- Confirmação pendente expira em 10 minutos ou ao reiniciar o servidor ("Confirmação expirada").
- O endpoint `/mcp` do Mestre do PC não pede token; qualquer programa do próprio PC pode chamá-lo.
- O modo antigo `/use_tool` (texto do modelo) continua nos outros provedores; `github_create_issue`
  por esse caminho também pede confirmação.
- O vault do Obsidian fica no OneDrive: com o OneDrive desligado, as notas que estão só na nuvem não podem ser lidas e a busca avisa quantas falharam. Abra o OneDrive (ou marque a pasta como "Sempre manter neste dispositivo").
