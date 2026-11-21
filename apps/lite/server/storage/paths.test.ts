// Pasta de dados do hub: fora do git, sem path traversal.
// Executar: pnpm --filter @mch/lite exec tsx server/storage/paths.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataRoot, findGitRepo, safeJoin, assertSafeDataRoot } from './paths.js';
import { readJson, writeJsonAtomic } from './atomic.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mch-paths-'));
const tests: [string, () => void][] = [
  ['dataRoot usa MCH_DATA_ROOT ou ~/MultChatHub', () => {
    assert.equal(dataRoot({ MCH_DATA_ROOT: tmp }), path.resolve(tmp));
    assert.equal(dataRoot({}, '/home/jean'), path.join('/home/jean', 'MultChatHub'));
  }],
  ['safeJoin bloqueia ../ e caminho absoluto', () => {
    assert.equal(safeJoin(tmp, 'agentes', 'pc'), path.join(tmp, 'agentes', 'pc'));
    assert.throws(() => safeJoin(tmp, '..', 'fora'), /fora da pasta/);
    assert.throws(() => safeJoin(tmp, 'agentes/../../x'), /fora da pasta/);
    assert.throws(() => safeJoin(tmp, path.resolve('/etc/passwd')), /fora da pasta/);
  }],
  ['recusa pasta de dados dentro de um repositório git', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    assert.equal(findGitRepo(path.join(repo, 'a', 'b')), repo);
    assert.throws(() => assertSafeDataRoot(path.join(repo, 'dados')), /repositório git/);
    assert.doesNotThrow(() => assertSafeDataRoot(path.join(tmp, 'livre')));
  }],
  ['escrita atômica grava JSON e não deixa .tmp', () => {
    const f = path.join(tmp, 'x', 'a.json');
    writeJsonAtomic(f, { ok: 1 });
    assert.deepEqual(readJson(f, null), { ok: 1 });
    assert.deepEqual(fs.readdirSync(path.dirname(f)), ['a.json']);
    assert.equal(readJson(path.join(tmp, 'nao-existe.json'), 'padrao'), 'padrao');
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`[PASS] ${name}`); } catch (err) { failed++; console.error(`[FAIL] ${name}\n`, err); }
}
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.error(`${failed} teste(s) de pastas falharam.`); process.exit(1); }
console.log(`${tests.length} testes de pastas passaram.`);
