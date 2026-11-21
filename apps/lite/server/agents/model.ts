// Modelo de agente (v2) gravado em <MCH_DATA_ROOT>/agentes/<id>/agent.json.
import { DEFAULT_LOCAL_MODEL, PROVIDER_CATALOG } from '../providers/catalog.js';

export interface AgentV2 {
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
  /** Nomes das skills ligadas (da biblioteca compartilhada). */
  skills: string[];
  /** Ferramentas: internas ligadas e, por servidor MCP, ferramentas liberadas. */
  tools: { enabled: boolean; mcp: Record<string, { enabled: boolean; allow: string[] }> };
  hidden: boolean;
  pinned: boolean;
  builtin: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type AgentInput = Partial<Omit<AgentV2, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'builtin'>>;

export const AGENT_SUBDIRS = [
  'memoria-curta', 'memoria-longa/fatos', 'memoria-longa/propostas', 'skills', 'ferramentas',
  'mcp', 'acessos', 'seguranca', 'rotinas', 'logs', 'historico',
];

const PROVIDER_IDS = new Set<string>(PROVIDER_CATALOG.map((p) => p.id));

export function slugify(name: string): string {
  const s = (name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40).replace(/-+$/g, '');
  return s || 'agente';
}

export function validateAgentInput(input: AgentInput): { errors: string[] } {
  const errors: string[] = [];
  const str = (v: unknown) => typeof v === 'string';
  if (!str(input.name) || !input.name!.trim()) errors.push('O nome é obrigatório.');
  else if (input.name!.length > 60) errors.push('O nome pode ter até 60 caracteres.');
  if (input.description !== undefined && (!str(input.description) || input.description.length > 300)) errors.push('A descrição pode ter até 300 caracteres.');
  if (input.avatar !== undefined && (!str(input.avatar) || [...input.avatar].length > 4)) errors.push('Avatar: use um emoji ou até 2 letras.');
  if (input.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(input.color))) errors.push('Cor inválida (use #RRGGBB).');
  if (input.provider !== undefined && !PROVIDER_IDS.has(String(input.provider))) errors.push(`Provedor desconhecido: ${input.provider}`);
  if (input.model !== undefined && (!str(input.model) || input.model.length > 200)) errors.push('Modelo inválido.');
  if (input.systemPrompt !== undefined && (!str(input.systemPrompt) || input.systemPrompt.length > 20_000)) errors.push('O system prompt pode ter até 20.000 caracteres.');
  if (input.temperature !== undefined && !(typeof input.temperature === 'number' && input.temperature >= 0 && input.temperature <= 2)) errors.push('A temperatura deve ficar entre 0 e 2.');
  if (input.skills !== undefined && !(Array.isArray(input.skills) && input.skills.every((s) => str(s) && s.length <= 100))) errors.push('Lista de skills inválida.');
  if (input.section !== undefined && (!str(input.section) || input.section.length > 40)) errors.push('Seção inválida.');
  if (input.role !== undefined && !['orquestrador', 'especialista', 'externo'].includes(String(input.role))) errors.push('Papel inválido.');
  if (input.tools !== undefined) {
    const t = input.tools as AgentV2['tools'];
    const ok = t && typeof t === 'object' && typeof t.enabled === 'boolean' && t.mcp && typeof t.mcp === 'object'
      && Object.values(t.mcp).every((m) => m && typeof m.enabled === 'boolean' && Array.isArray(m.allow) && m.allow.every(str));
    if (!ok) errors.push('Configuração de ferramentas inválida.');
  }
  return { errors };
}

export const MESTRE_SERVER_ID = 'mestre';
/** Leitura do Mestre roda direto; o resto sempre pede confirmação no chat. */
export const MESTRE_READ_TOOLS = ['mestre_system_status', 'mestre_list_operations', 'mestre_list_memories'];

type Seed = AgentInput & { id: string; name: string };
const base = {
  provider: 'ollama', model: DEFAULT_LOCAL_MODEL, temperature: 0.4, section: 'Principais',
  hidden: false, pinned: false, skills: [] as string[],
};

export const DEFAULT_AGENT_SEEDS: Seed[] = [
  {
    ...base, id: 'orquestrador', name: 'Orquestrador', avatar: '🧠', color: '#6d28d9', role: 'orquestrador', pinned: true,
    description: 'Coordena a equipe: entende o pedido, divide em tarefas e repassa aos colegas.',
    systemPrompt: 'Você é o Orquestrador do MULT-CHAT-HUB. Responda em português do Brasil, de forma direta. Quando a tarefa for de outro agente (PC/Mestre, Código, Pesquisa, Hermes), diga qual deve fazer e por quê. Nunca use modelo pago sem o Jean confirmar.',
    tools: { enabled: true, mcp: {} },
  },
  {
    ...base, id: 'pc-mestre', name: 'PC / Mestre', avatar: '🖥️', color: '#0f766e', role: 'especialista', pinned: true,
    description: 'Saúde e manutenção do PC pelo Mestre do PC local (MCP :7777).',
    systemPrompt: [
      'Você é o agente PC / Mestre do Jean. Responda em português do Brasil, curto e claro.',
      'Para saber o estado do PC (CPU, RAM, disco, serviços), CHAME a ferramenta mestre_system_status antes de responder; não invente números.',
      'Para ver o que dá para executar, use mestre_list_operations. Ações que alteram o PC, esvaziam a lixeira ou usam IA paga (mestre_ask_grok) só rodam depois que o Jean confirmar no app.',
    ].join('\n'),
    skills: ['diagnostico-pc'],
    tools: { enabled: true, mcp: { [MESTRE_SERVER_ID]: { enabled: true, allow: ['*'] } } },
  },
  {
    ...base, id: 'codigo', name: 'Código', avatar: '💻', color: '#1d4ed8', role: 'especialista', model: 'qwen2.5-coder:3b-instruct',
    description: 'Revisa, explica e corrige código nas pastas liberadas.',
    systemPrompt: 'Você é o agente de Código. Responda em português do Brasil. Explique o problema, proponha a correção mínima e mostre o trecho alterado.',
    skills: ['codigo', 'revisao'], tools: { enabled: true, mcp: {} },
  },
  {
    ...base, id: 'pesquisa', name: 'Pesquisa', avatar: '🔎', color: '#b45309', role: 'especialista', model: 'qwen3.5:4b',
    description: 'Pesquisa, análise de dados e relatórios.',
    systemPrompt: 'Você é o agente de Pesquisa. Responda em português do Brasil, cite de onde veio cada informação e separe fatos de suposições.',
    tools: { enabled: true, mcp: {} },
  },
  {
    ...base, id: 'hermes', name: 'Hermes', avatar: '🛰️', color: '#be123c', role: 'externo', provider: 'hermes', model: 'hermes',
    description: 'Agente externo na VPS (Telegram). Fica offline até haver túnel.',
    systemPrompt: 'Você é o Hermes, agente externo do Jean.',
    tools: { enabled: false, mcp: {} },
  },
];
