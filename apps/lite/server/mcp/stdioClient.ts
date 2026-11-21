// Cliente MCP por stdio (JSON-RPC, uma mensagem por linha). spawn SEM shell.
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import type { McpClientLike, McpTool } from '../agent/mcpClient.js';

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

export class McpStdioClient implements McpClientLike {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private initialized = false;
  private stderrTail = '';

  constructor(private readonly command: string, private readonly args: string[] = [], private readonly timeoutMs = 20_000, private readonly env: NodeJS.ProcessEnv = {}) {}

  private start(): ChildProcessWithoutNullStreams {
    if (this.proc && this.proc.exitCode === null) return this.proc;
    const proc = spawn(this.command, this.args, { shell: false, windowsHide: true, stdio: 'pipe', env: { ...process.env, ...this.env } });
    this.proc = proc;
    this.initialized = false;
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try { msg = JSON.parse(line); } catch { return; }
      if (typeof msg.id !== 'number') return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`MCP: ${msg.error.message ?? 'erro'}`));
      else p.resolve(msg.result);
    });
    proc.stderr.on('data', (d) => { this.stderrTail = (this.stderrTail + d.toString()).slice(-500); });
    const fail = (why: string) => {
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(why)); }
      this.pending.clear();
      this.proc = null;
    };
    proc.on('error', (e) => fail(`MCP stdio não iniciou: ${e.message}`));
    proc.on('exit', (code) => fail(`MCP stdio terminou (código ${code}). ${this.stderrTail.trim().slice(-200)}`));
    return proc;
  }

  private send(method: string, params?: object, notify = false): Promise<unknown> {
    const proc = this.start();
    if (notify) { proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); return Promise.resolve(null); }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP stdio: tempo esgotado em ${method}`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  private async initialize() {
    if (this.initialized && this.proc) return;
    await this.send('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mult-chat-hub-lite', version: '0.1.0' } });
    await this.send('notifications/initialized', {}, true);
    this.initialized = true;
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const r = (await this.send('tools/list', {})) as { tools?: McpTool[] } | undefined;
    return Array.isArray(r?.tools) ? r.tools : [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    await this.initialize();
    const r = (await this.send('tools/call', { name, arguments: args })) as { content?: { type?: string; text?: string }[]; isError?: boolean } | undefined;
    const text = (r?.content ?? []).map((p) => (p.type === 'text' ? p.text ?? '' : `[${p.type ?? 'conteúdo'} omitido]`)).join('\n');
    if (r?.isError) throw new Error(text || 'MCP: a ferramenta retornou erro.');
    return text;
  }

  reset(): void { this.close(); }

  close(): void {
    if (this.proc) { this.proc.kill(); this.proc = null; }
    this.initialized = false;
  }
}
