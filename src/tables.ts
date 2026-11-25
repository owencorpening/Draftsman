// Markdown pipe tables (the GitHub kind): finding them, and reading their cells.

import { findBlocks, findFences, isBlank, maskInlineCode, parseDoc } from './markdown.js';

export type Align = 'left' | 'center' | 'right' | null;

export interface Table {
  /** 1-based first line (the header row). */
  startLine: number;
  /** 1-based last line. */
  endLine: number;
  header: string[];
  align: Align[];
  rows: string[][];
  /** The table exactly as written. */
  markdown: string;
  /** The block before the table, or "" at the start of the file. */
  before: string;
}

const DELIMITER_CELL = /^\s*:?-+:?\s*$/;

/**
 * Splits a row into cells on pipes that aren't escaped (\|) or inside inline
 * code, dropping the optional pipes at either end. Escaped pipes become plain.
 */
export function splitRow(line: string): string[] {
  const masked = maskInlineCode(line.replace(/\\\|/g, '\u0000\u0000'));
  const cells: string[] = [];
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '|') {
      cells.push(line.slice(start, i));
      start = i + 1;
    }
  }
  cells.push(line.slice(start));
  if (cells.length > 1 && cells[0]!.trim() === '') cells.shift();
  if (cells.length > 1 && cells[cells.length - 1]!.trim() === '') cells.pop();
  return cells.map((c) => c.trim().replace(/\\\|/g, '|'));
}

const hasPipe = (line: string): boolean => maskInlineCode(line.replace(/\\\|/g, '  ')).includes('|');

function delimiter(line: string): Align[] | undefined {
  if (!hasPipe(line) && !/^\s*:?-+:?\s*$/.test(line)) return undefined;
  const cells = splitRow(line);
  if (!cells.length || !cells.every((c) => DELIMITER_CELL.test(c))) return undefined;
  return cells.map((c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
  });
}

/** Lines that end a table even without a blank line: headings, quotes, fences, thematic breaks. */
const BLOCK_START = /^ {0,3}(#{1,6}\s|>|```|~~~|(?:[-*_]\s*){3,}$)/;

/** Every pipe table in the text, outside code. */
export function findTables(text: string): Table[] {
  const { lines } = parseDoc(text);
  const { fenceOf } = findFences(lines);
  const blocks = findBlocks(lines);
  const tables: Table[] = [];

  for (let i = 0; i + 1 < lines.length; i++) {
    if (fenceOf[i] || fenceOf[i + 1]) continue;
    const head = lines[i]!;
    if (isBlank(head) || !hasPipe(head) || /^ {4,}/.test(head)) continue;
    const align = delimiter(lines[i + 1]!);
    if (!align) continue;
    const header = splitRow(head);
    if (header.length !== align.length) continue;

    const rows: string[][] = [];
    let j = i + 2;
    while (j < lines.length && !fenceOf[j] && !isBlank(lines[j]!) && !BLOCK_START.test(lines[j]!)) {
      const cells = splitRow(lines[j]!);
      rows.push(header.map((_, k) => cells[k] ?? ''));
      j++;
    }
    const blockIndex = blocks.findIndex(([s, e]) => s <= i && i <= e);
    const blockStart = blocks[blockIndex]?.[0] ?? i;
    // Text right above the table in the same block counts as "before" too.
    const before =
      blockStart < i
        ? lines.slice(blockStart, i).join('\n')
        : blockIndex > 0
          ? lines.slice(blocks[blockIndex - 1]![0], blocks[blockIndex - 1]![1] + 1).join('\n')
          : '';
    tables.push({ startLine: i + 1, endLine: j, header, align, rows, markdown: lines.slice(i, j).join('\n'), before });
    i = j - 1;
  }
  return tables;
}

/** A cell as plain text: markdown emphasis, code and links reduced to their text. */
export function plainText(cell: string): string {
  return cell
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(`+)(.+?)\1/g, '$2')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!|~])/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .trim();
}
