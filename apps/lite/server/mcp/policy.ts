// Política das ferramentas MCP: classe de risco, confirmação e liberação por agente.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentV2 } from '../agents/model.js';

export type ToolClass = 'read' | 'write' | 'exec' | 'destructive' | 'paid';

/** Classes fixas: o servidor não consegue rebaixar (ex.: dizer que esvaziar a lixeira é leitura). */
const FIXED: Record<string, Record<string, ToolClass>> = {
  mestre: {
    mestre_system_status: 'read',
    mestre_list_operations: 'read',
    mestre_list_memories: 'read',
    mestre_save_memory: 'write',
    mestre_run_operation: 'exec',
    mestre_optimize_ram_and_temp: 'destructive', // esvazia a Lixeira
    mestre_ask_grok: 'paid', // IA paga via 9Router
    mestre_turbo_diagnostico: 'read', // Turbo PC: só leitura
    mestre_turbo_otimizar: 'destructive', // Turbo PC: limpa temporários e muda configurações (com desfazer)
  },
};

export interface ToolAnnotations { readOnlyHint?: boolean; destructiveHint?: boolean }

export function classifyMcpTool(server: string, tool: string, ann: ToolAnnotations = {}): ToolClass {
  const fixed = FIXED[server]?.[tool];
  if (fixed) return fixed;
  if (ann.destructiveHint) return 'destructive';
  if (ann.readOnlyHint) return 'read';
  return 'write'; // desconhecida = pede confirmação
}

export function needsConfirmation(c: ToolClass): boolean {
  return c !== 'read';
}

export const CLASS_LABEL: Record<ToolClass, string> = {
  read: 'leitura', write: 'escrita', exec: 'execução', destructive: 'destrutiva', paid: 'paga 💲',
};

export function toolAllowedForAgent(tools: AgentV2['tools'], server: string, tool: string): boolean {
  if (!tools?.enabled) return false;
  const s = tools.mcp?.[server];
  if (!s?.enabled) return false;
  return s.allow.includes('*') || s.allow.includes(tool);
}

const SENSITIVE = /pass|senha|token|secret|key|auth/i;
function redact(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const safe = Object.fromEntries(Object.entries(args as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) ? '***' : v]));
  return JSON.stringify(safe).slice(0, 200);
}

export interface McpCallEntry { ts: string; agentId: string; server: string; tool: string; klass: ToolClass; ok: boolean; ms: number; args: string; error?: string }

export class McpCallLog {
  constructor(private readonly file: string) {}
  append(e: Omit<McpCallEntry, 'ts' | 'args'> & { args?: unknown }): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const entry: McpCallEntry = { ts: new Date().toISOString(), agentId: e.agentId, server: e.server, tool: e.tool, klass: e.klass, ok: e.ok, ms: e.ms, args: redact(e.args), ...(e.error ? { error: e.error.slice(0, 200) } : {}) };
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch { /* log nunca derruba a chamada */ }
  }
  tail(n = 50): McpCallEntry[] {
    try {
      return fs.readFileSync(this.file, 'utf8').trim().split('\n').slice(-n).filter(Boolean).map((l) => JSON.parse(l) as McpCallEntry);
    } catch { return []; }
  }
}
