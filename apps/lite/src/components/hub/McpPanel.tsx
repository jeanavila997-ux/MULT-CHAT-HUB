// Seção MCP com destaque para o Mestre do PC: status ao vivo, ferramentas por
// classe, teste de leitura, reconectar, iniciar o launcher e log de chamadas.
import { useCallback, useEffect, useState } from 'react';
import { Play, RefreshCw } from 'lucide-react';
import { hubApi, McpLogEntry, McpServer, MestreStatus } from '../../lib/hubApi';
import { useConfirm } from '../ui/ConfirmDialog';
import { Button } from '../ui/Button';
import { PanelShell } from './PanelShell';

const CLASS_ORDER = ['read', 'write', 'exec', 'destructive', 'paid'] as const;
const CLASS_TITLE: Record<string, string> = { read: 'Leitura (roda direto)', write: 'Escrita (confirma)', exec: 'Execução (confirma)', destructive: 'Destrutivas (confirma)', paid: 'Pagas 💲 (confirma)' };

export default function McpPanel({ onClose, onStatusChange }: { onClose: () => void; onStatusChange?: () => void }) {
  const confirm = useConfirm();
  const [mestre, setMestre] = useState<MestreStatus | null>(null);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [log, setLog] = useState<McpLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState('');

  const load = useCallback(async (force = false) => {
    setBusy(true);
    try {
      const [m, s, l] = await Promise.all([hubApi.mestreStatus(force), hubApi.listMcpServers(), hubApi.mcpLog()]);
      setMestre(m); setServers(s.servers); setLog(l.entries.slice().reverse());
    } catch (err) { setOut(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const reconnect = async () => { setBusy(true); try { await hubApi.mestreReconnect(); await load(true); onStatusChange?.(); } finally { setBusy(false); } };
  const start = async () => {
    const ok = await confirm({ title: 'Iniciar o Mestre do PC?', message: 'Abre o launcher do Mestre (node v10\\launcher.js) em segundo plano, na porta 7777.', confirmLabel: 'Iniciar' });
    if (!ok) return;
    try { await hubApi.mestreStart(); setOut('Iniciando… aguarde alguns segundos e clique em Reconectar.'); } catch (err) { setOut(err instanceof Error ? err.message : String(err)); }
  };
  const test = async (tool: string) => {
    setOut('Rodando…');
    try { const r = await hubApi.testMcpTool('mestre', tool); setOut(`${tool} (${r.ms} ms):\n${r.output}`); void load(); }
    catch (err) { setOut(err instanceof Error ? err.message : String(err)); }
  };

  return (
    <PanelShell title="🔌 MCP" subtitle="Servidores MCP locais e o Mestre do PC." onClose={onClose}>
      <section aria-label="Mestre do PC" className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>🖥️</span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">Mestre do PC</h3>
            <p className="text-xs text-zinc-500 truncate">{mestre?.url ?? 'http://127.0.0.1:7777/mcp'}</p>
          </div>
          <span className={`text-xs font-medium ${mestre?.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{mestre ? (mestre.ok ? `🟢 ${mestre.tools.length} ferramentas` : '🔴 fora do ar') : '…'}</span>
        </div>
        {mestre && !mestre.ok ? <p className="text-xs text-rose-600">{mestre.error}</p> : null}
        <p className="text-xs text-zinc-500">Token: {mestre?.tokenConfigured ? 'configurado (fica só no .env.local)' : '⚠️ falta MESTRE_MCP_TOKEN no .env.local'}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={reconnect} isLoading={busy}>Reconectar</Button>
          {mestre?.launcherAvailable && !mestre.ok ? <Button size="sm" icon={<Play className="w-3.5 h-3.5" />} onClick={start}>Iniciar Mestre</Button> : null}
        </div>
        {CLASS_ORDER.map((k) => {
          const tools = (mestre?.tools ?? []).filter((t) => t.klass === k);
          if (!tools.length) return null;
          return (
            <div key={k}>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">{CLASS_TITLE[k]}</h4>
              <ul className="space-y-1">
                {tools.map((t) => (
                  <li key={t.name} className="flex items-start gap-2 text-xs">
                    <div className="min-w-0 flex-1"><code className="font-mono">{t.name}</code><p className="text-zinc-500 line-clamp-2">{t.description}</p></div>
                    {k === 'read' ? <Button size="sm" variant="ghost" onClick={() => test(t.name)}>Testar</Button> : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {out ? <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950 text-zinc-100 p-3 text-[11px]">{out}</pre> : null}

      <section aria-label="Outros servidores" className="space-y-1">
        <h3 className="text-sm font-semibold">Servidores ({servers.length})</h3>
        <ul className="text-xs space-y-1">
          {servers.map((s) => <li key={s.id}>{s.status?.ok ? '🟢' : '🔴'} {s.name} · {s.type}{s.builtin ? ' · embutido' : ''}</li>)}
        </ul>
        <p className="text-xs text-zinc-500">Outros servidores (HTTP local ou stdio) são cadastrados em MultChatHub\mcp\servers.json; o editor na tela chega na próxima fase.</p>
      </section>

      <section aria-label="Log de chamadas" className="space-y-1">
        <h3 className="text-sm font-semibold">Últimas chamadas</h3>
        {log.length === 0 ? <p className="text-xs text-zinc-400">Nenhuma ainda.</p> : null}
        <ul className="text-[11px] font-mono space-y-0.5">
          {log.map((e) => (
            <li key={`${e.ts}-${e.tool}`} className={e.ok ? '' : 'text-rose-600'}>
              {new Date(e.ts).toLocaleTimeString('pt-BR', { timeZone: 'America/Rio_Branco' })} · {e.agentId} · {e.tool} · {e.ms} ms{e.ok ? '' : ` · ${e.error ?? 'erro'}`}
            </li>
          ))}
        </ul>
      </section>
    </PanelShell>
  );
}
