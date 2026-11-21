// Renderiza o markdown do chat como elementos React (texto sempre escapado).
import { memo, useMemo } from 'react';
import { Block, Inline, parseMarkdown } from '../lib/markdown';

function renderInline(nodes: Inline[], key = ''): React.ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case 'text': return n.v;
      case 'code': return <code key={k} className="rounded bg-black/5 dark:bg-white/10 px-1 py-0.5 font-mono text-[0.85em]">{n.v}</code>;
      case 'strong': return <strong key={k} className="font-semibold">{renderInline(n.c, `${k}-`)}</strong>;
      case 'em': return <em key={k}>{renderInline(n.c, `${k}-`)}</em>;
      case 'link': return <a key={k} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="text-indigo-600 dark:text-indigo-400 underline underline-offset-2">{renderInline(n.c, `${k}-`)}</a>;
      default: return null;
    }
  });
}

function renderBlock(b: Block, i: number) {
  switch (b.t) {
    case 'h': return <p key={i} className={`font-semibold ${b.level <= 2 ? 'text-base' : 'text-sm'} mt-1`}>{renderInline(b.c)}</p>;
    case 'ul': return <ul key={i} className="list-disc pl-5 space-y-0.5">{b.items.map((it, j) => <li key={j}>{renderInline(it, `${j}-`)}</li>)}</ul>;
    case 'ol': return <ol key={i} className="list-decimal pl-5 space-y-0.5">{b.items.map((it, j) => <li key={j}>{renderInline(it, `${j}-`)}</li>)}</ol>;
    case 'pre': return <pre key={i} className="overflow-x-auto rounded-lg bg-zinc-900 text-zinc-100 p-3 text-xs font-mono"><code>{b.v}</code></pre>;
    default: return <p key={i} className="whitespace-pre-wrap">{renderInline(b.c)}</p>;
  }
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="space-y-2 break-words">{blocks.map(renderBlock)}</div>;
});
