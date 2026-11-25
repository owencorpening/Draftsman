// Figure numbering. A figure is any caption line starting "Figure N" or
// "Fig. N" (optionally in * or _). Captions are numbered 1, 2, 3 … in
// document order, and references in the text ("Figure 3", "Figures 2 and 3",
// "Figs. 2–4") are rewritten so they still point at the same figures.

import { findFences, formatDoc, parseDoc } from './markdown.js';

/**
 * A caption: an optional emphasis marker, then Figure/Fig., a number or "?"
 * (a new figure), and a period or colon. The punctuation is what tells a
 * caption ("Figure 2. Storage") from prose that starts a line ("Figure 2 shows…").
 */
const CAPTION = /^(\s*(?:\*\*|__|\*|_)?\s*)(Figure|Fig\.)(\s+)(\d+|\?)(?=[.:])/;

/** A reference: Figure(s)/Fig(s). and a list or range of numbers. */
const REFERENCE = /\b(Figures?|Figs?\.)(\s+)(\d+(?:\s*(?:,|and|&|–|—|-|to)\s*\d+)*)\b/g;

export interface Renumbered {
  text: string;
  /** Each caption: its line, the number it had ("?" for a new one) and the number it has now. */
  figures: { line: number; from: string; to: number }[];
  /** References rewritten. */
  updated: { line: number; from: string; to: string }[];
  /** References that couldn't be followed: to a figure that no longer exists, or to a number two captions share. */
  problems: { line: number; reference: string; why: string }[];
}

/** Replaces inline code with spaces so its contents aren't read as references; columns stay put. */
function maskCode(line: string): string {
  return line.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) => ' '.repeat(m.length));
}

export function renumberFigures(text: string): Renumbered {
  const doc = parseDoc(text);
  const { fenceOf } = findFences(doc.lines);

  // 1. Captions, in order.
  const figures: Renumbered['figures'] = [];
  doc.lines.forEach((line, i) => {
    if (fenceOf[i]) return;
    const m = CAPTION.exec(line);
    if (m) figures.push({ line: i + 1, from: m[4]!, to: figures.length + 1 });
  });

  // Old number → new number, for numbers exactly one caption had.
  const count = new Map<string, number>();
  for (const f of figures) count.set(f.from, (count.get(f.from) ?? 0) + 1);
  const map = new Map<number, number>();
  for (const f of figures) if (f.from !== '?' && count.get(f.from) === 1) map.set(Number(f.from), f.to);

  const updated: Renumbered['updated'] = [];
  const problems: Renumbered['problems'] = [];

  doc.lines = doc.lines.map((line, i) => {
    if (fenceOf[i]) return line;
    let out = line;
    // 2. The caption's own number.
    const cap = CAPTION.exec(out);
    let skip = 0;
    if (cap) {
      const f = figures.find((x) => x.line === i + 1)!;
      out = out.replace(CAPTION, `$1$2$3${f.to}`);
      skip = cap[0].length - cap[4]!.length + String(f.to).length;
    }
    // 3. References elsewhere on the line, read from the original numbers.
    const masked = maskCode(out);
    const pieces: { start: number; end: number; text: string }[] = [];
    for (const m of masked.slice(skip).matchAll(REFERENCE)) {
      const start = skip + m.index;
      const original = out.slice(start, start + m[0].length);
      const numbers = m[3]!.match(/\d+/g)!.map(Number);
      const bad = numbers.filter((n) => !map.has(n));
      if (bad.length) {
        for (const n of bad) {
          const shared = (count.get(String(n)) ?? 0) > 1;
          problems.push({
            line: i + 1,
            reference: original,
            why: shared ? `two captions are numbered ${n}, so it's unclear which one this means` : `there's no figure ${n}`,
          });
        }
        continue;
      }
      const replaced = original.replace(/\d+/g, (d) => String(map.get(Number(d))));
      if (replaced !== original) {
        pieces.push({ start, end: start + m[0].length, text: replaced });
        updated.push({ line: i + 1, from: original, to: replaced });
      }
    }
    for (const p of pieces.reverse()) out = out.slice(0, p.start) + p.text + out.slice(p.end);
    return out;
  });

  return { text: formatDoc(doc), figures, updated, problems };
}
