import type { Request, Response } from 'express';
import { classifyOllamaModels, hiddenOllamaModels } from '../providers/catalog.js';
import { loadChain, saveChain } from '../ollama/modelChainStore.js';
import { normalizeName } from '../ollama/modelChain.js';

const ollamaHost = () => (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
const PULL_TIMEOUT_MS = 15 * 60_000;

async function listNames(): Promise<string[]> {
  const r = await fetch(`${ollamaHost()}/api/tags`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Ollama respondeu HTTP ${r.status}`);
  const data = await r.json() as { models?: { name?: string }[] };
  return (data.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === 'string' && n.length > 0);
}

export async function handleOllamaModels(_req: Request, res: Response) {
  const cfg = loadChain();
  const defaultModel = process.env.OLLAMA_MODEL?.trim() || cfg.uso1;
  try {
    const names = await listNames();
    const { local, cloud, hidden } = classifyOllamaModels(names, hiddenOllamaModels());
    return res.json({
      default: defaultModel,
      uso1: cfg.uso1,
      chain: cfg.chain,
      allowPaidFallback: cfg.allowPaidFallback,
      models: [...local, ...cloud],
      local,
      cloud,
      hidden,
    });
  } catch {
    return res.status(503).json({
      default: defaultModel,
      uso1: cfg.uso1,
      chain: cfg.chain,
      allowPaidFallback: cfg.allowPaidFallback,
      models: [],
      local: [],
      cloud: [],
      hidden: [],
      error: `Ollama não acessível em ${ollamaHost()}`,
    });
  }
}

export async function handlePutOllamaChain(req: Request, res: Response) {
  const body = req.body ?? {};
  const cfg = saveChain({
    uso1: typeof body.uso1 === 'string' ? body.uso1 : undefined,
    chain: Array.isArray(body.chain) ? body.chain : undefined,
    allowPaidFallback: typeof body.allowPaidFallback === 'boolean' ? body.allowPaidFallback : undefined,
  });
  return res.json(cfg);
}

export async function handlePullOllamaModel(req: Request, res: Response) {
  const name = normalizeName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'name é obrigatório.' });
  try {
    const r = await fetch(`${ollamaHost()}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: false }),
      signal: AbortSignal.timeout(PULL_TIMEOUT_MS),
    });
    const text = await r.text();
    if (!r.ok) return res.status(502).json({ error: `Ollama pull ${r.status}: ${text.slice(0, 400)}` });
    const cfg = loadChain();
    if (!cfg.chain.some((m) => m.toLowerCase() === name.toLowerCase())) {
      saveChain({ chain: [...cfg.chain, name] });
    }
    return res.json({ ok: true, name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(503).json({ error: `Falha ao baixar ${name}: ${msg}` });
  }
}

export async function handleDeleteOllamaModel(req: Request, res: Response) {
  const name = normalizeName(req.body?.name ?? req.query.name);
  if (!name) return res.status(400).json({ error: 'name é obrigatório.' });
  const cfg = loadChain();
  if (name.toLowerCase() === cfg.uso1.toLowerCase()) {
    return res.status(409).json({ error: `Não dá para excluir o modelo de uso 1 (${cfg.uso1}). Troque o uso 1 antes.` });
  }
  try {
    const r = await fetch(`${ollamaHost()}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok && r.status !== 404) {
      const text = await r.text();
      return res.status(502).json({ error: `Ollama delete ${r.status}: ${text.slice(0, 400)}` });
    }
    saveChain({ chain: cfg.chain.filter((m) => m.toLowerCase() !== name.toLowerCase()) });
    return res.json({ ok: true, name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(503).json({ error: `Falha ao excluir ${name}: ${msg}` });
  }
}
