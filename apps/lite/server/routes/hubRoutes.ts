// Rotas do hub: /agents, /agents-trash, /providers, /mcp, /mestre.
// Montadas depois do requireActivationSecret (ver routes/api.ts).
import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Hub } from '../hub.js';
import { PROVIDER_CATALOG, providerMeta } from '../providers/catalog.js';
import { testProvider } from '../providers/health.js';
import { importEnvSecrets } from '../secrets/envImport.js';
import { classifyMcpTool } from '../mcp/policy.js';
import type { McpServerConfig } from '../mcp/manager.js';

type GetHub = () => Promise<Hub>;

function errMsg(err: unknown) { return err instanceof Error ? err.message : String(err); }

export function defaultMestreLauncher(env: NodeJS.ProcessEnv): string {
  return env.MESTRE_LAUNCHER_PATH?.trim() || 'C:\\Users\\Jean\\Projetos\\ferramentas\\Mestre-do-PC-V10\\Iniciar-Mestre.bat';
}

export function buildHubRouter(getHub: GetHub): Router {
  const r = Router();
  const wrap = (fn: (hub: Hub, req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
    let hub: Hub;
    try { hub = await getHub(); } catch (err) { return res.status(500).json({ error: `Pasta de dados indisponível: ${errMsg(err)}` }); }
    try { return await fn(hub, req, res); } catch (err) {
      const msg = errMsg(err);
      const status = /não encontrad/i.test(msg) ? 404 : 400;
      return res.status(status).json({ error: msg });
    }
  };

  // ── Agentes ────────────────────────────────────────────────────────────────
  r.get('/agents', wrap((hub, _req, res) => res.json({ root: hub.root, agents: hub.registry.list() })));
  r.post('/agents', wrap((hub, req, res) => res.status(201).json({ agent: hub.registry.create(req.body ?? {}) })));
  r.post('/agents/import', wrap((hub, req, res) => res.status(201).json({ agent: hub.registry.importAgent(req.body) })));
  r.post('/agents/restore-defaults', wrap((hub, _req, res) => res.json({ restored: hub.registry.restoreDefaults() })));
  r.get('/agents/:id', wrap((hub, req, res) => {
    const a = hub.registry.get(String(req.params.id));
    return a ? res.json({ agent: a }) : res.status(404).json({ error: 'Agente não encontrado.' });
  }));
  r.put('/agents/:id', wrap((hub, req, res) => res.json({ agent: hub.registry.update(String(req.params.id), req.body ?? {}) })));
  r.delete('/agents/:id', wrap((hub, req, res) => {
    const a = hub.registry.get(String(req.params.id));
    if (!a) return res.status(404).json({ error: 'Agente não encontrado.' });
    if (req.body?.confirmName !== a.name) return res.status(400).json({ error: `Para excluir, digite o nome exato do agente: ${a.name}` });
    return res.json({ trash: hub.registry.remove(a.id) });
  }));
  r.post('/agents/:id/duplicate', wrap((hub, req, res) => res.status(201).json({ agent: hub.registry.duplicate(String(req.params.id)) })));
  r.get('/agents/:id/export', wrap((hub, req, res) => res.json(hub.registry.exportAgent(String(req.params.id)))));
  r.get('/agents-trash', wrap((hub, _req, res) => res.json({ trash: hub.registry.listTrash() })));
  r.post('/agents-trash/:trashId/restore', wrap((hub, req, res) => res.json({ agent: hub.registry.restore(String(req.params.trashId)) })));

  // ── Provedores e chaves ────────────────────────────────────────────────────
  r.get('/providers', wrap(async (hub, _req, res) => {
    const providers = await Promise.all(PROVIDER_CATALOG.map(async (p) => {
      const { source } = await hub.secrets.resolve(p.secretAccount, p.envKeys, hub.env);
      const info = p.secretAccount ? hub.secrets.info(p.secretAccount) : null;
      return {
        id: p.id, label: p.label, sublabel: p.sublabel, kind: p.kind, paid: p.paid, chat: p.chat,
        needsKey: !!p.secretAccount, envKeys: p.envKeys,
        configured: !p.secretAccount || !!source, source, last4: source === 'cofre' ? info?.last4 ?? null : null,
      };
    }));
    res.json({ providers, vault: { available: hub.secretsAvailable, error: hub.secretsError ?? null } });
  }));
  r.put('/providers/:id/key', wrap(async (hub, req, res) => {
    const meta = providerMeta(String(req.params.id));
    if (!meta?.secretAccount) return res.status(400).json({ error: 'Este provedor não usa chave.' });
    await hub.secrets.set(meta.secretAccount, String(req.body?.key ?? ''));
    return res.json({ ok: true, last4: hub.secrets.info(meta.secretAccount)?.last4 ?? null });
  }));
  r.delete('/providers/:id/key', wrap(async (hub, req, res) => {
    const meta = providerMeta(String(req.params.id));
    if (!meta?.secretAccount) return res.status(400).json({ error: 'Este provedor não usa chave.' });
    await hub.secrets.delete(meta.secretAccount);
    return res.json({ ok: true });
  }));
  r.post('/providers/import-env', wrap(async (hub, req, res) => {
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirme a importação (confirm=true).' });
    const targets = PROVIDER_CATALOG.filter((p) => p.secretAccount).map((p) => ({ account: p.secretAccount!, envKeys: p.envKeys }));
    const result = await importEnvSecrets(hub.secrets, hub.envFile, targets);
    return res.json({ ...result, backup: result.backup ? path.basename(result.backup) : null });
  }));
  r.post('/providers/:id/test', wrap(async (hub, req, res) => {
    const meta = providerMeta(String(req.params.id));
    if (!meta) return res.status(404).json({ error: 'Provedor não encontrado.' });
    const { value } = await hub.secrets.resolve(meta.secretAccount, meta.envKeys, hub.env);
    return res.json(await testProvider(meta, value, hub.env));
  }));

  // ── MCP ────────────────────────────────────────────────────────────────────
  r.get('/mcp/servers', wrap(async (hub, _req, res) => {
    const servers = hub.mcp.listServers();
    const status = await Promise.all(servers.map((s) => hub.mcp.status(s.id)));
    res.json({ servers: servers.map((s, i) => ({ ...s, status: status[i] })) });
  }));
  r.post('/mcp/servers', wrap((hub, req, res) => res.json({ server: hub.mcp.saveServer(req.body as McpServerConfig) })));
  r.delete('/mcp/servers/:id', wrap((hub, req, res) => { hub.mcp.removeServer(String(req.params.id)); return res.json({ ok: true }); }));
  r.get('/mcp/servers/:id/status', wrap(async (hub, req, res) => res.json(await hub.mcp.status(String(req.params.id), req.query.force === '1'))));
  r.post('/mcp/servers/:id/test', wrap(async (hub, req, res) => {
    const id = String(req.params.id);
    const tool = String(req.body?.tool ?? '');
    if (classifyMcpTool(id, tool) !== 'read') return res.status(400).json({ error: 'O teste pela tela só roda ferramentas de leitura. Use o chat do agente (com confirmação) para as outras.' });
    const t0 = Date.now();
    const output = await hub.mcp.callTool('teste-ui', id, tool, {});
    return res.json({ ok: true, ms: Date.now() - t0, output: output.slice(0, 4000) });
  }));
  r.get('/mcp/log', wrap((hub, req, res) => res.json({ entries: hub.mcp.log.tail(Math.min(Number(req.query.n) || 50, 200)) })));

  // ── Mestre do PC ───────────────────────────────────────────────────────────
  r.get('/mestre/status', wrap(async (hub, req, res) => {
    const st = await hub.mcp.status('mestre', req.query.force === '1');
    const launcher = defaultMestreLauncher(hub.env);
    const server = hub.mcp.listServers().find((s) => s.id === 'mestre');
    res.json({ ...st, url: server?.url, tokenConfigured: !!hub.env.MESTRE_MCP_TOKEN?.trim(), launcherAvailable: fs.existsSync(launcher) });
  }));
  r.post('/mestre/reconnect', wrap(async (hub, _req, res) => { hub.mcp.invalidate('mestre'); return res.json(await hub.mcp.status('mestre', true)); }));
  r.post('/mestre/start', wrap((hub, req, res) => {
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirme para iniciar o Mestre do PC (confirm=true).' });
    const launcher = defaultMestreLauncher(hub.env);
    if (!/\.bat$/i.test(launcher) || /["&|<>^%]/.test(launcher) || !fs.existsSync(launcher)) return res.status(400).json({ error: 'Iniciar-Mestre.bat não encontrado (defina MESTRE_LAUNCHER_PATH).' });
    // .bat precisa do cmd; o caminho é fixo/validado e não vem do navegador.
    const child = spawn('cmd.exe', ['/d', '/c', launcher], { cwd: path.dirname(launcher), detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    hub.mcp.invalidate('mestre');
    return res.json({ ok: true, started: true });
  }));

  return r;
}
