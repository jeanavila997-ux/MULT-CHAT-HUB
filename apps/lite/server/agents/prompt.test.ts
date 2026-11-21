// Editor do system prompt: histórico com desfazer, restaurar padrão e
// instruções de segurança (pasta seguranca/) sempre antes do prompt editável.
// Executar: pnpm --filter @mch/lite exec tsx server/agents/prompt.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRegistry } from './registry.js';
import { DEFAULT_AGENT_SEEDS } from './model.js';
import { resolveAgentRun } from '../agent/agentRun.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mch-prompt-'));
let clock = Date.parse('2026-11-20T12:00:00Z');
const reg = new AgentRegistry(tmp, () => new Date((clock += 1000)));
reg.seedDefaults();

const tests: [string, () => void][] = [
  ['prompt padrão do PC / Mestre segue as regras do Jean', () => {
    const p = DEFAULT_AGENT_SEEDS.find((a) => a.id === 'pc-mestre')!.systemPrompt!;
    for (const re of [/português do Brasil/i, /mestre_system_status/, /nunca invente/i, /"sim"/, /ask_grok/, /:cloud/, /arquivos pessoais/i, /\.env/, /próprias instruções/i, /memória longa/i, /técnico/i]) assert.match(p, re);
  }],
  ['histórico lista versões e desfazer volta o prompt anterior', () => {
    const original = reg.get('pc-mestre')!.systemPrompt;
    reg.update('pc-mestre', { systemPrompt: 'versão 2' });
    reg.update('pc-mestre', { systemPrompt: 'versão 3' });
    const hist = reg.history('pc-mestre');
    assert.equal(hist.length, 2);
    assert.equal(hist[0].systemPrompt, 'versão 2', 'mais recente primeiro');
    const back = reg.restoreVersion('pc-mestre', hist[1].file);
    assert.equal(back.systemPrompt, original);
    assert.equal(reg.get('pc-mestre')!.name, 'PC / Mestre', 'desfazer mexe só no prompt');
    assert.throws(() => reg.restoreVersion('pc-mestre', '../../agent.json'), /inválid/);
  }],
  ['restaurar padrão usa o prompt de fábrica; agente criado por você não tem padrão', () => {
    reg.update('pc-mestre', { systemPrompt: 'mexido' });
    assert.equal(reg.restoreDefaultPrompt('pc-mestre').systemPrompt, DEFAULT_AGENT_SEEDS.find((a) => a.id === 'pc-mestre')!.systemPrompt);
    const mine = reg.create({ name: 'Meu' });
    assert.equal(reg.defaultPrompt(mine.id), null);
    assert.throws(() => reg.restoreDefaultPrompt(mine.id), /padrão/);
  }],
  ['instruções de segurança entram antes do prompt editável', () => {
    fs.writeFileSync(path.join(tmp, 'agentes', 'pc-mestre', 'seguranca', 'instrucoes.md'), 'NUNCA apague C:\\Users\\Jean\\Documents.');
    const sec = reg.securityInstructions('pc-mestre');
    assert.match(sec, /NUNCA apague/);
    const run = resolveAgentRun(reg.get('pc-mestre'), { fallbackModel: 'x', security: sec }, []);
    assert.ok(run.systemPrompt.indexOf('NUNCA apague') < run.systemPrompt.indexOf('PC / Mestre'), 'segurança primeiro');
    assert.match(run.systemPrompt, /instruções de segurança/i);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`[PASS] ${name}`); } catch (err) { failed++; console.error(`[FAIL] ${name}\n`, err); }
}
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.error(`${failed} teste(s) do editor de prompt falharam.`); process.exit(1); }
console.log(`${tests.length} testes do editor de prompt passaram.`);
