// apply_change and undo_change: one accepted edit at a time, each reversible.
//
// A change names the exact lines it replaces, so it is never made against a
// stale reading. The history lives in Draftsman's cache folder, one file per
// article, never beside the article.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ImageError } from './images.js';
import { formatDoc, parseDoc } from './markdown.js';

/** The tools whose edits go in the undo history. */
export type ChangeTool = 'apply_change' | 'render_pullquote' | 'renumber_figures' | 'place_image' | 'render_table';

export interface Entry {
  at: string;
  /** The tool that made the change; histories written before this field are apply_change. */
  tool?: ChangeTool;
  /** 0-based line where the change was made. */
  start: number;
  original: string[];
  replacement: string[];
  /** The lines around the change, to find a deletion again. */
  before: string | null;
  after: string | null;
}

/** Lines of a snippet the AI sent: line endings normalized, one trailing newline dropped. */
const linesOf = (s: string): string[] => {
  const t = s.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  return t === '' ? [] : t.split('\n');
};

const same = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);

/** What undoing leaves behind, by tool, so the user isn't surprised. */
const UNDO_NOTES: Partial<Record<ChangeTool, string>> = {
  place_image: 'The image file and its provenance file are still in the images folder; delete them if you no longer want them.',
  render_pullquote: 'The pull quote image and its provenance file are still in the images folder; delete them if you no longer want them.',
  render_table:
    'The table is back, but the Google Sheet made for it is still in your Drive and anyone with its link can still open it. Delete it in Drive if you no longer want it. The image file is still in the images folder.',
};

export class Changes {
  constructor(private readonly o: { cwd: string; cacheDir: string; now?: () => Date }) {}

  private article(p: string): string {
    const full = path.resolve(this.o.cwd, p);
    if (!/\.(md|markdown)$/i.test(full)) throw new ImageError(`${p} is not a markdown file (.md or .markdown).`);
    return full;
  }

  private historyFile(full: string): string {
    return path.join(this.o.cacheDir, 'changes', createHash('sha256').update(full).digest('hex') + '.json');
  }

  private async history(full: string): Promise<Entry[]> {
    try {
      const h = JSON.parse(await readFile(this.historyFile(full), 'utf8')) as { path: string; changes: Entry[] };
      return h.path === full ? h.changes : [];
    } catch {
      return [];
    }
  }

  private async save(full: string, changes: Entry[]): Promise<void> {
    const file = this.historyFile(full);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify({ path: full, changes }, null, 2));
    await rename(`${file}.tmp`, file);
  }

  private async read(full: string): Promise<string> {
    return readFile(full, 'utf8').catch(() => {
      throw new ImageError(`${full} does not exist.`);
    });
  }

  /** Replaces lines startLine..endLine, which must still read `original`, with `replacement`. */
  async apply(args: { path: string; startLine: number; endLine: number; original: string; replacement: string }) {
    const full = this.article(args.path);
    const doc = parseDoc(await this.read(full));
    const { startLine, endLine } = args;
    if (endLine < startLine || startLine < 1 || endLine > doc.lines.length) {
      throw new ImageError(`Lines ${startLine}–${endLine} aren't in the article, which has ${doc.lines.length} lines.`);
    }
    const current = doc.lines.slice(startLine - 1, endLine);
    if (!same(current, linesOf(args.original))) {
      throw new ImageError(
        `Lines ${startLine}–${endLine} no longer read as expected, so nothing was changed. Read the article again. They now read:\n${current.join('\n')}`,
      );
    }
    const replacement = linesOf(args.replacement);
    const entry: Entry = {
      at: this.now(),
      tool: 'apply_change',
      start: startLine - 1,
      original: current,
      replacement,
      before: doc.lines[startLine - 2] ?? null,
      after: doc.lines[endLine] ?? null,
    };
    doc.lines.splice(startLine - 1, current.length, ...replacement);
    const history = await this.history(full);
    // History first: if writing the article fails, the extra entry is harmless (undo finds nothing to reverse).
    await this.save(full, [...history, entry]);
    await writeFile(full, formatDoc(doc));
    return {
      path: full,
      startLine,
      endLine: startLine + replacement.length - 1,
      replaced: current.length,
      inserted: replacement.length,
      undoable: history.length + 1,
    };
  }

  private now(): string {
    return (this.o.now ?? (() => new Date()))().toISOString();
  }

  /**
   * Records an edit another tool already made to an article, as one change
   * undo_change can reverse: the span from the first to the last line that
   * differs. Returns how many changes can now be undone, or null if the text
   * didn't change.
   */
  async record(fullPath: string, beforeText: string, afterText: string, tool: ChangeTool): Promise<number | null> {
    if (beforeText === afterText) return null;
    const full = path.resolve(fullPath);
    const a = parseDoc(beforeText).lines;
    const b = parseDoc(afterText).lines;
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let q = 0;
    while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
    // Only the line ending or final newline changed: nothing undo can put back by lines.
    if (p === a.length && p === b.length) return null;
    const entry: Entry = {
      at: this.now(),
      tool,
      start: p,
      original: a.slice(p, a.length - q),
      replacement: b.slice(p, b.length - q),
      before: a[p - 1] ?? null,
      after: a[a.length - q] ?? null,
    };
    const history = await this.history(full);
    await this.save(full, [...history, entry]);
    return history.length + 1;
  }

  /** The changes still in an article's history, oldest first. */
  async list(fullPath: string): Promise<Entry[]> {
    return this.history(path.resolve(fullPath));
  }

  /** Reverses the last change on the article, where its new text still stands. */
  async undo(args: { path: string }) {
    const full = this.article(args.path);
    const history = await this.history(full);
    const entry = history[history.length - 1];
    if (!entry) throw new ImageError('There is no change to undo in this article.');
    const doc = parseDoc(await this.read(full));
    const { lines } = doc;
    const n = entry.replacement.length;

    // Every place the new text still stands (for a deletion, where its neighbors meet), nearest first.
    const spots: number[] = [];
    for (let p = 0; p + n <= lines.length; p++) {
      if (!same(lines.slice(p, p + n), entry.replacement)) continue;
      if (n === 0 && !((lines[p - 1] ?? null) === entry.before && (lines[p] ?? null) === entry.after)) continue;
      spots.push(p);
    }
    if (!spots.length) {
      throw new ImageError(
        n === 0
          ? 'The last change deleted lines, and the text around that spot has been edited since, so it can’t be undone safely. Nothing was changed.'
          : `The last change’s new text has been edited since, so it can’t be undone safely. Nothing was changed. It read:\n${entry.replacement.join('\n')}`,
      );
    }
    const at = spots.sort((a, b) => Math.abs(a - entry.start) - Math.abs(b - entry.start))[0]!;
    lines.splice(at, n, ...entry.original);
    await writeFile(full, formatDoc(doc));
    await this.save(full, history.slice(0, -1));
    const note = UNDO_NOTES[entry.tool ?? 'apply_change'];
    return {
      path: full,
      tool: entry.tool ?? 'apply_change',
      startLine: at + 1,
      endLine: at + entry.original.length,
      restored: entry.original.length,
      undoable: history.length - 1,
      ...(note ? { note } : {}),
    };
  }
}
