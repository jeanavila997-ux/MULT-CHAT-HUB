export type ProviderName =
  | 'ollama'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'llamacpp'
  | 'cli'
  | 'powershell'
  | 'grok'
  | 'grok_bot'
  | 'codex'
  | 'claude_code'
  | 'hermes'
  | 'opencode'
  | 'router9'
  | 'deepseek'
  | 'nvidia'
  | 'cloudflare';

export interface ProviderConfig {
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, string>;
}

export interface Agent {
  name: string;
  specialty: string;
  description: string;
  permissions: string[];
  provider: string;
  status: string;
  thinkingLevel: 'LOW' | 'HIGH';
  tools: Tool[];
  /** Conexão de gateway externo (o token fica no servidor do lite). */
  gatewayId?: string;
}

export type AnalysisType = 'descritiva' | 'preditiva' | 'anomalias' | 'otimizacao' | 'software';

export interface AnalysisResult {
  analysis_type: AnalysisType;
  input_rows: number;
  input_columns: string[];
  analysis_result: Record<string, unknown>;
}

export interface AgentPendingTool {
  pendingId: string;
  name: string;
  args: Record<string, unknown>;
  source: string;
  description: string;
  status: 'pending' | 'approved' | 'denied';
}

export interface Message {
  id: string;
  channel: string;
  sender: string;
  text: string;
  analysis?: AnalysisResult;
  pendingTool?: AgentPendingTool;
}

export interface Channel {
  name: string;
  members: string[];
  isPrivate: boolean;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  deadline: string;
  status: string;
}

// Rotinas agendadas (GET /api/routines)
export interface RoutineRun {
  id: string;
  trigger: 'agenda' | 'manual';
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'error';
  provider: string;
  model: string;
  text: string;
  error?: string;
  toolsUsed: string[];
  blocked: string[];
}

export interface Routine {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  provider: string;
  model: string;
  tools: boolean;
  active: boolean;
  nextRunAt: string | null;
  nextRunLocal: string | null;
  lastRunAt?: string;
  lastStatus?: 'ok' | 'error';
  lastResult?: string;
  lastError?: string;
  history: RoutineRun[];
  running: boolean;
  paidProvider: boolean;
}
