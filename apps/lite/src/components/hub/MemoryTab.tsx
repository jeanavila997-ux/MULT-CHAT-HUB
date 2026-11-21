// Aba Memória: o agente propõe, o Jean aprova (pode editar), rejeita, edita ou apaga.
import { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { AgentMemoryView, hubApi, MemoryItem } from '../../lib/hubApi';
import { useConfirm } from '../ui/ConfirmDialog';
import { Button } from '../ui/Button';

const box = 'w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm';
const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

function ItemEditor({ initial, onSave, onCancel, saveLabel }: { initial: string; onSave: (v: string) => Promise<void>; onCancel: () => void; saveLabel: string }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-1">
      <textarea aria-label="Texto da memória" rows={3} maxLength={2000} className={box} value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      <div className="flex items-center gap-1">
        <Button size="sm" isLoading={busy} disabled={!v.trim()} onClick={async () => { setBusy(true); try { await onSave(v); } finally { setBusy(false); } }}>{saveLabel}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <span className="ml-auto text-[11px] text-zinc-400">{v.length}/2000</span>
      </div>
    </div>
  );
}

export default function MemoryTab({ agentId }: { agentId: string }) {
  const confirm = useConfirm();
  const [data, setData] = useState<AgentMemoryView | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await hubApi.memory(agentId)); setError(''); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [agentId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); setEditing(null); await load(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  if (!data) return <p className="text-sm text-zinc-500" role="status">{error || 'Carregando memória…'}</p>;
  const shortTotal = data.short.sessions.reduce((n, s) => n + s.count, 0);

  const factRow = (f: MemoryItem) => (
    <li key={f.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
      {editing === f.id ? (
        <ItemEditor initial={f.content} saveLabel="Salvar" onCancel={() => setEditing(null)} onSave={(v) => act(() => hubApi.updateFact(agentId, f.id, v))} />
      ) : (
        <div className="flex gap-2">
          <p className="text-sm flex-1 whitespace-pre-wrap">{f.content}</p>
          <Button size="sm" variant="ghost" aria-label="Editar fato" icon={<Pencil className="w-3.5 h-3.5" />} onClick={() => setEditing(f.id)} />
          <Button size="sm" variant="ghost" aria-label="Apagar fato" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={async () => {
            if (await confirm({ title: 'Apagar este fato?', message: f.content.slice(0, 160), confirmLabel: 'Apagar', variant: 'danger' })) await act(() => hubApi.deleteFact(agentId, f.id));
          }} />
        </div>
      )}
      <p className="text-[11px] text-zinc-400 mt-0.5">{fmt(f.updatedAt ?? f.createdAt)} · {f.source}</p>
    </li>
  );

  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : null}

      <section aria-label="Propostas do agente" className="space-y-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Esperando você ({data.proposals.length})</h4>
        {data.proposals.length === 0 ? (
          <p className="text-xs text-zinc-500">Nenhuma proposta. Quando o agente achar algo que vale lembrar, aparece aqui. Nada entra na memória sem você aprovar.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.proposals.map((p) => (
              <li key={p.id} className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 p-2">
                {editing === p.id ? (
                  <ItemEditor initial={p.content} saveLabel="Aprovar editado" onCancel={() => setEditing(null)} onSave={(v) => act(() => hubApi.approveMemory(agentId, p.id, v))} />
                ) : (
                  <>
                    <p className="text-sm whitespace-pre-wrap">{p.content}</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{fmt(p.createdAt)} · {p.source}</p>
                    <div className="flex gap-1 mt-1">
                      <Button size="sm" icon={<Check className="w-3.5 h-3.5" />} onClick={() => act(() => hubApi.approveMemory(agentId, p.id))}>Aprovar</Button>
                      <Button size="sm" variant="secondary" icon={<Pencil className="w-3.5 h-3.5" />} onClick={() => setEditing(p.id)}>Editar</Button>
                      <Button size="sm" variant="ghost" icon={<X className="w-3.5 h-3.5" />} onClick={() => act(() => hubApi.rejectMemory(agentId, p.id))}>Rejeitar</Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Memória longa" className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Memória longa ({data.facts.length})</h4>
          <Button size="sm" variant="ghost" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setEditing('novo')}>Escrever</Button>
        </div>
        {editing === 'novo' ? <ItemEditor initial="" saveLabel="Guardar" onCancel={() => setEditing(null)} onSave={(v) => act(() => hubApi.addFact(agentId, v))} /> : null}
        {data.facts.length === 0 && editing !== 'novo' ? <p className="text-xs text-zinc-500">Vazia. Os fatos aprovados entram no prompt do agente.</p> : <ul className="space-y-1.5">{data.facts.map(factRow)}</ul>}
      </section>

      <section aria-label="Memória curta" className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-2 text-xs space-y-1">
        <h4 className="font-semibold uppercase tracking-wide text-zinc-500">Memória curta</h4>
        <p>{shortTotal} mensagens em {data.short.sessions.length} sessão(ões). Guarda até {data.short.limit} por dia e apaga depois de {data.short.days} dias.</p>
        {data.short.sessions.length ? (
          <Button size="sm" variant="ghost" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={async () => {
            if (await confirm({ title: 'Limpar a memória curta?', message: 'Apaga o histórico de sessões deste agente. Os fatos aprovados ficam.', confirmLabel: 'Limpar', variant: 'danger' })) await act(() => hubApi.clearShortMemory(agentId));
          }}>Limpar</Button>
        ) : null}
      </section>
    </div>
  );
}
