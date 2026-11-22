// Executar: pnpm --filter @mch/lite exec tsx server/ollama/modelChain.test.ts
import assert from 'node:assert/strict';
import { DEFAULT_CHAIN, DEFAULT_USO1, normalizeChain, resolveSequence, runWithFallback, shouldFailover } from './modelChain.js';

const tests: [string, () => void | Promise<void>][] = [
  ['cadeia padrão começa no qwen3:4b e tem os quatro modelos', () => {
    const cfg = normalizeChain({});
    assert.equal(cfg.uso1, DEFAULT_USO1);
    assert.deepEqual(cfg.chain, [...DEFAULT_CHAIN]);
    assert.equal(cfg.allowPaidFallback, true);
  }],
  ['uso 1 entra na frente e duplicatas somem', () => {
    const cfg = normalizeChain({ uso1: 'qwen3:4b', chain: ['qwen3:4b', 'qwen2.5-coder:3b-instruct', 'qwen3:4b'] });
    assert.deepEqual(cfg.chain, ['qwen3:4b', 'qwen2.5-coder:3b-instruct']);
  }],
  ['sem modelo pedido: ordem = uso 1 e depois a cadeia (incluindo nuvem)', () => {
    const seq = resolveSequence({
      uso1: 'qwen3:4b',
      chain: [...DEFAULT_CHAIN],
      allowPaidFallback: true,
      confirmPaid: true,
    });
    assert.deepEqual(seq, [...DEFAULT_CHAIN]);
  }],
  ['tarefa com modelo próprio começa nele e segue a cadeia', () => {
    const seq = resolveSequence({
      requested: 'qwen2.5-coder:3b-instruct',
      uso1: 'qwen3:4b',
      chain: [...DEFAULT_CHAIN],
      allowPaidFallback: true,
      confirmPaid: true,
    });
    assert.equal(seq[0], 'qwen2.5-coder:3b-instruct');
    assert.ok(seq.includes('qwen3:4b'));
    assert.ok(seq.includes('kimi-k3:cloud'));
  }],
  ['sem confirmação de pago e allowPaidFallback false: só locais, mas o pedido pago entra', () => {
    const seq = resolveSequence({
      requested: 'kimi-k3:cloud',
      uso1: 'qwen3:4b',
      chain: [...DEFAULT_CHAIN],
      allowPaidFallback: false,
      confirmPaid: false,
    });
    assert.equal(seq[0], 'kimi-k3:cloud');
    assert.deepEqual(seq.slice(1), ['qwen3:4b', 'qwen2.5-coder:3b-instruct']);
  }],
  ['timeout e modelo ausente fazem failover; 402 pago não', () => {
    assert.equal(shouldFailover(Object.assign(new Error('aborted'), { name: 'AbortError' })), true);
    assert.equal(shouldFailover(new Error('Ollama 404: model not found')), true);
    assert.equal(shouldFailover(new Error('needs paid confirmation 402')), false);
  }],
  ['runWithFallback tenta o próximo quando o atual falha', async () => {
    const calls: string[] = [];
    const out = await runWithFallback(['a', 'b', 'c'], async (m) => {
      calls.push(m);
      if (m !== 'b') throw new Error('model not found');
      return `ok-${m}`;
    });
    assert.deepEqual(calls, ['a', 'b']);
    assert.equal(out.model, 'b');
    assert.equal(out.result, 'ok-b');
    assert.deepEqual(out.tried, ['a', 'b']);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] ${name}\n`, err);
  }
}
if (failed) {
  console.error(`${failed} teste(s) da cadeia falharam.`);
  process.exit(1);
}
console.log(`${tests.length} testes da cadeia passaram.`);
