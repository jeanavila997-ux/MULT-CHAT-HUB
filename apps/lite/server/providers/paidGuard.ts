// Guarda de custo: provedor pago ou modelo :cloud do Ollama só roda com
// confirmPaid === true (o front pergunta antes). Nunca há troca automática
// para um provedor pago.
import { isPaidOllamaModel, providerMeta } from './catalog.js';

export function isPaidChoice(provider: string, model: string): boolean {
  if (provider === 'ollama') return isPaidOllamaModel(model || '');
  const meta = providerMeta(provider);
  return meta ? meta.paid : true; // desconhecido = trata como pago
}

export function paidGuardError(provider: string, model: string, confirmPaid: unknown): string | null {
  if (!isPaidChoice(provider, model)) return null;
  if (confirmPaid === true) return null;
  const what = provider === 'ollama' ? `o modelo ${model} (nuvem do Ollama)` : `o provedor ${providerMeta(provider)?.label ?? provider}`;
  return `Uso pago bloqueado: ${what} pode cobrar. Confirme no app antes de enviar.`;
}
