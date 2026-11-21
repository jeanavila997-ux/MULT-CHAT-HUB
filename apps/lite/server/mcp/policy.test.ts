// Classificação de ferramentas MCP e filtro por agente.
// Executar: pnpm --filter @mch/lite exec tsx server/mcp/policy.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyMcpTool, needsConfirmation, toolAllowedForAgent, McpCallLog } from './policy.js';
import { DEFAULT_AGENT_SEEDS } from '../agents/model.js';

const tests: [string, () => void][] = [
  ['ferramentas conhecidas do Mestre têm classe fixa', () => {
    assert.equal(classifyMcpTool('mestre', 'mestre_system_status'), 'read');
    assert.equal(classifyMcpTool('mestre', 'mestre_list_operations'), 'read');
    assert.equal(classifyMcpTool('mestre', 'mestre_save_memory'), 'write');
    assert.equal(classifyMcpTool('mestre', 'mestre_run_operation'), 'exec');
    assert.equal(classifyMcpTool('mestre', 'mestre_optimize_ram_and_temp'), 'destructive');
    assert.equal(classifyMcpTool('mestre', 'mestre_ask_grok'), 'paid');
    assert.equal(classifyMcpTool('mestre', 'mestre_turbo_diagnostico'), 'read');
    assert.equal(classifyMcpTool('mestre', 'mestre_turbo_otimizar'), 'destructive');
    assert.equal(classifyMcpTool('mestre', 'mestre_turbo_otimizar', { readOnlyHint: true }), 'destructive', 'servidor não rebaixa o Turbo PC');
  }],
  ['desconhecida conta como escrita (pede confirmação); anotação readOnly vira leitura', () => {
    assert.equal(classifyMcpTool('outro', 'faz_algo'), 'write');
    assert.equal(classifyMcpTool('outro', 'faz_algo', { readOnlyHint: true }), 'read');
    assert.equal(classifyMcpTool('outro', 'apaga', { destructiveHint: true }), 'destructive');
    assert.equal(classifyMcpTool('mestre', 'mestre_optimize_ram_and_temp', { readOnlyHint: true }), 'destructive', 'servidor não rebaixa classe fixa');
  }],
  ['só leitura roda sem confirmação', () => {
    assert.equal(needsConfirmation('read'), false);
    for (const c of ['write', 'exec', 'destructive', 'paid'] as const) assert.equal(needsConfirmation(c), true);
  }],
  ['PC / Mestre padrão tem o Mestre ligado; Código não', () => {
    const pc = DEFAULT_AGENT_SEEDS.find((a) => a.id === 'pc-mestre')!;
    const cod = DEFAULT_AGENT_SEEDS.find((a) => a.id === 'codigo')!;
    assert.equal(toolAllowedForAgent(pc.tools!, 'mestre', 'mestre_system_status'), true);
    assert.equal(toolAllowedForAgent(pc.tools!, 'mestre', 'mestre_ask_grok'), true);
    assert.equal(toolAllowedForAgent(cod.tools!, 'mestre', 'mestre_system_status'), false);
    assert.equal(toolAllowedForAgent({ enabled: true, mcp: { mestre: { enabled: true, allow: ['mestre_system_status'] } } }, 'mestre', 'mestre_run_operation'), false);
    assert.equal(toolAllowedForAgent({ enabled: false, mcp: { mestre: { enabled: true, allow: ['*'] } } }, 'mestre', 'mestre_system_status'), false);
  }],
  ['log de chamadas em JSONL sem os argumentos completos', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mch-mcplog-'));
    const log = new McpCallLog(path.join(dir, 'mcp-chamadas.jsonl'));
    log.append({ agentId: 'pc-mestre', server: 'mestre', tool: 'mestre_run_operation', klass: 'exec', ok: true, ms: 12, args: { password: 'x'.repeat(500) } });
    const lines = log.tail(10);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].tool, 'mestre_run_operation');
    assert.equal(JSON.stringify(lines[0]).includes('x'.repeat(300)), false, 'args truncados');
    assert.equal(JSON.stringify(lines[0]).includes('"password":"x'), false, 'chave sensível mascarada');
    fs.rmSync(dir, { recursive: true, force: true });
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`[PASS] ${name}`); } catch (err) { failed++; console.error(`[FAIL] ${name}\n`, err); }
}
if (failed) { console.error(`${failed} teste(s) de política MCP falharam.`); process.exit(1); }
console.log(`${tests.length} testes de política MCP passaram.`);
