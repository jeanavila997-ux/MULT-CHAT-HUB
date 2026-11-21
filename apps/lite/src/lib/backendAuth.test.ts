// O segredo de ativação NÃO pode vir do bundle (import.meta.env.VITE_*).
// Executar: pnpm --filter @mch/lite exec tsx src/lib/backendAuth.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./backendAuth.ts', import.meta.url), 'utf8');
assert.equal(/VITE_APP_ACTIVATION_SECRET/.test(src), false, 'backendAuth não deve ler VITE_APP_ACTIVATION_SECRET');
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window = {
  localStorage: { getItem: (k: string) => store.get(k) ?? null },
  electronAPI: { activationSecret: 'do-electron' },
};
const { getBackendAuthHeaders } = await import('./backendAuth.js');
assert.deepEqual(getBackendAuthHeaders(), { 'x-mch-activation-secret': 'do-electron' });
(globalThis as { window: { electronAPI?: unknown } }).window.electronAPI = undefined;
store.set('mch:activation-secret', 'colado');
assert.deepEqual(getBackendAuthHeaders(), { 'x-mch-activation-secret': 'colado' });
store.clear();
assert.deepEqual(getBackendAuthHeaders(), {}, 'sem segredo: o proxy do Vite injeta no servidor');
const vite = fs.readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
assert.match(vite, /x-mch-activation-secret/, 'proxy do Vite injeta o cabeçalho no lado do servidor');
console.log('[PASS] segredo de ativação fora do bundle');
