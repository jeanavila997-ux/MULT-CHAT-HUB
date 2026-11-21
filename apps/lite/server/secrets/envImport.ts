// Move chaves do .env.local para o cofre. Ordem segura:
// 1) grava no cofre  2) lê de volta e confere  3) backup do .env.local
// 4) só então comenta as linhas conferidas. Falhou a conferência? Não mexe.
import fs from 'node:fs';
import { SecretStore } from './secretStore.js';

export interface EnvImportTarget { account: string; envKeys: string[] }
export interface EnvImportResult { imported: string[]; failed: string[]; skipped: string[]; backup: string | null }

function parseValue(raw: string): string {
  let v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.trim();
}

export async function importEnvSecrets(store: SecretStore, envFile: string, targets: EnvImportTarget[], now: () => Date = () => new Date()): Promise<EnvImportResult> {
  const result: EnvImportResult = { imported: [], failed: [], skipped: [], backup: null };
  if (!fs.existsSync(envFile)) return result;
  const original = fs.readFileSync(envFile, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);
  const toComment = new Set<number>();

  for (const t of targets) {
    for (const key of t.envKeys) {
      const idx = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
      if (idx < 0) continue;
      const value = parseValue(lines[idx].slice(lines[idx].indexOf('=') + 1));
      if (!value) { result.skipped.push(key); continue; }
      try {
        await store.set(t.account, value);
        const back = await store.get(t.account);
        if (back === value) { result.imported.push(key); toComment.add(idx); } else result.failed.push(key);
      } catch {
        result.failed.push(key);
      }
      break; // uma chave por conta
    }
  }

  if (toComment.size === 0) return result;
  const backup = `${envFile}.bak-${now().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '')}-cofre`;
  fs.copyFileSync(envFile, backup);
  result.backup = backup;
  const next = lines.map((l, i) => {
    if (!toComment.has(i)) return l;
    const key = l.split('=')[0].trim();
    return `# ${key} movida para o cofre do Windows (MultChatHub) em ${now().toISOString().slice(0, 10)}`;
  });
  fs.writeFileSync(envFile, next.join(eol), 'utf8');
  return result;
}
