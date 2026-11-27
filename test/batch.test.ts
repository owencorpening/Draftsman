import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import { Batch, findArticles, gitState, globToRegExp } from '../src/batch.js';
import { Changes } from '../src/changes.js';
import { createServer } from '../src/server.js';
import { autoAcceptSettings, Config, loadConfig } from '../src/sources/load.js';

const ARTICLE = ['# Water', '', '![a dry riverbed](draftsman:pending)', '', '- Nile: 36 months', '- Indus: 6 months', '', '| A | B |', '| - | - |', '| 1 | 2 |', ''].join('\n');
const FIGURES = ['# F', '', '![b](b.png)', '', '*Figure 2. B.*', '', '![a](a.png)', '', '*Figure 1. A.*', '', 'See Figure 2.', ''].join('\n');

/** A project folder with the given files; `git: true` makes it a repo with everything committed. */
async function project(files: Record<string, string>, o: { git?: boolean; config?: object } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'draftsman-batch-'));
  const all = { ...files, ...(o.config ? { '.draftsman/config.json': JSON.stringify(o.config) } : {}) };
  for (const [name, text] of Object.entries(all)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), text);
  }
  if (o.git) {
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'start');
  }
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'draftsman-cache-'));
  return { dir, cacheDir, p: (f: string) => path.join(dir, f) };
}

function batchFor(dir: string, cacheDir: string, now?: () => Date) {
  const { config } = loadConfig(dir);
  const changes = new Changes({ cwd: dir, cacheDir, ...(now ? { now } : {}) });
  return { changes, batch: new Batch({ cwd: dir, cacheDir, config, changes, ...(now ? { now } : {}) }) };
}

describe('finding articles', () => {
  it('globs: *, **, ?, {a,b} and [abc]', () => {
    expect(globToRegExp('**/*.md').test('a/b/c.md')).toBe(true);
    expect(globToRegExp('**/*.md').test('c.md')).toBe(true);
    expect(globToRegExp('*.md').test('a/c.md')).toBe(false);
    expect(globToRegExp('post-?.{md,markdown}').test('post-1.markdown')).toBe(true);
    expect(globToRegExp('[ab].md').test('c.md')).toBe(false);
    expect(globToRegExp('a.md').test('aXmd')).toBe(false);
  });

  it('walks a folder, skipping node_modules, dot folders, code folders and carousel decks', async () => {
    const { dir, p } = await project({
      'posts/a.md': ARTICLE,
      'posts/deep/b.markdown': ARTICLE,
      'posts/a-carousel.md': 'deck',
      'posts/notes.txt': 'x',
      'node_modules/pkg/README.md': 'x',
      '.github/README.md': 'x',
      'posts/.drafts/c.md': 'x',
      'src/README.md': 'x',
      'dist/x.md': 'x',
      'README.md': 'x',
    });
    expect(await findArticles('.', dir)).toEqual([p('README.md'), p('posts/a.md'), p('posts/deep/b.markdown')]);
    expect(await findArticles('posts/**/*.md', dir)).toEqual([p('posts/a.md')]);
    expect(await findArticles('posts/*', dir)).toEqual([p('posts/a.md')]);
    expect(await findArticles(p('posts/deep/b.markdown'), dir)).toEqual([p('posts/deep/b.markdown')]);
    // A skipped folder named before any wildcard is walked, because the user asked for it.
    expect(await findArticles('posts/.drafts/*.md', dir)).toEqual([p('posts/.drafts/c.md')]);
    await expect(findArticles('nowhere', dir)).rejects.toThrow(/does not exist/);
    await expect(findArticles('posts/notes.txt', dir)).rejects.toThrow(/not a markdown file/);
  });
});

describe('plan_batch', () => {
  it('is a dry run: lists the work in each article and changes nothing', async () => {
    const { dir, cacheDir, p } = await project({ 'posts/a.md': ARTICLE, 'posts/f.md': FIGURES }, { git: true });
    const plan = await batchFor(dir, cacheDir).batch.plan({ target: 'posts' });
    expect(plan.dryRun).toBe(true);
    expect(plan.batch).toMatch(/^[a-f0-9]{12}$/);
    expect(plan.articles).toEqual([
      { path: p('posts/a.md'), git: 'clean', work: { imageSpots: 1, tables: 1, lists: 1, blockquotes: 0, figuresOutOfOrder: false, summaryBlock: false } },
      { path: p('posts/f.md'), git: 'clean', work: { imageSpots: 0, tables: 0, lists: 0, blockquotes: 0, figuresOutOfOrder: true, summaryBlock: false } },
    ]);
    expect(plan.refused).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(await readFile(p('posts/a.md'), 'utf8')).toBe(ARTICLE);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()).toBe('');
  });

  it('refuses articles with uncommitted changes, untracked or ignored by git, and says why', async () => {
    const { dir, cacheDir, p } = await project({ 'a.md': ARTICLE, 'b.md': ARTICLE, '.gitignore': 'ignored.md\n' }, { git: true });
    await writeFile(p('a.md'), ARTICLE + 'More.\n');
    await writeFile(p('new.md'), ARTICLE);
    await writeFile(p('ignored.md'), ARTICLE);
    const plan = await batchFor(dir, cacheDir).batch.plan({ target: '.' });
    expect(plan.articles.map((a) => a.path)).toEqual([p('b.md')]);
    expect(plan.refused).toEqual([
      { path: p('a.md'), reason: expect.stringMatching(/uncommitted changes/) },
      { path: p('ignored.md'), reason: expect.stringMatching(/ignores it/) },
      { path: p('new.md'), reason: expect.stringMatching(/doesn’t have it yet/) },
    ]);
  });

  it('says plainly when a folder isn’t under git, and keeps its articles', async () => {
    const { dir, cacheDir, p } = await project({ 'a.md': ARTICLE });
    expect(await gitState(p('a.md'))).toBe('not under git');
    const plan = await batchFor(dir, cacheDir).batch.plan({ target: '.' });
    expect(plan.articles.map((a) => [a.path, a.git])).toEqual([[p('a.md'), 'not under git']]);
    expect(plan.warnings).toEqual([`${dir} isn’t under git. undo_change is the only way back for its articles.`]);
  });

  it('says so when git isn’t installed', async () => {
    const { p } = await project({ 'a.md': ARTICLE });
    expect(await gitState(p('a.md'), async () => ({ ok: false, out: '', missing: true }))).toBe('git not installed');
  });

  it('errors when nothing is found, without saving a plan', async () => {
    const { dir, cacheDir } = await project({ 'notes.txt': 'x' });
    await expect(batchFor(dir, cacheDir).batch.plan({ target: '.' })).rejects.toThrow(/No markdown articles found/);
  });
});

describe('auto-accept', () => {
  it('is off for every job by default', async () => {
    const { dir, cacheDir } = await project({ 'a.md': ARTICLE });
    expect((await batchFor(dir, cacheDir).batch.plan({ target: '.' })).autoAccept).toEqual({
      pullquotes: false,
      figures: false,
      lists: false,
      images: false,
      tables: false,
    });
  });

  it('true turns on everything but tables, which need their own switch', () => {
    expect(autoAcceptSettings(Config.parse({ autoAccept: true }))).toEqual({ pullquotes: true, figures: true, lists: true, images: true, tables: false });
    expect(autoAcceptSettings(Config.parse({ autoAccept: { lists: true } }))).toEqual({ pullquotes: false, figures: false, lists: true, images: false, tables: false });
    expect(autoAcceptSettings(Config.parse({ autoAccept: { tables: true } })).tables).toBe(true);
  });

  it('warns in the plan when tables are on, because each makes a shared Google Sheet', async () => {
    const { dir, cacheDir } = await project({ 'a.md': ARTICLE }, { git: true, config: { autoAccept: { tables: true } } });
    const plan = await batchFor(dir, cacheDir).batch.plan({ target: 'a.md' });
    expect(plan.warnings).toEqual([expect.stringMatching(/Google Sheet that anyone with the link can open/)]);
  });

  it('rejects an unknown job name in the config, naming it', async () => {
    const { dir } = await project({ 'a.md': ARTICLE }, { config: { autoAccept: { carousel: true } } });
    expect(() => loadConfig(dir)).toThrow(/autoAccept[\s\S]*carousel/);
  });
});

describe('summarize_batch', () => {
  it('gives one entry per article: its changes since the plan, no changes, or a change made some other way', async () => {
    let t = Date.parse('2026-12-01T10:00:00Z');
    const now = () => new Date((t += 1000));
    const { dir, cacheDir, p } = await project({ 'a.md': ARTICLE, 'b.md': ARTICLE, 'c.md': ARTICLE, 'f.md': FIGURES }, { git: true });
    const { batch, changes } = batchFor(dir, cacheDir, now);
    // A change before the plan isn't part of the batch.
    await changes.apply({ path: 'a.md', startLine: 1, endLine: 1, original: '# Water', replacement: '# Water, again' });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qam', 'x'], { cwd: dir });
    const plan = await batch.plan({ target: '.' });

    await changes.apply({ path: 'a.md', startLine: 5, endLine: 6, original: '- Nile: 36 months\n- Indus: 6 months', replacement: 'The Nile waits 36 months; the Indus, 6.' });
    const before = await readFile(p('f.md'), 'utf8');
    const after = before.replace('Figure 2. B', 'Figure 1. B').replace('Figure 1. A', 'Figure 2. A').replace('See Figure 2', 'See Figure 1');
    await writeFile(p('f.md'), after);
    await changes.record(p('f.md'), before, after, 'renumber_figures');
    await writeFile(p('c.md'), ARTICLE + 'Edited by hand.\n');

    const s = await batch.summarize({ batch: plan.batch! });
    expect(s.articles).toEqual([
      { path: p('a.md'), summary: '1 change: 1 × apply_change', changes: [{ tool: 'apply_change', at: expect.any(String), startLine: 5, linesBefore: 2, linesAfter: 1 }] },
      { path: p('b.md'), summary: 'No changes.', changes: [] },
      { path: p('c.md'), summary: 'No changes.', changes: [], note: expect.stringMatching(/not through a Draftsman tool/) },
      { path: p('f.md'), summary: '1 change: 1 × renumber_figures', changes: [{ tool: 'renumber_figures', at: expect.any(String), startLine: 5, linesBefore: 7, linesAfter: 7 }] },
    ]);
  });

  it('refuses a batch id it doesn’t know', async () => {
    const { dir, cacheDir } = await project({ 'a.md': ARTICLE });
    const { batch } = batchFor(dir, cacheDir);
    await expect(batch.summarize({ batch: 'abcdefabcdef' })).rejects.toThrow(/no batch abcdefabcdef/);
    await expect(batch.summarize({ batch: '../../etc' })).rejects.toThrow(/isn’t a batch id/);
  });
});

describe('over MCP', () => {
  it('renumber_figures is one change undo_change reverses, and the batch tools answer', async () => {
    const { dir, cacheDir, p } = await project({ 'f.md': FIGURES }, { git: true });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer({ cwd: dir, cacheDir }).connect(serverSide);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientSide);

    const plan = (await client.callTool({ name: 'plan_batch', arguments: { target: '.' } })).structuredContent as { batch: string };
    const r = await client.callTool({ name: 'renumber_figures', arguments: { path: 'f.md' } });
    expect(r.structuredContent).toMatchObject({ undoable: 1 });
    expect(await readFile(p('f.md'), 'utf8')).toContain('*Figure 1. B.*');

    const s = (await client.callTool({ name: 'summarize_batch', arguments: { batch: plan.batch } })).structuredContent as { articles: { summary: string }[] };
    expect(s.articles[0]!.summary).toBe('1 change: 1 × renumber_figures');

    const u = await client.callTool({ name: 'undo_change', arguments: { path: 'f.md' } });
    expect(u.structuredContent).toMatchObject({ tool: 'renumber_figures', undoable: 0 });
    expect(await readFile(p('f.md'), 'utf8')).toBe(FIGURES);

    // Nothing to renumber now that it's back? It is out of order again, so a second run renumbers again; a no-op records nothing.
    await client.callTool({ name: 'renumber_figures', arguments: { path: 'f.md' } });
    const again = await client.callTool({ name: 'renumber_figures', arguments: { path: 'f.md' } });
    expect(again.structuredContent).not.toHaveProperty('undoable');
    await client.close();
  });
});
