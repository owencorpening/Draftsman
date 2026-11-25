// Small, dependency-free helpers for reading markdown line by line.
// Draftsman edits the writer's own files, so these keep line endings and the
// final newline exactly as they were.

export interface Doc {
  lines: string[];
  eol: '\n' | '\r\n';
  finalNewline: boolean;
}

export function parseDoc(text: string): Doc {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const finalNewline = text.endsWith('\n');
  const body = finalNewline ? text.slice(0, text.endsWith('\r\n') ? -2 : -1) : text;
  const lines = text === '' ? [] : body.split(/\r?\n/);
  return { lines, eol, finalNewline };
}

export function formatDoc(doc: Doc): string {
  if (doc.lines.length === 0) return '';
  return doc.lines.join(doc.eol) + (doc.finalNewline ? doc.eol : '');
}

export const isBlank = (line: string): boolean => line.trim() === '';

export interface Fence {
  /** 0-based index of the opening fence line. */
  start: number;
  /** 0-based index of the closing fence line, or the last line if never closed. */
  end: number;
  closed: boolean;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Fenced code blocks (``` or ~~~), following CommonMark's rule that a fence
 * closes on the same character, at least as long, with nothing after it.
 * fenceOf[i] is the fence holding line i (fence lines included), or undefined.
 */
export function findFences(lines: string[]): { fences: Fence[]; fenceOf: (Fence | undefined)[] } {
  const fences: Fence[] = [];
  const fenceOf: (Fence | undefined)[] = new Array(lines.length).fill(undefined);
  let open: { start: number; char: string; length: number } | undefined;

  lines.forEach((line, i) => {
    if (!open) {
      const m = FENCE_OPEN.exec(line);
      const marker = m?.[1];
      // A backtick fence's info string can't contain a backtick.
      if (marker && !(marker[0] === '`' && line.slice(m.index + m[0].length).includes('`'))) {
        open = { start: i, char: marker[0]!, length: marker.length };
      }
      return;
    }
    const close = new RegExp(`^ {0,3}\\${open.char}{${open.length},}\\s*$`);
    if (close.test(line)) {
      const fence = { start: open.start, end: i, closed: true };
      fences.push(fence);
      for (let j = fence.start; j <= fence.end; j++) fenceOf[j] = fence;
      open = undefined;
    }
  });

  if (open) {
    const fence = { start: open.start, end: lines.length - 1, closed: false };
    fences.push(fence);
    for (let j = fence.start; j <= fence.end; j++) fenceOf[j] = fence;
  }
  return { fences, fenceOf };
}

/** Replaces inline code spans with spaces, so their contents are never read as markdown. Columns stay put. */
export function maskInlineCode(line: string): string {
  return line.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) => ' '.repeat(m.length));
}

/**
 * Blocks are runs of non-blank lines; a fenced code block is always one block,
 * even if it holds blank lines. Returns [start, end] 0-based, inclusive.
 */
export function findBlocks(lines: string[]): [number, number][] {
  const { fenceOf } = findFences(lines);
  const blocks: [number, number][] = [];
  let i = 0;
  while (i < lines.length) {
    if (isBlank(lines[i]!) && !fenceOf[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && (!isBlank(lines[i]!) || fenceOf[i])) {
      const fence = fenceOf[i];
      i = fence ? fence.end + 1 : i + 1;
    }
    blocks.push([start, i - 1]);
  }
  return blocks;
}
