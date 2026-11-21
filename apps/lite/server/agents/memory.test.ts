// Memória do agente: curta (sessões JSONL com limite) e longa (fatos .md).
// O agente só PROPÕE; fato só existe depois que o Jean aprova.
// Executar: pnpm --filter @mch/lite exec tsx server/agents/memory.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRegistry } from './registry.js';
import { AgentMemory } from './memory.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mch-mem-'));
let clock = Date.parse('2026-11-20T12:00:00Z');
const now = () => new Date(clock);
const reg = new AgentRegistry(tmp, now);
reg.seedDefaults();
const mem = new AgentMemory(reg, now, { shortLimit: 5, shortDays: 14 });

const tests: [string, () => void][] = [
  ['memória curta guarda a sessão do dia com limite de mensagens', () => {
    for (let i = 0; i < 7; i++) mem.appendShort('pc-mestre', i % 2 ? 'assistant' : 'user', `msg ${i}`);
    const s = mem.shortSummary('pc-mestre');
    assert.equal(s.sessions.length, 1);
    assert.equal(s.sessions[0].count, 5, 'só as 5 últimas');
    assert.deepEqual(mem.recentShort('pc-mestre', 2).map((m) => m.content), ['msg 5', 'msg 6']);
  }],
  ['sessões com mais de 14 dias são apagadas; limpar zera', () => {
    clock += 15 * 86_400_000;
    mem.appendShort('pc-mestre', 'user', 'nova');
    assert.equal(mem.purgeShort('pc-mestre'), 1);
    assert.equal(mem.shortSummary('pc-mestre').sessions.length, 1);
    mem.clearShort('pc-mestre');
    assert.equal(mem.shortSummary('pc-mestre').sessions.length, 0);
  }],
  ['agente propõe; proposta não vira fato sozinha', () => {
    const p = mem.propose('pc-mestre', 'Jean prefere respostas curtas', 'conversa de 20/11');
    assert.equal(mem.listFacts('pc-mestre').length, 0);
    assert.equal(mem.listProposals('pc-mestre')[0].id, p.id);
    assert.throws(() => mem.propose('pc-mestre', '', 'x'), /vazi/);
    assert.throws(() => mem.propose('pc-mestre', 'x'.repeat(2001), 'x'), /2\.000/);
  }],
  ['Jean aprova (podendo editar), edita e apaga fatos', () => {
    const p = mem.listProposals('pc-mestre')[0];
    const f = mem.approve('pc-mestre', p.id, 'Jean prefere respostas curtas e diretas.');
    assert.equal(mem.listProposals('pc-mestre').length, 0);
    assert.match(fs.readFileSync(path.join(tmp, 'agentes', 'pc-mestre', 'memoria-longa', 'fatos', `${f.id}.md`), 'utf8'), /aprovado_por: jean/);
    assert.equal(mem.listFacts('pc-mestre')[0].content, 'Jean prefere respostas curtas e diretas.');
    mem.updateFact('pc-mestre', f.id, 'Respostas curtas.');
    assert.equal(mem.listFacts('pc-mestre')[0].content, 'Respostas curtas.');
    mem.deleteFact('pc-mestre', f.id);
    assert.equal(mem.listFacts('pc-mestre').length, 0);
  }],
  ['rejeitar apaga a proposta; ids com ../ são recusados', () => {
    const p = mem.propose('pc-mestre', 'algo', 'x');
    mem.reject('pc-mestre', p.id);
    assert.equal(mem.listProposals('pc-mestre').length, 0);
    assert.throws(() => mem.approve('pc-mestre', '../../agent', undefined), /inválid/);
    assert.throws(() => mem.deleteFact('pc-mestre', '..\\x'), /inválid/);
  }],
  ['bloco para o prompt só com fatos aprovados, com limite', () => {
    mem.approve('pc-mestre', mem.propose('pc-mestre', 'Usa Windows 11', 'x').id);
    mem.propose('pc-mestre', 'NÃO APROVADO', 'x');
    const block = mem.promptBlock('pc-mestre', 4000);
    assert.match(block, /Usa Windows 11/);
    assert.equal(block.includes('NÃO APROVADO'), false);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`[PASS] ${name}`); } catch (err) { failed++; console.error(`[FAIL] ${name}\n`, err); }
}
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.error(`${failed} teste(s) de memória falharam.`); process.exit(1); }
console.log(`${tests.length} testes de memória passaram.`);
