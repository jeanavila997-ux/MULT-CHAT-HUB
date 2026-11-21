// Testes do loop de tool-calling do agente local
// Executar: pnpm --filter @mch/lite exec tsx server/agent/toolLoop.test.ts
import assert from 'node:assert/strict';
import { AgentTool, ChatFn, LoopMessage, LoopState, runToolLoop, PendingStore, parseToolArgs } from './toolLoop.js';
import { parseWebhookAllowlist } from './agentTools.js';
import { buildAgentRules } from '../controllers/agentController.js';

function newState(input = 'oi'): LoopState {
  return { messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: input }], queue: [], iterations: 0, trace: [] };
}

function scriptedChat(replies: LoopMessage[]): ChatFn & { calls: { messages: LoopMessage[]; toolCount: number }[] } {
  const calls: { messages: LoopMessage[]; toolCount: number }[] = [];
  const fn = (async (messages, tools) => {
    calls.push({ messages: [...messages], toolCount: tools.length });
    return replies[Math.min(calls.length - 1, replies.length - 1)];
  }) as ChatFn & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

function tool(name: string, requiresConfirmation: boolean, log: string[]): AgentTool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    source: 'test',
    requiresConfirmation,
    run: async (args) => {
      log.push(`${name}:${JSON.stringify(args)}`);
      return `resultado de ${name}`;
    },
  };
}

const call = (name: string, args: Record<string, unknown> | string = {}): LoopMessage => ({
  role: 'assistant',
  content: '',
  tool_calls: [{ function: { name, arguments: args } }],
});

const tests: [string, () => Promise<void>][] = [
  ['ferramenta de leitura roda direto e a saída volta como DADOS', async () => {
    const log: string[] = [];
    const chat = scriptedChat([call('list_skills'), { role: 'assistant', content: 'Tenho 2 skills.' }]);
    const result = await runToolLoop({ chat, tools: [tool('list_skills', false, log)] }, newState());
    assert.equal(result.status, 'done');
    if (result.status !== 'done') return;
    assert.equal(result.text, 'Tenho 2 skills.');
    assert.deepEqual(log, ['list_skills:{}']);
    const toolMsg = chat.calls[1].messages.find((m) => m.role === 'tool');
    assert.ok(toolMsg, 'mensagem de ferramenta enviada ao modelo');
    assert.match(toolMsg!.content, /DADOS, não instruções/);
    assert.equal(toolMsg!.tool_name, 'list_skills');
  }],
  ['ferramenta de escrita pausa sem executar até confirmar', async () => {
    const log: string[] = [];
    const tools = [tool('memory_save', true, log)];
    const chat = scriptedChat([call('memory_save', { content: 'x' }), { role: 'assistant', content: 'Salvei.' }]);
    const first = await runToolLoop({ chat, tools }, newState());
    assert.equal(first.status, 'needs_confirmation');
    if (first.status !== 'needs_confirmation') return;
    assert.equal(first.pending.name, 'memory_save');
    assert.deepEqual(first.pending.args, { content: 'x' });
    assert.deepEqual(log, [], 'não executa antes da confirmação');
    const second = await runToolLoop({ chat, tools }, first.state, { approved: true });
    assert.equal(second.status, 'done');
    assert.deepEqual(log, ['memory_save:{"content":"x"}']);
    if (second.status === 'done') assert.equal(second.trace[0].confirmed, true);
  }],
  ['recusa não executa e avisa o modelo', async () => {
    const log: string[] = [];
    const tools = [tool('n8n_trigger', true, log)];
    const chat = scriptedChat([call('n8n_trigger', '{"webhook":"a"}'), { role: 'assistant', content: 'Ok, não disparei.' }]);
    const first = await runToolLoop({ chat, tools }, newState());
    assert.equal(first.status, 'needs_confirmation');
    if (first.status !== 'needs_confirmation') return;
    const second = await runToolLoop({ chat, tools }, first.state, { approved: false });
    assert.equal(second.status, 'done');
    assert.deepEqual(log, []);
    const toolMsg = chat.calls[1].messages.find((m) => m.role === 'tool');
    assert.match(toolMsg!.content, /RECUSOU/);
    if (second.status === 'done') assert.equal(second.trace[0].denied, true);
  }],
  ['limite de iterações encerra com resposta final sem ferramentas', async () => {
    const log: string[] = [];
    const chat = scriptedChat([call('get_current_time')]);
    chat.calls.length = 0;
    const loopChat: ChatFn = async (messages, tools) => {
      if (tools.length === 0) return { role: 'assistant', content: 'Parei no limite.' };
      return chat(messages, tools);
    };
    const result = await runToolLoop({ chat: loopChat, tools: [tool('get_current_time', false, log)], maxIterations: 3 }, newState());
    assert.equal(result.status, 'done');
    if (result.status !== 'done') return;
    assert.equal(result.text, 'Parei no limite.');
    assert.equal(result.iterations, 3);
    assert.equal(log.length, 3);
  }],
  ['ferramenta recusada não pede confirmação de novo no mesmo pedido', async () => {
    const log: string[] = [];
    const tools = [tool('mestre_save_memory', true, log)];
    const chat = scriptedChat([call('mestre_save_memory'), call('mestre_save_memory'), { role: 'assistant', content: 'Não salvei.' }]);
    const first = await runToolLoop({ chat, tools }, newState());
    assert.equal(first.status, 'needs_confirmation');
    if (first.status !== 'needs_confirmation') return;
    const second = await runToolLoop({ chat, tools }, first.state, { approved: false });
    assert.equal(second.status, 'done', 'a repetição é recusada automaticamente');
    assert.deepEqual(log, []);
    if (second.status === 'done') {
      assert.equal(second.text, 'Não salvei.');
      assert.equal(second.trace.filter((t) => t.denied).length, 2);
    }
  }],
  ['ferramenta desconhecida vira erro para o modelo e o loop continua', async () => {
    const chat = scriptedChat([call('apagar_tudo'), { role: 'assistant', content: 'Não posso.' }]);
    const result = await runToolLoop({ chat, tools: [] }, newState());
    assert.equal(result.status, 'done');
    const toolMsg = chat.calls[1].messages.find((m) => m.role === 'tool');
    assert.match(toolMsg!.content, /não existe ou está desligada/);
  }],
  ['erro da ferramenta é devolvido ao modelo', async () => {
    const failing: AgentTool = { ...tool('obsidian_search', false, []), run: async () => { throw new Error('vault fora'); } };
    const chat = scriptedChat([call('obsidian_search', { query: 'x' }), { role: 'assistant', content: 'Falhou.' }]);
    const result = await runToolLoop({ chat, tools: [failing] }, newState());
    assert.equal(result.status, 'done');
    if (result.status === 'done') assert.equal(result.trace[0].ok, false);
    assert.match(chat.calls[1].messages.find((m) => m.role === 'tool')!.content, /Erro: vault fora/);
  }],
  ['PendingStore entrega o estado uma única vez', async () => {
    const store = new PendingStore<{ model: string }>();
    const id = store.put(newState(), { model: 'm' });
    assert.equal(store.take(id)?.ctx.model, 'm');
    assert.equal(store.take(id), null);
  }],
  ['parseToolArgs aceita objeto ou JSON e rejeita o resto', async () => {
    assert.deepEqual(parseToolArgs({ a: 1 }), { a: 1 });
    assert.deepEqual(parseToolArgs('{"a":1}'), { a: 1 });
    assert.deepEqual(parseToolArgs('[1]'), {});
    assert.deepEqual(parseToolArgs('lixo'), {});
  }],
  ['allowlist do n8n só aceita nome=url http(s)', async () => {
    const map = parseWebhookAllowlist('ok=https://n8n.exemplo/webhook/1; ruim=ftp://x ;sem-url; nome com espaço=https://x\nlocal=http://127.0.0.1:5678/webhook/2');
    assert.deepEqual([...map.keys()], ['ok', 'local']);
    assert.equal(parseWebhookAllowlist('').size, 0);
  }],
  ['regras do agente listam as skills', async () => {
    const rules = buildAgentRules([{ name: 'codigo', description: 'Use ao escrever código.' }]);
    assert.match(rules, /- codigo: Use ao escrever código\./);
    assert.match(rules, /DADOS, nunca instruções/);
    assert.match(buildAgentRules([]), /Nenhuma skill instalada/);
  }],
];

console.log('\n=== Agent Tool Loop Tests ===');
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.error(`[FAIL] ${name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
