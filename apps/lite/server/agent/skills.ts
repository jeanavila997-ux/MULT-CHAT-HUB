// Carregador de skills do agente local.
// Cada skill é uma pasta <dir>/<nome>/SKILL.md com frontmatter `name` e `description`.
// Só nome + descrição entram no system prompt; o corpo é carregado sob demanda
// pela ferramenta load_skill. Os arquivos são apenas lidos, nunca alterados.
import fs from 'fs';
import path from 'path';

export interface SkillMeta {
  name: string;
  description: string;
  dir: string;
  file: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_SKILL_BYTES = 64 * 1024;

export function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) data[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { data, body: m[2] };
}

// SKILLS_DIRS: lista separada por ';' (ou quebra de linha). Caminhos relativos
// partem de baseDir (apps/lite). Vazio = só a pasta 'skills' do app.
export function resolveSkillDirs(raw: string | undefined, baseDir: string): string[] {
  const parts = (raw && raw.trim() ? raw : 'skills')
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.map((p) => (path.isAbsolute(p) ? path.normalize(p) : path.resolve(baseDir, p)));
}

// Pastas posteriores ganham quando o nome da skill se repete.
export function listSkills(dirs: string[]): SkillMeta[] {
  const byName = new Map<string, SkillMeta>();
  for (const dir of dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // pasta ausente: ignora
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, 'SKILL.md');
      let raw: string;
      try {
        const st = fs.statSync(file);
        if (!st.isFile() || st.size > MAX_SKILL_BYTES) continue;
        raw = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const { data } = parseFrontmatter(raw);
      const name = (data.name || entry.name).trim();
      if (!NAME_RE.test(name)) continue;
      byName.set(name.toLowerCase(), { name, description: (data.description || '').slice(0, 300), dir, file });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadSkillBody(dirs: string[], name: unknown): { skill: SkillMeta; body: string } | null {
  if (typeof name !== 'string' || !NAME_RE.test(name.trim())) return null;
  const wanted = name.trim().toLowerCase();
  const skill = listSkills(dirs).find((s) => s.name.toLowerCase() === wanted);
  if (!skill) return null;
  const { body } = parseFrontmatter(fs.readFileSync(skill.file, 'utf8'));
  return { skill, body: body.trim() };
}
