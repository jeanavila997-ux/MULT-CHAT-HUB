// Memória do agente.
// - Curta: memoria-curta/sessoes/AAAA-MM-DD.jsonl (últimas N mensagens, some após X dias).
// - Longa: memoria-longa/propostas/*.md (o agente propõe) e fatos/*.md (só o Jean aprova).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRegistry } from './registry.js';
import { safeJoin } from '../storage/paths.js';

export interface ShortMessage { ts: string; role: 'user' | 'assistant'; content: string }
export interface MemoryItem { id: string; content: string; source: string; createdAt: string; updatedAt?: string }

const ID_RE = /^[a-z0-9-]{6,60}$/;
const SESSION_RE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
const MAX_FACT = 2000;

function checkId(id: string) { if (!ID_RE.test(id)) throw new Error('Id de memória inválido.'); }

function toMd(item: MemoryItem, approved: boolean): string {
  const fm = [
    '---',
    `id: ${item.id}`,
    `fonte: ${JSON.stringify(item.source)}`,
    `criado: ${item.createdAt}`,
    ...(item.updatedAt ? [`atualizado: ${item.updatedAt}`] : []),
    ...(approved ? ['aprovado_por: jean'] : ['status: proposta']),
    '---',
  ];
  return `${fm.join('\n')}\n${item.content}\n`;
}

function fromMd(id: string, text: string): MemoryItem {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  let source = meta.fonte ?? '';
  try { source = JSON.parse(source); } catch { /* texto simples */ }
  return { id, content: (m?.[2] ?? text).trim(), source, createdAt: meta.criado ?? '', ...(meta.atualizado ? { updatedAt: meta.atualizado } : {}) };
}

export class AgentMemory {
  constructor(
    private readonly reg: AgentRegistry,
    private readonly now: () => Date = () => new Date(),
    private readonly opts: { shortLimit: number; shortDays: number } = { shortLimit: 200, shortDays: 14 },
  ) {}

  private dir(agentId: string, ...parts: string[]) {
    const d = safeJoin(this.reg.agentDir(agentId), ...parts);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  // ── Curta ──
  appendShort(agentId: string, role: 'user' | 'assistant', content: string): void {
    const file = path.join(this.dir(agentId, 'memoria-curta', 'sessoes'), `${this.now().toISOString().slice(0, 10)}.jsonl`);
    const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
    lines.push(JSON.stringify({ ts: this.now().toISOString(), role, content: content.slice(0, 8000) }));
    fs.writeFileSync(file, `${lines.slice(-this.opts.shortLimit).join('\n')}\n`, 'utf8');
  }

  private sessions(agentId: string): string[] {
    return fs.readdirSync(this.dir(agentId, 'memoria-curta', 'sessoes')).filter((f) => SESSION_RE.test(f)).sort();
  }

  shortSummary(agentId: string): { sessions: { id: string; count: number }[]; limit: number; days: number } {
    const d = this.dir(agentId, 'memoria-curta', 'sessoes');
    return {
      sessions: this.sessions(agentId).reverse().map((f) => ({ id: f.replace('.jsonl', ''), count: fs.readFileSync(path.join(d, f), 'utf8').split('\n').filter(Boolean).length })),
      limit: this.opts.shortLimit,
      days: this.opts.shortDays,
    };
  }

  recentShort(agentId: string, n: number): ShortMessage[] {
    const d = this.dir(agentId, 'memoria-curta', 'sessoes');
    const files = this.sessions(agentId);
    const last = files[files.length - 1];
    if (!last) return [];
    return fs.readFileSync(path.join(d, last), 'utf8').split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l) as ShortMessage);
  }

  purgeShort(agentId: string): number {
    const d = this.dir(agentId, 'memoria-curta', 'sessoes');
    const limit = this.now().getTime() - this.opts.shortDays * 86_400_000;
    let n = 0;
    for (const f of this.sessions(agentId)) {
      if (Date.parse(`${f.slice(0, 10)}T23:59:59Z`) < limit) { fs.rmSync(path.join(d, f), { force: true }); n++; }
    }
    return n;
  }

  clearShort(agentId: string): void {
    const d = this.dir(agentId, 'memoria-curta', 'sessoes');
    for (const f of this.sessions(agentId)) fs.rmSync(path.join(d, f), { force: true });
  }

  // ── Longa ──
  private list(agentId: string, kind: 'fatos' | 'propostas'): MemoryItem[] {
    const d = this.dir(agentId, 'memoria-longa', kind);
    return fs.readdirSync(d).filter((f) => f.endsWith('.md') && ID_RE.test(f.slice(0, -3)))
      .map((f) => fromMd(f.slice(0, -3), fs.readFileSync(path.join(d, f), 'utf8')))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listFacts(agentId: string) { return this.list(agentId, 'fatos'); }
  listProposals(agentId: string) { return this.list(agentId, 'propostas'); }

  private clean(content: string) {
    const c = (content ?? '').trim();
    if (!c) throw new Error('A memória não pode ficar vazia.');
    if (c.length > MAX_FACT) throw new Error('Cada memória pode ter até 2.000 caracteres.');
    return c;
  }

  propose(agentId: string, content: string, source: string): MemoryItem {
    const item: MemoryItem = { id: `${this.now().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}`, content: this.clean(content), source: (source || '').slice(0, 200), createdAt: this.now().toISOString() };
    fs.writeFileSync(path.join(this.dir(agentId, 'memoria-longa', 'propostas'), `${item.id}.md`), toMd(item, false), 'utf8');
    return item;
  }

  approve(agentId: string, proposalId: string, edited?: string): MemoryItem {
    checkId(proposalId);
    const src = path.join(this.dir(agentId, 'memoria-longa', 'propostas'), `${proposalId}.md`);
    if (!fs.existsSync(src)) throw new Error('Proposta não encontrada.');
    const p = fromMd(proposalId, fs.readFileSync(src, 'utf8'));
    const fact: MemoryItem = { ...p, content: this.clean(edited ?? p.content), updatedAt: this.now().toISOString() };
    fs.writeFileSync(path.join(this.dir(agentId, 'memoria-longa', 'fatos'), `${proposalId}.md`), toMd(fact, true), 'utf8');
    fs.rmSync(src, { force: true });
    return fact;
  }

  reject(agentId: string, proposalId: string): void {
    checkId(proposalId);
    fs.rmSync(path.join(this.dir(agentId, 'memoria-longa', 'propostas'), `${proposalId}.md`), { force: true });
  }

  updateFact(agentId: string, factId: string, content: string): MemoryItem {
    checkId(factId);
    const file = path.join(this.dir(agentId, 'memoria-longa', 'fatos'), `${factId}.md`);
    if (!fs.existsSync(file)) throw new Error('Fato não encontrado.');
    const f = { ...fromMd(factId, fs.readFileSync(file, 'utf8')), content: this.clean(content), updatedAt: this.now().toISOString() };
    fs.writeFileSync(file, toMd(f, true), 'utf8');
    return f;
  }

  deleteFact(agentId: string, factId: string): void {
    checkId(factId);
    fs.rmSync(path.join(this.dir(agentId, 'memoria-longa', 'fatos'), `${factId}.md`), { force: true });
  }

  /** Fatos aprovados para entrar no prompt (mais recentes primeiro, até maxChars). */
  promptBlock(agentId: string, maxChars = 4000): string {
    const lines: string[] = [];
    let used = 0;
    for (const f of this.listFacts(agentId)) {
      const line = `- ${f.content.replace(/\s+/g, ' ')}`;
      if (used + line.length > maxChars) break;
      lines.push(line); used += line.length;
    }
    return lines.length ? `## Memória longa (aprovada pelo Jean)\n${lines.join('\n')}` : '';
  }
}
