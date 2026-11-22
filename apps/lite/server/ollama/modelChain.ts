// Cadeia de modelos Ollama: uso 1 (padrão) + sequência se o atual falhar.
// Tarefa com modelo próprio começa nele e só então segue a cadeia.
import { isPaidOllamaModel } from '../../src/lib/paid.js';

export const DEFAULT_USO1 = 'qwen3:4b';
export const DEFAULT_CHAIN = [
  'qwen3:4b',
  'qwen2.5-coder:3b-instruct',
  'kimi-k3:cloud',
  'deepseek-v4-pro:cloud',
] as const;

export interface ModelChainConfig {
  uso1: string;
  chain: string[];
  allowPaidFallback: boolean;
}

export function normalizeName(name: unknown): string {
  return typeof name === 'string' ? name.trim() : '';
}

export function normalizeChain(input: Partial<ModelChainConfig> | null | undefined): ModelChainConfig {
  const uso1 = normalizeName(input?.uso1) || DEFAULT_USO1;
  const raw = Array.isArray(input?.chain) ? input!.chain.map(normalizeName).filter(Boolean) : [...DEFAULT_CHAIN];
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const name of [uso1, ...raw]) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    chain.push(name);
  }
  return {
    uso1,
    chain,
    allowPaidFallback: input?.allowPaidFallback !== false,
  };
}

/** Monta a ordem de tentativa. requested = modelo da tarefa/cabeçalho (fora do uso 1). */
export function resolveSequence(opts: {
  requested?: string;
  uso1: string;
  chain: string[];
  allowPaidFallback: boolean;
  confirmPaid?: boolean;
  isPaid?: (name: string) => boolean;
}): string[] {
  const cfg = normalizeChain(opts);
  const isPaid = opts.isPaid ?? isPaidOllamaModel;
  const requested = normalizeName(opts.requested);
  const allowPaid = opts.allowPaidFallback !== false && (opts.confirmPaid === true || cfg.allowPaidFallback);
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const n = normalizeName(name);
    if (!n) return;
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    if (isPaid(n) && !allowPaid && key !== requested.toLowerCase()) return;
    seen.add(key);
    ordered.push(n);
  };
  if (requested) push(requested);
  else push(cfg.uso1);
  for (const name of cfg.chain) push(name);
  if (!ordered.length) push(cfg.uso1);
  return ordered;
}

export function shouldFailover(err: unknown): boolean {
  if (err == null) return false;
  const name = err instanceof Error ? err.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/402|needs paid|confirm/i.test(msg) && /paid|custo|assinatura/.test(msg)) return false;
  return /not found|no such model|does not exist|file does not exist|econnrefused|enotfound|fetch failed|socket|unavailable|timeout|timed out|abort|status 404|status 500|status 502|status 503|ollama 404|ollama 500|ollama 502|ollama 503/.test(msg);
}

export async function runWithFallback<T>(
  models: string[],
  run: (model: string) => Promise<T>,
  isFail: (err: unknown) => boolean = shouldFailover,
): Promise<{ result: T; model: string; tried: string[] }> {
  const tried: string[] = [];
  let lastErr: unknown;
  for (const model of models) {
    tried.push(model);
    try {
      const result = await run(model);
      return { result, model, tried };
    } catch (err) {
      lastErr = err;
      if (!isFail(err) || tried.length === models.length) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'Nenhum modelo respondeu.'));
}
