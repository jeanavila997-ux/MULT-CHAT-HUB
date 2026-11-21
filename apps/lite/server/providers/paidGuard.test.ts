// Nada pago sem confirmação explícita do Jean.
// Executar: pnpm --filter @mch/lite exec tsx server/providers/paidGuard.test.ts
import assert from 'node:assert/strict';
import { paidGuardError } from './paidGuard.js';

const tests: [string, () => void][] = [
  ['modelo local do Ollama passa sem confirmação', () => {
    assert.equal(paidGuardError('ollama', 'qwen3.5:4b', undefined), null);
  }],
  ['modelo :cloud do Ollama exige confirmPaid=true', () => {
    assert.match(paidGuardError('ollama', 'glm-5.3-flash:cloud', undefined) ?? '', /pago/i);
    assert.match(paidGuardError('ollama', 'glm-5.3-flash:cloud', 'true') ?? '', /pago/i);
    assert.equal(paidGuardError('ollama', 'glm-5.3-flash:cloud', true), null);
  }],
  ['provedor pago (API) exige confirmPaid=true', () => {
    assert.match(paidGuardError('openai', 'gpt-4o-mini', false) ?? '', /pago/i);
    assert.equal(paidGuardError('openai', 'gpt-4o-mini', true), null);
  }],
  ['llama.cpp local passa', () => {
    assert.equal(paidGuardError('llamacpp', 'local-model', undefined), null);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`[PASS] ${name}`); } catch (err) { failed++; console.error(`[FAIL] ${name}\n`, err); }
}
if (failed) { console.error(`${failed} teste(s) do guarda de custo falharam.`); process.exit(1); }
console.log(`${tests.length} testes do guarda de custo passaram.`);
