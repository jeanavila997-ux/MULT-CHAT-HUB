// Testes do catálogo de provedores e da separação de modelos do Ollama
// Executar: pnpm --filter @mch/lite exec tsx server/providers/catalog.test.ts
import assert from 'node:assert/strict';
import { classifyOllamaModels, isPaidOllamaModel, PROVIDER_CATALOG, providerMeta, DEFAULT_LOCAL_MODEL } from './catalog.js';

const tests: [string, () => void][] = [
  ['modelos :cloud e -cloud são pagos; locais não', () => {
    assert.equal(isPaidOllamaModel('glm-5.3-flash:cloud'), true);
    assert.equal(isPaidOllamaModel('deepseek-v4.1-flash:cloud'), true);
    assert.equal(isPaidOllamaModel('gpt-oss:120b-cloud'), true);
    assert.equal(isPaidOllamaModel('qwen3.5:4b'), false);
    assert.equal(isPaidOllamaModel('jeanavila997/agente-model-file:latest'), false);
  }],
  ['separa local e nuvem, remove duplicados e esconde os quebrados', () => {
    const out = classifyOllamaModels([
      'jeanavila997/agente-model-file:latest', 'llama3.2:3b', 'jeanavila997/agente-model-file:latest',
      'clef:cloud', 'deepseek-v4.1-flash:cloud', 'glm-5.3-flash:cloud', 'qwen3.5:4b', '', 'qwen2.5-coder:3b-instruct',
    ], ['clef:cloud']);
    assert.deepEqual(out.local, ['jeanavila997/agente-model-file:latest', 'llama3.2:3b', 'qwen2.5-coder:3b-instruct', 'qwen3.5:4b']);
    assert.deepEqual(out.cloud, ['deepseek-v4.1-flash:cloud', 'glm-5.3-flash:cloud']);
    assert.deepEqual(out.hidden, ['clef:cloud']);
  }],
  ['modelo padrão local é o do Jean (não o fazendaavila2026/avila inexistente)', () => {
    assert.equal(DEFAULT_LOCAL_MODEL, 'jeanavila997/agente-model-file:latest');
  }],
  ['catálogo separa tipos e marca pagos; OpenCode é CLI, não OpenAI', () => {
    assert.equal(providerMeta('ollama')?.kind, 'local');
    assert.equal(providerMeta('ollama')?.paid, false);
    assert.equal(providerMeta('openai')?.kind, 'api');
    assert.equal(providerMeta('openai')?.paid, true);
    assert.equal(providerMeta('router9')?.kind, 'router');
    assert.equal(providerMeta('opencode')?.kind, 'cli');
    assert.notEqual(providerMeta('opencode')?.sublabel, 'OpenAI');
    assert.equal(providerMeta('hermes')?.kind, 'agent');
    for (const p of PROVIDER_CATALOG) {
      assert.ok(p.label.length > 1, p.id);
      if (p.secretAccount) assert.match(p.secretAccount, /^[a-z0-9:_-]+$/);
    }
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`[PASS] ${name}`); } catch (err) { failed++; console.error(`[FAIL] ${name}\n`, err); }
}
if (failed) { console.error(`${failed} teste(s) do catálogo falharam.`); process.exit(1); }
console.log(`${tests.length} testes do catálogo passaram.`);
