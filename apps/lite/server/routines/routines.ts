// Rotinas: prompts salvos que o agente roda sozinho em horário marcado.
// Ninguém está olhando quando uma rotina roda, então:
//  - só ferramentas de LEITURA rodam; as que escrevem/executam/custam são bloqueadas
//    e o bloqueio fica registrado no resultado;
//  - o provedor é o que está salvo na rotina (padrão: Ollama local). Nunca há troca
//    automática para outro provedor.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AgentTool, ChatFn, LoopState, runToolLoop } from '../agent/toolLoop.js';
import { formatLocal, nextRunAt, parseSchedule } from './schedule.js';

export const MAX_HISTORY = 20;
const MAX_TEXT = 4000;
const MAX_ROUTINES = 50;
// Provedores que rodam no próprio PC (sem custo). Os demais podem cobrar por uso.
export const LOCAL_PROVIDERS = new Set(['ollama', 'llamacpp']);
export const ROUTINE_PROVIDERS = ['ollama', 'router9', 'nvidia', 'grok', 'cloudflare'] as const;

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
  model: string; // '' = padrão do servidor
  tools: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  lastRunAt?: string;
  lastStatus?: 'ok' | 'error';
  lastResult?: string;
  lastError?: string;
  history: RoutineRun[];
}

export interface RoutineInput {
  name?: unknown;
  prompt?: unknown;
  schedule?: unknown;
  provider?: unknown;
  model?: unknown;
  tools?: unknown;
  active?: unknown;
}

const clip = (s: string, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n)}…` : s);

// ── Ferramentas: só leitura em rotina ─────────────────────────────────────────
export const BLOCKED_PREFIX = 'BLOQUEADO EM ROTINA';

/**
 * Troca cada ferramenta que pediria confirmação por uma que recusa na hora (sem
 * executar nada) e anota o nome em `blocked`.
 */
export function restrictToReadOnly(tools: AgentTool[], blocked: string[]): AgentTool[] {
  return tools.map((t) => {
    if (!t.requiresConfirmation) return t;
    return {
      ...t,
      requiresConfirmation: false,
      run: async () => {
        if (!blocked.includes(t.name)) blocked.push(t.name);
        throw new Error(`${BLOCKED_PREFIX}: "${t.name}" escreve, executa ou custa dinheiro e só roda com o usuário confirmando no chat. Não tente de novo; responda sem ela.`);
      },
    };
  });
}

export const ROUTINE_RULES = [
  '## Execução automática (rotina)',
  '- Esta é uma ROTINA agendada: não há usuário olhando para confirmar nada.',
  '- Só ferramentas de leitura funcionam; as que escrevem, executam ou custam dinheiro estão bloqueadas.',
  '- Faça a tarefa e entregue um resumo curto e objetivo, sem inventar números.',
].join('\n');

// ── Persistência (apps/lite/data/routines.json, git-ignorado) ─────────────────
export function routinesFile(): string {
  return process.env.ROUTINES_FILE?.trim() || path.resolve(process.cwd(), 'data', 'routines.json');
}

export function exampleRoutine(now = new Date()): Routine {
  const iso = now.toISOString();
  return {
    id: crypto.randomUUID(),
    name: 'Status do PC',
    prompt: 'Use a ferramenta mestre_system_status e resuma em até 4 linhas como está o PC (RAM, disco e tempo ligado). Use só os números que a ferramenta devolver.',
    schedule: 'diário 07:00',
    provider: 'ollama',
    model: '',
    tools: true,
    active: false,
    createdAt: iso,
    updatedAt: iso,
    nextRunAt: null,
    history: [],
  };
}

export class RoutineStore {
  private routines: Routine[] = [];
  private loaded = false;

  constructor(private readonly file: () => string = routinesFile) {}

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    const file = this.file();
    if (!fs.existsSync(file)) {
      this.routines = [exampleRoutine()];
      this.save();
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { routines?: Routine[] };
      this.routines = Array.isArray(data.routines) ? data.routines : [];
    } catch {
      // Arquivo corrompido: guarda uma cópia e começa vazio (não apaga o original).
      fs.copyFileSync(file, `${file}.corrompido-${Date.now()}`);
      this.routines = [];
    }
  }

  save() {
    const file = this.file();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, routines: this.routines }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  list(): Routine[] {
    this.load();
    return this.routines;
  }

  get(id: string): Routine | undefined {
    return this.list().find((r) => r.id === id);
  }

  create(input: RoutineInput, now = new Date()): Routine {
    if (this.list().length >= MAX_ROUTINES) throw new Error(`Limite de ${MAX_ROUTINES} rotinas.`);
    const base = exampleRoutine(now);
    const r: Routine = { ...base, name: '', prompt: '', active: true, tools: true };
    applyInput(r, input, true);
    r.nextRunAt = r.active ? computeNext(r, now) : null;
    this.routines.push(r);
    this.save();
    return r;
  }

  update(id: string, input: RoutineInput, now = new Date()): Routine | undefined {
    const r = this.get(id);
    if (!r) return undefined;
    const copy: Routine = { ...r };
    applyInput(copy, input, false);
    copy.updatedAt = now.toISOString();
    copy.nextRunAt = copy.active ? computeNext(copy, now) : null;
    Object.assign(r, copy);
    this.save();
    return r;
  }

  remove(id: string): boolean {
    const before = this.list().length;
    this.routines = this.routines.filter((r) => r.id !== id);
    if (this.routines.length === before) return false;
    this.save();
    return true;
  }

  recordRun(id: string, run: RoutineRun, now = new Date()) {
    const r = this.get(id);
    if (!r) return;
    r.history = [run, ...(r.history ?? [])].slice(0, MAX_HISTORY);
    r.lastRunAt = run.finishedAt;
    r.lastStatus = run.status;
    r.lastResult = run.status === 'ok' ? clip(run.text, 600) : undefined;
    r.lastError = run.error;
    if (r.active) r.nextRunAt = computeNext(r, now);
    this.save();
  }
}

function computeNext(r: Routine, now: Date): string | null {
  return nextRunAt(parseSchedule(r.schedule), now)?.toISOString() ?? null;
}

function applyInput(r: Routine, input: RoutineInput, creating: boolean) {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
  const name = str(input.name, 80);
  const prompt = str(input.prompt, 4000);
  if (name !== undefined) r.name = name;
  if (prompt !== undefined) r.prompt = prompt;
  if (input.schedule !== undefined) r.schedule = parseSchedule(input.schedule).label;
  if (input.provider !== undefined) {
    const p = str(input.provider, 30) ?? '';
    if (!(ROUTINE_PROVIDERS as readonly string[]).includes(p)) {
      throw new Error(`Provedor inválido. Use: ${ROUTINE_PROVIDERS.join(', ')}.`);
    }
    r.provider = p;
  }
  if (input.model !== undefined) r.model = str(input.model, 120) ?? '';
  if (input.tools !== undefined) r.tools = input.tools === true;
  if (input.active !== undefined) r.active = input.active === true;
  if (creating || name !== undefined) if (!r.name) throw new Error('Nome é obrigatório.');
  if (creating || prompt !== undefined) if (!r.prompt) throw new Error('Prompt é obrigatório.');
  if (creating && input.schedule === undefined) throw new Error('Agenda é obrigatória.');
}

// ── Execução ──────────────────────────────────────────────────────────────────
export interface RoutineDeps {
  /** Ollama com tool-calling (já com system do Modelfile + regras). */
  ollama: (model: string) => { chat: ChatFn; system: () => Promise<string>; defaultModel: string; maxIterations: number };
  tools: () => Promise<AgentTool[]>;
  /** Chat simples para provedores na nuvem (sem ferramentas). */
  providerChat: (provider: string, model: string, input: string) => Promise<{ text: string; model: string }>;
}

export async function executeRoutine(r: Routine, deps: RoutineDeps, trigger: RoutineRun['trigger']): Promise<RoutineRun> {
  const startedAt = new Date().toISOString();
  const blocked: string[] = [];
  const base = { id: crypto.randomUUID(), trigger, startedAt, provider: r.provider };
  let model = r.model;
  try {
    if (r.provider === 'ollama') {
      const o = deps.ollama(r.model);
      model = r.model || o.defaultModel;
      const tools = r.tools ? restrictToReadOnly(await deps.tools(), blocked) : [];
      const system = [await o.system(), ROUTINE_RULES].filter(Boolean).join('\n\n');
      const state: LoopState = {
        messages: [{ role: 'system', content: system }, { role: 'user', content: r.prompt }],
        queue: [],
        iterations: 0,
        trace: [],
      };
      const result = await runToolLoop({ chat: o.chat, tools, maxIterations: o.maxIterations }, state);
      // Com todas as ferramentas sem confirmação, o loop sempre termina em 'done'.
      const text = result.status === 'done' ? result.text : '';
      const trace = result.status === 'done' ? result.trace : result.state.trace;
      return {
        ...base, model, status: 'ok', finishedAt: new Date().toISOString(),
        text: clip(text || 'Sem resposta do modelo.'),
        toolsUsed: trace.filter((t) => t.ok).map((t) => t.tool),
        blocked,
      };
    }
    const out = await deps.providerChat(r.provider, r.model, r.prompt);
    return { ...base, model: out.model, text: clip(out.text || 'Sem resposta.'), status: 'ok', finishedAt: new Date().toISOString(), toolsUsed: [], blocked };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...base, model, status: 'error', finishedAt: new Date().toISOString(),
      text: '', error: clip(msg, 500), toolsUsed: [], blocked,
    };
  }
}

// ── Agendador ─────────────────────────────────────────────────────────────────
export class RoutineScheduler {
  private readonly running = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly store: RoutineStore,
    private readonly deps: RoutineDeps,
    private readonly log: (msg: string, extra?: Record<string, unknown>) => void = () => {},
  ) {}

  isRunning(id: string) {
    return this.running.has(id);
  }

  runningIds() {
    return [...this.running];
  }

  /** Roda uma rotina; devolve null se ela já estiver rodando (nunca duas ao mesmo tempo). */
  async run(id: string, trigger: RoutineRun['trigger']): Promise<RoutineRun | null> {
    const r = this.store.get(id);
    if (!r || this.running.has(id)) return null;
    this.running.add(id);
    try {
      this.log('routine_start', { id, trigger, provider: r.provider });
      const run = await executeRoutine({ ...r }, this.deps, trigger);
      this.store.recordRun(id, run);
      this.log('routine_done', { id, status: run.status, tools: run.toolsUsed, blocked: run.blocked });
      return run;
    } finally {
      this.running.delete(id);
    }
  }

  /** Dispara as rotinas ativas que venceram. Rotinas perdidas com o app fechado não são recuperadas. */
  tick(now = new Date()) {
    for (const r of this.store.list()) {
      if (!r.active || this.running.has(r.id)) continue;
      if (!r.nextRunAt) {
        try { this.store.update(r.id, {}, now); } catch { /* agenda inválida: fica sem próximo */ }
        continue;
      }
      const due = new Date(r.nextRunAt).getTime();
      if (due > now.getTime()) continue;
      if (now.getTime() - due > 10 * 60_000) {
        // Venceu há muito tempo (app estava fechado): só reagenda.
        this.log('routine_skipped_missed', { id: r.id, dueLocal: formatLocal(new Date(due)) });
        this.store.update(r.id, {}, now);
        continue;
      }
      void this.run(r.id, 'agenda').catch((err) => this.log('routine_crash', { id: r.id, error: String(err).slice(0, 200) }));
    }
  }

  start(intervalMs = 20_000) {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
