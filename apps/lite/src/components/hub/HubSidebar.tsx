// Barra lateral no estilo dos bots do Grok Bot: busca, agentes com avatar,
// nome, descrição e status, seção de ocultos e navegação do hub.
import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, KeyRound, MessagesSquare, Plug, Plus, Puzzle, Search, Settings } from 'lucide-react';
import type { HubAgent } from '../../lib/hubApi';
import { AgentAvatar, DotState, StatusDot } from './AgentAvatar';

export type HubView = 'perfil' | 'skills' | 'mcp' | 'api' | 'config' | 'canais';

interface Props {
  agents: HubAgent[];
  activeId: string | null;
  status: Record<string, DotState>;
  view: HubView | null;
  error: string | null;
  onSelect: (id: string) => void;
  onOpenProfile: (id: string) => void;
  onCreate: () => void;
  onView: (v: HubView) => void;
}

const NAV: { id: HubView; label: string; icon: typeof Puzzle }[] = [
  { id: 'skills', label: 'Skills', icon: Puzzle },
  { id: 'mcp', label: 'MCP · Mestre do PC', icon: Plug },
  { id: 'api', label: 'API · chaves', icon: KeyRound },
  { id: 'canais', label: 'Canais e tarefas', icon: MessagesSquare },
  { id: 'config', label: 'Configurações', icon: Settings },
];

const AgentRow = memo(function AgentRow({ agent, active, dot, onSelect, onOpenProfile }: { agent: HubAgent; active: boolean; dot: DotState; onSelect: (id: string) => void; onOpenProfile: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(agent.id)}
        onDoubleClick={() => onOpenProfile(agent.id)}
        aria-current={active ? 'true' : undefined}
        className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${active ? 'bg-indigo-50 dark:bg-indigo-950/50' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/70'}`}
      >
        <AgentAvatar agent={agent} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{agent.name}</span>
            {agent.role === 'orquestrador' ? <span className="text-amber-500 text-xs" title="Orquestrador">★</span> : null}
            <span className="ml-auto"><StatusDot state={dot} /></span>
          </span>
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{agent.description || 'Sem descrição'}</span>
        </span>
      </button>
    </li>
  );
});

export default function HubSidebar({ agents, activeId, status, view, error, onSelect, onOpenProfile, onCreate, onView }: Props) {
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);

  const { visible, hidden } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (a: HubAgent) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
    const vis: HubAgent[] = [];
    const hid: HubAgent[] = [];
    for (const a of agents) if (match(a)) (a.hidden ? hid : vis).push(a);
    return { visible: vis, hidden: hid };
  }, [agents, query]);

  return (
    <nav className="flex flex-col h-full" aria-label="Agentes e seções">
      <div className="p-3 space-y-2 border-b border-zinc-200 dark:border-zinc-800">
        <label className="relative block">
          <span className="sr-only">Buscar agentes</span>
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar agentes…"
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-sm placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
        </label>
        <button
          type="button"
          onClick={onCreate}
          className="w-full h-9 flex items-center gap-2 px-3 rounded-lg text-sm font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Plus className="w-4 h-4" aria-hidden /> Novo agente
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <h2 className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Agentes</h2>
        {error ? (
          <p className="mx-2 mb-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 p-2 text-xs text-rose-700 dark:text-rose-300">{error}</p>
        ) : null}
        <ul className="space-y-0.5">
          {visible.map((a) => (
            <AgentRow key={a.id} agent={a} active={a.id === activeId} dot={status[a.id] ?? 'warn'} onSelect={onSelect} onOpenProfile={onOpenProfile} />
          ))}
        </ul>
        {hidden.length > 0 ? (
          <div className="mt-2">
            <button type="button" onClick={() => setShowHidden((v) => !v)} className="flex items-center gap-1 px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
              {showHidden ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Ocultos ({hidden.length})
            </button>
            {showHidden ? (
              <ul className="space-y-0.5 opacity-80">
                {hidden.map((a) => (
                  <AgentRow key={a.id} agent={a} active={a.id === activeId} dot={status[a.id] ?? 'warn'} onSelect={onSelect} onOpenProfile={onOpenProfile} />
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <ul className="p-2 border-t border-zinc-200 dark:border-zinc-800 space-y-0.5">
        {NAV.map(({ id, label, icon: Icon }) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onView(id)}
              aria-current={view === id ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-2.5 h-9 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${view === id ? 'bg-zinc-100 dark:bg-zinc-800 font-medium' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/70'}`}
            >
              <Icon className="w-4 h-4" aria-hidden /> {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
