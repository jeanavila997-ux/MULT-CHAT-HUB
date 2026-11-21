// Grupos de agentes, guardados em <root>/grupos/<id>/grupo.json (+ mensagens.jsonl).
// Modelo inspirado no A2A (cartão do agente, mensagens com remetente) e no
// GroupChat do AutoGen (moderador escolhe a vez, limite de rodadas).
// Convites: token curto aleatório; só o hash SHA-256 fica salvo.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRegistry } from '../agents/registry.js';
import { slugify } from '../agents/model.js';
import { readJson, writeJsonAtomic } from '../storage/atomic.js';
import { safeJoin } from '../storage/paths.js';

export type MemberStatus = 'ativo' | 'saiu' | 'bloqueado';
export interface GroupMember { agentId: string; role: 'moderador' | 'membro'; status: MemberStatus; since: string }
export interface GroupInvite { id: string; tokenHash: string; hint: string; createdAt: string; expiresAt: string; singleUse: boolean; uses: number; revoked: boolean; agentId?: string }
export interface Group {
  id: string; name: string; description: string; avatar: string;
  moderatorId: string | null; maxRounds: number;
  members: GroupMember[]; invites: GroupInvite[];
  createdAt: string; updatedAt: string;
}
export interface GroupMessage { id: string; ts: string; from: string; text: string; round?: number; kind?: 'mensagem' | 'sistema' | 'erro' }
export type GroupInput = Partial<Pick<Group, 'name' | 'description' | 'avatar' | 'maxRounds' | 'moderatorId'>> & { members?: string[] };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const MAX_MESSAGES = 500;

export function inviteLink(groupId: string, token: string): string {
  return `multchathub://grupo/${groupId}?convite=${token}`;
}
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
function newToken(len = 10): string {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('');
}

export class GroupStore {
  constructor(private readonly root: string, private readonly reg: AgentRegistry, private readonly now: () => Date = () => new Date()) {}

  private base() { const d = safeJoin(this.root, 'grupos'); fs.mkdirSync(d, { recursive: true }); return d; }
  private dir(id: string) {
    if (!ID_RE.test(id)) throw new Error('Id de grupo inválido.');
    return safeJoin(this.base(), id);
  }
  private file(id: string) { return path.join(this.dir(id), 'grupo.json'); }
  private iso() { return this.now().toISOString(); }

  list(): Group[] {
    return fs.readdirSync(this.base()).filter((n) => ID_RE.test(n))
      .map((n) => readJson<Group | null>(path.join(this.base(), n, 'grupo.json'), null))
      .filter((g): g is Group => !!g)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  get(id: string): Group | null {
    if (!ID_RE.test(id)) return null;
    return readJson<Group | null>(this.file(id), null);
  }

  private must(id: string): Group {
    const g = this.get(id);
    if (!g) {
      if (!ID_RE.test(id)) throw new Error('Id de grupo inválido.');
      throw new Error(`Grupo não encontrado: ${id}`);
    }
    return g;
  }

  private save(g: Group): Group {
    g.updatedAt = this.iso();
    writeJsonAtomic(this.file(g.id), g);
    return g;
  }

  private checkAgent(agentId: string) {
    if (!this.reg.get(agentId)) throw new Error(`Agente não encontrado: ${agentId}`);
  }

  private clean(input: GroupInput, g?: Group) {
    const name = input.name !== undefined ? input.name.trim() : g?.name ?? '';
    if (!name) throw new Error('O grupo precisa de um nome.');
    if (name.length > 60) throw new Error('Nome do grupo: até 60 caracteres.');
    const maxRounds = input.maxRounds ?? g?.maxRounds ?? 3;
    if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 6) throw new Error('Rodadas por mensagem: entre 1 e 6.');
    return {
      name,
      description: (input.description ?? g?.description ?? '').slice(0, 300),
      avatar: (input.avatar ?? g?.avatar ?? '👥').slice(0, 8),
      maxRounds,
    };
  }

  create(input: GroupInput): Group {
    const base = this.clean(input);
    const members = [...new Set(input.members ?? [])];
    members.forEach((m) => this.checkAgent(m));
    let id = '';
    do { id = `${slugify(base.name).slice(0, 40) || 'grupo'}-${crypto.randomBytes(2).toString('hex')}`; } while (fs.existsSync(this.dir(id)));
    const t = this.iso();
    const g: Group = {
      id, ...base, moderatorId: null, invites: [], createdAt: t, updatedAt: t,
      members: members.map((agentId) => ({ agentId, role: 'membro', status: 'ativo', since: t })),
    };
    fs.mkdirSync(this.dir(id), { recursive: true });
    this.save(g);
    if (input.moderatorId) return this.setModerator(id, input.moderatorId);
    return g;
  }

  update(id: string, input: GroupInput): Group {
    const g = this.must(id);
    Object.assign(g, this.clean(input, g));
    this.save(g);
    if (input.moderatorId !== undefined) return input.moderatorId ? this.setModerator(id, input.moderatorId) : this.clearModerator(id);
    return g;
  }

  remove(id: string): void {
    const g = this.must(id);
    const trash = safeJoin(this.root, 'lixeira');
    fs.mkdirSync(trash, { recursive: true });
    const stamp = this.iso().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const dest = safeJoin(trash, `grupo-${stamp}-${g.id}`);
    fs.renameSync(this.dir(id), dest);
    writeJsonAtomic(path.join(dest, 'lixeira.json'), { kind: 'grupo', id: g.id, name: g.name, deletedAt: this.iso() });
  }

  member(id: string, agentId: string): GroupMember | undefined {
    return this.must(id).members.find((m) => m.agentId === agentId);
  }

  private withMember(id: string, agentId: string, fn: (g: Group, m: GroupMember) => void): Group {
    const g = this.must(id);
    const m = g.members.find((x) => x.agentId === agentId);
    if (!m) throw new Error(`${agentId} não é membro do grupo.`);
    fn(g, m);
    return this.save(g);
  }

  addMember(id: string, agentId: string): Group {
    this.checkAgent(agentId);
    const g = this.must(id);
    if (g.members.some((m) => m.agentId === agentId)) return g;
    g.members.push({ agentId, role: 'membro', status: 'ativo', since: this.iso() });
    return this.save(g);
  }

  removeMember(id: string, agentId: string): Group {
    const g = this.must(id);
    g.members = g.members.filter((m) => m.agentId !== agentId);
    if (g.moderatorId === agentId) g.moderatorId = null;
    return this.save(g);
  }

  private dropModerator(g: Group, m: GroupMember) {
    if (g.moderatorId === m.agentId) { g.moderatorId = null; m.role = 'membro'; }
  }

  join(id: string, agentId: string): Group {
    return this.withMember(id, agentId, (_g, m) => {
      if (m.status === 'bloqueado') throw new Error(`${agentId} está bloqueado neste grupo. Desbloqueie antes.`);
      m.status = 'ativo'; m.since = this.iso();
    });
  }

  leave(id: string, agentId: string): Group {
    return this.withMember(id, agentId, (g, m) => { this.dropModerator(g, m); if (m.status !== 'bloqueado') m.status = 'saiu'; m.since = this.iso(); });
  }

  block(id: string, agentId: string): Group {
    return this.withMember(id, agentId, (g, m) => { this.dropModerator(g, m); m.status = 'bloqueado'; m.since = this.iso(); });
  }

  unblock(id: string, agentId: string): Group {
    return this.withMember(id, agentId, (_g, m) => { if (m.status === 'bloqueado') { m.status = 'ativo'; m.since = this.iso(); } });
  }

  setModerator(id: string, agentId: string): Group {
    return this.withMember(id, agentId, (g, m) => {
      if (m.status !== 'ativo') throw new Error('Só um membro ativo pode ser moderador.');
      for (const x of g.members) x.role = 'membro';
      m.role = 'moderador';
      g.moderatorId = agentId;
    });
  }

  clearModerator(id: string): Group {
    const g = this.must(id);
    for (const x of g.members) x.role = 'membro';
    g.moderatorId = null;
    return this.save(g);
  }

  // ── Convites ──
  createInvite(id: string, opts: { hours?: number; singleUse?: boolean; agentId?: string } = {}): { invite: GroupInvite; token: string; link: string } {
    const g = this.must(id);
    const hours = opts.hours ?? 24;
    if (!(hours >= 1 && hours <= 720)) throw new Error('Validade do convite: de 1 hora a 30 dias.');
    if (opts.agentId) this.checkAgent(opts.agentId);
    const token = newToken();
    const t = this.now();
    const invite: GroupInvite = {
      id: crypto.randomBytes(4).toString('hex'), tokenHash: hash(token), hint: token.slice(-3),
      createdAt: t.toISOString(), expiresAt: new Date(t.getTime() + hours * 3600_000).toISOString(),
      singleUse: !!opts.singleUse, uses: 0, revoked: false, ...(opts.agentId ? { agentId: opts.agentId } : {}),
    };
    g.invites = [...g.invites.filter((i) => !i.revoked && Date.parse(i.expiresAt) > t.getTime() - 7 * 86_400_000), invite].slice(-20);
    this.save(g);
    return { invite, token, link: inviteLink(id, token) };
  }

  revokeInvite(id: string, inviteId: string): Group {
    const g = this.must(id);
    const inv = g.invites.find((i) => i.id === inviteId);
    if (!inv) throw new Error('Convite não encontrado.');
    inv.revoked = true;
    return this.save(g);
  }

  checkInvite(id: string, token: string): { ok: boolean; reason?: string; group?: Pick<Group, 'id' | 'name' | 'description' | 'avatar'>; invite?: GroupInvite } {
    const g = this.get(id);
    if (!g) return { ok: false, reason: 'Grupo não existe (pode ter sido excluído).' };
    const group = { id: g.id, name: g.name, description: g.description, avatar: g.avatar };
    const h = hash(String(token ?? ''));
    const inv = g.invites.find((i) => i.tokenHash.length === h.length && crypto.timingSafeEqual(Buffer.from(i.tokenHash), Buffer.from(h)));
    if (!inv) return { ok: false, reason: 'Convite inválido.', group };
    if (inv.revoked) return { ok: false, reason: 'Convite revogado.', group, invite: inv };
    if (inv.singleUse && inv.uses > 0) return { ok: false, reason: 'Convite de uso único já foi usado.', group, invite: inv };
    if (Date.parse(inv.expiresAt) <= this.now().getTime()) return { ok: false, reason: 'Convite expirou.', group, invite: inv };
    return { ok: true, group, invite: inv };
  }

  acceptInvite(id: string, token: string, agentIds: string[]): { joined: string[]; refused: { agentId: string; reason: string }[] } {
    const check = this.checkInvite(id, token);
    if (!check.ok || !check.invite) throw new Error(check.reason ?? 'Convite inválido.');
    const wanted = check.invite.agentId ? [check.invite.agentId] : [...new Set(agentIds)];
    if (!wanted.length) throw new Error('Escolha pelo menos um agente para entrar.');
    const joined: string[] = [];
    const refused: { agentId: string; reason: string }[] = [];
    for (const a of wanted) {
      try {
        if (!this.member(id, a)) this.addMember(id, a);
        else this.join(id, a);
        joined.push(a);
      } catch (err) { refused.push({ agentId: a, reason: err instanceof Error ? err.message : String(err) }); }
    }
    if (joined.length) {
      const g = this.must(id);
      const inv = g.invites.find((i) => i.id === check.invite!.id);
      if (inv) inv.uses += 1;
      this.save(g);
    }
    return { joined, refused };
  }

  // ── Mensagens ──
  private msgFile(id: string) { return path.join(this.dir(id), 'mensagens.jsonl'); }

  appendMessage(id: string, msg: Omit<GroupMessage, 'id' | 'ts'>): GroupMessage {
    this.must(id);
    const full: GroupMessage = { id: crypto.randomBytes(5).toString('hex'), ts: this.iso(), ...msg, text: msg.text.slice(0, 12_000) };
    const lines = fs.existsSync(this.msgFile(id)) ? fs.readFileSync(this.msgFile(id), 'utf8').split('\n').filter(Boolean) : [];
    lines.push(JSON.stringify(full));
    fs.writeFileSync(this.msgFile(id), `${lines.slice(-MAX_MESSAGES).join('\n')}\n`, 'utf8');
    return full;
  }

  messages(id: string, n = 200): GroupMessage[] {
    this.must(id);
    if (!fs.existsSync(this.msgFile(id))) return [];
    return fs.readFileSync(this.msgFile(id), 'utf8').split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l) as GroupMessage);
  }

  clearMessages(id: string): void {
    this.must(id);
    fs.rmSync(this.msgFile(id), { force: true });
  }
}
