// Status real das dependências (Ollama, modelos instalados, Mestre do PC),
// atualizado a cada 60 s. Usado pela bolinha de status de cada agente.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { hubApi, HubAgent, MestreStatus } from '../lib/hubApi';
import type { DotState } from '../components/hub/AgentAvatar';

export interface HubStatus {
  ollamaOk: boolean | null;
  localModels: string[];
  cloudModels: string[];
  mestre: MestreStatus | null;
  checkedAt: number;
}

export function useHubStatus(agents: HubAgent[]) {
  const [s, setS] = useState<HubStatus>({ ollamaOk: null, localModels: [], cloudModels: [], mestre: null, checkedAt: 0 });

  const refresh = useCallback(async (force = false) => {
    const [health, models, mestre] = await Promise.all([
      fetch('/health').then((r) => r.json() as Promise<{ ollama?: string }>).catch(() => null),
      hubApi.ollamaModels().catch(() => null),
      hubApi.mestreStatus(force).catch(() => null),
    ]);
    setS({
      ollamaOk: health ? health.ollama === 'ok' : false,
      localModels: models?.local ?? models?.models ?? [],
      cloudModels: models?.cloud ?? [],
      mestre,
      checkedAt: Date.now(),
    });
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const dots = useMemo(() => {
    const out: Record<string, DotState> = {};
    const installed = new Set([...s.localModels, ...s.cloudModels]);
    for (const a of agents) out[a.id] = agentDot(a, s, installed);
    return out;
  }, [agents, s]);

  return { status: s, dots, refresh };
}

export function agentProblems(a: HubAgent, s: HubStatus, installed = new Set([...s.localModels, ...s.cloudModels])): string[] {
  const p: string[] = [];
  if (a.provider === 'ollama') {
    if (s.ollamaOk === false) p.push('Ollama fora do ar');
    else if (a.model && installed.size > 0 && !installed.has(a.model)) p.push(`Modelo ${a.model} não instalado`);
  }
  if (a.provider === 'hermes') p.push('Hermes sem túnel configurado');
  if (a.tools.enabled && a.tools.mcp.mestre?.enabled && s.mestre && !s.mestre.ok) p.push('Mestre do PC fora do ar');
  return p;
}

function agentDot(a: HubAgent, s: HubStatus, installed: Set<string>): DotState {
  if (s.checkedAt === 0) return 'warn';
  if (a.provider === 'hermes') return 'off';
  if (a.provider === 'ollama' && s.ollamaOk === false) return 'off';
  return agentProblems(a, s, installed).length ? 'warn' : 'ok';
}
