import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../storage/atomic.js';
import { ModelChainConfig, normalizeChain } from './modelChain.js';

export function chainFile(): string {
  return process.env.OLLAMA_CHAIN_FILE?.trim() || path.resolve(process.cwd(), 'data', 'ollama-chain.json');
}

export function loadChain(): ModelChainConfig {
  const file = chainFile();
  const cfg = normalizeChain(fs.existsSync(file) ? readJson<Partial<ModelChainConfig>>(file, {}) : {});
  if (!fs.existsSync(file)) writeJsonAtomic(file, cfg);
  return cfg;
}

export function saveChain(input: Partial<ModelChainConfig>): ModelChainConfig {
  const cfg = normalizeChain({ ...loadChain(), ...input });
  writeJsonAtomic(chainFile(), cfg);
  return cfg;
}
