// Registro de ferramentas do agente local: ferramentas do app, skills, notas do
// Obsidian, memória no Supabase, Hermes (VPS), n8n e ferramentas MCP do Mestre do PC.
// Ferramenta sem configuração fica desligada (não é oferecida ao modelo) e aparece
// em /api/agent/tools com o motivo.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentTool } from './toolLoop.js';
import { listSkills, loadSkillBody, resolveSkillDirs } from './skills.js';
import { McpHttpClient, McpTool } from './mcpClient.js';
import { runAppTool } from '../controllers/toolController.js';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const skillDirs = () => resolveSkillDirs(process.env.SKILLS_DIRS, APP_ROOT);

export interface ToolStatus {
  name: string;
  source: string;
  enabled: boolean;
  requiresConfirmation: boolean;
  reason?: string;
}

type Candidate = AgentTool & { disabledReason?: string };

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});
const str = (description: string) => ({ type: 'string', description });

function requireString(args: Record<string, unknown>, key: string, max = 4000): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Parâmetro obrigatório ausente: ${key}`);
  if (v.length > max) throw new Error(`Parâmetro ${key} muito longo (máx ${max} caracteres).`);
  return v.trim();
}

async function readJsonOrText(res: globalThis.Response): Promise<string> {
  const text = await res.text();
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

// ── Obsidian (somente leitura, só .md, COFRE REMOTO interditado) ───────────────

const FORBIDDEN_VAULT_RE = /cofre\s*remoto/i;

function vaultRoot(): { root?: string; reason?: string } {
  const raw = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!raw) return { reason: 'OBSIDIAN_VAULT_PATH vazio no .env.local' };
  if (FORBIDDEN_VAULT_RE.test(raw)) return { reason: 'vault interditado (COFRE REMOTO)' };
  const root = path.resolve(raw);
  if (!fs.existsSync(root)) return { reason: 'pasta do vault não encontrada' };
  return { root };
}

export function searchVault(
  root: string,
  query: string,
  limit = 5,
  stats: { scanned: number; unreadable: number } = { scanned: 0, unreadable: 0 },
): { file: string; score: number; snippet: string }[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2).slice(0, 8);
  if (terms.length === 0) return [];
  const results: { file: string; score: number; snippet: string }[] = [];
  let scanned = 0;

  const walk = (dir: string, depth: number) => {
    if (depth > 8 || scanned > 5000) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // .obsidian, .trash, .git
      const full = path.join(dir, entry.name);
      if (FORBIDDEN_VAULT_RE.test(full)) continue;
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      scanned++;
      stats.scanned++;
      let text: string;
      try {
        if (fs.statSync(full).size > 512 * 1024) continue;
        text = fs.readFileSync(full, 'utf8');
      } catch {
        stats.unreadable++; // ex.: arquivo só na nuvem com o OneDrive desligado
        continue;
      }
      const lower = text.toLowerCase();
      const fileLower = entry.name.toLowerCase();
      let score = 0;
      for (const term of terms) {
        let i = lower.indexOf(term);
        while (i !== -1 && score < 200) {
          score++;
          i = lower.indexOf(term, i + term.length);
        }
        if (fileLower.includes(term)) score += 5;
      }
      if (score === 0) continue;
      const hit = terms.find((t) => lower.includes(t));
      const at = hit ? lower.indexOf(hit) : 0;
      const snippet = text.slice(Math.max(0, at - 150), at + 350).replace(/\s+/g, ' ').trim();
      results.push({ file: path.relative(root, full), score, snippet });
    }
  };

  walk(root, 0);
  return results.sort((a, b) => b.score - a.score).slice(0, Math.min(Math.max(1, limit), 10));
}

// ── Supabase (memória compartilhada) ───────────────────────────────────────────

function supabaseConfig(): { url: string; key: string; table: string } | { reason: string } {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const table = (process.env.SUPABASE_MEMORY_TABLE || 'agent_memories').trim();
  if (!url) return { reason: 'SUPABASE_URL vazio no .env.local' };
  if (!key) return { reason: 'SUPABASE_SERVICE_ROLE_KEY vazio no .env.local' };
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) return { reason: 'SUPABASE_MEMORY_TABLE inválido' };
  return { url, key, table };
}

function supabaseHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// ── n8n (allowlist) ────────────────────────────────────────────────────────────

// Formato: "nome=https://url;outro=https://url" (também aceita quebra de linha).
export function parseWebhookAllowlist(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (raw || '').split(/[;\n]/)) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const url = part.slice(idx + 1).trim();
    if (!/^[\w-]{1,64}$/.test(name)) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
    } catch {
      continue;
    }
    map.set(name, url);
  }
  return map;
}

// ── Mestre do PC (MCP Streamable HTTP) ─────────────────────────────────────────

const DEFAULT_MCP_READONLY = ['mestre_system_status', 'mestre_list_operations', 'mestre_list_memories'];
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

let mcpClient: McpHttpClient | null = null;
let mcpKey = '';
let mcpCache: { at: number; ttl: number; tools: McpTool[]; error?: string } | null = null;

async function getMcpTools(): Promise<{ tools: McpTool[]; error?: string }> {
  const url = process.env.MESTRE_MCP_URL?.trim();
  if (!url) return { tools: [], error: 'MESTRE_MCP_URL vazio no .env.local' };
  if (!/^https?:\/\//i.test(url)) return { tools: [], error: 'MESTRE_MCP_URL inválido' };
  const key = `${url}|${process.env.MESTRE_MCP_TOKEN ? 'token' : ''}`;
  if (!mcpClient || mcpKey !== key) {
    mcpClient = new McpHttpClient(url, process.env.MESTRE_MCP_TOKEN?.trim() || '');
    mcpKey = key;
    mcpCache = null;
  }
  if (mcpCache && Date.now() - mcpCache.at < mcpCache.ttl) return mcpCache;
  try {
    const tools = await mcpClient.listTools();
    mcpCache = { at: Date.now(), ttl: 60_000, tools };
  } catch (err: unknown) {
    mcpClient.reset();
    const msg = err instanceof Error ? err.message : String(err);
    mcpCache = { at: Date.now(), ttl: 15_000, tools: [], error: `Mestre do PC fora do ar (${msg.slice(0, 120)})` };
  }
  return mcpCache;
}

function mcpReadOnlySet(): Set<string> {
  const raw = process.env.MESTRE_MCP_READONLY_TOOLS?.trim();
  const list = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_MCP_READONLY;
  return new Set(list);
}

// ── Registro ───────────────────────────────────────────────────────────────────

function builtinCandidates(): Candidate[] {
  const dirs = skillDirs();
  const vault = vaultRoot();
  const supa = supabaseConfig();
  const hermesBase = process.env.HERMES_BASE_URL?.trim().replace(/\/$/, '') || '';
  const webhooks = parseWebhookAllowlist(process.env.N8N_WEBHOOKS);

  return [
    {
      name: 'list_skills',
      description: 'Lista as skills instaladas do agente (nome e descrição).',
      parameters: obj({}),
      source: 'skills',
      requiresConfirmation: false,
      run: async () => {
        const skills = listSkills(dirs).map(({ name, description }) => ({ name, description }));
        return JSON.stringify({ total: skills.length, skills });
      },
    },
    {
      name: 'load_skill',
      description: 'Carrega as instruções completas de uma skill pelo nome, antes de segui-la.',
      parameters: obj({ name: str('Nome da skill (ex.: codigo)') }, ['name']),
      source: 'skills',
      requiresConfirmation: false,
      run: async (args) => {
        const loaded = loadSkillBody(dirs, args.name);
        if (!loaded) throw new Error(`Skill "${String(args.name ?? '')}" não encontrada. Use list_skills.`);
        return `# Skill ${loaded.skill.name}\n${loaded.body}`;
      },
    },
    {
      name: 'get_current_time',
      description: 'Data e hora atual do PC.',
      parameters: obj({}),
      source: 'app',
      requiresConfirmation: false,
      run: () => runAppTool('get_current_time', {}),
    },
    {
      name: 'calculate_math',
      description: 'Calcula uma expressão matemática simples (+, -, *, /, **, %, parênteses).',
      parameters: obj({ expression: str('Expressão, ex.: (2+3)*4') }, ['expression']),
      source: 'app',
      requiresConfirmation: false,
      run: (args) => runAppTool('calculate_math', { expression: requireString(args, 'expression', 500) }),
    },
    {
      name: 'github_list_repos',
      description: 'Lista os repositórios públicos mais recentes de um usuário do GitHub.',
      parameters: obj({ username: str('Usuário do GitHub') }, ['username']),
      source: 'app',
      requiresConfirmation: false,
      run: (args) => runAppTool('github_list_repos', { username: requireString(args, 'username', 100) }),
    },
    {
      name: 'github_create_issue',
      description: 'Cria uma issue num repositório do GitHub (pede confirmação do usuário).',
      parameters: obj(
        { owner: str('Dono do repositório'), repo: str('Nome do repositório'), title: str('Título'), body: str('Descrição') },
        ['owner', 'repo', 'title', 'body'],
      ),
      source: 'app',
      requiresConfirmation: true,
      disabledReason: process.env.GITHUB_TOKEN?.trim() ? undefined : 'GITHUB_TOKEN vazio no .env.local',
      run: (args) => runAppTool('github_create_issue', {
        owner: requireString(args, 'owner', 100),
        repo: requireString(args, 'repo', 100),
        title: requireString(args, 'title', 256),
        body: requireString(args, 'body', 8000),
      }),
    },
    {
      name: 'obsidian_search',
      description: 'Busca texto nas notas .md do vault Obsidian do Jean (somente leitura). Retorna arquivo e trecho.',
      parameters: obj({ query: str('Palavras a buscar'), limit: { type: 'number', description: 'Máximo de resultados (1-10)' } }, ['query']),
      source: 'obsidian',
      requiresConfirmation: false,
      disabledReason: vault.reason,
      run: async (args) => {
        const current = vaultRoot();
        if (!current.root) throw new Error(current.reason ?? 'vault indisponível');
        const stats = { scanned: 0, unreadable: 0 };
        const hits = searchVault(current.root, requireString(args, 'query', 200), Number(args.limit) || 5, stats);
        const aviso = stats.unreadable > 0
          ? `${stats.unreadable} de ${stats.scanned} notas não puderam ser lidas (OneDrive desligado ou arquivos só na nuvem). Avise o usuário.`
          : undefined;
        return JSON.stringify({ total: hits.length, results: hits, ...(aviso ? { aviso } : {}) });
      },
    },
    {
      name: 'memory_search',
      description: 'Busca na memória compartilhada (Supabase) por um texto.',
      parameters: obj({ query: str('Texto a buscar') }, ['query']),
      source: 'supabase',
      requiresConfirmation: false,
      disabledReason: 'reason' in supa ? supa.reason : undefined,
      run: async (args) => {
        const cfg = supabaseConfig();
        if ('reason' in cfg) throw new Error(cfg.reason);
        const q = requireString(args, 'query', 200).replace(/[*%,()\\]/g, ' ').trim();
        const url = `${cfg.url}/rest/v1/${cfg.table}?select=id,content,tags,created_at&content=ilike.${encodeURIComponent(`*${q}*`)}&order=created_at.desc&limit=5`;
        const res = await fetch(url, { headers: supabaseHeaders(cfg.key), signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await readJsonOrText(res)).slice(0, 300)}`);
        return await readJsonOrText(res);
      },
    },
    {
      name: 'memory_save',
      description: 'Salva uma memória na memória compartilhada (Supabase). Pede confirmação do usuário.',
      parameters: obj({ content: str('Conteúdo a lembrar'), tags: { type: 'array', items: { type: 'string' }, description: 'Etiquetas opcionais' } }, ['content']),
      source: 'supabase',
      requiresConfirmation: true,
      disabledReason: 'reason' in supa ? supa.reason : undefined,
      run: async (args) => {
        const cfg = supabaseConfig();
        if ('reason' in cfg) throw new Error(cfg.reason);
        const content = requireString(args, 'content', 4000);
        const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string').slice(0, 10) : [];
        const res = await fetch(`${cfg.url}/rest/v1/${cfg.table}`, {
          method: 'POST',
          headers: { ...supabaseHeaders(cfg.key), Prefer: 'return=representation' },
          body: JSON.stringify({ content, tags, source: 'mult-chat-hub-lite' }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await readJsonOrText(res)).slice(0, 300)}`);
        return `Memória salva. ${await readJsonOrText(res)}`;
      },
    },
    {
      name: 'hermes_ask',
      description: 'Pergunta ao agente Hermes da VPS (pode executar ações lá). Pede confirmação do usuário.',
      parameters: obj({ question: str('Pergunta ou pedido para o Hermes') }, ['question']),
      source: 'hermes',
      requiresConfirmation: true,
      disabledReason: hermesBase ? undefined : 'HERMES_BASE_URL vazio (precisa de túnel SSH para 127.0.0.1:8642 da VPS)',
      run: async (args) => {
        const base = process.env.HERMES_BASE_URL?.trim().replace(/\/$/, '') || '';
        if (!base) throw new Error('HERMES_BASE_URL vazio.');
        const endpoint = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
        const key = process.env.HERMES_API_KEY?.trim();
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify({
            model: process.env.HERMES_MODEL?.trim() || 'hermes-agent',
            messages: [{ role: 'user', content: requireString(args, 'question', 4000) }],
          }),
          signal: AbortSignal.timeout(180_000),
        });
        if (!res.ok) throw new Error(`Hermes ${res.status}: ${(await readJsonOrText(res)).slice(0, 300)}`);
        const data = await res.json() as { choices?: { message?: { content?: string } }[] };
        return data.choices?.[0]?.message?.content ?? 'Hermes não retornou texto.';
      },
    },
    {
      name: 'n8n_trigger',
      description: webhooks.size
        ? `Dispara um webhook do n8n da allowlist (${[...webhooks.keys()].join(', ')}). Pede confirmação do usuário.`
        : 'Dispara um webhook do n8n da allowlist. Pede confirmação do usuário.',
      parameters: obj({ webhook: str('Nome do webhook na allowlist'), payload: { type: 'object', description: 'Dados JSON enviados no POST' } }, ['webhook']),
      source: 'n8n',
      requiresConfirmation: true,
      disabledReason: webhooks.size ? undefined : 'N8N_WEBHOOKS vazio no .env.local',
      run: async (args) => {
        const allow = parseWebhookAllowlist(process.env.N8N_WEBHOOKS);
        const name = requireString(args, 'webhook', 64);
        const url = allow.get(name);
        if (!url) throw new Error(`Webhook "${name}" não está na allowlist N8N_WEBHOOKS.`);
        const payload = args.payload && typeof args.payload === 'object' && !Array.isArray(args.payload) ? args.payload : {};
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });
        return `n8n respondeu HTTP ${res.status}: ${(await readJsonOrText(res)).slice(0, 2000)}`;
      },
    },
  ];
}

export async function buildAgentTools(): Promise<{ tools: AgentTool[]; status: ToolStatus[] }> {
  const candidates = builtinCandidates();
  const names = new Set(candidates.map((c) => c.name));
  const status: ToolStatus[] = [];
  const tools: AgentTool[] = [];

  for (const c of candidates) {
    status.push({ name: c.name, source: c.source, enabled: !c.disabledReason, requiresConfirmation: c.requiresConfirmation, ...(c.disabledReason ? { reason: c.disabledReason } : {}) });
    if (!c.disabledReason) {
      const { disabledReason: _ignored, ...tool } = c;
      tools.push(tool);
    }
  }

  const mcp = await getMcpTools();
  if (mcp.error) {
    status.push({ name: 'mestre_*', source: 'mestre-mcp', enabled: false, requiresConfirmation: true, reason: mcp.error });
  }
  const readOnly = mcpReadOnlySet();
  for (const t of mcp.tools) {
    if (!TOOL_NAME_RE.test(t.name) || names.has(t.name)) continue;
    names.add(t.name);
    const requiresConfirmation = !readOnly.has(t.name);
    status.push({ name: t.name, source: 'mestre-mcp', enabled: true, requiresConfirmation });
    tools.push({
      name: t.name,
      description: (t.description || `Ferramenta MCP ${t.name}`).slice(0, 400),
      parameters: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : obj({}),
      source: 'mestre-mcp',
      requiresConfirmation,
      run: async (args) => {
        if (!mcpClient) throw new Error('Cliente MCP indisponível.');
        try {
          return await mcpClient.callTool(t.name, args);
        } catch (err) {
          mcpClient.reset();
          mcpCache = null;
          throw err;
        }
      },
    });
  }

  return { tools, status };
}
