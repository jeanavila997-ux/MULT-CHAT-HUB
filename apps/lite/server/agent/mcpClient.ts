// Cliente MCP mínimo (Streamable HTTP, JSON-RPC 2.0): initialize, tools/list, tools/call.
// Aceita resposta application/json ou text/event-stream e repassa Mcp-Session-Id.

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

/** O que o gerenciador precisa de qualquer cliente MCP (HTTP ou stdio). */
export interface McpClientLike {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  reset(): void;
}

interface RpcMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolCallResult {
  content?: { type?: string; text?: string }[];
  isError?: boolean;
}

export class McpHttpClient implements McpClientLike {
  private sessionId: string | null = null;
  private initialized = false;
  private nextId = 1;

  constructor(
    private readonly url: string,
    private readonly token = '',
    private readonly timeoutMs = 20_000,
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    for (const [k, v] of Object.entries(this.extraHeaders)) if (v) h[k] = v;
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    return h;
  }

  private async post(body: { id?: number; method: string; params?: object }, expectResponse = true): Promise<RpcMessage | null> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', ...body }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (!expectResponse) {
      await res.text().catch(() => '');
      return null;
    }
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    if (contentType.includes('text/event-stream')) {
      for (const line of text.split('\n')) {
        const m = line.match(/^data:\s?(.*)$/);
        if (!m) continue;
        try {
          const msg = JSON.parse(m[1]) as RpcMessage;
          if (msg.id === body.id) return msg;
        } catch { /* linha SSE malformada — ignorar */ }
      }
      throw new Error('MCP: resposta SSE sem a mensagem esperada.');
    }
    return JSON.parse(text) as RpcMessage;
  }

  private async rpc(method: string, params?: object): Promise<unknown> {
    const msg = await this.post({ id: this.nextId++, method, ...(params ? { params } : {}) });
    if (!msg) throw new Error('MCP: sem resposta.');
    if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message}`);
    return msg.result;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'mult-chat-hub-lite', version: '0.1.0' },
    });
    await this.post({ method: 'notifications/initialized' }, false);
    this.initialized = true;
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const result = (await this.rpc('tools/list', {})) as { tools?: McpTool[] } | undefined;
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    await this.initialize();
    const result = (await this.rpc('tools/call', { name, arguments: args })) as ToolCallResult | undefined;
    const parts = Array.isArray(result?.content) ? result.content : [];
    const text = parts
      .map((p) => (p.type === 'text' ? p.text ?? '' : `[${p.type ?? 'conteúdo'} omitido]`))
      .join('\n');
    if (result?.isError) throw new Error(text || 'MCP: a ferramenta retornou erro.');
    return text;
  }

  reset(): void {
    this.sessionId = null;
    this.initialized = false;
  }
}
