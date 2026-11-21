// Gerenciador MCP: servers.json com Mestre embutido, stdio sem shell, ferramentas por agente.
// Executar: pnpm --filter @mch/lite exec tsx server/mcp/manager.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpManager, validateServerConfig } from './manager.js';
import { McpStdioClient } from './stdioClient.js';
import type { McpClientLike } from '../agent/mcpClient.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mch-mcp-'));
const calls: string[] = [];
const fakeMestre: McpClientLike = {
  listTools: async () => [{ name: 'mestre_system_status' }, { name: 'mestre_optimize_ram_and_temp', annotations: { readOnlyHint: true } }, { name: 'mestre_ask_grok' }],
  callTool: async (name) => { calls.push(name); return `ok:${name}`; },
  reset: () => {},
};

const tests: [string, () => Promise<void>][] = [
  ['servers.json nasce com o Mestre embutido e o token não vai para o arquivo', async () => {
    const m = new McpManager(tmp, { MESTRE_MCP_URL: 'http://127.0.0.1:7777/mcp', MESTRE_MCP_TOKEN: 'segredo-123' });
    const servers = m.listServers();
    assert.equal(servers[0].id, 'mestre');
    assert.equal(servers[0].builtin, true);
    const raw = fs.readFileSync(path.join(tmp, 'mcp', 'servers.json'), 'utf8');
    assert.equal(raw.includes('segredo-123'), false);
  }],
  ['validação: http só em loopback por padrão, stdio sem shell nem caracteres perigosos', async () => {
    assert.deepEqual(validateServerConfig({ id: 'x', name: 'X', type: 'http', url: 'http://127.0.0.1:9000/mcp', enabled: true }).errors, []);
    assert.ok(validateServerConfig({ id: 'x', name: 'X', type: 'http', url: 'http://10.0.0.5/mcp', enabled: true }).errors.length > 0);
    assert.ok(validateServerConfig({ id: 'x', name: 'X', type: 'stdio', command: 'cmd.exe', args: ['/c', 'del'], enabled: true }).errors.length > 0);
    assert.ok(validateServerConfig({ id: 'x', name: 'X', type: 'stdio', command: 'node', args: ['a.js & calc'], enabled: true }).errors.length > 0);
    assert.ok(validateServerConfig({ id: '../x', name: 'X', type: 'stdio', command: 'node', args: [], enabled: true }).errors.length > 0);
  }],
  ['ferramentas do agente: classe fixa do Mestre e confirmação fora da leitura', async () => {
    const m = new McpManager(tmp, {}, () => fakeMestre);
    const { tools } = await m.toolsForAgent({ id: 'pc-mestre', tools: { enabled: true, mcp: { mestre: { enabled: true, allow: ['*'] } } } });
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.equal(byName.mestre_system_status.requiresConfirmation, false);
    assert.equal(byName.mestre_optimize_ram_and_temp.requiresConfirmation, true, 'readOnlyHint do servidor não vale para classe fixa');
    assert.equal(byName.mestre_ask_grok.requiresConfirmation, true);
    assert.match(byName.mestre_ask_grok.description, /paga/);
    assert.equal(await byName.mestre_system_status.run({}), 'ok:mestre_system_status');
    assert.equal(m.log.tail(1)[0].agentId, 'pc-mestre');
    const none = await m.toolsForAgent({ id: 'codigo', tools: { enabled: true, mcp: {} } });
    assert.equal(none.tools.length, 0);
  }],
  ['cliente stdio fala JSON-RPC com o processo (sem shell)', async () => {
    const c = new McpStdioClient(process.execPath, [path.join(here, 'fixtures', 'fake-stdio-server.mjs')], 5000);
    try {
      const tools = await c.listTools();
      assert.deepEqual(tools.map((t) => t.name), ['eco', 'apaga']);
      assert.equal(await c.callTool('eco', { texto: 'oi' }), 'eco:oi');
    } finally { c.close(); }
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`[PASS] ${name}`); } catch (err) { failed++; console.error(`[FAIL] ${name}\n`, err); }
}
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.error(`${failed} teste(s) do gerenciador MCP falharam.`); process.exit(1); }
console.log(`${tests.length} testes do gerenciador MCP passaram.`);
