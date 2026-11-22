import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Star, Trash2 } from 'lucide-react';
import { getBackendAuthHeaders } from '../../lib/backendAuth';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/ConfirmDialog';

interface ModelsPayload {
  uso1: string;
  chain: string[];
  allowPaidFallback: boolean;
  local: string[];
  cloud: string[];
  error?: string;
}

const empty: ModelsPayload = { uso1: 'qwen3:4b', chain: [], allowPaidFallback: true, local: [], cloud: [] };

export default function OllamaModelsPanel() {
  const confirm = useConfirm();
  const [data, setData] = useState<ModelsPayload>(empty);
  const [pullName, setPullName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`/api/models/ollama${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...getBackendAuthHeaders(), ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Erro ${res.status}`);
    return body;
  };

  const refresh = async () => {
    const body = await api('') as ModelsPayload;
    setData({
      uso1: body.uso1 || empty.uso1,
      chain: Array.isArray(body.chain) ? body.chain : [],
      allowPaidFallback: body.allowPaidFallback !== false,
      local: body.local ?? [],
      cloud: body.cloud ?? [],
      error: body.error,
    });
  };

  useEffect(() => { void refresh().catch((e) => setNote(e instanceof Error ? e.message : String(e))); }, []);

  const saveChain = async (patch: Partial<ModelsPayload>) => {
    setBusy('save');
    setNote('');
    try {
      const next = { ...data, ...patch };
      await api('/chain', { method: 'PUT', body: JSON.stringify({ uso1: next.uso1, chain: next.chain, allowPaidFallback: next.allowPaidFallback }) });
      await refresh();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const pull = async () => {
    const name = pullName.trim();
    if (!name) return;
    setBusy('pull');
    setNote(`Baixando ${name}…`);
    try {
      await api('/pull', { method: 'POST', body: JSON.stringify({ name }) });
      setPullName('');
      setNote(`Instalado: ${name}`);
      await refresh();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const remove = async (name: string) => {
    const ok = await confirm({ title: 'Excluir modelo?', message: `${name} sai do Ollama e da sequência.`, confirmLabel: 'Excluir', variant: 'danger' });
    if (!ok) return;
    setBusy(name);
    try {
      await api('/delete', { method: 'POST', body: JSON.stringify({ name }) });
      setNote(`Excluído: ${name}`);
      await refresh();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = [...data.chain];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    void saveChain({ chain: next });
  };

  const installed = [...data.local, ...data.cloud];
  const inChain = new Set(data.chain.map((m) => m.toLowerCase()));

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Modelos Ollama</h3>
      <p className="text-xs text-zinc-500">Uso 1 é o padrão. Se ele falhar, segue a sequência. Tarefa/agente com modelo próprio começa nele e só então cai na cadeia.</p>
      {data.error ? <p className="text-xs text-rose-600">{data.error}</p> : null}
      {note ? <p className="text-xs text-zinc-600 dark:text-zinc-300">{note}</p> : null}

      <label className="block text-xs">
        <span className="font-semibold">Uso 1</span>
        <select className="mt-1 w-full h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2" value={data.uso1} onChange={(e) => void saveChain({ uso1: e.target.value })}>
          {data.chain.map((m) => <option key={m} value={m}>{m}</option>)}
          {installed.filter((m) => !inChain.has(m.toLowerCase())).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>

      <ol className="space-y-1">
        {data.chain.map((m, i) => (
          <li key={m} className="flex items-center gap-1 text-sm">
            <span className="w-5 text-xs text-zinc-400">{i + 1}</span>
            <span className="flex-1 truncate font-mono text-xs">{m}{m === data.uso1 ? <Star className="inline w-3 h-3 ml-1 text-amber-500" /> : null}</span>
            <Button size="sm" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="ghost" aria-label="Descer" disabled={i === data.chain.length - 1} onClick={() => move(i, 1)}><ArrowDown className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="ghost" aria-label={`Excluir ${m}`} disabled={busy === m || m === data.uso1} onClick={() => void remove(m)}><Trash2 className="w-3.5 h-3.5" /></Button>
          </li>
        ))}
      </ol>

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={data.allowPaidFallback} onChange={(e) => void saveChain({ allowPaidFallback: e.target.checked })} />
        Se o local falhar, seguir para nuvem :cloud (pode cobrar)
      </label>

      <div className="flex gap-2">
        <input className="flex-1 h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-sm" placeholder="qwen3:8b ou glm-5.3:cloud" value={pullName} onChange={(e) => setPullName(e.target.value)} />
        <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} isLoading={busy === 'pull'} disabled={!pullName.trim()} onClick={() => void pull()}>Adicionar</Button>
      </div>
      <p className="text-[10px] text-zinc-500">Adicionar baixa o modelo no Ollama e coloca no fim da sequência.</p>
    </section>
  );
}
