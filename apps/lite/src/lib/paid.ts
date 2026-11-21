// Regras de custo compartilhadas entre front e servidor. O servidor é quem
// bloqueia (402 sem confirmPaid); o front usa isto para perguntar antes.

/** Modelos da nuvem do Ollama (cobram pela assinatura) terminam em :cloud ou -cloud. */
export function isPaidOllamaModel(name: string): boolean {
  return /(?::|-)cloud$/i.test((name || '').trim());
}

/** Provedores locais e grátis; todo o resto pode cobrar. */
export const FREE_PROVIDERS = new Set(['ollama', 'llamacpp', 'powershell']);

export function isPaidProviderModel(provider: string, model: string): boolean {
  if (provider === 'ollama') return isPaidOllamaModel(model);
  return !FREE_PROVIDERS.has(provider);
}
