// Cofre de chaves: valor nunca volta pela API, só os 4 últimos dígitos.
// Executar: pnpm --filter @mch/lite exec tsx server/secrets/secretStore.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemorySecretBackend, SecretStore } from './secretStore.js';
import { importEnvSecrets } from './envImport.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mch-secrets-'));
const backend = new MemorySecretBackend();
const store = new SecretStore(backend, path.join(tmp, 'config', 'secrets-index.json'));

const tests: [string, () => Promise<void> | void][] = [
  ['guarda no cofre e o índice só tem os 4 últimos', async () => {
    await store.set('provider:openai', 'sk-test-abcdefgh1234');
    assert.equal(await store.get('provider:openai'), 'sk-test-abcdefgh1234');
    const idx = fs.readFileSync(path.join(tmp, 'config', 'secrets-index.json'), 'utf8');
    assert.equal(idx.includes('abcdefgh'), false);
    assert.equal(store.info('provider:openai')?.last4, '1234');
  }],
  ['recusa conta inválida e valor vazio ou com quebra de linha', async () => {
    await assert.rejects(store.set('../x', 'a'), /conta/i);
    await assert.rejects(store.set('provider:openai', ''), /vazi/i);
    await assert.rejects(store.set('provider:openai', 'a\nb'), /linha/i);
  }],
  ['resolve: cofre primeiro, depois .env', async () => {
    assert.deepEqual(await store.resolve('provider:openai', ['OPENAI_API_KEY'], { OPENAI_API_KEY: 'env-1' }), { value: 'sk-test-abcdefgh1234', source: 'cofre' });
    assert.deepEqual(await store.resolve('provider:gemini', ['GEMINI_API_KEY'], { GEMINI_API_KEY: 'env-2' }), { value: 'env-2', source: 'env' });
    assert.deepEqual(await store.resolve('provider:x', ['X'], {}), { value: '', source: null });
  }],
  ['apagar remove do cofre e do índice', async () => {
    await store.delete('provider:openai');
    assert.equal(await store.get('provider:openai'), null);
    assert.equal(store.info('provider:openai'), null);
  }],
  ['importa do .env.local, confere e só então comenta as linhas (com backup)', async () => {
    const envFile = path.join(tmp, '.env.local');
    fs.writeFileSync(envFile, 'PORT=3002\r\nOPENAI_API_KEY="sk-env-9999"\r\nGEMINI_API_KEY=\r\nAPP_ACTIVATION_SECRET="nao-mexe"\r\n');
    const r = await importEnvSecrets(store, envFile, [
      { account: 'provider:openai', envKeys: ['OPENAI_API_KEY'] },
      { account: 'provider:gemini', envKeys: ['GEMINI_API_KEY'] },
    ], () => new Date('2026-11-20T12:00:00Z'));
    assert.deepEqual(r.imported, ['OPENAI_API_KEY']);
    assert.ok(r.backup && fs.existsSync(r.backup));
    assert.match(fs.readFileSync(r.backup!, 'utf8'), /sk-env-9999/);
    const after = fs.readFileSync(envFile, 'utf8');
    assert.equal(after.includes('sk-env-9999'), false);
    assert.match(after, /# OPENAI_API_KEY movida para o cofre/);
    assert.match(after, /APP_ACTIVATION_SECRET="nao-mexe"/);
    assert.match(after, /\r\n/, 'mantém CRLF');
    assert.equal(await store.get('provider:openai'), 'sk-env-9999');
  }],
  ['se a conferência falhar, não mexe no .env.local', async () => {
    const envFile = path.join(tmp, '.env2');
    fs.writeFileSync(envFile, 'DEEPSEEK_API_KEY=ds-1\n');
    const broken = new SecretStore({ get: async () => 'outro', set: async () => {}, delete: async () => {} }, path.join(tmp, 'i2.json'));
    const r = await importEnvSecrets(broken, envFile, [{ account: 'provider:deepseek', envKeys: ['DEEPSEEK_API_KEY'] }]);
    assert.deepEqual(r.imported, []);
    assert.deepEqual(r.failed, ['DEEPSEEK_API_KEY']);
    assert.equal(fs.readFileSync(envFile, 'utf8'), 'DEEPSEEK_API_KEY=ds-1\n');
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`[PASS] ${name}`); } catch (err) { failed++; console.error(`[FAIL] ${name}\n`, err); }
}
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.error(`${failed} teste(s) do cofre falharam.`); process.exit(1); }
console.log(`${tests.length} testes do cofre passaram.`);
