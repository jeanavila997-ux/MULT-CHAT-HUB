import { Request, Response } from 'express';
import { RoutineScheduler, RoutineStore, LOCAL_PROVIDERS, ROUTINE_PROVIDERS, RoutineDeps } from '../routines/routines.js';
import { ROUTINE_TIMEZONE, formatLocal } from '../routines/schedule.js';
import { buildAgentTools, skillDirs } from '../agent/agentTools.js';
import { listSkills } from '../agent/skills.js';
import { buildAgentRules, modelSystem, ollamaChat, ollamaModel, maxIterations } from './agentController.js';
import { runProviderChat } from './chatController.js';

function slog(level: 'INFO' | 'WARN', msg: string, extra?: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
}

const deps: RoutineDeps = {
  ollama: (model) => {
    const m = model || ollamaModel();
    return {
      // Rotina não tem pressa: espera até 5 min se o Ollama estiver ocupado.
      chat: ollamaChat(m, 300_000),
      system: async () => [await modelSystem(m), buildAgentRules(listSkills(skillDirs()))].filter(Boolean).join('\n\n'),
      defaultModel: m,
      maxIterations: maxIterations(),
    };
  },
  tools: async () => (await buildAgentTools()).tools,
  providerChat: (provider, model, input) => runProviderChat(provider, model, input),
};

const store = new RoutineStore();
export const routineScheduler = new RoutineScheduler(store, deps, (msg, extra) => slog('INFO', msg, extra));

export function startRoutineScheduler() {
  try {
    routineScheduler.start();
    slog('INFO', 'routine_scheduler_started', { timezone: ROUTINE_TIMEZONE, routines: store.list().length });
  } catch (err) {
    slog('WARN', 'routine_scheduler_error', { error: String(err).slice(0, 200) });
  }
}

const view = (r: ReturnType<RoutineStore['list']>[number]) => ({
  ...r,
  running: routineScheduler.isRunning(r.id),
  paidProvider: !LOCAL_PROVIDERS.has(r.provider),
  nextRunLocal: r.nextRunAt ? formatLocal(new Date(r.nextRunAt)) : null,
});

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const handleListRoutines = (_req: Request, res: Response) => {
  res.json({ timezone: ROUTINE_TIMEZONE, providers: ROUTINE_PROVIDERS, routines: store.list().map(view) });
};

export const handleCreateRoutine = (req: Request, res: Response) => {
  try {
    res.status(201).json(view(store.create(req.body ?? {})));
  } catch (err) {
    res.status(400).json({ error: errMsg(err) });
  }
};

export const handleUpdateRoutine = (req: Request, res: Response) => {
  try {
    const r = store.update(String(req.params.id), req.body ?? {});
    if (!r) return res.status(404).json({ error: 'Rotina não encontrada.' });
    return res.json(view(r));
  } catch (err) {
    return res.status(400).json({ error: errMsg(err) });
  }
};

export const handleDeleteRoutine = (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (routineScheduler.isRunning(id)) return res.status(409).json({ error: 'A rotina está rodando; espere terminar.' });
  return store.remove(id) ? res.json({ ok: true }) : res.status(404).json({ error: 'Rotina não encontrada.' });
};

export const handleRunRoutine = async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!store.get(id)) return res.status(404).json({ error: 'Rotina não encontrada.' });
  if (routineScheduler.isRunning(id)) return res.status(409).json({ error: 'Essa rotina já está rodando.' });
  try {
    const run = await routineScheduler.run(id, 'manual');
    if (!run) return res.status(409).json({ error: 'Essa rotina já está rodando.' });
    return res.json({ run, routine: view(store.get(id)!) });
  } catch (err) {
    return res.status(500).json({ error: errMsg(err) });
  }
};
