// Markdown mínimo e seguro para o chat. Gera nós (nunca HTML): o React escapa
// todo texto, então <script>, onerror etc. aparecem como texto literal.
// Suporta: # títulos, listas (- * 1.), ``` blocos ```, `código`, **negrito**,
// *itálico* / _itálico_, [texto](https://…). Links só http(s) e mailto.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'pre'; lang: string; v: string };

const MAX_LEN = 50_000;

export function safeHref(href: string): string | null {
  const h = href.trim();
  if (!/^(https?:\/\/|mailto:)/i.test(h)) return null;
  try {
    const u = new URL(h);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.toString() : null;
  } catch { return null; }
}

function pushText(out: Inline[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === 'text') last.v += v;
  else out.push({ t: 'text', v });
}

export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) { out.push({ t: 'code', v: src.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (depth < 3 && ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) { out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end), depth + 1) }); i = end + 2; continue; }
    }
    if (depth < 3 && (ch === '*' || ch === '_')) {
      const prev = src[i - 1];
      const next = src[i + 1];
      // abre só no início de palavra e se o próximo não for espaço (evita 2 * 3 e nomes_com_sublinhado)
      if ((!prev || /[\s(]/.test(prev)) && next && !/\s/.test(next)) {
        const end = src.indexOf(ch, i + 1);
        const after = src[end + 1];
        if (end > i + 1 && !/\s/.test(src[end - 1]) && (!after || /[\s.,;:!?)]/.test(after))) {
          out.push({ t: 'em', c: parseInline(src.slice(i + 1, end), depth + 1) });
          i = end + 1;
          continue;
        }
      }
    }
    if (ch === '[') {
      const close = src.indexOf('](', i + 1);
      const end = close > 0 ? src.indexOf(')', close + 2) : -1;
      if (close > i && end > close) {
        // permite um nível de parênteses no destino
        let stop = end;
        const inner = src.slice(close + 2, end);
        if (inner.includes('(') && src[end + 1] === ')') stop = end + 1;
        const href = safeHref(src.slice(close + 2, stop));
        if (href) {
          out.push({ t: 'link', href, c: parseInline(src.slice(i + 1, close), depth + 1) });
          i = stop + 1;
          continue;
        }
        pushText(out, src.slice(i, stop + 1));
        i = stop + 1;
        continue;
      }
    }
    pushText(out, ch);
    i++;
  }
  return out;
}

export function parseMarkdown(input: string): Block[] {
  const lines = (input || '').slice(0, MAX_LEN).replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { blocks.push({ t: 'p', c: parseInline(para.join('\n')) }); para = []; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ t: 'pre', lang: fence[1] || '', v: body.join('\n') });
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) { flush(); blocks.push({ t: 'h', level: h[1].length, c: parseInline(h[2]) }); continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      flush();
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(parseInline(lines[i++].replace(/^\s*[-*]\s+/, '')));
      i--;
      blocks.push({ t: 'ul', items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flush();
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(parseInline(lines[i++].replace(/^\s*\d+[.)]\s+/, '')));
      i--;
      blocks.push({ t: 'ol', items });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    para.push(line);
  }
  flush();
  return blocks;
}
