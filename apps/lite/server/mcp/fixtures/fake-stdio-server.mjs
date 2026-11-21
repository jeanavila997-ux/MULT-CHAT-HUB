// Servidor MCP falso (stdio) só para testes.
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', capabilities: {} } });
  if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'eco', annotations: { readOnlyHint: true } }, { name: 'apaga' }] } });
  if (msg.method === 'tools/call') return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `eco:${msg.params.arguments.texto}` }] } });
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'não existe' } });
});
