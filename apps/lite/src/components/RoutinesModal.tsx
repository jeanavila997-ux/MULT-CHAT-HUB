import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clock, Pause, Play, Pencil, Trash2, Plus, History } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { useConfirm } from './ui/ConfirmDialog';
import { ChatContext } from '../context/ChatContext';
import { getBackendAuthHeaders } from '../lib/backendAuth';
import { Routine } from '../types';

// Tela de Rotinas: prompts que o agente roda sozinho em horário marcado
// (GET/POST/PUT/DELETE /api/routines, POST /api/routines/:id/run).

const PROVIDERS: { id: string; label: string }[] = [
  { id: 'ollama', label: 'Ollama local (grátis)' },
  { id: 'router9', label: '9Router' },
  { id: 'nvidia', label: 'NVIDIA' },
  { id: 'grok', label: 'Grok (xAI)' },
  { id: 'cloudflare', label: 'Cloudflare Workers AI' },
];

interface Draft {
  id?: string;
  name: string;
  prompt: string;
  schedule: string;
  provider: string;
  model: string;
  tools: boolean;
  active: boolean;
}

const EMPTY: Draft = { name: '', prompt: '', schedule: 'diário 07:00', provider: 'ollama', model: '', tools: true, active: true };

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const inputCls = 'w-full mt-1 px-2 py-1.5 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const labelCls = 'text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wide';

export default function RoutinesModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const ctx = useContext(ChatContext);
  // Ref: o valor do contexto muda a cada render; o polling não deve reiniciar por isso.
  const syncRef = useRef(ctx?.syncRoutineResults);
  syncRef.current = ctx?.syncRoutineResults;
  const confirm = useConfirm();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<string | null>(null);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`/api/routines${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...getBackendAuthHeaders(), ...(init.headers ?? {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
    return data;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api('') as { routines?: Routine[] };
      const list = Array.isArray(data.routines) ? data.routines : [];
      setRoutines(list);
      syncRef.current?.(list);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
    const t = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(t);
  }, [isOpen, refresh]);

  const save = async () => {
    if (!draft) return;
    setBusy('save');
    try {
      const { id, ...body } = draft;
      await api(id ? `/${id}` : '', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      setDraft(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const act = async (r: Routine, action: 'run' | 'toggle' | 'delete') => {
    if (action === 'delete') {
      const ok = await confirm({ title: 'Apagar rotina?', message: `A rotina "${r.name}" e o histórico dela serão apagados.`, confirmLabel: 'Apagar', variant: 'danger' });
      if (!ok) return;
    }
    if (action === 'run' && r.paidProvider) {
      const ok = await confirm({ title: 'Rodar com provedor pago?', message: `"${r.name}" usa ${r.provider}, que pode cobrar por uso.`, confirmLabel: 'Rodar', variant: 'danger' });
      if (!ok) return;
    }
    setBusy(r.id);
    setError('');
    try {
      if (action === 'run') await api(`/${r.id}/run`, { method: 'POST' });
      if (action === 'toggle') await api(`/${r.id}`, { method: 'PUT', body: JSON.stringify({ active: !r.active }) });
      if (action === 'delete') await api(`/${r.id}`, { method: 'DELETE' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const paidDraft = draft && draft.provider !== 'ollama';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Rotinas"
      description="Tarefas que o agente roda sozinho no horário marcado (fuso America/Rio_Branco). Resultados vão para o canal Rotinas."
      maxWidth="4xl"
      footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}
    >
      <div className="space-y-4 text-sm">
        <p className="text-xs text-zinc-600 dark:text-zinc-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-2">
          Rotina roda sem ninguém olhando: só ferramentas de <b>leitura</b> funcionam. Ferramentas que escrevem, executam ou custam
          são bloqueadas e o bloqueio aparece no resultado. Rotinas perdidas com o app fechado não são recuperadas.
        </p>

        {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded p-2">{error}</p>}

        {draft ? (
          <div className="space-y-3 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 bg-zinc-50 dark:bg-zinc-800/50">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block"><span className={labelCls}>Nome</span>
                <input className={inputCls} value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Status do PC" />
              </label>
              <label className="block"><span className={labelCls}>Agenda</span>
                <input className={inputCls} value={draft.schedule} onChange={(e) => setDraft({ ...draft, schedule: e.target.value })} placeholder="diário 07:00" />
                <span className="text-[10px] text-zinc-500">"diário 07:00", "a cada 30 min" (mín. 5) ou cron "0 8 * * 1-5"</span>
              </label>
            </div>
            <label className="block"><span className={labelCls}>Prompt</span>
              <textarea className={`${inputCls} min-h-[80px]`} value={draft.prompt} maxLength={4000} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} placeholder="Use mestre_system_status e resuma o estado do PC." />
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block"><span className={labelCls}>Provedor</span>
                <select className={inputCls} value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })}>
                  {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              <label className="block"><span className={labelCls}>Modelo</span>
                <input className={inputCls} value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="vazio = padrão do servidor" />
              </label>
            </div>
            {paidDraft && (
              <p className="flex gap-2 text-xs text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 rounded p-2">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                Provedor na nuvem: pode cobrar a cada execução. Usa a chave do apps/lite/.env.local (não a colada na tela) e roda sem ferramentas.
              </p>
            )}
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.tools} disabled={draft.provider !== 'ollama'} onChange={(e) => setDraft({ ...draft, tools: e.target.checked })} /> Ferramentas de leitura</label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Ativa</label>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" isLoading={busy === 'save'} disabled={!draft.name.trim() || !draft.prompt.trim() || !draft.schedule.trim()} onClick={save}>Salvar</Button>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setDraft({ ...EMPTY })}>Nova rotina</Button>
        )}

        <ul className="space-y-2">
          {routines.length === 0 && <li className="text-xs text-zinc-500">Nenhuma rotina.</li>}
          {routines.map((r) => (
            <li key={r.id} className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 bg-white dark:bg-zinc-800">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-indigo-600" aria-hidden="true" /> {r.name}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'}`}>
                      {r.running ? 'RODANDO' : r.active ? 'ATIVA' : 'PAUSADA'}
                    </span>
                    {r.paidProvider && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200" title="Provedor que pode cobrar por uso">PAGO</span>}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {r.schedule} · {r.provider}{r.model ? ` / ${r.model}` : ''} · ferramentas {r.provider === 'ollama' && r.tools ? 'leitura' : 'não'} · próxima: {r.active ? (r.nextRunLocal ?? '—') : '—'}
                  </div>
                  <div className="text-xs mt-1 text-zinc-600 dark:text-zinc-300">
                    Última: {fmt(r.lastRunAt)} {r.lastStatus === 'error' ? <span className="text-red-600">erro: {r.lastError}</span> : r.lastResult ? `— ${r.lastResult.slice(0, 140)}${r.lastResult.length > 140 ? '…' : ''}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="secondary" icon={<Play className="w-3.5 h-3.5" />} isLoading={busy === r.id || r.running} disabled={r.running} onClick={() => act(r, 'run')}>Rodar agora</Button>
                  <Button size="sm" variant="ghost" icon={r.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} onClick={() => act(r, 'toggle')}>{r.active ? 'Pausar' : 'Retomar'}</Button>
                  <Button size="sm" variant="ghost" icon={<Pencil className="w-3.5 h-3.5" />} onClick={() => setDraft({ id: r.id, name: r.name, prompt: r.prompt, schedule: r.schedule, provider: r.provider, model: r.model, tools: r.tools, active: r.active })}>Editar</Button>
                  <Button size="sm" variant="ghost" icon={<History className="w-3.5 h-3.5" />} onClick={() => setOpenHistory(openHistory === r.id ? null : r.id)}>Histórico ({r.history.length})</Button>
                  <Button size="sm" variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} disabled={r.running} onClick={() => act(r, 'delete')}>Apagar</Button>
                </div>
              </div>
              {openHistory === r.id && (
                <ol className="mt-2 space-y-1 border-t border-zinc-200 dark:border-zinc-700 pt-2">
                  {r.history.length === 0 && <li className="text-xs text-zinc-500">Ainda não rodou.</li>}
                  {r.history.map((h) => (
                    <li key={h.id} className="text-xs">
                      <span className={h.status === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600'}>{h.status === 'ok' ? 'OK' : 'ERRO'}</span>{' '}
                      {fmt(h.finishedAt)} · {h.trigger} · {h.model || h.provider}
                      {h.blocked.length > 0 && <span className="text-amber-700 dark:text-amber-300"> · bloqueadas: {h.blocked.join(', ')}</span>}
                      <div className="text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">{h.status === 'ok' ? h.text : h.error}</div>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
