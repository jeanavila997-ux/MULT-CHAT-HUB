// Editor do system prompt do agente: texto grande (markdown), contador,
// salvar, restaurar padrão e histórico com desfazer. As instruções da pasta
// seguranca/ ficam separadas (somente leitura; edição com senha na fase 5).
import { useCallback, useContext, useEffect, useState } from 'react';
import { History, RotateCcw, Save, ShieldCheck, Undo2 } from 'lucide-react';
import { ChatContext } from '../../context/ChatContext';
import { hubApi, HubAgent, PromptInfo } from '../../lib/hubApi';
import { useConfirm } from '../ui/ConfirmDialog';
import { Button } from '../ui/Button';

const MAX = 20_000;
const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco', dateStyle: 'short', timeStyle: 'short' });

export default function PromptEditor({ agent }: { agent: HubAgent }) {
  const ctx = useContext(ChatContext);
  const confirm = useConfirm();
  const [text, setText] = useState(agent.systemPrompt);
  const [info, setInfo] = useState<PromptInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(() => { hubApi.promptInfo(agent.id).then(setInfo).catch(() => {}); }, [agent.id]);
  useEffect(() => { setText(agent.systemPrompt); setPreview(null); load(); }, [agent.id, agent.version, agent.systemPrompt, load]);

  const apply = (a: HubAgent, note: string) => { ctx?.replaceHubAgent(a); setMsg({ ok: true, text: note }); load(); };
  const fail = (err: unknown) => setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });

  const save = async () => {
    setBusy(true); setMsg(null);
    try { const { agent: a } = await hubApi.updateAgent(agent.id, { systemPrompt: text }); apply(a, `Salvo (v${a.version}).`); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };
  const restoreDefault = async () => {
    const ok = await confirm({ title: 'Restaurar o prompt padrão?', message: 'O prompt atual vai para o histórico e pode ser recuperado com Desfazer.', confirmLabel: 'Restaurar' });
    if (!ok) return;
    try { const { agent: a } = await hubApi.restoreDefaultPrompt(agent.id); apply(a, 'Prompt padrão restaurado.'); } catch (err) { fail(err); }
  };
  const undoTo = async (file: string, version: number) => {
    const ok = await confirm({ title: `Voltar para a versão ${version}?`, message: 'O prompt atual também fica guardado no histórico.', confirmLabel: 'Desfazer' });
    if (!ok) return;
    try { const { agent: a } = await hubApi.restoreVersion(agent.id, file); apply(a, `Voltou para o prompt da v${version}.`); } catch (err) { fail(err); }
  };

  const dirty = text !== agent.systemPrompt;
  const over = text.length > MAX;

  return (
    <section aria-label="System prompt" className="space-y-3">
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 p-3 text-xs flex gap-2">
        <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600" aria-hidden />
        <p>
          Prompt final = <strong>instruções de segurança</strong> (pasta <code>seguranca/</code>, {info?.security.exists ? `${info.security.chars} caracteres` : 'vazia'}; editar com senha chega na fase 5) + <strong>este prompt</strong>.
        </p>
      </div>

      <div>
        <div className="flex items-end justify-between mb-1">
          <label htmlFor={`prompt-${agent.id}`} className="text-xs font-medium text-zinc-500">System prompt (markdown)</label>
          <span className={`text-[11px] tabular-nums ${over ? 'text-rose-600 font-semibold' : 'text-zinc-400'}`}>{text.length.toLocaleString('pt-BR')} / {MAX.toLocaleString('pt-BR')}</span>
        </div>
        <textarea
          id={`prompt-${agent.id}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={20}
          className="w-full min-h-[22rem] resize-y rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Save className="w-4 h-4" />} onClick={save} disabled={!dirty || over || busy} isLoading={busy}>Salvar prompt</Button>
        {dirty ? <Button size="sm" variant="ghost" onClick={() => setText(agent.systemPrompt)}>Descartar edição</Button> : null}
        {info?.default != null ? <Button size="sm" variant="secondary" icon={<RotateCcw className="w-4 h-4" />} onClick={restoreDefault} disabled={agent.systemPrompt === info.default}>Restaurar padrão</Button> : null}
      </div>
      {msg ? <p role="status" className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</p> : null}

      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-1"><History className="w-4 h-4" aria-hidden /> Histórico ({info?.history.length ?? 0})</h3>
        {info && info.history.length === 0 ? <p className="text-xs text-zinc-400">Ainda não há versões anteriores.</p> : null}
        <ul className="space-y-1">
          {info?.history.map((h) => (
            <li key={h.file} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium">v{h.version}</span>
                <span className="text-zinc-400">{fmt(h.savedAt)} · {h.systemPrompt.length.toLocaleString('pt-BR')} caracteres</span>
                <button type="button" className="ml-auto text-indigo-600 hover:underline" onClick={() => setPreview(preview === h.file ? null : h.file)}>{preview === h.file ? 'Fechar' : 'Ver'}</button>
                <Button size="sm" variant="ghost" icon={<Undo2 className="w-3.5 h-3.5" />} onClick={() => undoTo(h.file, h.version)} disabled={h.systemPrompt === agent.systemPrompt}>Desfazer</Button>
              </div>
              {preview === h.file ? <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 dark:bg-zinc-900 p-2 font-mono text-[11px]">{h.systemPrompt}</pre> : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
