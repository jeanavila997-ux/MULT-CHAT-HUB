// Cabeçalho de ativação do backend. O segredo NUNCA entra no bundle:
// - Electron: o preload pede ao processo principal (lê o .env.local);
// - dev no navegador: o proxy do Vite injeta o cabeçalho no lado do servidor;
// - fallback: segredo colado em Configurações (localStorage deste navegador).
const STORAGE_KEY = 'mch:activation-secret';

export function getBackendAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const fromElectron = (window as unknown as { electronAPI?: { activationSecret?: string } }).electronAPI?.activationSecret;
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(STORAGE_KEY); } catch { /* indisponível */ }
  const secret = (fromElectron || stored || '').trim();
  return secret ? { 'x-mch-activation-secret': secret } : {};
}
