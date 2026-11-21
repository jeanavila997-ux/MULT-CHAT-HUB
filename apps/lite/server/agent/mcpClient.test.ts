// Cliente MCP manda o token nos dois formatos aceitos pelo Mestre.
// Executar: pnpm --filter @mch/lite exec tsx server/agent/mcpClient.test.ts
import assert from 'node:assert/strict';
import http from 'node:http';
import { McpHttpClient } from './mcpClient.js';

const seen: Record<string, string | undefined>[] = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push({ auth: req.headers.authorization, mestre: req.headers['x-mestre-mcp-token'] as string | undefined, ct: req.headers['content-type'] });
    const msg = body ? JSON.parse(body) : {};
    if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
    const result = msg.method === 'tools/list' ? { tools: [{ name: 'mestre_system_status' }] } : {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
  });
});

await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
let failed = 0;
try {
  const client = new McpHttpClient(`http://127.0.0.1:${port}/mcp`, 'tok-123', 5000, { 'X-Mestre-Mcp-Token': 'tok-123' });
  const tools = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ['mestre_system_status']);
  assert.ok(seen.length >= 2);
  for (const s of seen) {
    assert.equal(s.auth, 'Bearer tok-123');
    assert.equal(s.mestre, 'tok-123');
    assert.match(s.ct ?? '', /^application\/json/);
  }
  console.log('[PASS] envia Authorization Bearer e X-Mestre-Mcp-Token em JSON');
} catch (err) {
  failed++; console.error('[FAIL] cabeçalhos do cliente MCP\n', err);
} finally {
  server.close();
}
if (failed) process.exit(1);
console.log('1 teste do cliente MCP passou.');
