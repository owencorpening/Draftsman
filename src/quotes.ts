// Pull quotes and blockquotes: finding where a quote comes from, word for
// word, and listing the article's blockquotes.
//
// "Word for word" ignores only whitespace, inline markdown (bold, italic,
// code, link markup) and typographic variants of quote marks, apostrophes,
// dashes and the ellipsis. Any other difference is refused.

import { findBlocks, findFences, isBlank, parseDoc } from './markdown.js';
import { findTables } from './tables.js';

/** Inline markdown removed, whitespace collapsed: the text as a reader sees it. */
export function stripInline(s: string): string {
  const codes: string[] = [];
  let out = s.replace(/(`+)([\s\S]+?)\1/g, (_, __, code: string) => {
    codes.push(code.trim());
    return `\ue000${codes.length - 1}\ue000`;
  });
  out = out
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>"'])/g, (_, c: string) => `\ue001${c.charCodeAt(0)}\ue001`)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/\*\*|~~/g, '')
    .replace(/\*/g, '')
    .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, '$1')
    .replace(/\ue001(\d+)\ue001/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\ue000(\d+)\ue000/g, (_, n: string) => codes[Number(n)]!);
  return out.replace(/[\s\u00a0\u2000-\u200b\u202f\u205f\u3000]+/g, ' ').trim();
}

/** Typographic variants folded to one form, for comparing. */
export function fold(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/\u2026/g, '...');
}

const compare = (s: string) => fold(stripInline(s));

export interface Paragraph {
  /** 1-based first and last lines. */
  startLine: number;
  endLine: number;
  /** The text as a reader sees it. */
  text: string;
}

const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const QUOTE = /^ {0,3}>/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const IMAGE_ONLY = /^\s*\[?!\[[^\]]*\]\([^)]*\)(\]\([^)]*\))?\s*$/;

/** The article's prose paragraphs: not code, headings, tables, blockquotes, rules or lone images. */
export function paragraphs(text: string): Paragraph[] {
  const { lines } = parseDoc(text);
  const { fenceOf } = findFences(lines);
  const tableLines = new Set<number>();
  for (const t of findTables(text)) for (let l = t.startLine; l <= t.endLine; l++) tableLines.add(l - 1);
  const out: Paragraph[] = [];
  for (const [start, end] of findBlocks(lines)) {
    const first = lines[start]!;
    if (fenceOf[start] || tableLines.has(start) || HEADING.test(first) || QUOTE.test(first) || RULE.test(first)) continue;
    if (end === start && IMAGE_ONLY.test(first)) continue;
    const joined = lines
      .slice(start, end + 1)
      .map((l) => l.replace(/\\$/, ''))
      .join(' ');
    out.push({ startLine: start + 1, endLine: end + 1, text: stripInline(joined) });
  }
  return out;
}

export class QuoteError extends Error {}

/** A quote's text for the image: inline markdown gone, and any quote marks wrapped around the whole of it. */
export function quoteText(quote: string): string {
  const t = stripInline(quote);
  const m = /^["'\u201c\u2018](.*)["'\u201d\u2019]$/s.exec(t);
  return m ? m[1]!.trim() : t;
}

const snippet = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}\u2026` : s);

/**
 * Finds the one paragraph a quote comes from, word for word. With a line, only
 * the paragraph holding that line is searched. Throws a QuoteError saying
 * where the quote stops matching, or which lines it appears on when it's ambiguous.
 */
export function locateQuote(text: string, quote: string, line?: number): Paragraph {
  const wanted = fold(quoteText(quote));
  if (!wanted) throw new QuoteError('The quote is empty.');
  let paras = paragraphs(text);
  if (line !== undefined) {
    paras = paras.filter((p) => p.startLine <= line && line <= p.endLine);
    if (!paras.length) throw new QuoteError(`Line ${line} isn't in a paragraph of prose.`);
  }
  const hits = paras.filter((p) => fold(p.text).includes(wanted));
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) {
    throw new QuoteError(`The quote appears in more than one paragraph (lines ${hits.map((h) => h.startLine).join(', ')}). Give the line of the one to use.`);
  }

  // Not found: say how far it matches, and where it differs.
  let best = { k: 0, para: undefined as Paragraph | undefined, at: -1 };
  for (const p of paras) {
    const f = fold(p.text);
    let lo = 0;
    let hi = wanted.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (f.includes(wanted.slice(0, mid))) lo = mid;
      else hi = mid - 1;
    }
    if (lo > best.k) best = { k: lo, para: p, at: f.indexOf(wanted.slice(0, lo)) };
  }
  // Back up to a word boundary so the message names whole words.
  const cut = best.k > 0 ? Math.max(0, wanted.lastIndexOf(' ', best.k - 1)) : 0;
  if (!best.para || best.k < Math.min(12, wanted.length)) {
    throw new QuoteError('The quote is not in the article word for word. A pull quote has to be copied exactly from one paragraph.');
  }
  const f = fold(best.para.text);
  const words = (s: string) => s.trim().split(' ').slice(0, 6).join(' ');
  const articleNext = words(f.slice(best.at + cut));
  const quoteNext = words(wanted.slice(cut));
  const ends = best.at + best.k >= f.length;
  throw new QuoteError(
    `The quote is not in the article word for word. It matches the paragraph at line ${best.para.startLine} up to "${snippet(wanted.slice(0, cut).trim().split(' ').slice(-6).join(' '))}", ` +
      (ends
        ? `where the paragraph ends; a pull quote has to come from one paragraph.`
        : `then the article has "${snippet(articleNext)}" where the quote has "${snippet(quoteNext)}".`) +
      ' Copy the text exactly, without cutting words out.',
  );
}

export interface Blockquote {
  /** 1-based first and last lines. */
  startLine: number;
  endLine: number;
  /** "quote", or "alert" for a GitHub alert like > [!NOTE], which can't be rendered. */
  kind: 'quote' | 'alert';
  /** The quote's markdown without the > markers or the attribution line. */
  markdown: string;
  /** The same as a reader sees it, paragraphs joined by a blank line. */
  text: string;
  /** From a last line like "\u2014 Name", when there is one. */
  attribution: string | null;
}

const ALERT = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
/** A last line starting with an em dash, en dash or "--". A single hyphen starts a list item, so it doesn't count. */
const ATTRIBUTION = /^\s*(?:\u2014|\u2015|--|\u2013)\s*(\S.*)$/;

/** Every blockquote outside code. */
export function findBlockquotes(text: string): Blockquote[] {
  const { lines } = parseDoc(text);
  const { fenceOf } = findFences(lines);
  const out: Blockquote[] = [];
  for (const [start, end] of findBlocks(lines)) {
    if (fenceOf[start] || !QUOTE.test(lines[start]!)) continue;
    const inner = lines.slice(start, end + 1).map((l) => l.replace(/^ {0,3}> ?/, ''));
    const kind = ALERT.test(inner[0] ?? '') ? 'alert' : 'quote';
    let attribution: string | null = null;
    const lastIdx = inner.map((l, i) => (isBlank(l) ? -1 : i)).filter((i) => i >= 0).pop();
    if (lastIdx !== undefined && lastIdx > 0) {
      const m = ATTRIBUTION.exec(inner[lastIdx]!);
      if (m) {
        attribution = stripInline(m[1]!);
        inner.splice(lastIdx, 1);
      }
    }
    while (inner.length && isBlank(inner[inner.length - 1]!)) inner.pop();
    const paras: string[][] = [[]];
    for (const l of inner) {
      if (isBlank(l)) {
        if (paras[paras.length - 1]!.length) paras.push([]);
      } else paras[paras.length - 1]!.push(l.replace(/\\$/, ''));
    }
    out.push({
      startLine: start + 1,
      endLine: end + 1,
      kind,
      markdown: inner.join('\n'),
      text: paras
        .filter((p) => p.length)
        .map((p) => stripInline(p.join(' ')))
        .join('\n\n'),
      attribution,
    });
  }
  return out;
}

/** True when the article already has a pull quote image whose alt text is this quote. */
export function alreadyPlaced(text: string, quote: string): boolean {
  const wanted = compare(quoteText(quote));
  for (const m of text.matchAll(/!\[((?:\\.|[^\]\\])*)\]\(([^)]*pullquote[^)]*)\)/g)) {
    if (compare(m[1]!.replace(/\\([\\[\]])/g, '$1')) === wanted) return true;
  }
  return false;
}
