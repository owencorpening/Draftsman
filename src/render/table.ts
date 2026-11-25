// The HTML for a table image. The caption isn't drawn in the image: it stays
// in the article as text, so figure numbers can change without re-rendering.

import type { LoadedStyle } from '../styles.js';
import type { Table } from '../tables.js';

const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Inline markdown in a cell as HTML: code, bold, italic and strikethrough kept; links and images show their text. */
export function cellHtml(cell: string): string {
  const codes: string[] = [];
  let s = cell.replace(/(`+)(.+?)\1/g, (_, __, code: string) => {
    codes.push(code);
    return `\uE000${codes.length - 1}\uE000`;
  });
  s = s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!|~])/g, (_, c: string) => `\uE001${c.charCodeAt(0)}\uE001`);
  s = escape(s)
    .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
    .replace(/(\*|_)(.+?)\1/g, '<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/\uE001(\d+)\uE001/g, (_, n: string) => escape(String.fromCharCode(Number(n))))
    .replace(/\uE000(\d+)\uE000/g, (_, n: string) => `<code>${escape(codes[Number(n)]!)}</code>`);
  return s;
}

const fam = (family: string | undefined, fallback: string) => (family ? `${JSON.stringify(family)}, ${fallback}` : fallback);

export function tableHtml(table: Table, loaded: LoadedStyle): string {
  const { style } = loaded;
  const c = style.colors;
  const t = style.table;
  const text = fam(style.fonts.text.family, 'sans-serif');
  const heading = fam(style.fonts.heading?.family ?? style.fonts.text.family, 'sans-serif');
  const code = fam(style.fonts.code?.family, 'monospace');
  const align = (i: number) => (table.align[i] ? ` style="text-align:${table.align[i]}"` : '');
  const head = table.header.map((h, i) => `<th${align(i)}>${cellHtml(h)}</th>`).join('');
  const body = table.rows.map((r) => `<tr>${r.map((cell, i) => `<td${align(i)}>${cellHtml(cell)}</td>`).join('')}</tr>`).join('\n');
  const wm = style.watermark;

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html { background: ${c.background}; }
  body { margin: 0; display: inline-block; background: ${c.background}; position: relative; }
  .figure { padding: ${t.padding}px ${t.padding}px ${wm ? t.padding + 14 : t.padding}px; max-width: ${t.maxWidth}px; font-family: ${text}; color: ${c.text}; }
  table { border-collapse: collapse; font-size: ${t.fontSize}px; line-height: 1.35; }
  th, td { padding: 8px 16px; text-align: left; vertical-align: top; border-bottom: 1px solid ${c.rule}; }
  th { background: ${c.headerBackground}; color: ${c.headerText}; font-family: ${heading}; font-weight: bold; font-size: ${t.headerFontSize}px;${t.uppercaseHeader ? ' text-transform: uppercase; letter-spacing: 0.04em;' : ''} }
  td { font-variant-numeric: tabular-nums; }
  ${c.stripe ? `tbody tr:nth-child(even) td { background: ${c.stripe}; }` : ''}
  tbody tr:last-child td { border-bottom: 2px solid ${c.strongRule}; }
  code { font-family: ${code}; font-size: 0.92em; }
  .watermark { position: absolute; bottom: ${Math.round(t.padding / 2)}px; ${wm?.position === 'bottom-left' ? 'left' : 'right'}: ${t.padding}px; font-family: ${text}; font-size: 11px; color: ${c.muted}; }
</style></head>
<body><div class="figure"><table>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table></div>${wm ? `<div class="watermark">${escape(wm.text)}</div>` : ''}</body></html>`;
}
