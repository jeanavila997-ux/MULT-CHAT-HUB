// Rotas do hub (agentes, provedores, MCP) contra uma pasta temporária.
// Executar: pnpm --filter @mch/lite exec tsx server/routes/hubRoutes.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { buildHubRouter } from './hubRoutes.js';
import { createHub } from '../hub.js';
import { MemorySecretBackend } from '../secrets/secretStore.js';
import type { McpClientLike } from '../agent/mcpClient.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mch-hubroutes-'));
const envFile = path.join(tmp, '.env.local');
fs.writeFileSync(envFile, 'OPENAI_API_KEY=sk-env-abcd\n');
const fakeMestre: McpClientLike = {
  listTools: async () => [{ name: 'mestre_system_status' }, { name: 'mestre_optimize_ram_and_temp' }],
  callTool: async (name) => `ok:${name}`,
  reset: () => {},
};
const hub = await createHub({ root: tmp, env: { OPENAI_API_KEY: 'sk-env-abcd' }, secretBackend: new MemorySecretBackend(), mcpFactory: () => fakeMestre, envFile });
const app = express();
app.use(express.json());
app.use('/api', buildHubRouter(async () => hub));
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
async function call(method: string, p: string, body?: unknown) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, raw: text };
}

const tests: [string, () => Promise<void>][] = [
  ['GET /agents traz os 5 padrões, com PC / Mestre ligado ao Mestre', async () => {
    const r = await call('GET', '/agents');
    assert.equal(r.status, 200);
    assert.equal(r.body.agents.length, 5);
    const pc = r.body.agents.find((a: { id: string }) => a.id === 'pc-mestre');
    assert.equal(pc.tools.mcp.mestre.enabled, true);
    assert.equal(pc.provider, 'ollama');
    assert.equal(pc.model, 'jeanavila997/agente-model-file:latest');
  }],
  ['criar, editar, excluir (pede o nome) e restaurar', async () => {
    const c = await call('POST', '/agents', { name: 'Teste', description: 'x' });
    assert.equal(c.status, 201);
    assert.equal((await call('PUT', '/agents/teste', { temperature: 9 })).status, 400);
    assert.equal((await call('PUT', '/agents/teste', { description: 'y' })).body.agent.description, 'y');
    assert.equal((await call('DELETE', '/agents/teste', { confirmName: 'errado' })).status, 400);
    const del = await call('DELETE', '/agents/teste', { confirmName: 'Teste' });
    assert.equal(del.status, 200);
    const trash = await call('GET', '/agents-trash');
    assert.equal(trash.body.trash.length, 1);
    assert.equal((await call('POST', `/agents-trash/${trash.body.trash[0].trashId}/restore`)).status, 200);
    assert.equal((await call('GET', '/agents/teste')).status, 200);
  }],
  ['provedores: chave nunca volta, só last4 e origem', async () => {
    let r = await call('GET', '/providers');
    let openai = r.body.providers.find((p: { id: string }) => p.id === 'openai');
    assert.equal(openai.source, 'env');
    assert.equal(openai.paid, true);
    assert.equal(r.raw.includes('sk-env-abcd'), false);
    assert.equal((await call('PUT', '/providers/openai/key', { key: 'sk-new-key-7777' })).status, 200);
    r = await call('GET', '/providers');
    openai = r.body.providers.find((p: { id: string }) => p.id === 'openai');
    assert.equal(openai.source, 'cofre');
    assert.equal(openai.last4, '7777');
    assert.equal(r.raw.includes('sk-new-key'), false);
    assert.equal((await call('PUT', '/providers/ollama/key', { key: 'x' })).status, 400, 'provedor local não tem chave');
    assert.equal((await call('DELETE', '/providers/openai/key')).status, 200);
  }],
  ['importar do .env exige confirm=true', async () => {
    assert.equal((await call('POST', '/providers/import-env', {})).status, 400);
    const r = await call('POST', '/providers/import-env', { confirm: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.imported, ['OPENAI_API_KEY']);
    assert.equal(r.raw.includes('sk-env-abcd'), false);
  }],
  ['MCP: status do Mestre classifica e teste só aceita leitura', async () => {
    const s = await call('GET', '/mcp/servers/mestre/status?force=1');
    assert.equal(s.body.ok, true);
    const opt = s.body.tools.find((t: { name: string }) => t.name === 'mestre_optimize_ram_and_temp');
    assert.equal(opt.klass, 'destructive');
    assert.equal((await call('POST', '/mcp/servers/mestre/test', { tool: 'mestre_system_status' })).body.output, 'ok:mestre_system_status');
    assert.equal((await call('POST', '/mcp/servers/mestre/test', { tool: 'mestre_optimize_ram_and_temp' })).status, 400);
    assert.ok((await call('GET', '/mcp/log')).body.entries.length >= 1);
  }],
  ['iniciar o Mestre exige confirm=true', async () => {
    assert.equal((await call('POST', '/mestre/start', {})).status, 400);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`[PASS] ${name}`); } catch (err) { failed++; console.error(`[FAIL] ${name}\n`, err); }
}
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.error(`${failed} teste(s) das rotas do hub falharam.`); process.exit(1); }
console.log(`${tests.length} testes das rotas do hub passaram.`);
