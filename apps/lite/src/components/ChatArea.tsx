import React, { lazy, Suspense, useContext, useEffect, useRef, useState } from 'react';
import { Send, Bot, Mic, Paperclip } from 'lucide-react';
import { motion } from 'motion/react';
import { ChatContext } from '../context/ChatContext';
import { Markdown } from './Markdown';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { ProviderName } from '../types';
import type { ReactNode } from 'react';

// Charts puxam recharts (~400KB minified). Lazy load: so baixa quando
// uma mensagem com .analysis e renderizada.
const AnalysisChart = lazy(() => import('./AnalysisChart'));

// Troca rápida de modelo. Escolha só do usuário: não há fallback automático
// para provedor pago.
const QUICK_PROVIDERS: { id: ProviderName; label: string }[] = [
  { id: 'ollama', label: 'Agente local (Ollama)' },
  { id: 'router9', label: '9Router' },
  { id: 'nvidia', label: 'NVIDIA (nuvem)' },
  { id: 'grok', label: 'Grok (nuvem)' },
  { id: 'cloudflare', label: 'Cloudflare (nuvem)' },
];

export default function ChatArea({ header }: { header?: ReactNode }) {
  const ctx = useContext(ChatContext);
  const [input, setInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = ctx?.messages ?? [];
  const currentChannel = ctx?.currentChannel ?? '';
  const channelMessages = messages.filter((m) => m.channel === currentChannel);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages.length]);

  if (!ctx) return null;
  const {
    sendMessage, thinkingLevel, setThinkingLevel, transcribeAudio, uploadDataset, isLoading, streamingId,
    activeProvider, setActiveProvider, agentToolsEnabled, setAgentToolsEnabled, resolveToolConfirmation,
  } = ctx;

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input);
    setInput('');
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadDataset(file);
      e.target.value = '';
    }
  };

  const canSend = input.trim().length > 0 && !isLoading;

  return (
    <section className="flex-1 bg-white dark:bg-zinc-950 flex flex-col h-full overflow-hidden" aria-label="Área de chat">
      {header ?? (
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-between gap-3 shadow-sm">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
          # <span className="font-mono">{currentChannel}</span>
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <select
            aria-label="Modelo da conversa"
            value={activeProvider}
            onChange={(e) => setActiveProvider(e.target.value as ProviderName)}
            className="h-8 px-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {!QUICK_PROVIDERS.some((p) => p.id === activeProvider) && <option value={activeProvider}>{activeProvider}</option>}
            {QUICK_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          {activeProvider === 'ollama' && (
            <Button
              variant={agentToolsEnabled ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setAgentToolsEnabled(!agentToolsEnabled)}
              aria-pressed={agentToolsEnabled}
              title="Ferramentas, MCP e skills do agente local"
            >
              {agentToolsEnabled ? 'Ferramentas: ON' : 'Ferramentas: OFF'}
            </Button>
          )}
          <span className="text-zinc-600 dark:text-zinc-400 hidden sm:inline">Pensamento:</span>
          <Button
            variant={thinkingLevel === 'HIGH' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setThinkingLevel(thinkingLevel === 'HIGH' ? 'LOW' : 'HIGH')}
            aria-pressed={thinkingLevel === 'HIGH'}
          >
            {thinkingLevel === 'HIGH' ? 'ALTO' : 'BAIXO'}
          </Button>
        </div>
      </div>
      )}

      <div className="flex-1 px-4 sm:px-6 py-4 overflow-y-auto space-y-5" role="log" aria-live="polite">
        {channelMessages.length === 0 ? (
          <div className="text-center text-zinc-400 dark:text-zinc-600 italic mt-12">
            <p className="mb-2">Canal vazio.</p>
            <p className="text-xs">Comece com uma pergunta ou um <span className="font-mono">/use_tool</span>.</p>
          </div>
        ) : (
          channelMessages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex w-full ${msg.sender === 'User' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[75%] p-3 sm:p-4 rounded-xl shadow-sm leading-relaxed ${
                  msg.sender === 'User'
                    ? 'bg-indigo-600 text-white rounded-br-none'
                    : msg.sender === 'Sistema'
                    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 text-sm italic'
                    : 'bg-emerald-50 dark:bg-emerald-950 border border-emerald-100 dark:border-emerald-900 text-emerald-950 dark:text-emerald-100 rounded-bl-none'
                }`}
              >
                <span
                  className={`font-bold text-[10px] uppercase flex items-center gap-1 mb-1 opacity-80 ${
                    msg.sender === 'User' ? 'text-indigo-200' : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  {msg.sender !== 'User' && msg.sender !== 'Sistema' && <Bot className="w-3 h-3" aria-hidden="true" />}
                  {msg.sender === 'User' ? 'Você' : msg.sender}
                </span>
                {streamingId === msg.id || msg.sender === 'User' ? (
                  <p className="whitespace-pre-wrap break-words">
                    {msg.text}
                    {streamingId === msg.id ? (
                      <span className="inline-block w-0.5 h-4 bg-current ml-0.5 align-text-bottom animate-pulse" aria-hidden="true" />
                    ) : null}
                  </p>
                ) : (
                  <Markdown text={msg.text} />
                )}
                {msg.pendingTool && (
                  <div className="mt-2 not-italic space-y-2">
                    {Object.keys(msg.pendingTool.args).length > 0 && (
                      <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-white/70 dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-700 rounded p-2 max-h-40 overflow-auto">
                        {JSON.stringify(msg.pendingTool.args, null, 2)}
                      </pre>
                    )}
                    {msg.pendingTool.status === 'pending' ? (
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" disabled={isLoading} onClick={() => resolveToolConfirmation(msg.id, true)}>
                          Executar
                        </Button>
                        <Button size="sm" variant="ghost" disabled={isLoading} onClick={() => resolveToolConfirmation(msg.id, false)}>
                          Recusar
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs font-medium">
                        {msg.pendingTool.status === 'approved' ? 'Execução aprovada.' : 'Execução recusada.'}
                      </span>
                    )}
                  </div>
                )}
                {msg.analysis && (
                  <Suspense fallback={<div className="mt-2 text-xs text-zinc-500 italic">Carregando gráfico…</div>}>
                    <AnalysisChart result={msg.analysis} />
                  </Suspense>
                )}
              </div>
            </motion.div>
          ))
        )}
        {isLoading && !streamingId && (
          <div className="flex justify-start">
            <div className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm italic text-zinc-600 dark:text-zinc-400 inline-flex items-center gap-2" aria-live="polite">
              <span className="sr-only">Aguardando resposta</span>
              <span className="flex gap-1" aria-hidden="true">
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
              processando…
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 sm:p-4 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 shadow-inner">
        <div className="flex gap-1 sm:gap-2 items-center bg-white dark:bg-zinc-800 p-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 focus-within:ring-2 ring-indigo-500/20 transition-all shadow-sm">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json"
            className="hidden"
            onChange={handleFile}
          />
          <IconButton
            aria-label="Carregar dataset CSV ou JSON"
            icon={<Paperclip className="w-5 h-5" />}
            onClick={() => fileInputRef.current?.click()}
            size="sm"
          />
          <IconButton
            aria-label="Transcrever áudio do microfone"
            icon={<Mic className="w-5 h-5" />}
            onClick={() => transcribeAudio(setInput)}
            size="sm"
          />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            className="flex-1 px-2 py-2 outline-none bg-transparent min-w-0 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
            placeholder="Mensagem ou /use_tool…"
            aria-label="Mensagem para o agente"
            disabled={isLoading}
          />
          <IconButton
            aria-label="Enviar mensagem"
            icon={<Send className="w-5 h-5" />}
            onClick={handleSend}
            disabled={!canSend}
            variant="primary"
            size="sm"
          />
        </div>
      </div>
    </section>
  );
}
