// Markdown do chat: vira árvore de nós (nunca HTML cru). Links só http(s)/mailto.
// Executar: pnpm --filter @mch/lite exec tsx src/lib/markdown.test.ts
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, safeHref } from './markdown.js';

const tests: [string, () => void][] = [
  ['negrito, itálico, código e link seguro', () => {
    assert.deepEqual(parseInline('**RAM** livre: *4,5 GB* em `C:`'), [
      { t: 'strong', c: [{ t: 'text', v: 'RAM' }] },
      { t: 'text', v: ' livre: ' },
      { t: 'em', c: [{ t: 'text', v: '4,5 GB' }] },
      { t: 'text', v: ' em ' },
      { t: 'code', v: 'C:' },
    ]);
    assert.deepEqual(parseInline('[docs](https://ollama.com/x)'), [{ t: 'link', href: 'https://ollama.com/x', c: [{ t: 'text', v: 'docs' }] }]);
  }],
  ['links perigosos viram texto', () => {
    assert.equal(safeHref('javascript:alert(1)'), null);
    assert.equal(safeHref('JaVaScRiPt:alert(1)'), null);
    assert.equal(safeHref('data:text/html;base64,xx'), null);
    assert.equal(safeHref('//evil.com'), null);
    assert.equal(safeHref('file:///C:/x'), null);
    assert.deepEqual(parseInline('[x](javascript:alert(1))'), [{ t: 'text', v: '[x](javascript:alert(1))' }]);
  }],
  ['HTML cru fica como texto literal', () => {
    const nodes = parseMarkdown('<img src=x onerror=alert(1)> oi');
    assert.deepEqual(nodes, [{ t: 'p', c: [{ t: 'text', v: '<img src=x onerror=alert(1)> oi' }] }]);
  }],
  ['blocos: título, listas, código e parágrafos', () => {
    const nodes = parseMarkdown('## Status\n\n- RAM: **4 GB**\n- CPU: 12\n\n1. um\n2. dois\n\n```ps1\nGet-Process\n```\nfim');
    assert.equal(nodes[0].t, 'h');
    assert.equal(nodes[1].t, 'ul');
    assert.equal((nodes[1] as { items: unknown[] }).items.length, 2);
    assert.equal(nodes[2].t, 'ol');
    assert.deepEqual(nodes[3], { t: 'pre', lang: 'ps1', v: 'Get-Process' });
    assert.equal(nodes[4].t, 'p');
  }],
  ['asterisco solto e sublinhado em nome de arquivo não quebram', () => {
    assert.deepEqual(parseInline('2 * 3 = 6'), [{ t: 'text', v: '2 * 3 = 6' }]);
    assert.deepEqual(parseInline('mestre_system_status'), [{ t: 'text', v: 'mestre_system_status' }]);
  }],
  ['texto enorme não trava (limite)', () => {
    const t0 = Date.now();
    parseMarkdown('**'.repeat(20000) + 'a');
    assert.ok(Date.now() - t0 < 500);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`[PASS] ${name}`); } catch (err) { failed++; console.error(`[FAIL] ${name}\n`, err); }
}
if (failed) { console.error(`${failed} teste(s) de markdown falharam.`); process.exit(1); }
console.log(`${tests.length} testes de markdown passaram.`);
