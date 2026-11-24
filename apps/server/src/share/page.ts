import { isLinkUrl } from '@atelier/core';

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface ShareItem {
  kind: 'link' | 'note' | 'todo';
  title: string;
  url: string | null;
  note: string | null;
  body: unknown;
  done: boolean;
}

export interface ShareCategory {
  name: string;
  emoji: string | null;
}

const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote', 'taskItem']);

/** Plain-text paragraphs from TipTap JSON: text nodes only, one paragraph per text block. */
export function bodyParagraphs(body: unknown): string[] {
  const out: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = '';
  };
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 50) return;
    const n = node as { type?: unknown; text?: unknown; content?: unknown };
    if (n.type === 'text') {
      if (typeof n.text === 'string') cur += n.text;
      return;
    }
    if (n.type === 'hardBreak') {
      cur += '\n';
      return;
    }
    if (Array.isArray(n.content)) for (const child of n.content) walk(child, depth + 1);
    if (typeof n.type === 'string' && BLOCKS.has(n.type)) flush();
  };
  walk(body, 0);
  flush();
  return out;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

const CSS = `
@font-face{font-family:"Cormorant Garamond";font-weight:500;font-style:normal;font-display:swap;src:url(/static/fonts/cormorant-garamond-latin-500-normal.woff2) format("woff2")}
@font-face{font-family:Jost;font-weight:400;font-style:normal;font-display:swap;src:url(/static/fonts/jost-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:Jost;font-weight:500;font-style:normal;font-display:swap;src:url(/static/fonts/jost-latin-500-normal.woff2) format("woff2")}
:root{--canvas:#f6f1e7;--canvas-raised:#fbf8f2;--canvas-sunk:#ece5d6;--line:#ddd3c1;--line-strong:#8f8878;--ink:#2a2f3d;--ink-muted:#5d6170;--lily:#46568a;--lily-soft:#dfe3f0;--sage:#4d6a4a;--sage-soft:#dfe8d9;--shadow-soft:0 1px 2px rgba(42,47,61,.06),0 6px 20px rgba(42,47,61,.06);--font-serif:"Cormorant Garamond","Cormorant",Garamond,"Times New Roman",serif;--font-sans:Jost,"Futura","Avenir Next",system-ui,sans-serif;--radius-md:10px;--radius-lg:20px}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--font-sans);font-size:16px;line-height:1.55}
main{max-width:640px;margin:0 auto;padding:48px 16px 24px}
h1{font-family:var(--font-serif);font-weight:500;font-size:2.6rem;line-height:1.1;margin:0 0 32px;overflow-wrap:anywhere}
h1 .emoji{margin-right:.35em}
ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}
li{background:var(--canvas-raised);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-soft);padding:12px 16px;overflow-wrap:anywhere}
a{color:var(--lily);font-weight:500;text-decoration:none}
a:hover,a:focus-visible{text-decoration:underline}
a:focus-visible{outline:2px solid var(--lily);outline-offset:2px;border-radius:4px}
.host{display:block;color:var(--ink-muted);font-size:.85rem}
.item-title{font-family:var(--font-serif);font-weight:500;font-size:1.35rem;margin:0 0 4px}
p{margin:4px 0 0;white-space:pre-wrap}
.todo{display:flex;gap:12px;align-items:baseline}
.mark{flex:none;width:1.2em;color:var(--lily)}
.todo.done .text{color:var(--ink-muted);text-decoration:line-through}
.empty{color:var(--ink-muted)}
footer{max-width:640px;margin:0 auto;padding:24px 16px 48px;color:var(--ink-muted);font-size:.85rem;text-align:center}
`;

const layout = (title: string, inner: string): string =>
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title>
<style>${CSS}</style></head><body>
${inner}
<footer>Shared with Atelier</footer>
</body></html>`;

function renderItem(item: ShareItem): string {
  if (item.kind === 'link') {
    const href = item.url && isLinkUrl(item.url) ? item.url : null;
    const label = escapeHtml(item.title || item.url || 'Untitled');
    const head = href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a><span class="host">${escapeHtml(hostOf(href))}</span>`
      : `<span>${label}</span>`;
    const note = item.note?.trim() ? `<p>${escapeHtml(item.note.trim())}</p>` : '';
    return `<li>${head}${note}</li>`;
  }
  if (item.kind === 'todo') {
    const mark = item.done ? '&#10003;' : '&#9675;';
    const state = item.done ? 'Done' : 'Not done';
    return `<li class="todo${item.done ? ' done' : ''}"><span class="mark" role="img" aria-label="${state}">${mark}</span><span class="text">${escapeHtml(item.title)}</span></li>`;
  }
  const paras = bodyParagraphs(item.body).map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  return `<li><h2 class="item-title">${escapeHtml(item.title)}</h2>${paras}</li>`;
}

export function renderSharePage(category: ShareCategory, items: ShareItem[]): string {
  const emoji = category.emoji ? `<span class="emoji">${escapeHtml(category.emoji)}</span>` : '';
  const list = items.length ? `<ul>${items.map(renderItem).join('')}</ul>` : `<p class="empty">Nothing here yet.</p>`;
  return layout(category.name, `<main><h1>${emoji}${escapeHtml(category.name)}</h1>${list}</main>`);
}

export function renderNotFoundPage(): string {
  return layout('Link not available', `<main><h1>This link isn't available</h1><p class="empty">It may have been turned off or removed by whoever shared it.</p></main>`);
}
