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

interface Entry {
  at: string;
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
      at: (this.o.now ?? (() => new Date()))().toISOString(),
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
    return {
      path: full,
      startLine: at + 1,
      endLine: at + entry.original.length,
      restored: entry.original.length,
      undoable: history.length - 1,
    };
  }
}
