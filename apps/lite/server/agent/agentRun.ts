// Converte a ficha do agente (agent.json) na configuração de uma conversa
// com o agente local (Ollama + ferramentas).
import type { AgentV2 } from '../agents/model.js';

export interface AgentScope { id: string; tools: AgentV2['tools'] }
export interface AgentRunConfig<S> { agentId: string | null; model: string; systemPrompt: string; skills: S[]; scope: AgentScope }

/** Sem agente escolhido: igual ao comportamento antigo (Mestre liberado, com confirmação fora da leitura). */
export const LEGACY_SCOPE: AgentScope = { id: 'chat', tools: { enabled: true, mcp: { mestre: { enabled: true, allow: ['*'] } } } };

export function resolveAgentRun<S extends { name: string }>(agent: AgentV2 | null, opts: { model?: string; fallbackModel: string }, allSkills: S[]): AgentRunConfig<S> {
  const override = opts.model?.trim();
  if (!agent) return { agentId: null, model: override || opts.fallbackModel, systemPrompt: '', skills: allSkills, scope: LEGACY_SCOPE };
  if (agent.provider !== 'ollama') throw new Error(`O agente ${agent.name} usa ${agent.provider}; o agente com ferramentas só roda no Ollama local.`);
  const wanted = new Set(agent.skills);
  return {
    agentId: agent.id,
    model: override || agent.model || opts.fallbackModel,
    systemPrompt: agent.systemPrompt,
    skills: allSkills.filter((s) => wanted.has(s.name)),
    scope: { id: agent.id, tools: agent.tools },
  };
}
