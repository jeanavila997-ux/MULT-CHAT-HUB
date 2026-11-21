// Cabeçalho do chat de um agente: avatar, nome, status e troca de modelo
// (Local / Nuvem Ollama 💲). Trocar o modelo salva no agent.json.
import { useContext, useState } from 'react';
import { UserCog } from 'lucide-react';
import { ChatContext } from '../../context/ChatContext';
import { hubApi, HubAgent } from '../../lib/hubApi';
import type { HubStatus } from '../../hooks/useHubStatus';
import { AgentAvatar, DotState, StatusDot } from './AgentAvatar';
import { ModelSelect } from './ModelSelect';

export default function AgentChatHeader({ agent, status, dot, onOpenProfile }: { agent: HubAgent; status: HubStatus; dot: DotState; onOpenProfile: () => void }) {
  const ctx = useContext(ChatContext);
  const [err, setErr] = useState('');
  const changeModel = async (model: string) => {
    setErr('');
    try { const r = await hubApi.updateAgent(agent.id, { model }); ctx?.replaceHubAgent(r.agent); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const mestreOn = agent.tools.enabled && agent.tools.mcp.mestre?.enabled;
  return (
    <div className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center gap-3">
      <AgentAvatar agent={agent} size="sm" />
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 font-semibold truncate">{agent.name} <StatusDot state={dot} /></h2>
        <p className="text-xs text-zinc-500 truncate">
          {agent.description}{mestreOn ? ` · Mestre ${status.mestre?.ok ? 'conectado' : 'offline'}` : ''}
        </p>
      </div>
      {agent.provider === 'ollama' ? (
        <ModelSelect value={agent.model} local={status.localModels} cloud={status.cloudModels} onChange={changeModel} className="max-w-[14rem] text-xs" />
      ) : (
        <span className="text-xs text-zinc-500">{agent.provider} · {agent.model}</span>
      )}
      <button type="button" onClick={onOpenProfile} aria-label={`Perfil de ${agent.name}`} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><UserCog className="w-4 h-4" /></button>
      {err ? <span role="alert" className="text-xs text-rose-600">{err}</span> : null}
    </div>
  );
}
