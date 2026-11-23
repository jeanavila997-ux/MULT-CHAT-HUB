import React, { createContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { Agent, Message, Channel, Task, AnalysisResult, ProviderName, ProviderConfig, Routine, RoutineRun } from '../types';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { parseCsv, newMsgId } from '../lib/utils';
import { processCommands } from '../lib/commandProcessor';
import { getBackendAuthHeaders } from '../lib/backendAuth';

interface ChatContextType {
  messages: Message[];
  channels: Channel[];
  currentChannel: string;
  agents: Agent[];
  tasks: Task[];
  dataCache: Record<string, unknown>;
  reports: string[];
  notifications: { id: string; text: string }[];
  activeAgentIndex: number | null;
  externalAgentURL: string;
  pairingCode: string;
  thinkingLevel: 'LOW' | 'HIGH';
  isLoading: boolean;
  streamingId: string | null;
  activeProvider: ProviderName;
  providerConfig: Record<ProviderName, ProviderConfig>;
  agentToolsEnabled: boolean;

  setCurrentChannel: (ch: string) => void;
  addChannel: (ch: Channel) => void;
  addMessage: (msg: Message) => void;
  updateMessageText: (id: string, text: string) => void;
  sendMessage: (text: string) => Promise<void>;
  registerAgent: (agent: Agent) => void;
  updateAgent: (index: number, agent: Agent) => void;
  setActiveAgentIndex: (index: number | null) => void;
  setThinkingLevel: (level: 'LOW' | 'HIGH') => void;
  setActiveProvider: (p: ProviderName) => void;
  updateProviderConfig: (p: ProviderName, cfg: Partial<ProviderConfig>) => void;
  setAgentToolsEnabled: (v: boolean) => void;
  resolveToolConfirmation: (messageId: string, approved: boolean) => Promise<void>;
  setExternalAgentURL: (url: string) => void;
  setPairingCode: (code: string) => void;
  connectExternalAgent: () => Promise<void>;
  disconnectExternalAgent: (gatewayId: string) => Promise<void>;
  syncRoutineResults: (routines: Routine[]) => void;
  transcribeAudio: (callback: (text: string) => void) => void;
  uploadDataset: (file: File) => Promise<void>;
}

export const ChatContext = createContext<ChatContextType | undefined>(undefined);

const STORAGE_KEY = 'mch:state:v1';
const AGENT_TOOLS_KEY = 'mch:agent-tools';
const MAX_PERSIST_MESSAGES = 100;

const DEFAULT_PROVIDER_CONFIG: Record<ProviderName, ProviderConfig> = {
  // model vazio = usa OLLAMA_MODEL do servidor (apps/lite/.env.local)
  ollama:      { model: '', apiKey: '', baseUrl: 'http://127.0.0.1:11434' },
  openai:      { model: 'gpt-4o-mini', apiKey: '' },
  anthropic:   { model: 'claude-haiku-4-5-20251001', apiKey: '' },
  gemini:      { model: 'gemini-2.0-flash-lite', apiKey: '' },
  openrouter:  { model: 'openai/gpt-4o-mini', apiKey: '', baseUrl: 'https://openrouter.ai/api/v1' },
  llamacpp:    { model: 'local-model', apiKey: '', baseUrl: 'http://127.0.0.1:8080/v1' },
  cli:         { model: 'gpt-4o-mini', apiKey: '', baseUrl: 'http://localhost:11434' },
  powershell:  { model: 'gpt-4o-mini', apiKey: '', baseUrl: 'http://localhost:11434' },
  grok:        { model: 'grok-4.7', apiKey: '', baseUrl: 'https://api.x.ai/v1' },
  grok_bot:    { model: 'grok-4.7', apiKey: '', baseUrl: 'https://api.x.ai/v1' },
  codex:       { model: 'gpt-4o-mini', apiKey: '', baseUrl: 'https://api.openai.com/v1' },
  claude_code: { model: 'claude-3-5-sonnet-latest', apiKey: '', baseUrl: 'https://api.anthropic.com' },
  hermes:      { model: 'hermes-3-llama-3.1-70b', apiKey: '', baseUrl: 'https://api.openai.com/v1' },
  opencode:    { model: 'gpt-4o-mini', apiKey: '', baseUrl: 'https://api.openai.com/v1' },
  // model vazio = usa ROUTER_MODEL do servidor
  router9:     { model: '', apiKey: '', baseUrl: 'http://127.0.0.1:20128/v1' },
  deepseek:    { model: 'deepseek-chat', apiKey: '', baseUrl: 'https://api.deepseek.com/v1' },
  nvidia:      { model: 'nvidia/nemotron-nano-3-30b-a3b', apiKey: '', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  cloudflare:  { model: '@cf/meta/llama-4-scout-17b-16e-instruct', apiKey: '' },
  jarvis:      { model: 'jarvis-router', apiKey: '', baseUrl: 'http://127.0.0.1:3200' },
};

const DEFAULT_MESSAGES: Message[] = [
  { id: '1', channel: 'Geral', sender: 'Sistema', text: 'Bem-vindo ao Hub de Colaboração Multi-IA. Por favor, apresente-se ou proponha uma tarefa.' }
];
const DEFAULT_CHANNELS: Channel[] = [{ name: 'Geral', members: [], isPrivate: false }];

const DEFAULT_AGENTS: Agent[] = [
  {
    name: 'Orquestrador Hub',
    specialty: 'Coordenação Ollama Local',
    description: 'IA central do sistema para tarefas gerais e orquestração via modelo local fazendaavila2026/avila.',
    permissions: ['admin', 'tools'],
    provider: 'Interno',
    status: 'Ativo',
    thinkingLevel: 'HIGH',
    tools: []
  },
  {
    name: 'Agente de Análise',
    specialty: 'Análise de Dados & BI',
    description: 'Especialista em análise descritiva, preditiva, detecção de anomalias e otimização linear sobre datasets carregados.',
    permissions: ['tools', 'data_read'],
    provider: 'Interno',
    status: 'Ativo',
    thinkingLevel: 'HIGH',
    tools: [
      { name: 'analyze_descriptive', description: 'Estatísticas descritivas por coluna', parameters: { data: 'object' } },
      { name: 'analyze_predictive', description: 'Regressão linear multivariada', parameters: { data: 'object', target_column: 'string' } },
      { name: 'detect_anomalies', description: 'Detecção de anomalias via z-score', parameters: { data: 'object' } },
      { name: 'optimize_linear', description: 'Otimização linear (LP)', parameters: {} }
    ]
  },
  {
    name: 'Agente de Tools',
    specialty: 'Execução de Ferramentas',
    description: 'Dispatcher de ferramentas do backend: matemática, tempo, memória e análises. Interpreta /use_tool e roteia ao endpoint correto.',
    permissions: ['tools', 'backend'],
    provider: 'Interno',
    status: 'Ativo',
    thinkingLevel: 'LOW',
    tools: [
      { name: 'get_current_time', description: 'Data e hora atual', parameters: {} },
      { name: 'calculate_math', description: 'Calculadora matemática segura', parameters: { expression: 'string' } },
      { name: 'store_memory', description: 'Salva valor em memória', parameters: { key: 'string', value: 'string' } },
      { name: 'retrieve_memory', description: 'Recupera valor da memória', parameters: { key: 'string' } }
    ]
  },
  {
    name: 'Agente GitHub',
    specialty: 'Integração GitHub',
    description: 'Gerencia repositórios e issues via API do GitHub. Requer GITHUB_TOKEN configurado no backend.',
    permissions: ['tools', 'github'],
    provider: 'GitHub API',
    status: 'Ativo',
    thinkingLevel: 'LOW',
    tools: [
      { name: 'github_list_repos', description: 'Lista repositórios de um usuário', parameters: { username: 'string' } },
      { name: 'github_create_issue', description: 'Cria issue em repositório', parameters: { owner: 'string', repo: 'string', title: 'string', body: 'string' } }
    ]
  },
  {
    name: 'Agente de Memória',
    specialty: 'Persistência & Contexto',
    description: 'Gerencia memória de curto e longo prazo do hub. Salva e recupera contexto entre sessões via store_memory/retrieve_memory.',
    permissions: ['memory', 'tools'],
    provider: 'Interno',
    status: 'Ativo',
    thinkingLevel: 'LOW',
    tools: [
      { name: 'store_memory', description: 'Persiste valor por chave', parameters: { key: 'string', value: 'string' } },
      { name: 'retrieve_memory', description: 'Recupera valor por chave', parameters: { key: 'string' } }
    ]
  },
  {
    name: 'Agente de Relatórios',
    specialty: 'Geração de Relatórios',
    description: 'Consolida resultados de análises, tarefas e métricas em relatórios estruturados via /gerar_relatorio.',
    permissions: ['reports', 'data_read'],
    provider: 'Interno',
    status: 'Ativo',
    thinkingLevel: 'HIGH',
    tools: []
  },
  {
    name: 'Agente de Segurança',
    specialty: 'Auditoria & Conformidade',
    description: 'Monitora entradas suspeitas, valida expressões matemáticas e audita uso de ferramentas. Bloqueia payloads maliciosos.',
    permissions: ['audit', 'read_only'],
    provider: 'Interno',
    status: 'Ativo',
    thinkingLevel: 'HIGH',
    tools: []
  },
  {
    name: 'Agente de Monetização',
    specialty: 'Estratégia & Receita',
    description: 'Analisa métricas de uso, sugere modelos de precificação e identifica oportunidades de crescimento com base nos dados do hub.',
    permissions: ['data_read', 'reports'],
    provider: 'Interno',
    status: 'Ativo',
    thinkingLevel: 'HIGH',
    tools: [
      { name: 'recommend_stack', description: 'Recomenda stack tecnológica', parameters: {} }
    ]
  },
  {
    name: 'Agente de Cibersegurança',
    specialty: 'Segurança Ofensiva e Defensiva',
    description: 'Especialista em segurança via Claude API (Anthropic). Analisa vulnerabilidades, audita código, detecta ameaças e gera relatórios de conformidade OWASP/CWE.',
    permissions: ['security_scan', 'code_audit'],
    provider: 'Claude API',
    status: 'Online',
    thinkingLevel: 'HIGH' as const,
    tools: [
      { name: 'scan_text_threats', description: 'Detecta padrões de injeção e ameaças no texto', parameters: { text: 'string' } },
      { name: 'analyze_code_security', description: 'Audita código por vulnerabilidades (CWE/OWASP)', parameters: { code: 'string', language: 'string' } },
      { name: 'generate_security_report', description: 'Gera relatório de segurança estruturado', parameters: { findings: 'string' } }
    ]
  },
  {
    name: 'NullClaw Gateway',
    specialty: 'Automação Local',
    description: 'Conecte seu motor NullClaw rodando localmente.',
    permissions: ['full_access'],
    provider: 'NullClaw Gateway',
    status: 'Offline',
    thinkingLevel: 'HIGH' as const,
    tools: []
  },
  {
    name: 'OpenClaw Automator',
    specialty: 'Integração Webhook Genérico',
    description: 'Agente para automação via webhooks externos. Configure um endpoint URL e dispare automações para qualquer API compatível.',
    permissions: ['tools', 'webhook'],
    provider: 'Webhook Externo',
    status: 'Offline',
    thinkingLevel: 'HIGH' as const,
    tools: [{ name: 'webhook_call', description: 'POST para webhook configurado', parameters: { url: 'string', payload: 'object', headers: 'object' } }]
  }
];

interface PersistedState {
  messages: Message[];
  channels: Channel[];
  tasks: Task[];
  dataCache: Record<string, unknown>;
  reports: string[];
  activeProvider?: ProviderName;
  providerConfig?: Record<ProviderName, ProviderConfig>;
}

function loadPersisted(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedState>;
  } catch {
    return {};
  }
}

function persistState(state: PersistedState): void {
  try {
    let toSave = state;
    let serialized = JSON.stringify(toSave);
    if (serialized.length > 4_000_000 && state.messages.length > MAX_PERSIST_MESSAGES) {
      toSave = { ...state, messages: state.messages.slice(-MAX_PERSIST_MESSAGES) };
      serialized = JSON.stringify(toSave);
    }
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // localStorage cheio ou indisponível: ignorar silenciosamente
  }
}

function mergeProviderConfig(
  saved: Partial<Record<ProviderName, ProviderConfig>> | undefined
): Record<ProviderName, ProviderConfig> {
  if (!saved) return { ...DEFAULT_PROVIDER_CONFIG };
  const result = { ...DEFAULT_PROVIDER_CONFIG };
  for (const p of Object.keys(DEFAULT_PROVIDER_CONFIG) as ProviderName[]) {
    if (saved[p]) result[p] = { ...result[p], ...saved[p] };
  }
  return result;
}

// SSE reader helper: returns the full accumulated text
async function readSseStream(
  response: globalThis.Response,
  onToken: (token: string) => void
): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const tokens: string[] = [];
  let sseBuffer = '';
  let done = false;

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    if (readerDone) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.replace(/^data:\s*/, '').trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed) as { token?: string; done?: boolean; text?: string; error?: string };
        if (evt.error) throw new Error(evt.error);
        if (evt.token) { tokens.push(evt.token); onToken(evt.token); }
        if (evt.done) { done = true; if (evt.text) return evt.text; break; }
      } catch (e) {
        // Re-throw error events, ignore malformed SSE lines
        if (e instanceof Error && !line.startsWith('data:')) continue;
        throw e;
      }
    }
  }
  // Flush remaining decoder bytes
  sseBuffer += decoder.decode();
  return tokens.join('');
}

// Rotinas: resultados viram mensagens no canal "Rotinas" (cada execução uma vez só).
const ROUTINES_SEEN_KEY = 'mch:routines-seen';
const ROUTINES_CHANNEL = 'Rotinas';

function formatRoutineRun(r: Routine, h: RoutineRun): string {
  const when = new Date(h.finishedAt).toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const head = `[${h.trigger === 'manual' ? 'rodada manual' : 'agenda'} · ${when} (Rio Branco) · ${h.model || h.provider}]`;
  const body = h.status === 'ok' ? h.text : `Erro: ${h.error ?? 'desconhecido'}`;
  const extra = [
    h.toolsUsed.length ? `Ferramentas usadas: ${h.toolsUsed.join(', ')}` : '',
    h.blocked.length ? `Bloqueadas (rotina só lê): ${h.blocked.join(', ')}` : '',
  ].filter(Boolean).join('\n');
  return [head, body, extra].filter(Boolean).join('\n\n');
}

// Agente de um gateway pareado (o token fica no servidor; aqui só o id).
function gatewayAgent(g: { id: string; url: string }): Agent {
  return {
    name: `NullClaw ${g.url.replace(/^https?:\/\//, '')}`,
    specialty: 'Agente Conectado',
    description: `Agente rodando em ${g.url}`,
    permissions: ['full_access'],
    provider: 'NullClaw Gateway',
    status: 'Online',
    thinkingLevel: 'HIGH',
    tools: [],
    gatewayId: g.id,
  };
}

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const persisted = loadPersisted();
  const confirm = useConfirm();

  const [messages, setMessages] = useState<Message[]>(persisted.messages?.length ? persisted.messages : DEFAULT_MESSAGES);
  const [channels, setChannels] = useState<Channel[]>(persisted.channels?.length ? persisted.channels : DEFAULT_CHANNELS);
  const [currentChannel, setCurrentChannel] = useState('Geral');
  const [agents, setAgents] = useState<Agent[]>(DEFAULT_AGENTS);
  const [tasks, setTasks] = useState<Task[]>(persisted.tasks ?? []);
  const [dataCache, setDataCache] = useState<Record<string, unknown>>(persisted.dataCache ?? {});
  const [reports, setReports] = useState<string[]>(persisted.reports ?? []);
  const [notifications] = useState<{ id: string; text: string }[]>([]);
  const [activeAgentIndex, setActiveAgentIndex] = useState<number | null>(null);
  const [externalAgentURL, setExternalAgentURL] = useState('http://127.0.0.1:3000');
  const [pairingCode, setPairingCode] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState<'LOW' | 'HIGH'>('HIGH');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<ProviderName>(
    () => (persisted.activeProvider ?? 'ollama')
  );
  const [providerConfig, setProviderConfig] = useState<Record<ProviderName, ProviderConfig>>(
    () => mergeProviderConfig(persisted.providerConfig)
  );
  const [agentToolsEnabled, setAgentToolsEnabledState] = useState<boolean>(() => {
    try { return localStorage.getItem(AGENT_TOOLS_KEY) !== 'off'; } catch { return true; }
  });
  const setAgentToolsEnabled = useCallback((v: boolean) => {
    setAgentToolsEnabledState(v);
    try { localStorage.setItem(AGENT_TOOLS_KEY, v ? 'on' : 'off'); } catch { /* localStorage indisponível */ }
  }, []);

  const updateProviderConfig = useCallback((p: ProviderName, cfg: Partial<ProviderConfig>) => {
    setProviderConfig((prev) => ({ ...prev, [p]: { ...prev[p], ...cfg } }));
  }, []);

  // Refs para acesso ao estado atual dentro de callbacks
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const dataCacheRef = useRef(dataCache);
  dataCacheRef.current = dataCache;

  // Debounce de 500ms para não serializar a cada mudança de estado
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistState({ messages, channels, tasks, dataCache, reports, activeProvider, providerConfig });
    }, 500);
    return () => { if (persistTimer.current) clearTimeout(persistTimer.current); };
  }, [messages, channels, tasks, dataCache, reports, activeProvider, providerConfig]);

  const addMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateMessageText = useCallback((id: string, text: string) => {
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, text } : m));
  }, []);

  const syncRoutineResults = useCallback((list: Routine[]) => {
    let seen = 0;
    try { seen = Number(localStorage.getItem(ROUTINES_SEEN_KEY)) || 0; } catch { /* localStorage indisponível */ }
    const fresh = list
      .flatMap((r) => (r.history ?? []).map((h) => ({ r, h })))
      .filter(({ h }) => new Date(h.finishedAt).getTime() > seen)
      .sort((a, b) => a.h.finishedAt.localeCompare(b.h.finishedAt));
    if (fresh.length === 0) return;
    setChannels((prev) => (prev.some((c) => c.name === ROUTINES_CHANNEL) ? prev : [...prev, { name: ROUTINES_CHANNEL, members: [], isPrivate: false }]));
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const add = fresh
        .filter(({ h }) => !ids.has(`routine-${h.id}`))
        .map(({ r, h }) => ({ id: `routine-${h.id}`, channel: ROUTINES_CHANNEL, sender: `Rotina: ${r.name}`, text: formatRoutineRun(r, h) }));
      return add.length ? [...prev, ...add] : prev;
    });
    const max = Math.max(...fresh.map(({ h }) => new Date(h.finishedAt).getTime()));
    try { localStorage.setItem(ROUTINES_SEEN_KEY, String(max)); } catch { /* localStorage indisponível */ }
  }, []);

  // Busca resultados novos das rotinas a cada 30 s.
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/routines', { headers: getBackendAuthHeaders() });
        if (!res.ok || stopped) return;
        const data = await res.json() as { routines?: Routine[] };
        if (Array.isArray(data.routines)) syncRoutineResults(data.routines);
      } catch { /* backend fora do ar */ }
    };
    void poll();
    const timer = setInterval(poll, 30_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [syncRoutineResults]);

  // Gateways já pareados (o servidor guarda o token) voltam como agentes ao abrir o app.
  useEffect(() => {
    fetch('/api/gateway', { headers: getBackendAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { gateways?: { id: string; url: string }[] } | null) => {
        const list = Array.isArray(data?.gateways) ? data.gateways : [];
        if (list.length) setAgents((prev) => [...prev.filter((a) => !a.gatewayId), ...list.map(gatewayAgent)]);
      })
      .catch(() => { /* backend fora do ar */ });
  }, []);

  // Resposta do agente local (/api/agent/chat e /api/agent/confirm)
  const applyAgentResponse = async (response: globalThis.Response, senderName: string, channel: string) => {
    const data = await response.json().catch(() => ({})) as {
      status?: 'done' | 'needs_confirmation';
      text?: string;
      error?: string;
      pendingId?: string;
      tool?: { name: string; args: Record<string, unknown>; source: string; description: string };
      trace?: { tool: string; ok: boolean; denied?: boolean }[];
    };
    if (!response.ok || data.error) {
      addMessage({ id: newMsgId(), channel, sender: 'Sistema', text: data.error ?? `Erro do agente local (${response.status}).` });
      return;
    }
    if (data.status === 'needs_confirmation' && data.pendingId && data.tool) {
      addMessage({
        id: newMsgId(),
        channel,
        sender: 'Sistema',
        text: `O agente quer executar "${data.tool.name}" (${data.tool.source}). Confirma?`,
        pendingTool: { pendingId: data.pendingId, ...data.tool, status: 'pending' },
      });
      return;
    }
    const used = (data.trace ?? []).filter((t) => !t.denied).map((t) => (t.ok ? t.tool : `${t.tool} (erro)`));
    const note = used.length ? `\n\nFerramentas usadas: ${used.join(', ')}` : '';
    addMessage({ id: newMsgId(), channel, sender: senderName, text: (data.text || 'Sem resposta.') + note });
  };

  const resolveToolConfirmation = async (messageId: string, approved: boolean) => {
    const msg = messagesRef.current.find((m) => m.id === messageId);
    const pendingTool = msg?.pendingTool;
    if (!msg || !pendingTool || pendingTool.status !== 'pending') return;
    setMessages((prev) => prev.map((m) => (m.id === messageId && m.pendingTool
      ? { ...m, pendingTool: { ...m.pendingTool, status: approved ? 'approved' : 'denied' } }
      : m)));
    setIsLoading(true);
    try {
      const response = await fetch('/api/agent/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getBackendAuthHeaders() },
        body: JSON.stringify({ pendingId: pendingTool.pendingId, approved }),
      });
      await applyAgentResponse(response, 'Agente Local', msg.channel);
    } catch {
      addMessage({ id: newMsgId(), channel: msg.channel, sender: 'Sistema', text: 'Falha de comunicação. Verifique se o backend está rodando.' });
    } finally {
      setIsLoading(false);
    }
  };

  // /rotinas lista; /rotina <nome> roda agora (resultado no canal Rotinas).
  const routineCommand = async (input: string) => {
    const say = (text: string) => addMessage({ id: newMsgId(), channel: currentChannel, sender: 'Sistema', text });
    try {
      const res = await fetch('/api/routines', { headers: getBackendAuthHeaders() });
      const data = await res.json().catch(() => ({})) as { routines?: Routine[]; error?: string };
      if (!res.ok) { say(data.error ?? `Erro ${res.status} ao listar rotinas.`); return; }
      const list = data.routines ?? [];
      if (input === '/rotinas') {
        say(list.length
          ? `${list.map((r) => `• ${r.name} — ${r.schedule} — ${r.active ? 'ativa' : 'pausada'}${r.paidProvider ? ' — provedor pago' : ''}`).join('\n')}\n\nRodar agora: /rotina <nome>. Criar ou editar: botão "Rotinas" no topo.`
          : 'Nenhuma rotina. Crie pelo botão "Rotinas" no topo.');
        return;
      }
      const name = input.slice('/rotina '.length).trim();
      const r = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!r) { say(`Rotina "${name}" não encontrada. Veja /rotinas.`); return; }
      if (r.paidProvider) {
        const ok = await confirm({ title: 'Rodar com provedor pago?', message: `"${r.name}" usa ${r.provider}, que pode cobrar por uso.`, confirmLabel: 'Rodar', variant: 'danger' });
        if (!ok) return;
      }
      say(`Rodando "${r.name}"… o resultado vai para o canal ${ROUTINES_CHANNEL}.`);
      const run = await fetch(`/api/routines/${encodeURIComponent(r.id)}/run`, { method: 'POST', headers: getBackendAuthHeaders() });
      const out = await run.json().catch(() => ({})) as { error?: string; routine?: Routine };
      if (!run.ok) { say(out.error ?? `Erro ${run.status} ao rodar a rotina.`); return; }
      if (out.routine) syncRoutineResults([out.routine]);
    } catch {
      say('Falha de comunicação com o backend.');
    }
  };

  const sendMessage = async (input: string) => {
    const channel = channels.find((c) => c.name === currentChannel);
    if (channel?.isPrivate && !channel.members.includes('User')) {
      addMessage({ id: newMsgId(), channel: currentChannel, sender: 'Sistema', text: 'Você não tem permissão neste canal privado.' });
      return;
    }

    if (input.startsWith('/')) {
      if (input === '/clear') {
        const ok = await confirm({
          title: 'Limpar canal?',
          message: `Todas as mensagens do canal "${currentChannel}" serão apagadas.`,
          confirmLabel: 'Limpar',
          variant: 'danger',
        });
        if (ok) setMessages((prev) => prev.filter((m) => m.channel !== currentChannel));
      } else if (input === '/reset') {
        const ok = await confirm({
          title: 'Resetar tudo?',
          message: 'Mensagens, tarefas, datasets e relatórios serão apagados permanentemente.',
          confirmLabel: 'Resetar',
          variant: 'danger',
        });
        if (ok) {
          setMessages(DEFAULT_MESSAGES);
          setTasks([]);
          setDataCache({});
          setReports([]);
          localStorage.removeItem(STORAGE_KEY);
        }
      } else if (input === '/rotinas' || input.startsWith('/rotina ')) {
        await routineCommand(input);
      } else {
        addMessage({ id: newMsgId(), channel: currentChannel, sender: 'Sistema', text: 'Comandos locais: /clear, /reset, /rotinas, /rotina <nome>' });
      }
      return;
    }

    addMessage({ id: newMsgId(), channel: currentChannel, sender: 'User', text: input });
    setIsLoading(true);

    let streamPlaceholderId: string | null = null;
    try {
      let responseText = '';
      let senderName = 'Orquestrador Hub';
      const activeAgent = activeAgentIndex !== null ? agents[activeAgentIndex] : null;

      if (activeAgent?.provider === 'NullClaw Gateway') {
        senderName = activeAgent.name;
        if (!activeAgent.gatewayId) {
          responseText = 'Este é o modelo do agente NullClaw. Conecte um gateway em "Gateway Externo" (URL + código de pareamento) e selecione o agente conectado.';
        } else {
          // O servidor do lite usa o token deste gateway (evita CORS e não expõe o token).
          const response = await fetch(`/api/gateway/${encodeURIComponent(activeAgent.gatewayId)}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getBackendAuthHeaders() },
            body: JSON.stringify({ message: input }),
          });
          const data = await response.json().catch(() => ({})) as { text?: string; error?: string };
          responseText = response.ok ? (data.text || 'Sem resposta.') : (data.error ?? `Erro no Gateway (${response.status}).`);
        }
        addMessage({ id: newMsgId(), channel: currentChannel, sender: senderName, text: responseText });

      } else if (activeAgent?.provider === 'Webhook Externo') {
        senderName = activeAgent.name;
        responseText = 'Aguardando configuração de URL de webhook. Defina a URL no campo "Conectar Gateway Externo" (URL) e envie /use_tool webhook_call para testar.';
        addMessage({ id: newMsgId(), channel: currentChannel, sender: senderName, text: responseText });

      } else if (activeAgent?.provider === 'Claude API') {
        // SSE streaming via Agente de Cibersegurança (Claude API)
        senderName = activeAgent.name;

        const channelHistory = messagesRef.current
          .filter((m) => m.channel === currentChannel && m.sender !== 'Sistema')
          .slice(-20)
          .map((m) => ({ role: m.sender === 'User' ? 'user' : 'assistant', content: m.text }));

        const streamMsgId = newMsgId();
        streamPlaceholderId = streamMsgId;
        addMessage({ id: streamMsgId, channel: currentChannel, sender: senderName, text: '' });
        setStreamingId(streamMsgId);

        try {
          const response = await fetch('/api/chat/claude-security', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getBackendAuthHeaders() },
            body: JSON.stringify({ input, history: channelHistory }),
          });

          if (!response.ok || !response.body) {
            const errData = await response.json().catch(() => ({} as { error?: string })) as { error?: string };
            responseText = errData.error ?? 'Erro ao conectar à Claude API. Verifique ANTHROPIC_API_KEY no backend.';
            updateMessageText(streamMsgId, responseText);
          } else {
            try {
              const claudeTokens: string[] = [];
              responseText = await readSseStream(response, (token) => {
                claudeTokens.push(token);
                updateMessageText(streamMsgId, claudeTokens.join(''));
              });
              updateMessageText(streamMsgId, responseText);
            } catch (sseErr: unknown) {
              responseText = sseErr instanceof Error ? sseErr.message : 'Erro no stream do Agente de Cibersegurança.';
              updateMessageText(streamMsgId, responseText);
            }
          }
        } finally {
          setStreamingId(null);
        }

      } else if (activeProvider === 'ollama' && agentToolsEnabled) {
        // Agente local com tool-calling (ferramentas, MCP, skills). Ferramentas de
        // escrita voltam como needs_confirmation e só rodam após o clique do usuário.
        senderName = activeAgent?.name ?? 'Agente Local';
        const channelHistory = messagesRef.current
          .filter((m) => m.channel === currentChannel && m.sender !== 'Sistema')
          .slice(-20)
          .map((m) => ({ role: m.sender === 'User' ? 'user' : 'assistant', content: m.text }));
        const response = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getBackendAuthHeaders() },
          body: JSON.stringify({ input, history: channelHistory, model: providerConfig.ollama.model }),
        });
        await applyAgentResponse(response, senderName, currentChannel);
        // responseText fica vazio de propósito: /use_tool (processCommands) não roda
        // no modo agente, para nenhuma ferramenta escapar da confirmação.

      } else if (activeProvider === 'ollama') {
        // SSE streaming via Ollama
        senderName = activeAgent?.name ?? 'Orquestrador Hub';

        const channelHistory = messagesRef.current
          .filter((m) => m.channel === currentChannel && m.sender !== 'Sistema')
          .slice(-20)
          .map((m) => ({ role: m.sender === 'User' ? 'user' : 'assistant', content: m.text }));

        const cfg = providerConfig[activeProvider];
        const streamMsgId = newMsgId();
        streamPlaceholderId = streamMsgId;
        addMessage({ id: streamMsgId, channel: currentChannel, sender: senderName, text: '' });
        setStreamingId(streamMsgId);

        try {
          const response = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getBackendAuthHeaders() },
            body: JSON.stringify({ input, thinking: thinkingLevel, history: channelHistory, model: cfg.model, baseUrl: cfg.baseUrl, provider: activeProvider }),
          });

          if (!response.ok || !response.body) {
            const errData = await response.json().catch(() => ({} as { error?: string })) as { error?: string };
            responseText = errData.error ?? 'Ollama offline. Inicie com `ollama serve`.';
            updateMessageText(streamMsgId, responseText);
          } else {
            // Accumulate tokens in a local array to avoid O(n²) string growth
            const accumulated: string[] = [];
            try {
              responseText = await readSseStream(response, (token) => {
                accumulated.push(token);
                updateMessageText(streamMsgId, accumulated.join(''));
              });
              updateMessageText(streamMsgId, responseText);
            } catch (sseErr: unknown) {
              responseText = sseErr instanceof Error ? sseErr.message : 'Erro no stream do Ollama.';
              updateMessageText(streamMsgId, responseText);
            }
          }
        } finally {
          setStreamingId(null);
        }

      } else {
        // Non-streaming multi-provider path (openai, anthropic, gemini, openrouter)
        senderName = activeAgent?.name ?? 'Orquestrador Hub';

        const channelHistory = messagesRef.current
          .filter((m) => m.channel === currentChannel && m.sender !== 'Sistema')
          .slice(-20)
          .map((m) => ({ role: m.sender === 'User' ? 'user' : 'assistant', content: m.text }));

        const cfg = providerConfig[activeProvider];
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getBackendAuthHeaders() },
          body: JSON.stringify({
            input,
            thinking: thinkingLevel,
            history: channelHistory,
            provider: activeProvider,
            model: cfg.model,
            apiKey: cfg.apiKey,
            baseUrl: cfg.baseUrl,
          }),
        });
        if (response.ok) {
          const data = await response.json() as { text?: string; error?: string };
          responseText = data.text || data.error || 'Sem resposta.';
        } else {
          const data = await response.json().catch(() => ({} as { error?: string })) as { error?: string };
          responseText = data.error ?? `Erro ao chamar ${activeProvider}.`;
        }
        addMessage({ id: newMsgId(), channel: currentChannel, sender: senderName, text: responseText });
      }

      // processCommands runs for all paths
      if (responseText) {
        await processCommands(responseText, {
          channel: currentChannel,
          tasks: tasksRef.current,
          dataCache: dataCacheRef.current,
          addMessage,
          setTasks,
          setDataCache,
          setReports,
          confirmWrite: (toolName, args) => confirm({
            title: `Executar ${toolName}?`,
            message: `O modelo pediu ${toolName} com: ${JSON.stringify(args).slice(0, 400)}`,
            confirmLabel: 'Executar',
            variant: 'danger',
          }),
        });
      }
    } catch {
      const errMsg = 'Falha de comunicação. Verifique se o backend está rodando.';
      if (streamPlaceholderId) {
        updateMessageText(streamPlaceholderId, errMsg);
      } else {
        addMessage({ id: newMsgId(), channel: currentChannel, sender: 'Sistema', text: errMsg });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const uploadDataset = async (file: File) => {
    try {
      const text = await file.text();
      let parsed: Record<string, number[]>;
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.json')) {
        const raw = JSON.parse(text) as unknown;
        if (Array.isArray(raw)) {
          if (raw.length === 0) throw new Error('JSON vazio.');
          const firstRow = raw[0] as Record<string, unknown>;
          const cols: Record<string, number[]> = {};
          for (const key of Object.keys(firstRow)) cols[key] = [];
          for (const row of raw) {
            for (const key of Object.keys(cols)) {
              const v = (row as Record<string, unknown>)[key];
              const num = Number(v);
              cols[key].push(Number.isFinite(num) ? num : NaN);
            }
          }
          parsed = cols;
        } else if (raw && typeof raw === 'object') {
          parsed = raw as Record<string, number[]>;
        } else {
          throw new Error('JSON precisa ser objeto colunar ou array de objetos.');
        }
      } else if (lower.endsWith('.csv')) {
        parsed = parseCsv(text);
      } else {
        throw new Error('Formato não suportado. Envie .csv ou .json');
      }

      setDataCache((prev) => ({ ...prev, [file.name]: parsed }));
      const cols = Object.keys(parsed);
      const rows = parsed[cols[0]]?.length ?? 0;
      addMessage({
        id: newMsgId(),
        channel: currentChannel,
        sender: 'Sistema',
        text: `Dataset "${file.name}" carregado: ${rows} linhas, ${cols.length} colunas (${cols.join(', ')}).\nUse: /use_tool analyze_descriptive {"data": <conteúdo de dataCache["${file.name}"]>}`
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addMessage({ id: newMsgId(), channel: currentChannel, sender: 'Sistema', text: `Erro ao carregar arquivo: ${msg}` });
    }
  };

  // Pareamento: o servidor troca o código (uso único) por um token no /pair do
  // gateway e guarda o token; o navegador recebe só o id da conexão.
  const connectExternalAgent = async () => {
    if (!externalAgentURL.trim() || !pairingCode.trim()) return;
    const say = (text: string) => addMessage({ id: newMsgId(), channel: currentChannel, sender: 'Sistema', text });
    try {
      const response = await fetch('/api/gateway/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getBackendAuthHeaders() },
        body: JSON.stringify({ url: externalAgentURL.trim(), code: pairingCode.trim() }),
      });
      const data = await response.json().catch(() => ({})) as { id?: string; url?: string; error?: string };
      if (!response.ok || !data.id || !data.url) {
        say(`Pareamento falhou: ${data.error ?? `erro ${response.status}`}`);
        return;
      }
      const agent = gatewayAgent({ id: data.id, url: data.url });
      setActiveAgentIndex(null);
      setAgents((prev) => [...prev.filter((a) => a.name !== agent.name), agent]);
      setPairingCode(''); // o código já foi trocado por um token guardado no servidor
      say(`Conectado ao gateway ${data.url}. Selecione "${agent.name}" na lista de agentes para conversar.`);
    } catch {
      say('Erro de conexão com o servidor do lite.');
    }
  };

  const disconnectExternalAgent = async (gatewayId: string) => {
    try {
      await fetch(`/api/gateway/${encodeURIComponent(gatewayId)}`, { method: 'DELETE', headers: getBackendAuthHeaders() });
    } catch { /* remove da lista mesmo assim */ }
    setActiveAgentIndex(null);
    setAgents((prev) => prev.filter((a) => a.gatewayId !== gatewayId));
    addMessage({ id: newMsgId(), channel: currentChannel, sender: 'Sistema', text: 'Gateway desconectado; o token foi apagado do servidor do lite.' });
  };

  const transcribeAudio = (callback: (t: string) => void) => {
    if (!('webkitSpeechRecognition' in window)) {
      addMessage({ id: newMsgId(), channel: currentChannel, sender: 'Sistema', text: 'Reconhecimento de voz não suportado neste navegador.' });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionCtor = (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'pt-BR';
    recognition.onresult = (event: { results: { [0]: { [0]: { transcript: string } } } }) => {
      callback(event.results[0][0].transcript);
    };
    recognition.onerror = () => {
      addMessage({ id: newMsgId(), channel: currentChannel, sender: 'Sistema', text: 'Erro ao capturar áudio.' });
    };
    recognition.start();
    addMessage({ id: newMsgId(), channel: currentChannel, sender: 'Sistema', text: 'Ouvindo…' });
  };

  return (
    <ChatContext.Provider value={{
      messages, channels, currentChannel, agents, tasks, dataCache, reports, notifications, activeAgentIndex,
      externalAgentURL, pairingCode, thinkingLevel, isLoading, streamingId, activeProvider, providerConfig, agentToolsEnabled,
      setCurrentChannel,
      addChannel: (ch) => setChannels((prev) => [...prev, ch]),
      addMessage,
      updateMessageText,
      sendMessage,
      registerAgent: (ag) => setAgents((prev) => [...prev, ag]),
      updateAgent: (i, ag) => setAgents((prev) => { const next = [...prev]; next[i] = ag; return next; }),
      setActiveAgentIndex,
      setThinkingLevel,
      setActiveProvider,
      updateProviderConfig,
      setAgentToolsEnabled,
      resolveToolConfirmation,
      setExternalAgentURL,
      setPairingCode,
      connectExternalAgent,
      disconnectExternalAgent,
      syncRoutineResults,
      transcribeAudio,
      uploadDataset,
    }}>
      {children}
    </ChatContext.Provider>
  );
};
