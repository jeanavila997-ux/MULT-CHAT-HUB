// Layout principal: barra lateral de agentes | chat | painel (perfil/seções).
import { lazy, Suspense, useCallback, useContext, useState } from 'react';
import { agentChannel, ChatContext } from '../../context/ChatContext';
import { hubApi } from '../../lib/hubApi';
import { useHubStatus } from '../../hooks/useHubStatus';
import { useIsMobile } from '../../hooks/useMediaQuery';
import ChatArea from '../ChatArea';
import Sidebar from '../Sidebar';
import { Drawer } from '../ui/Drawer';
import HubSidebar, { HubView } from './HubSidebar';
import AgentChatHeader from './AgentChatHeader';
import { PanelShell } from './PanelShell';

const AgentProfile = lazy(() => import('./AgentProfile'));
const ApiPanel = lazy(() => import('./ApiPanel'));
const McpPanel = lazy(() => import('./McpPanel'));
const SkillsPanel = lazy(() => import('./SkillsPanel'));
const SettingsPanel = lazy(() => import('./SettingsPanel'));

const NEW_AGENT = {
  name: 'Novo agente', avatar: '✨', color: '#4f46e5', provider: 'ollama', model: 'jeanavila997/agente-model-file:latest',
  description: 'Descreva o que este agente faz.', systemPrompt: 'Responda em português do Brasil, de forma direta.',
  tools: { enabled: true, mcp: {} },
};

export default function HubLayout({ sidebarOpen, onCloseSidebar }: { sidebarOpen: boolean; onCloseSidebar: () => void }) {
  const ctx = useContext(ChatContext);
  const isMobile = useIsMobile();
  const [view, setView] = useState<HubView | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const agents = ctx?.hubAgents ?? [];
  const { status, dots, refresh } = useHubStatus(agents);

  const openProfile = useCallback((id: string) => { setProfileId(id); setView('perfil'); }, []);
  const select = useCallback((id: string) => { ctx?.selectHubAgent(id); onCloseSidebar(); }, [ctx, onCloseSidebar]);
  const create = useCallback(async () => {
    try {
      const { agent } = await hubApi.createAgent(NEW_AGENT);
      ctx?.replaceHubAgent(agent);
      ctx?.selectHubAgent(agent.id);
      openProfile(agent.id);
    } catch { /* erro aparece ao recarregar a lista */ }
  }, [ctx, openProfile]);
  const close = useCallback(() => setView(null), []);
  const onView = useCallback((v: HubView) => { setView((cur) => (cur === v ? null : v)); onCloseSidebar(); }, [onCloseSidebar]);

  if (!ctx) return null;
  const active = ctx.activeHubAgentId && ctx.currentChannel === agentChannel(ctx.activeHubAgentId)
    ? agents.find((a) => a.id === ctx.activeHubAgentId) ?? null
    : null;

  const sidebar = (
    <HubSidebar agents={agents} activeId={active?.id ?? null} status={dots} view={view} error={ctx.hubError}
      onSelect={select} onOpenProfile={openProfile} onCreate={create} onView={onView} />
  );

  return (
    <main className="flex-1 flex overflow-hidden">
      <aside className="hidden md:flex bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 w-[280px] lg:w-[300px] flex-col">{sidebar}</aside>
      <Drawer isOpen={isMobile && sidebarOpen} onClose={onCloseSidebar} side="left" title="Agentes" width="300px">{sidebar}</Drawer>

      <ChatArea header={active ? <AgentChatHeader agent={active} status={status} dot={dots[active.id] ?? 'warn'} onOpenProfile={() => openProfile(active.id)} /> : undefined} />

      {view ? (
        <aside className="fixed inset-y-0 right-0 z-30 w-full sm:w-[400px] lg:static lg:z-auto bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 flex flex-col shadow-xl lg:shadow-none" aria-label="Painel">
          <Suspense fallback={<p className="p-4 text-sm text-zinc-400">Carregando…</p>}>
            {view === 'perfil' && profileId ? <AgentProfile agentId={profileId} status={status} onClose={close} /> : null}
            {view === 'api' ? <ApiPanel onClose={close} /> : null}
            {view === 'mcp' ? <McpPanel onClose={close} onStatusChange={() => void refresh(true)} /> : null}
            {view === 'skills' ? <SkillsPanel onClose={close} /> : null}
            {view === 'config' ? <SettingsPanel onClose={close} /> : null}
            {view === 'canais' ? (
              <PanelShell title="Canais e tarefas" subtitle="Conversa geral, canais e estado." onClose={close}>
                <Sidebar />
              </PanelShell>
            ) : null}
          </Suspense>
        </aside>
      ) : null}
    </main>
  );
}
