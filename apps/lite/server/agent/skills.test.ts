// Testes do carregador de skills
// Executar: pnpm --filter @mch/lite exec tsx server/agent/skills.test.ts
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSkills, loadSkillBody, parseFrontmatter, resolveSkillDirs } from './skills.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mch-skills-'));
const dirApp = path.join(root, 'app');
const dirJean = path.join(root, 'jean');

function writeSkill(dir: string, folder: string, content: string) {
  fs.mkdirSync(path.join(dir, folder), { recursive: true });
  fs.writeFileSync(path.join(dir, folder, 'SKILL.md'), content, 'utf8');
}

writeSkill(dirApp, 'diagnostico-pc', '---\nname: diagnostico-pc\ndescription: Checa a saúde do PC.\n---\n# Corpo A\nPasso 1');
writeSkill(dirApp, 'codigo', '---\nname: codigo\ndescription: versão do app\n---\ncorpo do app');
writeSkill(dirJean, 'codigo', '\uFEFF---\r\nname: codigo\r\ndescription: "versão do Jean"\r\n---\r\ncorpo do Jean\r\n');
writeSkill(dirJean, 'sem-frontmatter', 'Só texto');
writeSkill(dirJean, 'invalida', '---\nname: ../fora\ndescription: x\n---\n');
fs.mkdirSync(path.join(dirJean, 'vazia'));
fs.writeFileSync(path.join(dirJean, 'README.md'), '# não é skill');

const tests: [string, () => void][] = [
  ['lista skills das duas pastas e a última pasta ganha no nome repetido', () => {
    const skills = listSkills([dirApp, dirJean, path.join(root, 'nao-existe')]);
    assert.deepEqual(skills.map((s) => s.name), ['codigo', 'diagnostico-pc', 'sem-frontmatter']);
    const codigo = skills.find((s) => s.name === 'codigo')!;
    assert.equal(codigo.description, 'versão do Jean');
    assert.equal(codigo.dir, dirJean);
  }],
  ['load_skill devolve o corpo sem frontmatter', () => {
    const loaded = loadSkillBody([dirApp, dirJean], 'codigo');
    assert.equal(loaded?.body, 'corpo do Jean');
    assert.equal(loadSkillBody([dirApp], 'diagnostico-pc')?.body, '# Corpo A\nPasso 1');
  }],
  ['nomes inválidos ou inexistentes não carregam nada', () => {
    assert.equal(loadSkillBody([dirApp, dirJean], '../fora'), null);
    assert.equal(loadSkillBody([dirApp, dirJean], 'nao-tem'), null);
    assert.equal(loadSkillBody([dirApp, dirJean], 42), null);
  }],
  ['frontmatter com CRLF e BOM é lido', () => {
    const { data, body } = parseFrontmatter('\uFEFF---\r\nname: x\r\ndescription: y\r\n---\r\nz');
    assert.deepEqual(data, { name: 'x', description: 'y' });
    assert.equal(body, 'z');
  }],
  ['SKILLS_DIRS resolve relativos a partir do app e aceita absolutos', () => {
    const base = path.join(root, 'base');
    assert.deepEqual(resolveSkillDirs(undefined, base), [path.join(base, 'skills')]);
    assert.deepEqual(resolveSkillDirs(` skills ; ${dirJean} `, base), [path.join(base, 'skills'), path.normalize(dirJean)]);
  }],
];

console.log('\n=== Skills Loader Tests ===');
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.error(`[FAIL] ${name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
fs.rmSync(root, { recursive: true, force: true });
