// Bullet and numbered lists: finding them with their items and context, so
// the AI can judge whether a list is really a table, an argument or a paragraph.

import { findBlocks, findFences, isBlank, parseDoc } from './markdown.js';
import { stripInline } from './quotes.js';

export interface ListItem {
  /** 1-based line where the item starts. */
  line: number;
  /** The item's text as a reader sees it, continuation lines joined. */
  text: string;
  /** Nested items under this one. */
  children: ListItem[];
}

export interface MarkdownList {
  /** 1-based first and last lines. */
  startLine: number;
  endLine: number;
  ordered: boolean;
  items: ListItem[];
  /** The list exactly as written. */
  markdown: string;
  /** The block before the list and the block after it, or "" at either end of the file. */
  before: string;
  after: string;
}

const ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const indentOf = (l: string) => /^ */.exec(l)![0].length;

interface Open {
  item: ListItem;
  /** Column where the item's text starts; deeper lines belong to it. */
  content: number;
  parts: string[];
}

/** Every top-level list outside code and blockquotes. */
export function findLists(text: string): MarkdownList[] {
  const { lines } = parseDoc(text);
  const { fenceOf } = findFences(lines);
  const blocks = findBlocks(lines);
  const blockText = (b: [number, number] | undefined) => (b ? lines.slice(b[0], b[1] + 1).join('\n') : '');
  const lists: MarkdownList[] = [];

  const top = (i: number) => {
    const m = ITEM.exec(lines[i]!);
    return m && m[1]!.length <= 3 && !RULE.test(lines[i]!) && !fenceOf[i] ? m : null;
  };

  let i = 0;
  while (i < lines.length) {
    const first = top(i);
    if (!first) {
      i++;
      continue;
    }
    const ordered = /\d/.test(first[2]!);
    const kind = ordered ? first[2]!.slice(-1) : first[2]!;
    const start = i;
    const items: ListItem[] = [];
    const stack: Open[] = [];
    const close = (depth: number) => {
      while (stack.length > depth) {
        const o = stack.pop()!;
        o.item.text = stripInline(o.parts.join(' '));
      }
    };
    let last = i;
    let j = i;
    let prevBlank = false;
    for (; j < lines.length; j++) {
      const l = lines[j]!;
      if (isBlank(l) && !fenceOf[j]) {
        // A blank line ends the list unless more of it follows.
        let k = j + 1;
        while (k < lines.length && isBlank(lines[k]!)) k++;
        const next = lines[k];
        const nm = next !== undefined ? ITEM.exec(next) : null;
        const sameKind = nm && nm[1]!.length <= 3 && (ordered ? /\d/.test(nm[2]!) && nm[2]!.slice(-1) === kind : nm[2] === kind);
        if (next === undefined || (!sameKind && indentOf(next) < (stack[0]?.content ?? 2))) break;
        prevBlank = true;
        continue;
      }
      const m = fenceOf[j] ? null : ITEM.exec(l);
      if (m && !RULE.test(l)) {
        const indent = m[1]!.length;
        // Find the parent: the deepest open item whose content column this line reaches.
        let depth = 0;
        while (depth < stack.length && indent >= stack[depth]!.content) depth++;
        if (depth === 0) {
          const sameKind = ordered ? /\d/.test(m[2]!) && m[2]!.slice(-1) === kind : m[2] === kind;
          if (!sameKind || indent > 3) break;
        }
        close(depth);
        const item: ListItem = { line: j + 1, text: '', children: [] };
        (depth === 0 ? items : stack[depth - 1]!.item.children).push(item);
        stack.push({ item, content: indent + m[2]!.length + Math.max(1, Math.min(m[3]!.length, 4)), parts: [m[4]!] });
        last = j;
        prevBlank = false;
        continue;
      }
      // Continuation: indented under an open item, or a lazy line right after text.
      const indent = indentOf(l);
      let depth = stack.length;
      while (depth > 0 && indent < stack[depth - 1]!.content) depth--;
      if (depth > 0) {
        close(depth);
        if (!fenceOf[j]) stack[depth - 1]!.parts.push(l.trim());
      } else if (!prevBlank && stack.length) {
        stack[stack.length - 1]!.parts.push(l.trim());
      } else break;
      last = j;
      prevBlank = false;
    }
    close(0);
    const bi = blocks.findIndex(([s, e]) => s <= start && start <= e);
    const ai = blocks.findIndex(([s]) => s > last);
    lists.push({
      startLine: start + 1,
      endLine: last + 1,
      ordered,
      items,
      markdown: lines.slice(start, last + 1).join('\n'),
      before: bi > 0 && blocks[bi]![0] === start ? blockText(blocks[bi - 1]) : bi >= 0 && blocks[bi]![0] < start ? lines.slice(blocks[bi]![0], start).join('\n') : '',
      after: ai >= 0 ? blockText(blocks[ai]) : '',
    });
    i = last + 1;
  }
  return lists;
}
