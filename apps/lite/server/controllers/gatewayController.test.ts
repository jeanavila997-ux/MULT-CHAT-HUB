// Testes do pareamento com gateway externo (NullClaw) contra um gateway falso local
// Executar: pnpm --filter @mch/lite exec tsx server/controllers/gatewayController.test.ts
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { handleConnectGateway, handleDisconnectGateway, handleGatewayMessage, handleListGateways, normalizeGatewayUrl } from './gatewayController.js';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`[PASS] ${name}`);
}

function listen(app: express.Express): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => {
      const a = s.address();
      resolve({ port: typeof a === 'object' && a ? a.port : 0, close: () => s.close() });
    });
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mch-gw-'));
process.env.GATEWAYS_FILE = path.join(tmp, 'gateways.json');
delete process.env.GATEWAY_ALLOWED_HOSTS;

// Gateway falso no estilo NullClaw: /pair com código de uso único, /webhook com Bearer.
const fake = express();
fake.use(express.json());
let pairCode = '482913';
const TOKEN = 'tok-fake-abc';
fake.get('/health', (_q, r) => r.json({ status: 'ok' }));
fake.post('/pair', (q, r) => {
  if (q.get('x-pairing-code') !== pairCode) return r.status(401).json({ error: 'invalid code' });
  pairCode = 'usado';
  return r.json({ paired: true, token: TOKEN });
});
fake.post('/webhook', (q, r) => {
  if (q.get('authorization') !== `Bearer ${TOKEN}`) return r.status(401).json({ error: 'unauthorized' });
  return r.json({ response: `eco: ${q.body?.message}` });
});

const app = express();
app.use(express.json());
app.get('/gw', handleListGateways);
app.post('/gw/connect', handleConnectGateway);
app.post('/gw/:id/message', handleGatewayMessage);
app.delete('/gw/:id', handleDisconnectGateway);

const fk = await listen(fake);
const hub = await listen(app);
const url = `http://127.0.0.1:${fk.port}`;
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${hub.port}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() as Record<string, unknown> };
};

try {
  await test('allowlist: só este PC por padrão', () => {
    assert.equal(normalizeGatewayUrl('http://127.0.0.1:3010/'), 'http://127.0.0.1:3010');
    assert.throws(() => normalizeGatewayUrl('http://192.168.0.10:3000'), /GATEWAY_ALLOWED_HOSTS/);
    assert.throws(() => normalizeGatewayUrl('file:///etc/passwd'), /http/);
    assert.equal(normalizeGatewayUrl('http://10.0.0.5:3000', ['10.0.0.5']), 'http://10.0.0.5:3000');
  });

  await test('código errado → 401 com mensagem clara', async () => {
    const r = await call('POST', '/gw/connect', { url, code: '000000' });
    assert.equal(r.status, 401);
    assert.match(String(r.body.error), /inválido/);
  });

  let id = '';
  await test('código certo → conecta, guarda token só no servidor', async () => {
    const r = await call('POST', '/gw/connect', { url, code: '482913' });
    assert.equal(r.status, 200);
    id = String(r.body.id);
    assert.equal(r.body.token, undefined, 'token nunca volta ao navegador');
    const list = await call('GET', '/gw');
    assert.equal((list.body.gateways as unknown[]).length, 1);
    assert.equal(JSON.stringify(list.body).includes(TOKEN), false);
  });

  await test('mensagem usa o token do gateway certo', async () => {
    const r = await call('POST', `/gw/${id}/message`, { message: 'olá' });
    assert.equal(r.status, 200);
    assert.equal(r.body.text, 'eco: olá');
  });

  await test('código de uso único não pareia de novo', async () => {
    const r = await call('POST', '/gw/connect', { url, code: '482913' });
    assert.equal(r.status, 401);
  });

  await test('desconectar apaga o token', async () => {
    assert.equal((await call('DELETE', `/gw/${id}`)).status, 200);
    assert.equal((await call('POST', `/gw/${id}/message`, { message: 'x' })).status, 404);
    assert.equal(fs.readFileSync(process.env.GATEWAYS_FILE!, 'utf8').includes(TOKEN), false);
  });
} finally {
  fk.close();
  hub.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} testes de gateway passaram.`);
