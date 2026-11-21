// Cofre de chaves. No Windows: Gerenciador de Credenciais (via @napi-rs/keyring,
// serviço "MultChatHub"). O índice em config/secrets-index.json guarda só
// conta, 4 últimos dígitos e data — nunca o valor.
import { readJson, writeJsonAtomic } from '../storage/atomic.js';

export interface SecretBackend {
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
}

export class MemorySecretBackend implements SecretBackend {
  private m = new Map<string, string>();
  async get(a: string) { return this.m.get(a) ?? null; }
  async set(a: string, v: string) { this.m.set(a, v); }
  async delete(a: string) { this.m.delete(a); }
}

export const KEYRING_SERVICE = 'MultChatHub';

/** Gerenciador de Credenciais do Windows (ou Keychain/Secret Service). Carregado sob demanda. */
export async function createKeyringBackend(): Promise<SecretBackend> {
  const mod = await import('@napi-rs/keyring');
  const Entry = mod.Entry;
  return {
    async get(a) { try { return new Entry(KEYRING_SERVICE, a).getPassword() ?? null; } catch { return null; } },
    async set(a, v) { new Entry(KEYRING_SERVICE, a).setPassword(v); },
    async delete(a) { try { new Entry(KEYRING_SERVICE, a).deletePassword(); } catch { /* já não existia */ } },
  };
}

export interface SecretInfo { account: string; last4: string; updatedAt: string }
const ACCOUNT_RE = /^(provider|tool):[a-z0-9_]{1,40}$/;

export class SecretStore {
  constructor(private readonly backend: SecretBackend, private readonly indexFile: string) {}

  private index(): Record<string, SecretInfo> { return readJson(this.indexFile, {} as Record<string, SecretInfo>); }

  info(account: string): SecretInfo | null { return this.index()[account] ?? null; }

  async get(account: string): Promise<string | null> {
    if (!ACCOUNT_RE.test(account)) return null;
    return this.backend.get(account);
  }

  async set(account: string, value: string): Promise<void> {
    if (!ACCOUNT_RE.test(account)) throw new Error('Conta de cofre inválida.');
    const v = (value ?? '').trim();
    if (!v) throw new Error('A chave não pode ficar vazia.');
    if (/[\r\n]/.test(v)) throw new Error('A chave não pode ter quebra de linha.');
    if (v.length > 4096) throw new Error('Chave longa demais.');
    await this.backend.set(account, v);
    const idx = this.index();
    idx[account] = { account, last4: v.slice(-4), updatedAt: new Date().toISOString() };
    writeJsonAtomic(this.indexFile, idx);
  }

  async delete(account: string): Promise<void> {
    if (!ACCOUNT_RE.test(account)) throw new Error('Conta de cofre inválida.');
    await this.backend.delete(account);
    const idx = this.index();
    delete idx[account];
    writeJsonAtomic(this.indexFile, idx);
  }

  /** Cofre primeiro, depois variáveis de ambiente (compatibilidade com o .env.local). */
  async resolve(account: string | undefined, envKeys: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ value: string; source: 'cofre' | 'env' | null }> {
    if (account) {
      const v = await this.get(account);
      if (v) return { value: v, source: 'cofre' };
    }
    for (const k of envKeys) {
      const v = env[k]?.trim();
      if (v) return { value: v, source: 'env' };
    }
    return { value: '', source: null };
  }
}
