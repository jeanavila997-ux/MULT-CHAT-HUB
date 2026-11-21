// Testes das rotinas: bloqueio de ferramentas de escrita, histórico e execução única
// Executar: pnpm --filter @mch/lite exec tsx server/routines/routines.test.ts
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentTool, ChatFn } from '../agent/toolLoop.js';
import { BLOCKED_PREFIX, MAX_HISTORY, RoutineDeps, RoutineScheduler, RoutineStore, executeRoutine, restrictToReadOnly } from './routines.js';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`[PASS] ${name}`);
}

const calls: string[] = [];
const tools: AgentTool[] = [
  { name: 'ler_status', description: 'leitura', parameters: {}, source: 't', requiresConfirmation: false, run: async () => { calls.push('ler_status'); return 'RAM ok'; } },
  { name: 'apagar_tudo', description: 'escrita', parameters: {}, source: 't', requiresConfirmation: true, run: async () => { calls.push('apagar_tudo'); return 'apagado'; } },
];

// Modelo falso: 1ª resposta chama as duas ferramentas; 2ª responde com o que recebeu.
function fakeChat(seen: string[][]): ChatFn {
  let n = 0;
  return async (messages) => {
    n++;
    if (n === 1) {
      return { role: 'assistant', content: '', tool_calls: [{ function: { name: 'apagar_tudo', arguments: {} } }, { function: { name: 'ler_status', arguments: {} } }] };
    }
    seen.push(messages.filter((m) => m.role === 'tool').map((m) => m.content));
    return { role: 'assistant', content: 'Resumo: RAM ok.' };
  };
}

function deps(chat: ChatFn, slow = 0): RoutineDeps {
  return {
    ollama: () => ({ chat, system: async () => 'sys', defaultModel: 'modelo-teste', maxIterations: 3 }),
    tools: async () => { if (slow) await new Promise((r) => setTimeout(r, slow)); return tools; },
    providerChat: async () => { throw new Error('não deveria chamar provedor de nuvem'); },
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mch-routines-'));
const file = path.join(tmp, 'routines.json');

await test('restrictToReadOnly não executa ferramenta de escrita e registra o bloqueio', async () => {
  const blocked: string[] = [];
  const safe = restrictToReadOnly(tools, blocked);
  assert.equal(safe.every((t) => !t.requiresConfirmation), true);
  await assert.rejects(() => safe[1].run({}), new RegExp(BLOCKED_PREFIX));
  assert.deepEqual(blocked, ['apagar_tudo']);
  assert.equal(await safe[0].run({}), 'RAM ok');
  assert.deepEqual(calls.splice(0), ['ler_status']);
});

const store = new RoutineStore(() => file);

await test('primeiro uso cria a rotina de exemplo PAUSADA', () => {
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Status do PC');
  assert.equal(list[0].active, false);
  assert.equal(list[0].schedule, 'diário 07:00');
  assert.equal(list[0].nextRunAt, null);
  assert.ok(fs.existsSync(file));
});

await test('rotina roda leitura, bloqueia escrita e anota no resultado', async () => {
  const r = store.create({ name: 'Teste', prompt: 'faça', schedule: 'a cada 10 min' });
  const seen: string[][] = [];
  const run = await executeRoutine(r, deps(fakeChat(seen)), 'manual');
  assert.equal(run.status, 'ok');
  assert.equal(run.text, 'Resumo: RAM ok.');
  assert.deepEqual(run.blocked, ['apagar_tudo']);
  assert.deepEqual(run.toolsUsed, ['ler_status']);
  assert.deepEqual(calls.splice(0), ['ler_status'], 'a ferramenta de escrita real nunca é chamada');
  assert.match(seen[0][0], new RegExp(BLOCKED_PREFIX));
});

await test('rotina com ferramentas desligadas não recebe ferramentas', async () => {
  const r = store.create({ name: 'Sem tools', prompt: 'oi', schedule: 'a cada 10 min', tools: false });
  let toolCount = -1;
  const chat: ChatFn = async (_m, specs) => { toolCount = specs.length; return { role: 'assistant', content: 'oi' }; };
  const run = await executeRoutine(r, deps(chat), 'manual');
  assert.equal(run.status, 'ok');
  assert.equal(toolCount, 0);
});

await test('provedor inválido e campos obrigatórios', () => {
  assert.throws(() => store.create({ name: 'x', prompt: 'y', schedule: 'a cada 10 min', provider: 'openai' }), /Provedor inválido/);
  assert.throws(() => store.create({ name: '', prompt: 'y', schedule: 'a cada 10 min' }), /Nome/);
  assert.throws(() => store.create({ name: 'x', prompt: 'y', schedule: 'a cada 1 min' }), /mínimo/);
});

await test('não roda a mesma rotina duas vezes ao mesmo tempo', async () => {
  const r = store.create({ name: 'Lenta', prompt: 'faça', schedule: 'a cada 10 min' });
  const sched = new RoutineScheduler(store, deps(async () => ({ role: 'assistant', content: 'feito' }), 150));
  const [a, b] = await Promise.all([sched.run(r.id, 'manual'), sched.run(r.id, 'agenda')]);
  assert.ok(a);
  assert.equal(b, null);
  assert.equal(store.get(r.id)?.history.length, 1);
});

await test('histórico guarda só as últimas 20 e persiste no arquivo', async () => {
  const r = store.create({ name: 'Hist', prompt: 'faça', schedule: 'a cada 10 min' });
  const sched = new RoutineScheduler(store, deps(async () => ({ role: 'assistant', content: 'feito' })));
  for (let i = 0; i < MAX_HISTORY + 3; i++) await sched.run(r.id, 'manual');
  assert.equal(store.get(r.id)?.history.length, MAX_HISTORY);
  const reloaded = new RoutineStore(() => file);
  const again = reloaded.get(r.id);
  assert.equal(again?.history.length, MAX_HISTORY);
  assert.equal(again?.lastStatus, 'ok');
  assert.ok(again?.nextRunAt);
});

await test('pausar zera o próximo disparo; tick ignora pausadas', async () => {
  const r = store.create({ name: 'Pausa', prompt: 'faça', schedule: 'a cada 10 min' });
  store.update(r.id, { active: false });
  assert.equal(store.get(r.id)?.nextRunAt, null);
  let ran = 0;
  const sched = new RoutineScheduler(store, deps(async () => { ran++; return { role: 'assistant', content: 'x' }; }));
  sched.tick(new Date(Date.now() + 3600_000));
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(store.get(r.id)?.history.length, 0);
});

await test('erro do modelo vira resultado com status error', async () => {
  const r = store.create({ name: 'Erro', prompt: 'faça', schedule: 'a cada 10 min' });
  const run = await executeRoutine(r, deps(async () => { throw new Error('Ollama 500: caiu'); }), 'manual');
  assert.equal(run.status, 'error');
  assert.match(run.error ?? '', /Ollama 500/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} testes de rotinas passaram.`);
