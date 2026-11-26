// The HTML for a pull quote or blockquote image: the quote in the style's
// font, a large quote mark and an accent rule, an attribution when there is
// one, and the watermark.

import type { LoadedStyle } from '../styles.js';

const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fam = (family: string | undefined, fallback: string) => (family ? `${JSON.stringify(family)}, ${fallback}` : fallback);

/** The quote as paragraphs (split on blank lines), and an optional attribution. */
export function pullquoteHtml(quote: string, attribution: string | null, loaded: LoadedStyle): string {
  const { style } = loaded;
  const c = style.colors;
  const p = style.pullquote;
  const accent = p.ruleColor ?? c.strongRule;
  const font = p.font === 'heading' ? (style.fonts.heading ?? style.fonts.text) : style.fonts.text;
  const serif = p.font === 'heading' && style.fonts.heading ? 'serif' : 'sans-serif';
  const text = fam(style.fonts.text.family, 'sans-serif');
  const wm = style.watermark;
  const paras = quote
    .split(/\n\s*\n/)
    .map((s) => `<p>${escape(s.trim())}</p>`)
    .join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html { background: ${c.background}; }
  body { margin: 0; display: inline-block; background: ${c.background}; position: relative; }
  .quote { box-sizing: border-box; width: ${p.width}px; padding: ${p.padding}px ${p.padding}px ${wm ? p.padding + 14 : p.padding}px; color: ${c.text}; }
  .inner { border-left: 6px solid ${accent}; padding-left: ${Math.round(p.padding / 2)}px; position: relative; }
  .mark { font-family: ${fam(font.family, serif)}; font-weight: bold; font-size: ${Math.round(p.fontSize * 2.6)}px; line-height: 0.8; color: ${accent}; height: ${Math.round(p.fontSize * 1.2)}px; }
  p { margin: 0 0 ${Math.round(p.fontSize * 0.6)}px; font-family: ${fam(font.family, serif)}; font-weight: bold; font-size: ${p.fontSize}px; line-height: 1.3; }
  p:last-of-type { margin-bottom: 0; }
  .by { margin-top: ${Math.round(p.fontSize * 0.7)}px; font-family: ${text}; font-size: ${Math.round(p.fontSize * 0.55)}px; color: ${c.muted}; }
  .watermark { position: absolute; bottom: ${Math.round(p.padding / 2)}px; ${wm?.position === 'bottom-left' ? 'left' : 'right'}: ${p.padding}px; font-family: ${text}; font-size: 11px; color: ${c.muted}; }
</style></head>
<body><div class="quote"><div class="inner">${p.quoteMark ? '<div class="mark">\u201c</div>' : ''}
${paras}${attribution ? `\n<div class="by">\u2014 ${escape(attribution)}</div>` : ''}
</div></div>${wm ? `<div class="watermark">${escape(wm.text)}</div>` : ''}</body></html>`;
}
