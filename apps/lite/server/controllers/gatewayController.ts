import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';

// Gateway externo (NullClaw): o lite faz o pareamento e repassa as mensagens.
//  - POST {url}/pair com X-Pairing-Code → token Bearer (o código é de uso único);
//  - POST {url}/webhook com Authorization: Bearer <token> e {"message": "..."}.
// O token fica só no servidor (apps/lite/data/gateways.json, git-ignorado), nunca vai
// para o navegador nem para o log. O navegador conhece só o id da conexão.
// Passar pelo servidor evita CORS (o gateway não manda Access-Control-Allow-Origin)
// e limita os destinos à lista GATEWAY_ALLOWED_HOSTS (padrão: só este PC).

interface GatewayEntry {
  id: string;
  url: string;
  token: string;
  mode: 'pair' | 'token';
  connectedAt: string;
}

const TIMEOUT_MS = 15_000;
const MESSAGE_TIMEOUT_MS = 120_000;

function gatewaysFile(): string {
  return process.env.GATEWAYS_FILE?.trim() || path.resolve(process.cwd(), 'data', 'gateways.json');
}

function load(): GatewayEntry[] {
  try {
    const data = JSON.parse(fs.readFileSync(gatewaysFile(), 'utf8')) as { gateways?: GatewayEntry[] };
    return Array.isArray(data.gateways) ? data.gateways : [];
  } catch {
    return [];
  }
}

function save(list: GatewayEntry[]) {
  const file = gatewaysFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ gateways: list }, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

export function allowedHosts(): string[] {
  const raw = process.env.GATEWAY_ALLOWED_HOSTS?.trim();
  const list = raw ? raw.split(/[;,\s]+/) : ['127.0.0.1', 'localhost', '[::1]'];
  return list.map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/** Normaliza a URL do gateway e confere a allowlist. Lança erro com mensagem para o usuário. */
export function normalizeGatewayUrl(raw: unknown, hosts = allowedHosts()): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Informe a URL do gateway.');
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error('URL do gateway inválida (ex.: http://127.0.0.1:3010).');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Use http:// ou https://.');
  if (u.username || u.password) throw new Error('Não coloque usuário/senha na URL.');
  if (!hosts.includes(u.hostname.toLowerCase())) {
    throw new Error(`Host "${u.hostname}" fora da lista permitida. Adicione em GATEWAY_ALLOWED_HOSTS no apps/lite/.env.local e reinicie o app.`);
  }
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

function pickToken(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  for (const k of ['token', 'bearer_token', 'access_token', 'bearer']) {
    if (typeof d[k] === 'string' && (d[k] as string).trim()) return (d[k] as string).trim();
  }
  return '';
}

async function post(url: string, headers: Record<string, string>, body?: unknown, timeout = TIMEOUT_MS) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
    redirect: 'error',
  });
}

const publicView = (g: GatewayEntry) => ({ id: g.id, url: g.url, mode: g.mode, connectedAt: g.connectedAt });

export const handleListGateways = (_req: Request, res: Response) => {
  res.json({ gateways: load().map(publicView), allowedHosts: allowedHosts() });
};

export const handleConnectGateway = async (req: Request, res: Response) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!code) return res.status(400).json({ error: 'Informe o código de pareamento.' });
  if (code.length > 512) return res.status(400).json({ error: 'Código grande demais.' });
  let url: string;
  try {
    url = normalizeGatewayUrl(req.body?.url);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  try {
    // 1) /pair troca o código de uso único por um token.
    const pair = await post(`${url}/pair`, { 'X-Pairing-Code': code });
    let token = '';
    let mode: GatewayEntry['mode'] = 'pair';
    if (pair.ok) {
      token = pickToken(await pair.json().catch(() => null));
      if (!token) return res.status(502).json({ error: 'O gateway aceitou o código mas não devolveu um token.' });
    } else if (pair.status === 401 || pair.status === 403) {
      return res.status(401).json({ error: 'Código de pareamento inválido ou já usado. Gere um novo código no gateway (ele vale uma vez só).' });
    } else if (pair.status === 429) {
      return res.status(429).json({ error: 'O gateway bloqueou por muitas tentativas. Espere um pouco e tente de novo.' });
    } else if (pair.status === 404 || pair.status === 405) {
      // 2) Gateway sem /pair: o código já é o token Bearer. Valida com uma mensagem de teste.
      mode = 'token';
      token = code;
      const test = await post(`${url}/webhook`, { Authorization: `Bearer ${token}` }, { message: '[MULT-CHAT-HUB] teste de pareamento — responda só "ok".' }, MESSAGE_TIMEOUT_MS);
      if (test.status === 401 || test.status === 403) {
        return res.status(401).json({ error: 'Token recusado pelo gateway (401). Confira o código/token.' });
      }
      if (!test.ok) return res.status(502).json({ error: `O gateway respondeu ${test.status} no teste do /webhook.` });
    } else {
      return res.status(502).json({ error: `O gateway respondeu ${pair.status} no /pair.` });
    }

    const list = load().filter((g) => g.url !== url);
    const entry: GatewayEntry = { id: crypto.randomUUID(), url, token, mode, connectedAt: new Date().toISOString() };
    save([...list, entry]);
    return res.json(publicView(entry));
  } catch (err) {
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return res.status(502).json({ error: timeout ? `Gateway ${url} não respondeu a tempo.` : `Gateway ${url} não alcançável.` });
  }
};

export const handleGatewayMessage = async (req: Request, res: Response) => {
  const g = load().find((x) => x.id === String(req.params.id));
  if (!g) return res.status(404).json({ error: 'Gateway não conectado (ou desconectado). Conecte de novo em "Gateway Externo".' });
  const message = typeof req.body?.message === 'string' ? req.body.message : '';
  if (!message.trim()) return res.status(400).json({ error: 'Mensagem vazia.' });
  try {
    const r = await post(`${g.url}/webhook`, { Authorization: `Bearer ${g.token}` }, { message: message.slice(0, 20_000) }, MESSAGE_TIMEOUT_MS);
    if (r.status === 401 || r.status === 403) {
      return res.status(401).json({ error: 'O gateway recusou o token (401). Ele pode ter sido revogado ou o gateway reiniciou: desconecte e pareie de novo.' });
    }
    const raw = await r.text();
    if (!r.ok) return res.status(502).json({ error: `Erro no gateway (${r.status}).` });
    let text = raw;
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const v = data.reply ?? data.response ?? data.text ?? data.message;
      text = typeof v === 'string' ? v : JSON.stringify(data);
    } catch { /* resposta em texto puro */ }
    return res.json({ text: text.slice(0, 20_000) });
  } catch {
    return res.status(502).json({ error: `Gateway ${g.url} não alcançável.` });
  }
};

export const handleDisconnectGateway = (req: Request, res: Response) => {
  const list = load();
  const next = list.filter((g) => g.id !== String(req.params.id));
  if (next.length === list.length) return res.status(404).json({ error: 'Gateway não encontrado.' });
  save(next);
  return res.json({ ok: true });
};
