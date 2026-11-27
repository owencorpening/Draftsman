// Batch mode: plan_batch finds the articles under a folder or glob and dry-runs
// the whole job without changing anything; summarize_batch reports, per
// article, what changed since the plan. The AI does the work in between, one
// article and one job at a time, with the user's auto-accept settings.

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_SUMMARY_HEADINGS, findSummary } from './carousel.js';
import type { Changes, ChangeTool } from './changes.js';
import { renumberFigures } from './figures.js';
import { ImageError } from './images.js';
import { findLists } from './lists.js';
import { findBlockquotes } from './quotes.js';
import { findSlots } from './slots.js';
import { autoAcceptSettings, type AutoAccept, type Config } from './sources/load.js';
import { findTables } from './tables.js';

/** Folders a batch never walks into, besides any whose name starts with a dot. */
export const SKIPPED_FOLDERS = new Set([
  'node_modules',
  'bower_components',
  'src',
  'lib',
  'dist',
  'build',
  'out',
  'vendor',
  'target',
  'coverage',
  '__pycache__',
  'venv',
]);

export const MAX_ARTICLES = 200;

const MARKDOWN = /\.(md|markdown)$/i;
/** Carousel decks build_carousel wrote beside an article. */
const DECK = /-carousel\.md$/i;
const GLOB_CHARS = /[*?{[]/;

export const skipFolder = (name: string): boolean => name.startsWith('.') || SKIPPED_FOLDERS.has(name);

/** A glob over forward-slash paths: *, **, ?, {a,b} and [abc]. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      re += '(?:';
      depth++;
    } else if (c === '}' && depth) {
      re += ')';
      depth--;
    } else if (c === ',' && depth) re += '|';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end < 0) re += '\\[';
      else {
        re += '[' + glob.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']';
        i = end;
      }
    } else re += c.replace(/[.+^$()|\\\]]/g, '\\$&');
  }
  if (depth) throw new ImageError(`The pattern ${glob} has an unclosed {.`);
  return new RegExp(`^${re}$`);
}

const posix = (p: string) => p.split(path.sep).join('/');

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    // Symlinks aren't followed, so a link can't loop or lead out of the tree.
    if (e.isDirectory()) {
      if (!skipFolder(e.name)) await walk(full, out);
    } else if (e.isFile() && MARKDOWN.test(e.name) && !DECK.test(e.name)) out.push(full);
  }
}

/** The markdown articles a folder, file or glob names, sorted by path. */
export async function findArticles(target: string, cwd: string): Promise<string[]> {
  const found = await findUnsorted(target, cwd);
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function findUnsorted(target: string, cwd: string): Promise<string[]> {
  const t = target.trim();
  if (!t) throw new ImageError('Give a folder or a file pattern, like "posts" or "posts/**/*.md".');
  if (!GLOB_CHARS.test(t)) {
    const full = path.resolve(cwd, t);
    const s = await stat(full).catch(() => undefined);
    if (!s) throw new ImageError(`${full} does not exist.`);
    if (s.isFile()) {
      if (!MARKDOWN.test(full)) throw new ImageError(`${t} is not a markdown file (.md or .markdown).`);
      return [full];
    }
    const out: string[] = [];
    await walk(full, out);
    return out;
  }
  // The fixed part before the first wildcard is walked as given, even a dot folder the user named.
  const parts = posix(t).split('/');
  const first = parts.findIndex((p) => GLOB_CHARS.test(p));
  const base = path.resolve(cwd, parts.slice(0, first).join('/') || '.');
  const match = globToRegExp(parts.slice(first).join('/'));
  const out: string[] = [];
  await walk(base, out);
  return out.filter((f) => match.test(posix(path.relative(base, f))));
}

type Git = (args: string[], cwd: string) => Promise<{ ok: boolean; out: string; missing?: boolean }>;

const liveGit: Git = (args, cwd) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 1 << 20 }, (err, stdout) => {
      const missing = (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
      resolve({ ok: !err, out: String(stdout), ...(missing ? { missing } : {}) });
    });
  });

export type GitState = 'clean' | 'modified' | 'untracked' | 'ignored' | 'not under git' | 'git not installed';

/** Whether git has an article committed exactly as it stands. */
export async function gitState(file: string, git: Git = liveGit): Promise<GitState> {
  const dir = path.dirname(file);
  const top = await git(['rev-parse', '--show-toplevel'], dir);
  if (top.missing) return 'git not installed';
  if (!top.ok) return 'not under git';
  const s = await git(['status', '--porcelain=v1', '--ignored', '--', path.basename(file)], dir);
  if (!s.ok) return 'not under git';
  const line = s.out.split('\n').find((l) => l.trim());
  if (!line) return 'clean';
  if (line.startsWith('??')) return 'untracked';
  if (line.startsWith('!!')) return 'ignored';
  return 'modified';
}

const REFUSALS: Partial<Record<GitState, string>> = {
  modified: 'It has uncommitted changes. Commit or stash them first, so the batch’s changes stand apart.',
  untracked: 'Git doesn’t have it yet. Commit it first, so the batch’s changes stand apart.',
  ignored: 'Git ignores it, so there is no committed copy to go back to.',
};

export interface Work {
  imageSpots: number;
  tables: number;
  lists: number;
  blockquotes: number;
  figuresOutOfOrder: boolean;
  summaryBlock: boolean;
}

export function workIn(text: string, summaryHeadings = DEFAULT_SUMMARY_HEADINGS): Work {
  let summaryBlock = false;
  try {
    summaryBlock = findSummary(text, summaryHeadings) !== null;
  } catch {
    // A malformed summary is the carousel job's to report.
  }
  return {
    imageSpots: findSlots(text).length,
    tables: findTables(text).length,
    lists: findLists(text).length,
    blockquotes: findBlockquotes(text).filter((b) => b.kind !== 'alert').length,
    figuresOutOfOrder: renumberFigures(text).text !== text,
    summaryBlock,
  };
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

interface SavedPlan {
  batch: string;
  createdAt: string;
  target: string;
  articles: { path: string; hash: string; git: GitState }[];
  refused: { path: string; reason: string }[];
}

export interface BatchOptions {
  cwd: string;
  cacheDir: string;
  config: Pick<Config, 'autoAccept' | 'carousel'>;
  changes: Changes;
  git?: Git;
  now?: () => Date;
}

export class Batch {
  constructor(private readonly o: BatchOptions) {}

  private planFile(id: string): string {
    if (!/^[a-f0-9]{12}$/.test(id)) throw new ImageError(`${id} isn’t a batch id from plan_batch.`);
    return path.join(this.o.cacheDir, 'batches', `${id}.json`);
  }

  /** The dry run: what each article holds and whether it may be changed. Changes nothing in the project. */
  async plan(args: { target: string }) {
    const files = await findArticles(args.target, this.o.cwd);
    if (!files.length) throw new ImageError(`No markdown articles found for ${args.target} (node_modules, dot folders and code folders are skipped).`);
    const listed = files.slice(0, MAX_ARTICLES);
    const autoAccept: AutoAccept = autoAcceptSettings(this.o.config);
    const headings = this.o.config.carousel.summaryHeadings ?? DEFAULT_SUMMARY_HEADINGS;

    const articles: { path: string; git: GitState; work: Work }[] = [];
    const refused: { path: string; reason: string }[] = [];
    const saved: SavedPlan['articles'] = [];
    const outsideGit = new Set<string>();
    let gitMissing = false;

    for (const file of listed) {
      const state = await gitState(file, this.o.git);
      const reason = REFUSALS[state];
      if (reason) {
        refused.push({ path: file, reason });
        continue;
      }
      if (state === 'not under git') outsideGit.add(path.dirname(file));
      if (state === 'git not installed') gitMissing = true;
      const text = await readFile(file, 'utf8');
      articles.push({ path: file, git: state, work: workIn(text, headings) });
      saved.push({ path: file, hash: hash(text), git: state });
    }

    const warnings: string[] = [];
    if (gitMissing) warnings.push('Git isn’t installed, so nothing could be checked for uncommitted changes. undo_change is the only way back for every article.');
    for (const dir of outsideGit) warnings.push(`${dir} isn’t under git. undo_change is the only way back for its articles.`);
    if (files.length > listed.length) warnings.push(`Found ${files.length} articles; only the first ${MAX_ARTICLES} are in this batch. Narrow the pattern to reach the rest.`);
    if (autoAccept.tables) warnings.push('Tables are on auto-accept: every table becomes a new Google Sheet that anyone with the link can open.');

    const batch = randomBytes(6).toString('hex');
    const plan: SavedPlan = { batch, createdAt: (this.o.now ?? (() => new Date()))().toISOString(), target: args.target, articles: saved, refused };
    if (articles.length) {
      const file = this.planFile(batch);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(plan, null, 2));
      await rename(`${file}.tmp`, file);
    }
    return {
      batch: articles.length ? batch : null,
      target: args.target,
      dryRun: true,
      autoAccept,
      articles,
      refused,
      warnings,
      found: files.length,
    };
  }

  /** One entry per article in the batch: what changed through Draftsman's tools since the plan. */
  async summarize(args: { batch: string }) {
    const plan = await readFile(this.planFile(args.batch), 'utf8')
      .then((t) => JSON.parse(t) as SavedPlan)
      .catch(() => {
        throw new ImageError(`There’s no batch ${args.batch}. Start one with plan_batch.`);
      });
    const articles = [];
    for (const a of plan.articles) {
      const text = await readFile(a.path, 'utf8').catch(() => undefined);
      const entries = (await this.o.changes.list(a.path)).filter((e) => e.at >= plan.createdAt);
      const changes = entries.map((e) => ({
        tool: (e.tool ?? 'apply_change') as ChangeTool,
        at: e.at,
        startLine: e.start + 1,
        linesBefore: e.original.length,
        linesAfter: e.replacement.length,
      }));
      let note: string | undefined;
      if (text === undefined) note = 'The file is gone.';
      else if (!changes.length && hash(text) !== a.hash) note = 'Changed since the plan, but not through a Draftsman tool, so undo_change can’t reverse it.';
      articles.push({
        path: a.path,
        summary: changes.length ? `${changes.length} change${changes.length > 1 ? 's' : ''}: ${countBy(changes.map((c) => c.tool))}` : 'No changes.',
        changes,
        ...(note ? { note } : {}),
      });
    }
    return {
      batch: plan.batch,
      target: plan.target,
      planned: plan.createdAt,
      articles,
      refused: plan.refused,
      undo: 'Each change above is one edit; undo_change on an article reverses its changes one at a time, newest first.',
    };
  }
}

function countBy(xs: string[]): string {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${n} × ${k}`).join(', ');
}
