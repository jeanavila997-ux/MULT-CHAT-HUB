import type { HubAgent } from '../../lib/hubApi';

const SIZES = { sm: 'w-8 h-8 text-base', md: 'w-10 h-10 text-lg', lg: 'w-14 h-14 text-2xl' } as const;

export function AgentAvatar({ agent, size = 'md' }: { agent: Pick<HubAgent, 'avatar' | 'color' | 'name'>; size?: keyof typeof SIZES }) {
  return (
    <span
      aria-hidden="true"
      className={`${SIZES[size]} shrink-0 rounded-full grid place-items-center font-semibold text-white shadow-sm`}
      style={{ backgroundColor: agent.color }}
    >
      {agent.avatar || agent.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export type DotState = 'ok' | 'warn' | 'off';
const DOT: Record<DotState, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', off: 'bg-rose-500' };
const DOT_LABEL: Record<DotState, string> = { ok: 'pronto', warn: 'atenção', off: 'offline' };

export function StatusDot({ state }: { state: DotState }) {
  return <span className={`w-2 h-2 rounded-full ${DOT[state]}`} role="img" aria-label={DOT_LABEL[state]} title={DOT_LABEL[state]} />;
}
