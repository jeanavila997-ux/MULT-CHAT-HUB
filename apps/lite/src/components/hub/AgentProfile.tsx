// Perfil do agente com abas (Visão geral, Skills, Ferramentas/MCP e as
// próximas fases desativadas). Salvar grava agent.json no servidor.
import { useContext, useEffect, useMemo, useState } from 'react';
import { Copy, Download, Save, Trash2, X } from 'lucide-react';
import { ChatContext } from '../../context/ChatContext';
import { hubApi, HubAgent, HubProvider, McpServer } from '../../lib/hubApi';
import { isPaidProviderModel } from '../../lib/paid';
import type { HubStatus } from '../../hooks/useHubStatus';
import { agentProblems } from '../../hooks/useHubStatus';
import { Button } from '../ui/Button';
import { AgentAvatar } from './AgentAvatar';
import { ModelSelect } from './ModelSelect';
import PromptEditor from './PromptEditor';

type Tab = 'geral' | 'prompt' | 'skills' | 'ferramentas' | 'memoria' | 'acessos' | 'seguranca' | 'rotinas';
const TABS: { id: Tab; label: string; soon?: string }[] = [
  { id: 'geral', label: 'Visão geral' },
  { id: 'prompt', label: 'Prompt' },
  { id: 'skills', label: 'Skills' },
  { id: 'ferramentas', label: 'Ferramentas/MCP' },
  { id: 'memoria', label: 'Memória', soon: 'fase 3' },
  { id: 'acessos', label: 'Acessos', soon: 'fase 4' },
  { id: 'seguranca', label: 'Segurança 🔒', soon: 'fase 5' },
  { id: 'rotinas', label: 'Rotinas', soon: 'fase 6' },
];

const input = 'w-full h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const labelCls = 'block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1';

interface Props { agentId: string; status: HubStatus; onClose: () => void }

export default function AgentProfile({ agentId, status, onClose }: Props) {
  const ctx = useContext(ChatContext);
  const saved = ctx?.hubAgents.find((a) => a.id === agentId) ?? null;
  const [draft, setDraft] = useState<HubAgent | null>(saved);
  const [tab, setTab] = useState<Tab>('geral');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [providers, setProviders] = useState<HubProvider[]>([]);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [deleteName, setDeleteName] = useState('');

  useEffect(() => { setDraft(saved); setMsg(null); setDeleteName(''); }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps
  // O prompt é salvo pela aba Prompt: traz a versão nova sem perder a edição das outras abas.
  useEffect(() => {
    if (saved) setDraft((d) => (d ? { ...d, systemPrompt: saved.systemPrompt, version: saved.version, updatedAt: saved.updatedAt } : d));
  }, [saved?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void Promise.all([
      hubApi.listProviders().then((r) => setProviders(r.providers.filter((p) => p.chat))).catch(() => {}),
      hubApi.skills().then((r) => setSkills(r.skills)).catch(() => {}),
      hubApi.listMcpServers().then((r) => setServers(r.servers)).catch(() => {}),
    ]);
  }, []);

  const dirty = useMemo(() => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  if (!ctx || !draft || !saved) return <p className="p-4 text-sm text-zinc-500">Agente não encontrado.</p>;

  const set = <K extends keyof HubAgent>(k: K, v: HubAgent[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const problems = agentProblems(draft, status);
  const paid = isPaidProviderModel(draft.provider, draft.model);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const { id, version, createdAt, updatedAt, builtin, systemPrompt, ...patch } = draft;
      void id; void version; void createdAt; void updatedAt; void builtin; void systemPrompt;
      const { agent } = await hubApi.updateAgent(saved.id, patch);
      ctx.replaceHubAgent(agent); setDraft(agent);
      setMsg({ ok: true, text: 'Salvo.' });
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) }); }
    finally { setBusy(false); }
  };

  const duplicate = async () => {
    try { const { agent } = await hubApi.duplicateAgent(saved.id); ctx.replaceHubAgent(agent); setMsg({ ok: true, text: `Criado: ${agent.name}` }); }
    catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) }); }
  };

  const exportJson = async () => {
    const data = await hubApi.exportAgent(saved.id);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `agente-${saved.id}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const remove = async () => {
    try {
      await hubApi.deleteAgent(saved.id, deleteName);
      if (ctx.activeHubAgentId === saved.id) ctx.selectHubAgent(null);
      await ctx.refreshHubAgents();
      onClose();
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) }); }
  };

  const toggleSkill = (name: string) => set('skills', draft.skills.includes(name) ? draft.skills.filter((s) => s !== name) : [...draft.skills, name]);
  const setServer = (id: string, patch: Partial<{ enabled: boolean; allow: string[] }>) => {
    const cur = draft.tools.mcp[id] ?? { enabled: false, allow: ['*'] };
    set('tools', { ...draft.tools, mcp: { ...draft.tools.mcp, [id]: { ...cur, ...patch } } });
  };

  return (
    <div className="flex flex-col h-full">
      <header className="p-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-start gap-3">
          <AgentAvatar agent={draft} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold truncate">{draft.name}</h2>
            <p className="text-xs text-zinc-500 line-clamp-2">{draft.description}</p>
            <p className="mt-1 text-[11px] text-zinc-400">v{saved.version} · {saved.builtin ? 'padrão' : 'criado por você'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar perfil" className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="w-4 h-4" /></button>
        </div>
        <div role="tablist" aria-label="Seções do perfil" className="mt-3 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              disabled={!!t.soon}
              title={t.soon ? `Chega na ${t.soon}` : undefined}
              onClick={() => setTab(t.id)}
              className={`px-2.5 h-7 rounded-full text-xs font-medium ${tab === t.id ? 'bg-indigo-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'geral' ? (
          <>
            <section aria-label="Status" className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 text-xs space-y-1">
              <p className="font-medium text-zinc-700 dark:text-zinc-200">Status</p>
              {draft.provider === 'ollama' ? <p>{status.ollamaOk ? '🟢' : '🔴'} Ollama {status.ollamaOk ? 'ok' : 'fora do ar'}</p> : null}
              {draft.tools.enabled && draft.tools.mcp.mestre?.enabled ? (
                <p>{status.mestre?.ok ? '🟢' : '🔴'} Mestre do PC {status.mestre?.ok ? `ok · ${status.mestre.tools.length} ferramentas` : status.mestre?.error ?? 'sem resposta'}</p>
              ) : null}
              {problems.map((p) => <p key={p} className="text-amber-700 dark:text-amber-400">⚠️ {p}</p>)}
              {paid ? <p className="text-rose-600">💲 Modelo pago: cada envio pede confirmação.</p> : <p className="text-emerald-700 dark:text-emerald-400">Sem custo (modelo local).</p>}
            </section>

            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <div><label htmlFor="ag-name" className={labelCls}>Nome</label><input id="ag-name" className={input} value={draft.name} maxLength={60} onChange={(e) => set('name', e.target.value)} /></div>
              <div><label htmlFor="ag-avatar" className={labelCls}>Avatar</label><input id="ag-avatar" className={`${input} w-16 text-center`} value={draft.avatar} maxLength={4} onChange={(e) => set('avatar', e.target.value)} /></div>
              <div><label htmlFor="ag-color" className={labelCls}>Cor</label><input id="ag-color" type="color" className="h-9 w-12 rounded-lg border border-zinc-300 dark:border-zinc-700" value={draft.color} onChange={(e) => set('color', e.target.value)} /></div>
            </div>
            <div><label htmlFor="ag-desc" className={labelCls}>Descrição (aparece na barra lateral)</label><input id="ag-desc" className={input} value={draft.description} maxLength={300} onChange={(e) => set('description', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="ag-provider" className={labelCls}>Provedor</label>
                <select id="ag-provider" className={input} value={draft.provider} onChange={(e) => set('provider', e.target.value)}>
                  {providers.map((p) => <option key={p.id} value={p.id}>{p.paid ? '💲 ' : ''}{p.label}{p.needsKey && !p.configured ? ' (sem chave)' : ''}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ag-temp" className={labelCls}>Temperatura: {draft.temperature.toFixed(1)}</label>
                <input id="ag-temp" type="range" min={0} max={2} step={0.1} value={draft.temperature} onChange={(e) => set('temperature', Number(e.target.value))} className="w-full accent-indigo-600" />
              </div>
            </div>
            <div>
              <label htmlFor="ag-model" className={labelCls}>Modelo</label>
              {draft.provider === 'ollama' ? (
                <ModelSelect id="ag-model" value={draft.model} local={status.localModels} cloud={status.cloudModels} onChange={(m) => set('model', m)} className="w-full" />
              ) : (
                <input id="ag-model" className={input} value={draft.model} onChange={(e) => set('model', e.target.value)} />
              )}
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={draft.pinned} onChange={(e) => set('pinned', e.target.checked)} /> Fixar no topo</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={draft.hidden} onChange={(e) => set('hidden', e.target.checked)} /> Ocultar da lista</label>
            </div>
          </>
        ) : null}

        {tab === 'prompt' ? <PromptEditor agent={saved} /> : null}

        {tab === 'skills' ? (
          <section aria-label="Skills do agente" className="space-y-2">
            <p className="text-xs text-zinc-500">Todas as skills vêm da biblioteca compartilhada. Marque as que este agente usa (o nome e a descrição entram no prompt).</p>
            {skills.length === 0 ? <p className="text-sm text-zinc-400">Nenhuma skill encontrada.</p> : null}
            <ul className="space-y-1">
              {skills.map((s) => (
                <li key={s.name}>
                  <label className="flex items-start gap-2 rounded-lg p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <input type="checkbox" className="mt-1" checked={draft.skills.includes(s.name)} onChange={() => toggleSkill(s.name)} />
                    <span><span className="text-sm font-medium">{s.name}</span><span className="block text-xs text-zinc-500 line-clamp-2">{s.description}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {tab === 'ferramentas' ? (
          <section aria-label="Ferramentas e MCP" className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={draft.tools.enabled} onChange={(e) => set('tools', { ...draft.tools, enabled: e.target.checked })} /> Usar ferramentas</label>
            <p className="text-xs text-zinc-500">Leitura roda direto. Escrita, execução, destrutivas e pagas sempre pedem sua confirmação no chat.</p>
            {servers.map((srv) => {
              const cfg = draft.tools.mcp[srv.id] ?? { enabled: false, allow: ['*'] };
              const all = cfg.allow.includes('*');
              return (
                <div key={srv.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" disabled={!draft.tools.enabled} checked={cfg.enabled} onChange={(e) => setServer(srv.id, { enabled: e.target.checked })} />
                    {srv.name} <span className="ml-auto text-xs">{srv.status?.ok ? '🟢' : '🔴'}</span>
                  </label>
                  {cfg.enabled ? (
                    <>
                      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={all} onChange={(e) => setServer(srv.id, { allow: e.target.checked ? ['*'] : [] })} /> Todas as ferramentas (atuais e futuras)</label>
                      <ul className="space-y-1">
                        {(srv.status?.tools ?? []).map((t) => (
                          <li key={t.name} className="flex items-center gap-2 text-xs">
                            <input type="checkbox" disabled={all} checked={all || cfg.allow.includes(t.name)} onChange={(e) => setServer(srv.id, { allow: e.target.checked ? [...cfg.allow, t.name] : cfg.allow.filter((x) => x !== t.name) })} />
                            <code className="font-mono">{t.name}</code>
                            <span className={`ml-auto rounded-full px-2 py-0.5 ${t.requiresConfirmation ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'}`}>{t.label}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null}
        {msg ? <p role="status" className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</p> : null}
      </div>

      <footer className="p-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
        <div className="flex gap-2">
          <Button size="sm" icon={<Save className="w-4 h-4" />} onClick={save} disabled={!dirty || busy} isLoading={busy} fullWidth>Salvar</Button>
          <Button size="sm" variant="secondary" icon={<Copy className="w-4 h-4" />} onClick={duplicate}>Duplicar</Button>
          <Button size="sm" variant="secondary" icon={<Download className="w-4 h-4" />} onClick={exportJson}>Exportar</Button>
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer text-rose-600">Excluir agente…</summary>
          <div className="mt-2 flex gap-2">
            <input aria-label={`Digite ${saved.name} para confirmar`} placeholder={`Digite "${saved.name}"`} className={input} value={deleteName} onChange={(e) => setDeleteName(e.target.value)} />
            <Button size="sm" variant="danger" icon={<Trash2 className="w-4 h-4" />} disabled={deleteName !== saved.name} onClick={remove}>Excluir</Button>
          </div>
          <p className="mt-1 text-zinc-500">Vai para a lixeira (Configurações) e pode ser restaurado por 30 dias.</p>
        </details>
      </footer>
    </div>
  );
}
