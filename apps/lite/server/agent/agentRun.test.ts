// Como um agente salvo vira a configuração de uma conversa.
// Executar: pnpm --filter @mch/lite exec tsx server/agent/agentRun.test.ts
import assert from 'node:assert/strict';
import { resolveAgentRun, LEGACY_SCOPE } from './agentRun.js';
import { DEFAULT_AGENT_SEEDS, AgentV2 } from '../agents/model.js';

const pc = { ...DEFAULT_AGENT_SEEDS.find((a) => a.id === 'pc-mestre')!, version: 1, builtin: true, createdAt: '', updatedAt: '' } as AgentV2;
const skills = [{ name: 'diagnostico-pc', description: 'd' }, { name: 'codigo', description: 'c' }];

const tests: [string, () => void][] = [
  ['agente PC / Mestre: modelo local, prompt próprio, só as skills dele e escopo MCP do Mestre', () => {
    const r = resolveAgentRun(pc, { fallbackModel: 'x' }, skills);
    assert.equal(r.model, 'jeanavila997/agente-model-file:latest');
    assert.match(r.systemPrompt, /mestre_system_status/);
    assert.deepEqual(r.skills.map((s) => s.name), ['diagnostico-pc']);
    assert.equal(r.scope.tools.mcp.mestre.enabled, true);
    assert.equal(r.agentId, 'pc-mestre');
  }],
  ['modelo escolhido no cabeçalho do chat vence o do agente', () => {
    assert.equal(resolveAgentRun(pc, { model: 'qwen3.5:4b', fallbackModel: 'x' }, skills).model, 'qwen3.5:4b');
  }],
  ['sem agente: comportamento antigo (todas as skills, Mestre liberado com confirmação)', () => {
    const r = resolveAgentRun(null, { fallbackModel: 'padrao' }, skills);
    assert.equal(r.model, 'padrao');
    assert.equal(r.skills.length, 2);
    assert.deepEqual(r.scope, LEGACY_SCOPE);
  }],
  ['agente com provedor que não é Ollama é recusado no agente local', () => {
    const hermes = { ...pc, provider: 'hermes' } as AgentV2;
    assert.throws(() => resolveAgentRun(hermes, { fallbackModel: 'x' }, skills), /Ollama/);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`[PASS] ${name}`); } catch (err) { failed++; console.error(`[FAIL] ${name}\n`, err); }
}
if (failed) { console.error(`${failed} teste(s) de agentRun falharam.`); process.exit(1); }
console.log(`${tests.length} testes de agentRun passaram.`);
