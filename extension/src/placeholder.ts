// Where the image placeholder goes, and its text. No VS Code here, so it's
// the same rule as the server's mark_slot: the placeholder is its own block,
// and a paragraph is never split.

export const PENDING = 'draftsman:pending';

/** ![description](draftsman:pending), with brackets and backslashes escaped and the description on one line. */
export function placeholderText(description: string): string {
  const one = description.replace(/\s+/g, ' ').trim();
  return `![${one.replace(/[\\[\]]/g, '\\$&')}](${PENDING})`;
}

export interface PlaceholderEdit {
  /** 0-based line whose text is replaced (from column 0 to its end). */
  line: number;
  /** The new text for that line; may hold line breaks. */
  text: string;
}

const blank = (s: string | undefined) => s === undefined || s.trim() === '';

/**
 * On a blank line, the placeholder takes that line, with blank lines added
 * around it only where needed. Inside text, it goes after the end of the
 * cursor's paragraph, so the paragraph stays whole.
 */
export function placeholderEdit(lines: string[], cursorLine: number, description: string): PlaceholderEdit {
  const ph = placeholderText(description);
  if (blank(lines[cursorLine])) {
    const before = cursorLine > 0 && !blank(lines[cursorLine - 1]) ? '\n' : '';
    const after = cursorLine < lines.length - 1 && !blank(lines[cursorLine + 1]) ? '\n' : '';
    return { line: cursorLine, text: `${before}${ph}${after}` };
  }
  let end = cursorLine;
  while (end + 1 < lines.length && !blank(lines[end + 1])) end++;
  return { line: end, text: `${lines[end]}\n\n${ph}` };
}
