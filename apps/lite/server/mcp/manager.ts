// Gerenciador MCP: lista de servidores em <root>/mcp/servers.json (sem tokens),
// clientes HTTP/stdio, classificação de risco e liberação por agente.
import path from 'node:path';
import { McpHttpClient, McpClientLike, McpTool } from '../agent/mcpClient.js';
import type { AgentTool } from '../agent/toolLoop.js';
import type { AgentV2 } from '../agents/model.js';
import { readJson, writeJsonAtomic } from '../storage/atomic.js';
import { safeJoin } from '../storage/paths.js';
import { McpStdioClient } from './stdioClient.js';
import { CLASS_LABEL, classifyMcpTool, McpCallLog, needsConfirmation, toolAllowedForAgent, ToolClass } from './policy.js';

export interface McpServerConfig {
  id: string;
  name: string;
  type: 'http' | 'stdio';
  url?: string;
  /** Nome da variável de ambiente com o token (o valor nunca vai para o arquivo). */
  tokenEnv?: string;
  command?: string;
  args?: string[];
  enabled: boolean;
  builtin?: boolean;
}

export interface McpToolInfo { name: string; description: string; klass: ToolClass; label: string; requiresConfirmation: boolean }
export interface McpServerStatus { id: string; name: string; ok: boolean; error?: string; tools: McpToolInfo[]; checkedAt: string }

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SHELLS = /^(cmd|cmd\.exe|powershell|powershell\.exe|pwsh|pwsh\.exe|bash|sh|zsh)$/i;
const DANGER = /[&|;<>`$\r\n]/;

export function validateServerConfig(c: McpServerConfig): { errors: string[] } {
  const errors: string[] = [];
  if (!c || !ID_RE.test(String(c.id))) errors.push('Id inválido (minúsculas, números, - e _).');
  if (!c?.name || String(c.name).length > 60) errors.push('Nome obrigatório (até 60).');
  if (c?.type === 'http') {
    let u: URL | null = null;
    try { u = new URL(String(c.url)); } catch { /* */ }
    if (!u || !/^https?:$/.test(u.protocol)) errors.push('URL inválida.');
    else if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) errors.push('Por segurança, só servidores MCP locais (127.0.0.1).');
  } else if (c?.type === 'stdio') {
    const cmd = String(c.command ?? '');
    const base = path.basename(cmd);
    if (!cmd || DANGER.test(cmd)) errors.push('Comando inválido.');
    if (SHELLS.test(base)) errors.push('Não é permitido rodar um shell como servidor MCP.');
    if (!Array.isArray(c.args) || c.args.some((a) => typeof a !== 'string' || DANGER.test(a))) errors.push('Argumentos inválidos (sem & | ; < > ` $).');
  } else errors.push('Tipo deve ser http ou stdio.');
  if (c?.tokenEnv !== undefined && !/^[A-Z][A-Z0-9_]{0,60}$/.test(String(c.tokenEnv))) errors.push('Variável do token inválida.');
  return { errors };
}

function mestreDefault(env: NodeJS.ProcessEnv): McpServerConfig {
  return { id: 'mestre', name: 'Mestre do PC', type: 'http', url: env.MESTRE_MCP_URL?.trim() || 'http://127.0.0.1:7777/mcp', tokenEnv: 'MESTRE_MCP_TOKEN', enabled: true, builtin: true };
}

type ClientFactory = (cfg: McpServerConfig) => McpClientLike;

export class McpManager {
  readonly log: McpCallLog;
  private clients = new Map<string, { key: string; client: McpClientLike }>();
  private cache = new Map<string, { at: number; ttl: number; tools: McpTool[]; error?: string }>();

  constructor(private readonly root: string, private readonly env: NodeJS.ProcessEnv = process.env, private readonly factory?: ClientFactory) {
    this.log = new McpCallLog(safeJoin(root, 'logs', 'mcp-chamadas.jsonl'));
  }

  private file() { return safeJoin(this.root, 'mcp', 'servers.json'); }

  listServers(): McpServerConfig[] {
    const saved = readJson<{ servers?: McpServerConfig[] }>(this.file(), {}).servers ?? [];
    const others = saved.filter((s) => s.id !== 'mestre' && validateServerConfig(s).errors.length === 0);
    const mestreSaved = saved.find((s) => s.id === 'mestre');
    const mestre = { ...mestreDefault(this.env), ...(mestreSaved ? { enabled: mestreSaved.enabled } : {}) };
    const list = [mestre, ...others];
    if (!mestreSaved) writeJsonAtomic(this.file(), { servers: list });
    return list;
  }

  saveServer(cfg: McpServerConfig): McpServerConfig {
    const { errors } = validateServerConfig(cfg);
    if (errors.length) throw new Error(errors.join(' '));
    const list = this.listServers().filter((s) => s.id !== cfg.id);
    const clean: McpServerConfig = cfg.id === 'mestre' ? { ...mestreDefault(this.env), enabled: !!cfg.enabled } : { id: cfg.id, name: cfg.name, type: cfg.type, url: cfg.url, tokenEnv: cfg.tokenEnv, command: cfg.command, args: cfg.args, enabled: !!cfg.enabled };
    writeJsonAtomic(this.file(), { servers: [...list, clean] });
    this.invalidate(cfg.id);
    return clean;
  }

  removeServer(id: string): void {
    if (id === 'mestre') throw new Error('O Mestre do PC é embutido: desligue em vez de remover.');
    writeJsonAtomic(this.file(), { servers: this.listServers().filter((s) => s.id !== id) });
    this.invalidate(id);
  }

  invalidate(id: string) {
    const c = this.clients.get(id);
    c?.client.reset();
    this.clients.delete(id);
    this.cache.delete(id);
  }

  private clientFor(cfg: McpServerConfig): McpClientLike {
    const token = cfg.tokenEnv ? this.env[cfg.tokenEnv]?.trim() ?? '' : '';
    const key = `${cfg.type}|${cfg.url ?? ''}|${cfg.command ?? ''}|${(cfg.args ?? []).join(' ')}|${token ? 't' : ''}`;
    const hit = this.clients.get(cfg.id);
    if (hit && hit.key === key) return hit.client;
    hit?.client.reset();
    const client = this.factory ? this.factory(cfg)
      : cfg.type === 'http'
        ? new McpHttpClient(cfg.url!, token, 20_000, token ? { 'X-Mestre-Mcp-Token': token } : {})
        : new McpStdioClient(cfg.command!, cfg.args ?? []);
    this.clients.set(cfg.id, { key, client });
    return client;
  }

  async listServerTools(id: string, force = false): Promise<{ tools: McpTool[]; error?: string }> {
    const cfg = this.listServers().find((s) => s.id === id);
    if (!cfg) return { tools: [], error: 'Servidor não encontrado.' };
    if (!cfg.enabled) return { tools: [], error: 'Servidor desligado.' };
    const c = this.cache.get(id);
    if (!force && c && Date.now() - c.at < c.ttl) return c;
    const client = this.clientFor(cfg);
    try {
      const tools = (await client.listTools()).filter((t) => TOOL_NAME_RE.test(t.name));
      const entry = { at: Date.now(), ttl: 60_000, tools };
      this.cache.set(id, entry);
      return entry;
    } catch (err) {
      client.reset();
      const msg = err instanceof Error ? err.message : String(err);
      const entry = { at: Date.now(), ttl: 15_000, tools: [] as McpTool[], error: `${cfg.name} fora do ar (${msg.slice(0, 160)})` };
      this.cache.set(id, entry);
      return entry;
    }
  }

  async status(id: string, force = false): Promise<McpServerStatus> {
    const cfg = this.listServers().find((s) => s.id === id);
    const { tools, error } = await this.listServerTools(id, force);
    return {
      id, name: cfg?.name ?? id, ok: !error, ...(error ? { error } : {}), checkedAt: new Date().toISOString(),
      tools: tools.map((t) => {
        const klass = classifyMcpTool(id, t.name, t.annotations);
        return { name: t.name, description: (t.description ?? '').slice(0, 300), klass, label: CLASS_LABEL[klass], requiresConfirmation: needsConfirmation(klass) };
      }),
    };
  }

  async callTool(agentId: string, serverId: string, tool: string, args: Record<string, unknown>): Promise<string> {
    const cfg = this.listServers().find((s) => s.id === serverId);
    if (!cfg?.enabled) throw new Error('Servidor MCP desligado.');
    const klass = classifyMcpTool(serverId, tool);
    const t0 = Date.now();
    const client = this.clientFor(cfg);
    try {
      const out = await client.callTool(tool, args);
      this.log.append({ agentId, server: serverId, tool, klass, ok: true, ms: Date.now() - t0, args });
      return out;
    } catch (err) {
      client.reset();
      this.cache.delete(serverId);
      const msg = err instanceof Error ? err.message : String(err);
      this.log.append({ agentId, server: serverId, tool, klass, ok: false, ms: Date.now() - t0, args, error: msg });
      throw err;
    }
  }

  /** Ferramentas MCP liberadas para o agente, já com classe e confirmação. */
  async toolsForAgent(agent: Pick<AgentV2, 'id' | 'tools'>): Promise<{ tools: AgentTool[]; errors: string[] }> {
    const tools: AgentTool[] = [];
    const errors: string[] = [];
    if (!agent.tools?.enabled) return { tools, errors };
    for (const cfg of this.listServers()) {
      if (!agent.tools.mcp?.[cfg.id]?.enabled) continue;
      const { tools: list, error } = await this.listServerTools(cfg.id);
      if (error) errors.push(error);
      for (const t of list) {
        if (!toolAllowedForAgent(agent.tools, cfg.id, t.name)) continue;
        const klass = classifyMcpTool(cfg.id, t.name, t.annotations);
        tools.push({
          name: t.name,
          description: `[${cfg.name} · ${CLASS_LABEL[klass]}] ${(t.description || `Ferramenta MCP ${t.name}`)}`.slice(0, 400),
          parameters: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
          source: `mcp:${cfg.id}`,
          requiresConfirmation: needsConfirmation(klass),
          run: (args) => this.callTool(agent.id, cfg.id, t.name, args),
        });
      }
    }
    return { tools, errors };
  }
}
