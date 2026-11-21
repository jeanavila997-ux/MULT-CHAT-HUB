// Seção API: chaves por provedor no cofre do Windows. A chave digitada vai
// direto para o servidor e nunca volta (só os 4 últimos dígitos).
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, PlugZap, Trash2 } from 'lucide-react';
import { hubApi, HealthResult, HubProvider } from '../../lib/hubApi';
import { useConfirm } from '../ui/ConfirmDialog';
import { Button } from '../ui/Button';
import { PanelShell } from './PanelShell';

const SOURCE: Record<string, string> = { cofre: 'no cofre', env: 'no .env.local' };

function ProviderRow({ p, onChanged }: { p: HubProvider; onChanged: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HealthResult | { ok: boolean; detail: string } | null>(null);

  const save = async () => {
    setBusy(true);
    try { await hubApi.setKey(p.id, key); setKey(''); setResult({ ok: true, detail: 'Chave salva no cofre.' }); onChanged(); }
    catch (err) { setResult({ ok: false, detail: err instanceof Error ? err.message : String(err) }); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { setResult(await hubApi.testProvider(p.id)); } catch (err) { setResult({ ok: false, detail: err instanceof Error ? err.message : String(err) }); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    try { await hubApi.deleteKey(p.id); setResult({ ok: true, detail: 'Chave apagada do cofre.' }); onChanged(); }
    catch (err) { setResult({ ok: false, detail: err instanceof Error ? err.message : String(err) }); }
  };

  return (
    <li className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">{p.label}</span>
        {p.paid ? <span className="text-[10px] rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 px-1.5 py-0.5">💲 pago</span> : <span className="text-[10px] rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 px-1.5 py-0.5">grátis</span>}
        <span className="ml-auto text-xs text-zinc-500">
          {p.needsKey ? (p.source ? `●  ${SOURCE[p.source]}${p.last4 ? ` · …${p.last4}` : ''}` : '○ sem chave') : 'local'}
        </span>
      </div>
      <p className="text-xs text-zinc-500">{p.sublabel}</p>
      {p.needsKey ? (
        <div className="flex gap-2">
          <label className="sr-only" htmlFor={`key-${p.id}`}>Nova chave {p.label}</label>
          <input
            id={`key-${p.id}`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={p.source ? 'Trocar chave…' : 'Colar chave…'}
            className="flex-1 h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-sm"
          />
          <Button size="sm" icon={<KeyRound className="w-3.5 h-3.5" />} disabled={!key.trim() || busy} onClick={save}>Salvar</Button>
          {p.source === 'cofre' ? <Button size="sm" variant="ghost" aria-label={`Apagar chave ${p.label}`} icon={<Trash2 className="w-3.5 h-3.5" />} onClick={remove} /> : null}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" icon={<PlugZap className="w-3.5 h-3.5" />} onClick={test} isLoading={busy}>Testar conexão</Button>
        {result ? <span role="status" className={`text-xs ${result.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{result.ok ? '✓' : '✗'} {result.detail}</span> : null}
      </div>
    </li>
  );
}

export default function ApiPanel({ onClose }: { onClose: () => void }) {
  const confirm = useConfirm();
  const [providers, setProviders] = useState<HubProvider[]>([]);
  const [vault, setVault] = useState<{ available: boolean; error: string | null } | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    hubApi.listProviders().then((r) => { setProviders(r.providers); setVault(r.vault); }).catch((e) => setNote(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);

  const envCount = providers.filter((p) => p.source === 'env').length;
  const importEnv = async () => {
    const ok = await confirm({
      title: 'Mover chaves para o cofre do Windows?',
      message: `${envCount} chave(s) do .env.local vão para o Gerenciador de Credenciais. Cada uma é conferida antes; o .env.local ganha backup e só então as linhas são comentadas.`,
      confirmLabel: 'Mover',
    });
    if (!ok) return;
    try {
      const r = await hubApi.importEnv();
      setNote(`Movidas: ${r.imported.join(', ') || 'nenhuma'}${r.failed.length ? ` · falharam: ${r.failed.join(', ')}` : ''}${r.backup ? ` · backup: ${r.backup}` : ''}. Reinicie o servidor para o .env.local ser relido.`);
      load();
    } catch (err) { setNote(err instanceof Error ? err.message : String(err)); }
  };

  return (
    <PanelShell title="🔑 API" subtitle="Chaves no cofre do Windows. Nunca aparecem no app nem vão para o navegador." onClose={onClose}>
      {vault && !vault.available ? <p className="rounded-lg bg-rose-50 dark:bg-rose-950/40 p-2 text-xs text-rose-700">Cofre indisponível: {vault.error}</p> : null}
      {envCount > 0 ? (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 text-xs space-y-2">
          <p>{envCount} chave(s) ainda estão em texto no <code>.env.local</code>.</p>
          <Button size="sm" variant="secondary" onClick={importEnv}>Mover para o cofre (com backup)</Button>
        </div>
      ) : null}
      {note ? <p role="status" className="text-xs text-zinc-600 dark:text-zinc-300">{note}</p> : null}
      <p className="text-xs text-zinc-500">Nenhum provedor pago é usado sozinho: cada envio pago pede sua confirmação.</p>
      <ul className="space-y-2">{providers.map((p) => <ProviderRow key={p.id} p={p} onChanged={load} />)}</ul>
    </PanelShell>
  );
}
