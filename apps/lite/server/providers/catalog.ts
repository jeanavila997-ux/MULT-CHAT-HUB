// Catálogo único de provedores: separa modelo local, nuvem do Ollama (paga),
// APIs, roteadores, CLIs e agentes externos. O front recebe só estes metadados,
// nunca chaves. "paid" = pode cobrar por uso: exige confirmação, sem fallback.
import type { ProviderName } from '../../src/lib/providerAdapters.js';

export type ProviderKind = 'local' | 'ollama-cloud' | 'api' | 'router' | 'cli' | 'agent';

export interface ProviderMetaInfo {
  id: ProviderName | 'ollama_cloud' | 'github' | 'supabase' | 'n8n';
  label: string;
  sublabel: string;
  kind: ProviderKind;
  paid: boolean;
  /** Conta no Windows Credential Manager (serviço MultChatHub). */
  secretAccount?: string;
  /** Variáveis do .env.local de onde a chave pode ser importada (a 1ª tem prioridade). */
  envKeys: string[];
  /** Pode ser usado como modelo de conversa. */
  chat: boolean;
}

export const DEFAULT_LOCAL_MODEL = 'jeanavila997/agente-model-file:latest';

export const PROVIDER_CATALOG: ProviderMetaInfo[] = [
  { id: 'ollama', label: 'Ollama', sublabel: 'Local', kind: 'local', paid: false, envKeys: [], chat: true },
  { id: 'llamacpp', label: 'llama.cpp', sublabel: 'Local', kind: 'local', paid: false, envKeys: [], chat: true },
  { id: 'ollama_cloud', label: 'Ollama Cloud', sublabel: 'Nuvem (assinatura)', kind: 'ollama-cloud', paid: true, secretAccount: 'provider:ollama_cloud', envKeys: ['OLLAMA_API_KEY'], chat: false },
  { id: 'openai', label: 'OpenAI', sublabel: 'API', kind: 'api', paid: true, secretAccount: 'provider:openai', envKeys: ['OPENAI_API_KEY'], chat: true },
  { id: 'anthropic', label: 'Anthropic', sublabel: 'API Claude', kind: 'api', paid: true, secretAccount: 'provider:anthropic', envKeys: ['ANTHROPIC_API_KEY'], chat: true },
  { id: 'gemini', label: 'Gemini', sublabel: 'API Google', kind: 'api', paid: true, secretAccount: 'provider:gemini', envKeys: ['GEMINI_API_KEY'], chat: true },
  { id: 'deepseek', label: 'DeepSeek', sublabel: 'API', kind: 'api', paid: true, secretAccount: 'provider:deepseek', envKeys: ['DEEPSEEK_API_KEY'], chat: true },
  { id: 'nvidia', label: 'NVIDIA NIM', sublabel: 'API', kind: 'api', paid: true, secretAccount: 'provider:nvidia', envKeys: ['NVIDIA_API_KEY'], chat: true },
  { id: 'cloudflare', label: 'Cloudflare Workers AI', sublabel: 'API', kind: 'api', paid: true, secretAccount: 'provider:cloudflare', envKeys: ['CLOUDFLARE_API_TOKEN'], chat: true },
  { id: 'grok', label: 'Grok', sublabel: 'API xAI', kind: 'api', paid: true, secretAccount: 'provider:grok', envKeys: ['GROK_API_KEY'], chat: true },
  { id: 'router9', label: '9Router', sublabel: 'Roteador local', kind: 'router', paid: true, secretAccount: 'provider:router9', envKeys: ['ROUTER_API_KEY'], chat: true },
  { id: 'openrouter', label: 'OpenRouter', sublabel: 'Roteador', kind: 'router', paid: true, secretAccount: 'provider:openrouter', envKeys: ['OPENROUTER_API_KEY'], chat: true },
  { id: 'codex', label: 'Codex', sublabel: 'CLI', kind: 'cli', paid: true, envKeys: [], chat: false },
  { id: 'claude_code', label: 'Claude Code', sublabel: 'CLI', kind: 'cli', paid: true, envKeys: [], chat: false },
  { id: 'opencode', label: 'OpenCode', sublabel: 'CLI', kind: 'cli', paid: true, envKeys: [], chat: false },
  { id: 'powershell', label: 'PowerShell', sublabel: 'Terminal', kind: 'cli', paid: false, envKeys: [], chat: false },
  { id: 'hermes', label: 'Hermes', sublabel: 'Agente na VPS', kind: 'agent', paid: true, secretAccount: 'provider:hermes', envKeys: ['HERMES_API_KEY'], chat: false },
  { id: 'grok_bot', label: 'Grok Bot', sublabel: 'Agente externo', kind: 'agent', paid: true, envKeys: [], chat: false },
  { id: 'github', label: 'GitHub', sublabel: 'Ferramenta', kind: 'api', paid: false, secretAccount: 'tool:github', envKeys: ['GITHUB_TOKEN'], chat: false },
  { id: 'supabase', label: 'Supabase', sublabel: 'Memória', kind: 'api', paid: false, secretAccount: 'tool:supabase', envKeys: ['SUPABASE_SERVICE_ROLE_KEY'], chat: false },
];

export function providerMeta(id: string): ProviderMetaInfo | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}

import { isPaidOllamaModel } from '../../src/lib/paid.js';
export { isPaidOllamaModel };

/** Separa modelos instalados em local e nuvem, sem duplicados, escondendo os quebrados. */
export function classifyOllamaModels(names: string[], hiddenList: string[] = []) {
  const hiddenSet = new Set(hiddenList.map((h) => h.trim().toLowerCase()).filter(Boolean));
  const unique = [...new Set(names.map((n) => (typeof n === 'string' ? n.trim() : '')).filter(Boolean))];
  const hidden = unique.filter((n) => hiddenSet.has(n.toLowerCase()));
  const visible = unique.filter((n) => !hiddenSet.has(n.toLowerCase()));
  const sort = (a: string, b: string) => a.localeCompare(b);
  return {
    local: visible.filter((n) => !isPaidOllamaModel(n)).sort(sort),
    cloud: visible.filter(isPaidOllamaModel).sort(sort),
    hidden: hidden.sort(sort),
  };
}

/** OLLAMA_HIDDEN_MODELS="a;b" (padrão: clef:cloud, que quebra com "decision model"). */
export function hiddenOllamaModels(): string[] {
  const raw = process.env.OLLAMA_HIDDEN_MODELS;
  return (raw === undefined ? 'clef:cloud' : raw).split(/[;,\n]/).map((s) => s.trim()).filter(Boolean);
}
