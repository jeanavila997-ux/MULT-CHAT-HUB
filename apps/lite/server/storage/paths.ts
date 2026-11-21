// Pasta de dados do hub (agentes, config, lixeira). Fica FORA do repositório:
// não entra em commit, git clean nem pnpm clean.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function dataRoot(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const custom = env.MCH_DATA_ROOT?.trim();
  return custom ? path.resolve(custom) : path.join(home, 'MultChatHub');
}

/** Junta partes dentro de root; erro se o resultado sair de root (../, absoluto, etc.). */
export function safeJoin(root: string, ...parts: string[]): string {
  const base = path.resolve(root);
  for (const p of parts) {
    if (path.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) throw new Error(`Caminho fora da pasta permitida: ${p}`);
  }
  const full = path.resolve(base, ...parts);
  const rel = path.relative(base, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Caminho fora da pasta permitida.');
  return full;
}

/** Sobe a árvore procurando .git; devolve a raiz do repositório ou null. */
export function findGitRepo(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function assertSafeDataRoot(root: string): void {
  const repo = findGitRepo(root);
  if (repo) throw new Error(`MCH_DATA_ROOT não pode ficar dentro de um repositório git (${repo}).`);
}
