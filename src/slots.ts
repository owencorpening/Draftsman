// Image placeholders ("slots"): a markdown image whose link is draftsman:pending,
// like ![drought map of Texas](draftsman:pending). They stay plain markdown and
// show as a missing image in any preview, so an unfilled spot is easy to see.

import { findBlocks, findFences, formatDoc, isBlank, maskInlineCode, parseDoc } from './markdown.js';

export const PENDING = 'draftsman:pending';

export interface Slot {
  /** 1-based line of the placeholder. */
  line: number;
  /** 1-based column where the placeholder starts. */
  column: number;
  /** The description the writer gave (the image's alt text). */
  description: string;
  /** The placeholder exactly as written. */
  markdown: string;
  /** The block (paragraph, list, heading run) that holds the placeholder. */
  paragraph: string;
  /** The block before it, or "" at the start of the file. */
  before: string;
  /** The block after it, or "" at the end of the file. */
  after: string;
}

// ![alt](draftsman:pending) with an optional <...> around the link and an
// optional title. The alt may contain escaped characters, like \], and one
// level of balanced brackets, like [2026], as CommonMark allows.
const SLOT =
  /!\[((?:\\.|[^[\]\\]|\[(?:\\.|[^[\]\\])*\])*)\]\(\s*(?:<draftsman:pending>|draftsman:pending)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

const unescape = (s: string): string => s.replace(/\\(.)/g, '$1');

/** Lists every placeholder in a markdown text, skipping code blocks and inline code. */
export function findSlots(text: string): Slot[] {
  const { lines } = parseDoc(text);
  const { fenceOf } = findFences(lines);
  const blocks = findBlocks(lines);
  const blockText = (b: [number, number] | undefined): string => (b ? lines.slice(b[0], b[1] + 1).join('\n') : '');

  const slots: Slot[] = [];
  lines.forEach((line, i) => {
    if (fenceOf[i]) return;
    const masked = maskInlineCode(line);
    for (const m of masked.matchAll(SLOT)) {
      const at = blocks.findIndex(([s, e]) => s <= i && i <= e);
      slots.push({
        line: i + 1,
        column: m.index + 1,
        description: unescape(m[1] ?? '').trim(),
        markdown: line.slice(m.index, m.index + m[0].length),
        paragraph: blockText(blocks[at]),
        before: blockText(blocks[at - 1]),
        after: blockText(blocks[at + 1]),
      });
    }
  });
  return slots;
}

export class SlotError extends Error {}

/** Builds the placeholder markdown for a description, escaping what would break it. */
export function placeholder(description: string): string {
  const d = description.trim();
  if (!d) throw new SlotError('The description is empty. Say in a few words what the image should show.');
  if (/[\r\n]/.test(d)) throw new SlotError('The description must be one line.');
  return `![${d.replace(/[\\[\]]/g, '\\$&')}](${PENDING})`;
}

/**
 * Inserts a placeholder as its own block so that it starts at `line` (1-based);
 * the line that was there moves down. `line` may be one past the last line, to
 * append. Blank lines are added around it only where needed.
 *
 * Refuses a spot inside a code block (it would not be a placeholder there) and
 * a spot between two non-blank lines (it would split the writer's paragraph).
 */
export function markSlot(text: string, line: number, description: string): { text: string; slot: Slot } {
  const ph = placeholder(description);
  const doc = parseDoc(text);
  const { lines } = doc;

  if (!Number.isInteger(line) || line < 1 || line > lines.length + 1) {
    throw new SlotError(`Line ${line} is outside the file, which has ${lines.length} line(s). Use 1 to ${lines.length + 1}.`);
  }

  const prev = line - 2; // 0-based index of the line above the insert point
  const next = line - 1; // 0-based index of the line that moves down
  // Inside a code block exactly when the line above is in a fence and isn't
  // that fence's closing line (a fence never closed runs to the end of the file).
  const prevFence = prev >= 0 ? findFences(lines).fenceOf[prev] : undefined;
  if (prevFence && !(prevFence.closed && prev === prevFence.end)) {
    throw new SlotError(`Line ${line} is inside a code block. Pick a line outside it.`);
  }

  const prevText = prev >= 0 && !isBlank(lines[prev]!);
  const nextText = next < lines.length && !isBlank(lines[next]!);
  if (prevText && nextText) {
    throw new SlotError(
      `Line ${line} is in the middle of a block (lines ${line - 1} and ${line} both have text), and a placeholder there would split it. Use a blank line or the start or end of a block.`,
    );
  }

  const insert = [...(prevText ? [''] : []), ph, ...(nextText ? [''] : [])];
  lines.splice(next, 0, ...insert);
  if (text === '') doc.finalNewline = true;

  const out = formatDoc(doc);
  const at = line + (prevText ? 1 : 0);
  const slot = findSlots(out).find((s) => s.line === at);
  if (!slot) throw new Error(`placeholder not found at line ${at} after inserting it`);
  return { text: out, slot };
}
