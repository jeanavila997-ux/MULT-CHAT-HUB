// Grupos de agentes: CRUD, membros (entrar/sair/bloquear), moderador e convites.
// Executar: pnpm --filter @mch/lite exec tsx server/groups/groupStore.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRegistry } from '../agents/registry.js';
import { GroupStore, inviteLink } from './groupStore.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mch-grp-'));
let clock = Date.parse('2026-11-20T12:00:00Z');
const now = () => new Date(clock);
const reg = new AgentRegistry(tmp, now);
reg.seedDefaults();
const ids = reg.list().map((a) => a.id);
const [A, B, C] = ids;
const store = new GroupStore(tmp, reg, now);
let gid = '';

const tests: [string, () => void][] = [
  ['cria grupo com membros e moderador; recusa nome vazio e agente inexistente', () => {
    const g = store.create({ name: 'Time PC', members: [A, B], moderatorId: A });
    gid = g.id;
    assert.match(g.id, /^time-pc-[a-z0-9]{4}$/);
    assert.equal(g.members.length, 2);
    assert.equal(g.members.find((m) => m.agentId === A)?.role, 'moderador');
    assert.equal(g.maxRounds, 3);
    assert.throws(() => store.create({ name: ' ' }), /nome/i);
    assert.throws(() => store.create({ name: 'X', members: ['nao-existe'] }), /não encontrado/);
    assert.ok(fs.existsSync(path.join(tmp, 'grupos', g.id, 'grupo.json')));
  }],
  ['edita nome e limite de rodadas (1 a 6)', () => {
    assert.equal(store.update(gid, { name: 'Time do PC', maxRounds: 5 }).maxRounds, 5);
    assert.throws(() => store.update(gid, { maxRounds: 20 }), /1 e 6/);
  }],
  ['adicionar, sair, entrar, bloquear, desbloquear e remover', () => {
    store.addMember(gid, C);
    assert.equal(store.get(gid)!.members.length, 3);
    store.leave(gid, C);
    assert.equal(store.member(gid, C)?.status, 'saiu');
    store.join(gid, C);
    assert.equal(store.member(gid, C)?.status, 'ativo');
    store.block(gid, C);
    assert.equal(store.member(gid, C)?.status, 'bloqueado');
    assert.throws(() => store.join(gid, C), /bloqueado/);
    store.unblock(gid, C);
    assert.equal(store.member(gid, C)?.status, 'ativo');
    store.removeMember(gid, C);
    assert.equal(store.member(gid, C), undefined);
  }],
  ['moderador que sai ou é bloqueado deixa o grupo sem moderador', () => {
    store.leave(gid, A);
    assert.equal(store.get(gid)!.moderatorId, null);
    store.join(gid, A);
    store.setModerator(gid, A);
    assert.equal(store.get(gid)!.moderatorId, A);
    assert.throws(() => store.setModerator(gid, C), /não é membro/);
  }],
  ['convite: link curto, guarda só o hash, valida e expira', () => {
    const { invite, token } = store.createInvite(gid, { hours: 2 });
    assert.match(token, /^[a-z2-9]{10}$/);
    assert.equal(inviteLink(gid, token), `multchathub://grupo/${gid}?convite=${token}`);
    assert.equal(JSON.stringify(store.get(gid)).includes(token), false, 'token não fica salvo');
    assert.equal(store.checkInvite(gid, token).ok, true);
    assert.equal(store.checkInvite(gid, 'zzzzzzzzzz').ok, false);
    clock += 3 * 3600_000;
    const exp = store.checkInvite(gid, token);
    assert.equal(exp.ok, false);
    assert.match(exp.reason!, /expirou/);
    assert.ok(invite.expiresAt);
  }],
  ['convite de uso único some depois de aceito; revogado não vale', () => {
    store.addMember(gid, C); store.leave(gid, C);
    const { token } = store.createInvite(gid, { hours: 24, singleUse: true });
    const r = store.acceptInvite(gid, token, [C]);
    assert.deepEqual(r.joined, [C]);
    assert.equal(store.member(gid, C)?.status, 'ativo');
    assert.match(store.checkInvite(gid, token).reason!, /usado/);
    const { invite, token: t2 } = store.createInvite(gid, { hours: 24 });
    store.revokeInvite(gid, invite.id);
    assert.match(store.checkInvite(gid, t2).reason!, /revogado/);
  }],
  ['aceitar convite não desbloqueia agente bloqueado', () => {
    store.block(gid, C);
    const { token } = store.createInvite(gid, { hours: 24 });
    const r = store.acceptInvite(gid, token, [C]);
    assert.deepEqual(r.joined, []);
    assert.match(r.refused[0].reason, /bloqueado/);
    assert.equal(store.member(gid, C)?.status, 'bloqueado');
  }],
  ['mensagens do grupo ficam no histórico; excluir manda para a lixeira', () => {
    store.appendMessage(gid, { from: 'jean', text: 'oi @todos' });
    assert.equal(store.messages(gid).at(-1)!.text, 'oi @todos');
    store.remove(gid);
    assert.equal(store.get(gid), null);
    assert.ok(fs.readdirSync(path.join(tmp, 'lixeira')).some((d) => d.startsWith('grupo-')));
    assert.throws(() => store.update('../x', { name: 'y' }), /inválid/);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`[PASS] ${name}`); } catch (err) { failed++; console.error(`[FAIL] ${name}\n`, err); }
}
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.error(`${failed} teste(s) de grupos falharam.`); process.exit(1); }
console.log(`${tests.length} testes de grupos passaram.`);
