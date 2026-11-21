// Registro de agentes no disco (<root>/agentes/<id>/agent.json).
// Nada é apagado de verdade na exclusão: vai para <root>/lixeira e some só
// depois de N dias (padrão 30).
import fs from 'node:fs';
import path from 'node:path';
import { safeJoin } from '../storage/paths.js';
import { readJson, writeJsonAtomic } from '../storage/atomic.js';
import { AGENT_SUBDIRS, AgentInput, AgentV2, DEFAULT_AGENT_SEEDS, slugify, validateAgentInput } from './model.js';

const HISTORY_LIMIT = 20;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const HIST_RE = /^\d{8}T\d{6}Z?-v\d+\.json$/;
const TRASH_RE = /^\d{8}T\d{6}Z?-[a-z0-9][a-z0-9-]{0,60}$/;

export interface HistoryEntry { file: string; version: number; savedAt: string; systemPrompt: string }
export interface TrashEntry { trashId: string; id: string; name: string; deletedAt: string }
export interface AgentExport { format: 'mch-agent@1'; exportedAt: string; agent: AgentV2 }

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

export class AgentRegistry {
  constructor(readonly root: string, private readonly now: () => Date = () => new Date()) {}

  private agentsDir() { return safeJoin(this.root, 'agentes'); }
  private trashDir() { return safeJoin(this.root, 'lixeira'); }
  private dirOf(id: string) {
    if (!ID_RE.test(id)) throw new Error(`Id de agente inválido: ${id}`);
    return safeJoin(this.agentsDir(), id);
  }
  private fileOf(id: string) { return path.join(this.dirOf(id), 'agent.json'); }

  list(): AgentV2[] {
    if (!fs.existsSync(this.agentsDir())) return [];
    return fs.readdirSync(this.agentsDir(), { withFileTypes: true })
      .filter((d) => d.isDirectory() && ID_RE.test(d.name))
      .map((d) => readJson<AgentV2 | null>(path.join(this.agentsDir(), d.name, 'agent.json'), null))
      .filter((a): a is AgentV2 => !!a && typeof a.id === 'string')
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name, 'pt-BR'));
  }

  get(id: string): AgentV2 | null {
    if (!ID_RE.test(id)) return null;
    return readJson<AgentV2 | null>(this.fileOf(id), null);
  }

  private uniqueId(wanted: string): string {
    let id = wanted;
    for (let n = 2; fs.existsSync(this.dirOf(id)); n++) id = `${wanted}-${n}`.slice(0, 60);
    return id;
  }

  private build(id: string, input: AgentInput, builtin: boolean): AgentV2 {
    const ts = this.now().toISOString();
    return {
      id,
      name: input.name!.trim(),
      description: input.description ?? '',
      avatar: input.avatar || input.name!.trim().slice(0, 2).toUpperCase(),
      color: input.color ?? '#475569',
      section: input.section ?? 'Principais',
      role: input.role ?? 'especialista',
      provider: input.provider ?? 'ollama',
      model: input.model ?? '',
      systemPrompt: input.systemPrompt ?? '',
      temperature: input.temperature ?? 0.4,
      skills: input.skills ?? [],
      tools: input.tools ?? { enabled: true, mcp: {} },
      hidden: input.hidden ?? false,
      pinned: input.pinned ?? false,
      builtin,
      version: 1,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  private materialize(agent: AgentV2): AgentV2 {
    const dir = this.dirOf(agent.id);
    for (const sub of AGENT_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    writeJsonAtomic(path.join(dir, 'agent.json'), agent);
    return agent;
  }

  create(input: AgentInput, opts: { id?: string; builtin?: boolean } = {}): AgentV2 {
    const { errors } = validateAgentInput(input);
    if (errors.length) throw new Error(errors.join(' '));
    const id = this.uniqueId(opts.id ?? slugify(input.name!));
    return this.materialize(this.build(id, input, !!opts.builtin));
  }

  update(id: string, patch: AgentInput): AgentV2 {
    const current = this.get(id);
    if (!current) throw new Error(`Agente não encontrado: ${id}`);
    const clean: AgentInput = { ...patch };
    for (const k of ['id', 'version', 'createdAt', 'updatedAt', 'builtin'] as const) delete (clean as Record<string, unknown>)[k];
    const merged = { ...current, ...clean };
    const { errors } = validateAgentInput(merged);
    if (errors.length) throw new Error(errors.join(' '));
    const histDir = path.join(this.dirOf(id), 'historico');
    fs.mkdirSync(histDir, { recursive: true });
    writeJsonAtomic(path.join(histDir, `${stamp(this.now())}-v${current.version}.json`), current);
    const old = fs.readdirSync(histDir).sort();
    for (const f of old.slice(0, Math.max(0, old.length - HISTORY_LIMIT))) fs.rmSync(path.join(histDir, f), { force: true });
    const next: AgentV2 = { ...merged, id, builtin: current.builtin, createdAt: current.createdAt, version: current.version + 1, updatedAt: this.now().toISOString() };
    writeJsonAtomic(this.fileOf(id), next);
    return next;
  }

  /** Versões anteriores (mais recente primeiro). */
  history(id: string): HistoryEntry[] {
    if (!this.get(id)) throw new Error(`Agente não encontrado: ${id}`);
    const dir = path.join(this.dirOf(id), 'historico');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => HIST_RE.test(f)).sort().reverse()
      .map((file) => {
        const a = readJson<AgentV2 | null>(path.join(dir, file), null);
        return a ? { file, version: a.version, savedAt: a.updatedAt, systemPrompt: a.systemPrompt } : null;
      })
      .filter((e): e is HistoryEntry => !!e);
  }

  /** Desfazer: volta o system prompt de uma versão anterior (a atual vai para o histórico). */
  restoreVersion(id: string, file: string): AgentV2 {
    if (!HIST_RE.test(file)) throw new Error('Versão inválida.');
    const old = readJson<AgentV2 | null>(safeJoin(this.dirOf(id), 'historico', file), null);
    if (!old) throw new Error('Versão não encontrada.');
    return this.update(id, { systemPrompt: old.systemPrompt });
  }

  defaultPrompt(id: string): string | null {
    const a = this.get(id);
    if (!a?.builtin) return null;
    return DEFAULT_AGENT_SEEDS.find((s) => s.id === id)?.systemPrompt ?? null;
  }

  restoreDefaultPrompt(id: string): AgentV2 {
    const p = this.defaultPrompt(id);
    if (p === null) throw new Error('Este agente não tem prompt padrão (só os agentes padrão têm).');
    return this.update(id, { systemPrompt: p });
  }

  /** seguranca/instrucoes.md: só leitura aqui; edição com senha chega na fase 5. */
  securityInstructions(id: string): string {
    try { return fs.readFileSync(path.join(this.dirOf(id), 'seguranca', 'instrucoes.md'), 'utf8').slice(0, 20_000).trim(); }
    catch { return ''; }
  }

  /** Copia ficha e skills próprias. Não copia memória, segurança nem histórico. */
  duplicate(id: string): AgentV2 {
    const src = this.get(id);
    if (!src) throw new Error(`Agente não encontrado: ${id}`);
    const copy = this.create({ ...src, name: `${src.name} (cópia)`.slice(0, 60), pinned: false }, { id: this.uniqueId(`${id}-copia`) });
    const skillsSrc = path.join(this.dirOf(id), 'skills');
    if (fs.existsSync(skillsSrc)) fs.cpSync(skillsSrc, path.join(this.dirOf(copy.id), 'skills'), { recursive: true });
    return copy;
  }

  remove(id: string): TrashEntry {
    const agent = this.get(id);
    if (!agent) throw new Error(`Agente não encontrado: ${id}`);
    fs.mkdirSync(this.trashDir(), { recursive: true });
    const deletedAt = this.now().toISOString();
    const trashId = `${stamp(this.now())}-${id}`;
    const dest = safeJoin(this.trashDir(), trashId);
    fs.renameSync(this.dirOf(id), dest);
    const entry: TrashEntry = { trashId, id, name: agent.name, deletedAt };
    writeJsonAtomic(path.join(dest, 'lixeira.json'), entry);
    return entry;
  }

  listTrash(): TrashEntry[] {
    if (!fs.existsSync(this.trashDir())) return [];
    return fs.readdirSync(this.trashDir())
      .filter((n) => TRASH_RE.test(n))
      .map((n) => readJson<TrashEntry | null>(path.join(this.trashDir(), n, 'lixeira.json'), null))
      .filter((e): e is TrashEntry => !!e)
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  restore(trashId: string): AgentV2 {
    if (!TRASH_RE.test(trashId)) throw new Error('Item da lixeira inválido.');
    const src = safeJoin(this.trashDir(), trashId);
    const entry = readJson<TrashEntry | null>(path.join(src, 'lixeira.json'), null);
    if (!entry) throw new Error('Item da lixeira não encontrado.');
    const id = this.uniqueId(entry.id);
    fs.rmSync(path.join(src, 'lixeira.json'), { force: true });
    fs.renameSync(src, this.dirOf(id));
    // Se já existe outro agente com o mesmo id, volta com sufixo (-2, -3…).
    return id !== entry.id ? this.reId(id) : this.get(id)!;
  }

  private reId(id: string): AgentV2 {
    const a = readJson<AgentV2>(this.fileOf(id), null as unknown as AgentV2);
    const fixed = { ...a, id };
    writeJsonAtomic(this.fileOf(id), fixed);
    return fixed;
  }

  /** Apaga da lixeira o que foi excluído há mais de `days` dias. Devolve quantos. */
  purgeTrash(days = 30): number {
    const limit = this.now().getTime() - days * 86_400_000;
    let n = 0;
    for (const e of this.listTrash()) {
      if (Date.parse(e.deletedAt) < limit) {
        fs.rmSync(safeJoin(this.trashDir(), e.trashId), { recursive: true, force: true });
        n++;
      }
    }
    return n;
  }

  /** Só cria os padrões quando ainda não há nenhum agente. */
  seedDefaults(): AgentV2[] {
    if (this.list().length > 0) return [];
    return DEFAULT_AGENT_SEEDS.map(({ id, ...seed }) => this.create(seed, { id, builtin: true }));
  }

  /** Recria os padrões que faltam (não mexe nos existentes). */
  restoreDefaults(): AgentV2[] {
    return DEFAULT_AGENT_SEEDS
      .filter((s) => !this.get(s.id))
      .map(({ id, ...seed }) => this.create(seed, { id, builtin: true }));
  }

  exportAgent(id: string): AgentExport {
    const agent = this.get(id);
    if (!agent) throw new Error(`Agente não encontrado: ${id}`);
    return { format: 'mch-agent@1', exportedAt: this.now().toISOString(), agent };
  }

  importAgent(data: AgentExport): AgentV2 {
    if (!data || data.format !== 'mch-agent@1' || !data.agent) throw new Error('Formato de arquivo não reconhecido (esperado mch-agent@1).');
    const { id, version, createdAt, updatedAt, builtin, ...input } = data.agent;
    void version; void createdAt; void updatedAt; void builtin;
    // Ferramentas MCP importadas chegam desligadas: o Jean revê antes de ligar.
    const tools = input.tools ? { enabled: input.tools.enabled, mcp: Object.fromEntries(Object.entries(input.tools.mcp ?? {}).map(([k, v]) => [k, { ...v, enabled: false }])) } : undefined;
    return this.create({ ...input, tools }, { id: this.uniqueId(ID_RE.test(id) ? id : slugify(input.name ?? '')) });
  }
}
