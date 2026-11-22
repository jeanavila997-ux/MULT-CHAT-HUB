// Configurações: pasta de dados, lixeira (30 dias), padrões, importar agente,
// segredo de ativação no modo navegador e o painel antigo (pareamento/gateway).
import { lazy, Suspense, useContext, useEffect, useState } from 'react';
import { ChatContext } from '../../context/ChatContext';
import { hubApi, TrashEntry } from '../../lib/hubApi';
import { Button } from '../ui/Button';
import { PanelShell } from './PanelShell';

const AgentConfig = lazy(() => import('../AgentConfig'));
const OllamaModelsPanel = lazy(() => import('./OllamaModelsPanel'));
const SECRET_KEY = 'mch:activation-secret';

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const ctx = useContext(ChatContext);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [note, setNote] = useState('');
  const [secret, setSecret] = useState('');
  const [showLegacy, setShowLegacy] = useState(false);
  const isElectron = typeof window !== 'undefined' && !!(window as unknown as { electronAPI?: unknown }).electronAPI;

  const loadTrash = () => { hubApi.listTrash().then((r) => setTrash(r.trash)).catch(() => {}); };
  useEffect(loadTrash, []);

  const restore = async (t: TrashEntry) => {
    try { const { agent } = await hubApi.restoreTrash(t.trashId); ctx?.replaceHubAgent(agent); setNote(`Restaurado: ${agent.name}`); loadTrash(); }
    catch (err) { setNote(err instanceof Error ? err.message : String(err)); }
  };
  const restoreDefaults = async () => {
    try { const { restored } = await hubApi.restoreDefaults(); await ctx?.refreshHubAgents(); setNote(restored.length ? `Recriados: ${restored.map((a) => a.name).join(', ')}` : 'Todos os padrões já existem.'); }
    catch (err) { setNote(err instanceof Error ? err.message : String(err)); }
  };
  const importFile = async (file: File) => {
    try { const data = JSON.parse(await file.text()); const { agent } = await hubApi.importAgent(data); ctx?.replaceHubAgent(agent); setNote(`Importado: ${agent.name} (MCP chega desligado; revise no perfil).`); }
    catch (err) { setNote(err instanceof Error ? err.message : String(err)); }
  };
  const saveSecret = () => {
    try { localStorage.setItem(SECRET_KEY, secret.trim()); setSecret(''); setNote('Segredo salvo neste navegador.'); } catch { setNote('Não foi possível salvar.'); }
  };

  return (
    <PanelShell title="⚙️ Configurações" onClose={onClose}>
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Pasta de dados</h3>
        <p className="text-xs font-mono break-all text-zinc-600 dark:text-zinc-300">{ctx?.hubRoot || '…'}</p>
        <p className="text-xs text-zinc-500">Fora do repositório (variável MCH_DATA_ROOT). Cada agente tem pastas de memória, skills, ferramentas, MCP, acessos, segurança, rotinas e logs.</p>
      </section>

      <Suspense fallback={<p className="text-xs text-zinc-500">Carregando modelos…</p>}>
        <OllamaModelsPanel />
      </Suspense>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Agentes</h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={restoreDefaults}>Recriar padrões que faltam</Button>
          <label className="inline-flex items-center h-8 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800">
            Importar .json
            <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
          </label>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Lixeira ({trash.length})</h3>
        <p className="text-xs text-zinc-500">Itens somem sozinhos depois de 30 dias.</p>
        <ul className="space-y-1">
          {trash.map((t) => (
            <li key={t.trashId} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{t.name} <span className="text-xs text-zinc-400">· {new Date(t.deletedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Rio_Branco' })}</span></span>
              <Button size="sm" variant="ghost" onClick={() => restore(t)}>Restaurar</Button>
            </li>
          ))}
        </ul>
      </section>

      {!isElectron ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Segredo de ativação (modo navegador)</h3>
          <p className="text-xs text-zinc-500">No app Electron isso é automático. No navegador, cole o APP_ACTIVATION_SECRET do .env.local (fica só neste navegador).</p>
          <div className="flex gap-2">
            <input type="password" aria-label="Segredo de ativação" value={secret} onChange={(e) => setSecret(e.target.value)} className="flex-1 h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-sm" />
            <Button size="sm" disabled={!secret.trim()} onClick={saveSecret}>Salvar</Button>
          </div>
        </section>
      ) : null}

      {note ? <p role="status" className="text-xs text-zinc-600 dark:text-zinc-300">{note}</p> : null}

      <section className="space-y-2">
        <button type="button" onClick={() => setShowLegacy((v) => !v)} className="text-sm font-semibold">
          {showLegacy ? '▾' : '▸'} Pareamento / Gateway e provedor da conversa geral
        </button>
        {showLegacy ? (
          <Suspense fallback={<p className="text-xs text-zinc-400">Carregando…</p>}>
            <div className="-mx-4"><AgentConfig /></div>
          </Suspense>
        ) : null}
      </section>
    </PanelShell>
  );
}
