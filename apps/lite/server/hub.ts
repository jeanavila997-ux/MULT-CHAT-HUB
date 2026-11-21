// Serviços do hub: pasta de dados, registro de agentes, cofre de chaves e MCP.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRegistry } from './agents/registry.js';
import { AgentMemory } from './agents/memory.js';
import { McpManager } from './mcp/manager.js';
import type { McpClientLike } from './agent/mcpClient.js';
import { assertSafeDataRoot, dataRoot } from './storage/paths.js';
import { createKeyringBackend, SecretBackend, SecretStore } from './secrets/secretStore.js';
import { providerMeta } from './providers/catalog.js';

export interface Hub {
  root: string;
  registry: AgentRegistry;
  memory: AgentMemory;
  secrets: SecretStore;
  secretsAvailable: boolean;
  secretsError?: string;
  mcp: McpManager;
  envFile: string;
  env: NodeJS.ProcessEnv;
}

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class UnavailableBackend implements SecretBackend {
  constructor(private readonly why: string) {}
  async get() { return null; }
  async set() { throw new Error(`Cofre do Windows indisponível: ${this.why}`); }
  async delete() { throw new Error(`Cofre do Windows indisponível: ${this.why}`); }
}

export async function createHub(opts: { root?: string; env?: NodeJS.ProcessEnv; secretBackend?: SecretBackend; mcpFactory?: (cfg: unknown) => McpClientLike; envFile?: string } = {}): Promise<Hub> {
  const env = opts.env ?? process.env;
  const root = opts.root ?? dataRoot(env);
  assertSafeDataRoot(root);
  for (const d of ['agentes', 'skills', 'mcp', 'config', 'logs', 'lixeira', 'modelos', 'backups', 'memoria-compartilhada']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  const registry = new AgentRegistry(root);
  registry.seedDefaults();
  for (const a of registry.list()) { try { new AgentMemory(registry).purgeShort(a.id); } catch { /* agente sem pasta */ } }
  registry.purgeTrash(Number(env.MCH_TRASH_DAYS) > 0 ? Number(env.MCH_TRASH_DAYS) : 30);

  let backend = opts.secretBackend;
  let secretsError: string | undefined;
  if (!backend) {
    try {
      backend = await createKeyringBackend();
    } catch (err) {
      secretsError = err instanceof Error ? err.message.slice(0, 160) : String(err);
      backend = new UnavailableBackend(secretsError);
    }
  }
  return {
    root,
    registry,
    memory: new AgentMemory(registry),
    secrets: new SecretStore(backend, path.join(root, 'config', 'secrets-index.json')),
    secretsAvailable: !secretsError,
    ...(secretsError ? { secretsError } : {}),
    mcp: new McpManager(root, env, opts.mcpFactory as never),
    envFile: opts.envFile ?? path.join(APP_ROOT, '.env.local'),
    env,
  };
}

let hubPromise: Promise<Hub> | null = null;
export function getHub(): Promise<Hub> {
  if (!hubPromise) {
    hubPromise = createHub().catch((err) => { hubPromise = null; throw err; });
  }
  return hubPromise;
}

/** Chave do provedor: cofre primeiro, depois .env.local. Nunca vem do navegador. */
export async function providerKey(provider: string, envFallback: () => string): Promise<string> {
  const meta = providerMeta(provider);
  if (meta?.secretAccount) {
    try {
      const hub = await getHub();
      const v = await hub.secrets.get(meta.secretAccount);
      if (v) return v;
    } catch { /* sem hub: usa o .env */ }
  }
  return envFallback();
}
