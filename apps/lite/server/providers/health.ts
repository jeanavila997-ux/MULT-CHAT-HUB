// Teste de conexão por provedor. Só chamadas grátis (listar modelos / conta),
// timeout curto, e a chave nunca aparece na resposta.
import type { ProviderMetaInfo } from './catalog.js';

export interface HealthResult { ok: boolean; status?: number; detail: string; ms: number }

function trimBase(u: string) { return u.replace(/\/$/, ''); }

export function healthRequest(meta: ProviderMetaInfo, key: string, env: NodeJS.ProcessEnv): { url: string; headers: Record<string, string> } | { skip: string } {
  const bearer = key ? { Authorization: `Bearer ${key}` } : {};
  switch (meta.id) {
    case 'ollama': return { url: `${trimBase(env.OLLAMA_HOST || 'http://127.0.0.1:11434')}/api/tags`, headers: {} };
    case 'llamacpp': return { url: `${trimBase(env.LLM_BASE_URL || 'http://127.0.0.1:8080/v1')}/models`, headers: {} };
    case 'router9': return { url: `${trimBase(env.ROUTER_BASE_URL || 'http://127.0.0.1:20128/v1')}/models`, headers: bearer };
    case 'ollama_cloud': return { url: 'https://ollama.com/api/tags', headers: bearer };
    case 'openai': return { url: 'https://api.openai.com/v1/models', headers: bearer };
    case 'deepseek': return { url: 'https://api.deepseek.com/v1/models', headers: bearer };
    case 'grok': return { url: `${trimBase(env.GROK_BASE_URL || 'https://api.x.ai/v1')}/models`, headers: bearer };
    case 'nvidia': return { url: `${trimBase(env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1')}/models`, headers: bearer };
    case 'openrouter': return { url: 'https://openrouter.ai/api/v1/key', headers: bearer };
    case 'anthropic': return { url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } };
    case 'gemini': return { url: 'https://generativelanguage.googleapis.com/v1beta/models', headers: { 'x-goog-api-key': key } };
    case 'cloudflare': {
      const acc = env.CLOUDFLARE_ACCOUNT_ID?.trim();
      return acc ? { url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(acc)}/ai/models/search?per_page=1`, headers: bearer } : { skip: 'Defina CLOUDFLARE_ACCOUNT_ID.' };
    }
    case 'github': return { url: 'https://api.github.com/user', headers: { ...bearer, 'User-Agent': 'mult-chat-hub' } };
    case 'supabase': {
      const u = env.SUPABASE_URL?.trim();
      return u ? { url: `${trimBase(u)}/rest/v1/`, headers: { apikey: key, Authorization: `Bearer ${key}` } } : { skip: 'Defina SUPABASE_URL.' };
    }
    default: return { skip: 'Este provedor não tem teste automático.' };
  }
}

export async function testProvider(meta: ProviderMetaInfo, key: string, env: NodeJS.ProcessEnv): Promise<HealthResult> {
  const t0 = Date.now();
  if (meta.secretAccount && !key && meta.kind !== 'router') return { ok: false, detail: 'Sem chave configurada.', ms: 0 };
  const req = healthRequest(meta, key, env);
  if ('skip' in req) return { ok: false, detail: req.skip, ms: 0 };
  try {
    const r = await fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(8000) });
    const detail = r.ok ? 'Conectado.' : r.status === 401 || r.status === 403 ? 'Chave recusada (401/403).' : `HTTP ${r.status}`;
    return { ok: r.ok, status: r.status, detail, ms: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `Sem resposta: ${msg.replaceAll(key || '\u0000', '***').slice(0, 120)}`, ms: Date.now() - t0 };
  }
}
