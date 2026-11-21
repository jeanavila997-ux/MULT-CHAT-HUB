// Cliente das rotas do hub (/api/agents, /api/providers, /api/mcp, /api/mestre).
// Nenhuma chave de API passa por aqui de volta: o servidor só devolve last4.
import { getBackendAuthHeaders } from './backendAuth';

export interface HubAgent {
  id: string;
  name: string;
  description: string;
  avatar: string;
  color: string;
  section: string;
  role: 'orquestrador' | 'especialista' | 'externo';
  provider: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  skills: string[];
  tools: { enabled: boolean; mcp: Record<string, { enabled: boolean; allow: string[] }> };
  hidden: boolean;
  pinned: boolean;
  builtin: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface HubProvider {
  id: string; label: string; sublabel: string; kind: string; paid: boolean; chat: boolean;
  needsKey: boolean; envKeys: string[]; configured: boolean; source: 'cofre' | 'env' | null; last4: string | null;
}

export interface McpToolInfo { name: string; description: string; klass: 'read' | 'write' | 'exec' | 'destructive' | 'paid'; label: string; requiresConfirmation: boolean }
export interface McpStatus { id: string; name: string; ok: boolean; error?: string; tools: McpToolInfo[]; checkedAt: string }
export interface MestreStatus extends McpStatus { url?: string; tokenConfigured: boolean; launcherAvailable: boolean }
export interface McpServer { id: string; name: string; type: 'http' | 'stdio'; url?: string; tokenEnv?: string; command?: string; args?: string[]; enabled: boolean; builtin?: boolean; status?: McpStatus }
export interface McpLogEntry { ts: string; agentId: string; server: string; tool: string; klass: string; ok: boolean; ms: number; error?: string }
export interface TrashEntry { trashId: string; id: string; name: string; deletedAt: string }
export interface PromptHistoryEntry { file: string; version: number; savedAt: string; systemPrompt: string }
export interface PromptInfo { systemPrompt: string; default: string | null; security: { exists: boolean; chars: number }; history: PromptHistoryEntry[] }
export interface HealthResult { ok: boolean; status?: number; detail: string; ms: number }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...getBackendAuthHeaders() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

export const hubApi = {
  listAgents: () => req<{ root: string; agents: HubAgent[] }>('GET', '/api/agents'),
  createAgent: (input: Partial<HubAgent>) => req<{ agent: HubAgent }>('POST', '/api/agents', input),
  updateAgent: (id: string, patch: Partial<HubAgent>) => req<{ agent: HubAgent }>('PUT', `/api/agents/${encodeURIComponent(id)}`, patch),
  deleteAgent: (id: string, confirmName: string) => req<{ trash: TrashEntry }>('DELETE', `/api/agents/${encodeURIComponent(id)}`, { confirmName }),
  duplicateAgent: (id: string) => req<{ agent: HubAgent }>('POST', `/api/agents/${encodeURIComponent(id)}/duplicate`),
  exportAgent: (id: string) => req<unknown>('GET', `/api/agents/${encodeURIComponent(id)}/export`),
  importAgent: (data: unknown) => req<{ agent: HubAgent }>('POST', '/api/agents/import', data),
  restoreDefaults: () => req<{ restored: HubAgent[] }>('POST', '/api/agents/restore-defaults'),
  promptInfo: (id: string) => req<PromptInfo>('GET', `/api/agents/${encodeURIComponent(id)}/prompt`),
  restoreDefaultPrompt: (id: string) => req<{ agent: HubAgent }>('POST', `/api/agents/${encodeURIComponent(id)}/prompt/restore-default`),
  restoreVersion: (id: string, file: string) => req<{ agent: HubAgent }>('POST', `/api/agents/${encodeURIComponent(id)}/history/${encodeURIComponent(file)}/restore`),
  listTrash: () => req<{ trash: TrashEntry[] }>('GET', '/api/agents-trash'),
  restoreTrash: (trashId: string) => req<{ agent: HubAgent }>('POST', `/api/agents-trash/${encodeURIComponent(trashId)}/restore`),

  listProviders: () => req<{ providers: HubProvider[]; vault: { available: boolean; error: string | null } }>('GET', '/api/providers'),
  setKey: (id: string, key: string) => req<{ ok: boolean; last4: string | null }>('PUT', `/api/providers/${encodeURIComponent(id)}/key`, { key }),
  deleteKey: (id: string) => req<{ ok: boolean }>('DELETE', `/api/providers/${encodeURIComponent(id)}/key`),
  testProvider: (id: string) => req<HealthResult>('POST', `/api/providers/${encodeURIComponent(id)}/test`),
  importEnv: () => req<{ imported: string[]; failed: string[]; skipped: string[]; backup: string | null }>('POST', '/api/providers/import-env', { confirm: true }),

  listMcpServers: () => req<{ servers: McpServer[] }>('GET', '/api/mcp/servers'),
  mcpStatus: (id: string, force = false) => req<McpStatus>('GET', `/api/mcp/servers/${encodeURIComponent(id)}/status${force ? '?force=1' : ''}`),
  testMcpTool: (id: string, tool: string) => req<{ ok: boolean; ms: number; output: string }>('POST', `/api/mcp/servers/${encodeURIComponent(id)}/test`, { tool }),
  saveMcpServer: (cfg: McpServer & { tokenEnv?: string }) => req<{ server: McpServer }>('POST', '/api/mcp/servers', cfg),
  removeMcpServer: (id: string) => req<{ ok: boolean }>('DELETE', `/api/mcp/servers/${encodeURIComponent(id)}`),
  mcpLog: () => req<{ entries: McpLogEntry[] }>('GET', '/api/mcp/log?n=30'),
  mestreStatus: (force = false) => req<MestreStatus>('GET', `/api/mestre/status${force ? '?force=1' : ''}`),
  mestreReconnect: () => req<McpStatus>('POST', '/api/mestre/reconnect'),
  mestreStart: () => req<{ ok: boolean }>('POST', '/api/mestre/start', { confirm: true }),

  ollamaModels: () => req<{ default?: string; local?: string[]; cloud?: string[]; models?: string[] }>('GET', '/api/models/ollama'),
  skills: () => req<{ skills: { name: string; description: string; dir: string }[] }>('GET', '/api/agent/skills'),
};
