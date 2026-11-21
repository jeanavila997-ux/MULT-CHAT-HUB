// Agentes no disco: criar, editar, duplicar, lixeira 30 dias, padrões, exportar/importar.
// Executar: pnpm --filter @mch/lite exec tsx server/agents/registry.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRegistry } from './registry.js';
import { slugify, validateAgentInput, DEFAULT_AGENT_SEEDS } from './model.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mch-agents-'));
let clock = Date.parse('2026-11-20T12:00:00Z');
const reg = new AgentRegistry(tmp, () => new Date(clock));

const tests: [string, () => void][] = [
  ['slug seguro, sem acento nem ../', () => {
    assert.equal(slugify('PC / Mestre'), 'pc-mestre');
    assert.equal(slugify('Código Ágil!!'), 'codigo-agil');
    assert.equal(slugify('../../etc'), 'etc');
    assert.equal(slugify('   '), 'agente');
  }],
  ['validação recusa nome vazio, provedor desconhecido e temperatura fora da faixa', () => {
    assert.ok(validateAgentInput({ name: '' }).errors.length > 0);
    assert.ok(validateAgentInput({ name: 'X', provider: 'inventado' }).errors.some((e) => /provedor/i.test(e)));
    assert.ok(validateAgentInput({ name: 'X', temperature: 5 }).errors.some((e) => /temperatura/i.test(e)));
    assert.equal(validateAgentInput({ name: 'X' }).errors.length, 0);
  }],
  ['seed cria os 5 padrões com pastas próprias', () => {
    const created = reg.seedDefaults();
    assert.equal(created.length, 5);
    assert.deepEqual(reg.list().map((a) => a.id).sort(), DEFAULT_AGENT_SEEDS.map((a) => a.id).sort());
    for (const sub of ['memoria-curta', 'memoria-longa/fatos', 'memoria-longa/propostas', 'skills', 'ferramentas', 'mcp', 'acessos', 'seguranca', 'rotinas', 'logs', 'historico']) {
      assert.ok(fs.existsSync(path.join(tmp, 'agentes', 'orquestrador', sub)), sub);
    }
    assert.equal(reg.seedDefaults().length, 0, 'segunda chamada não duplica');
  }],
  ['criar gera id único e grava agent.json', () => {
    const a = reg.create({ name: 'Código', description: 'outro' });
    assert.equal(a.id, 'codigo-2');
    assert.equal(reg.get('codigo-2')?.description, 'outro');
    assert.throws(() => reg.create({ name: '' }), /nome/i);
  }],
  ['editar guarda a versão anterior no histórico', () => {
    clock += 1000;
    const b = reg.update('codigo-2', { description: 'nova', id: 'hack' } as never);
    assert.equal(b.description, 'nova');
    assert.equal(b.id, 'codigo-2', 'id não muda');
    assert.equal(b.version, 2);
    const hist = fs.readdirSync(path.join(tmp, 'agentes', 'codigo-2', 'historico'));
    assert.equal(hist.length, 1);
    assert.throws(() => reg.update('nao-existe', { name: 'x' }), /não encontrado/);
  }],
  ['duplicar não copia memória', () => {
    fs.writeFileSync(path.join(tmp, 'agentes', 'codigo-2', 'memoria-longa', 'fatos', 'f.md'), 'segredo');
    const c = reg.duplicate('codigo-2');
    assert.equal(c.id, 'codigo-2-copia');
    assert.equal(c.builtin, false);
    assert.equal(fs.readdirSync(path.join(tmp, 'agentes', c.id, 'memoria-longa', 'fatos')).length, 0);
  }],
  ['excluir manda para a lixeira e restaurar volta', () => {
    const t = reg.remove('codigo-2-copia');
    assert.equal(reg.get('codigo-2-copia'), null);
    assert.equal(reg.listTrash().length, 1);
    const r = reg.restore(t.trashId);
    assert.equal(r.id, 'codigo-2-copia');
    assert.equal(reg.listTrash().length, 0);
  }],
  ['lixeira limpa só o que tem mais de 30 dias', () => {
    reg.remove('codigo-2-copia');
    clock += 29 * 86_400_000;
    assert.equal(reg.purgeTrash(30), 0);
    clock += 2 * 86_400_000;
    assert.equal(reg.purgeTrash(30), 1);
    assert.equal(reg.listTrash().length, 0);
  }],
  ['restaurar padrões recria só os que faltam', () => {
    reg.remove('hermes');
    assert.deepEqual(reg.restoreDefaults().map((a) => a.id), ['hermes']);
  }],
  ['exportar não leva segredos; importar valida e não sobrescreve', () => {
    const json = reg.exportAgent('codigo-2');
    assert.equal(json.format, 'mch-agent@1');
    assert.equal('password' in json.agent, false);
    const imported = reg.importAgent(json);
    assert.equal(imported.id, 'codigo-2-2');
    assert.throws(() => reg.importAgent({ format: 'outro', agent: {} } as never), /formato/i);
  }],
  ['restore de lixeira com id malicioso é recusado', () => {
    assert.throws(() => reg.restore('../agentes/orquestrador'), /inválid|não encontrad/);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`[PASS] ${name}`); } catch (err) { failed++; console.error(`[FAIL] ${name}\n`, err); }
}
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.error(`${failed} teste(s) do registro de agentes falharam.`); process.exit(1); }
console.log(`${tests.length} testes do registro de agentes passaram.`);
