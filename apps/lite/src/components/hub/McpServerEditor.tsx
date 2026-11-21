// Cadastro de servidores MCP (substitui editar servers.json à mão).
// O servidor valida: HTTP só em 127.0.0.1, stdio sem shell nem & | ; < > ` $.
import { useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { hubApi, McpServer } from '../../lib/hubApi';
import { useConfirm } from '../ui/ConfirmDialog';
import { Button } from '../ui/Button';

const EMPTY: McpServer = { id: '', name: '', type: 'http', url: 'http://127.0.0.1:', enabled: true, args: [] };
const field = 'w-full h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-sm';
const lbl = 'block text-[11px] font-medium text-zinc-500 mb-0.5';

export default function McpServerEditor({ servers, onChanged }: { servers: McpServer[]; onChanged: () => void }) {
  const confirm = useConfirm();
  const [form, setForm] = useState<McpServer | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [argsText, setArgsText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<Record<string, string>>({});

  const edit = (s: McpServer | null) => {
    setError('');
    setIsNew(!s);
    const f = s ? { ...s } : { ...EMPTY };
    setForm(f);
    setArgsText((f.args ?? []).join('\n'));
  };
  const save = async () => {
    if (!form) return;
    setBusy('save'); setError('');
    try {
      await hubApi.saveMcpServer({ ...form, args: argsText.split('\n').map((a) => a.trim()).filter(Boolean) });
      setForm(null); onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  };
  const remove = async (s: McpServer) => {
    const ok = await confirm({ title: `Remover ${s.name}?`, message: 'Os agentes que usavam este servidor perdem as ferramentas dele.', confirmLabel: 'Remover', variant: 'danger' });
    if (!ok) return;
    try { await hubApi.removeMcpServer(s.id); onChanged(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const test = async (s: McpServer) => {
    setBusy(s.id);
    try {
      const st = await hubApi.mcpStatus(s.id, true);
      setTestMsg((m) => ({ ...m, [s.id]: st.ok ? `🟢 ${st.tools.length} ferramentas` : `🔴 ${st.error ?? 'sem resposta'}` }));
    } catch (err) { setTestMsg((m) => ({ ...m, [s.id]: `🔴 ${err instanceof Error ? err.message : String(err)}` })); }
    finally { setBusy(null); }
  };
  const set = <K extends keyof McpServer>(k: K, v: McpServer[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <section aria-label="Servidores MCP" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Servidores ({servers.length})</h3>
        <Button size="sm" variant="secondary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => edit(null)}>Adicionar</Button>
      </div>
      <ul className="space-y-1">
        {servers.map((s) => (
          <li key={s.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2 text-xs">
            <div className="flex items-center gap-2">
              <span>{s.status?.ok ? '🟢' : s.enabled ? '🔴' : '⚪'}</span>
              <span className="font-medium text-sm truncate">{s.name}</span>
              <span className="text-zinc-400">{s.type}{s.builtin ? ' · embutido' : ''}{s.enabled ? '' : ' · desligado'}</span>
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" aria-label={`Testar ${s.name}`} icon={<RefreshCw className="w-3.5 h-3.5" />} isLoading={busy === s.id} onClick={() => test(s)} />
                <Button size="sm" variant="ghost" aria-label={`Editar ${s.name}`} icon={<Pencil className="w-3.5 h-3.5" />} onClick={() => edit(s)} />
                {s.builtin ? null : <Button size="sm" variant="ghost" aria-label={`Remover ${s.name}`} icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => remove(s)} />}
              </span>
            </div>
            <p className="font-mono text-zinc-500 truncate">{s.type === 'http' ? s.url : [s.command, ...(s.args ?? [])].join(' ')}</p>
            {testMsg[s.id] ? <p role="status" className="mt-1">{testMsg[s.id]}</p> : null}
          </li>
        ))}
      </ul>

      {form ? (
        <form className="rounded-xl border border-indigo-200 dark:border-indigo-900 p-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <h4 className="text-sm font-semibold">{isNew ? 'Novo servidor MCP' : `Editar ${form.name}`}</h4>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl} htmlFor="mcp-id">Id</label><input id="mcp-id" className={field} value={form.id} disabled={!isNew} placeholder="ex.: arquivos" onChange={(e) => set('id', e.target.value.toLowerCase())} /></div>
            <div><label className={lbl} htmlFor="mcp-name">Nome</label><input id="mcp-name" className={field} value={form.name} disabled={!!form.builtin} onChange={(e) => set('name', e.target.value)} /></div>
          </div>
          {form.builtin ? null : (
            <div className="flex gap-3 text-sm" role="radiogroup" aria-label="Tipo">
              <label className="flex items-center gap-1"><input type="radio" checked={form.type === 'http'} onChange={() => set('type', 'http')} /> HTTP local</label>
              <label className="flex items-center gap-1"><input type="radio" checked={form.type === 'stdio'} onChange={() => set('type', 'stdio')} /> Processo (stdio)</label>
            </div>
          )}
          {form.builtin ? null : form.type === 'http' ? (
            <>
              <div><label className={lbl} htmlFor="mcp-url">URL (só 127.0.0.1 / localhost)</label><input id="mcp-url" className={`${field} font-mono`} value={form.url ?? ''} onChange={(e) => set('url', e.target.value)} /></div>
              <div><label className={lbl} htmlFor="mcp-token">Variável do token no .env.local (opcional)</label><input id="mcp-token" className={`${field} font-mono`} value={form.tokenEnv ?? ''} placeholder="ex.: MEU_MCP_TOKEN" onChange={(e) => set('tokenEnv', e.target.value.toUpperCase() || undefined)} /></div>
            </>
          ) : (
            <>
              <div><label className={lbl} htmlFor="mcp-cmd">Programa (sem shell: node, python, npx, caminho .exe)</label><input id="mcp-cmd" className={`${field} font-mono`} value={form.command ?? ''} onChange={(e) => set('command', e.target.value)} /></div>
              <div><label className={lbl} htmlFor="mcp-args">Argumentos (um por linha)</label><textarea id="mcp-args" rows={3} className={`${field} h-auto py-1 font-mono text-xs`} value={argsText} onChange={(e) => setArgsText(e.target.value)} /></div>
            </>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Ligado</label>
          {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : null}
          <div className="flex gap-2">
            <Button size="sm" type="submit" isLoading={busy === 'save'}>Salvar</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setForm(null)}>Cancelar</Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
