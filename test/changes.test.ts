import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { Changes } from '../src/changes.js';
import { ImageError } from '../src/images.js';
import { workspace } from './helpers.js';

const ARTICLE = ['# T', '', 'Intro.', '', '- Nile: 36 months', '- Indus: 6 months', '', 'After.', ''].join('\n');
const TABLE = '| Basin | Months |\n| --- | ---: |\n| Nile | 36 |\n| Indus | 6 |';

async function setup(article = ARTICLE) {
  const ws = await workspace({ article });
  return { ...ws, changes: new Changes({ cwd: ws.dir, cacheDir: ws.cacheDir }) };
}

describe('apply_change', () => {
  it('replaces the lines as one edit and keeps its history outside the project', async () => {
    const { changes, article, dir, cacheDir } = await setup();
    const r = await changes.apply({ path: 'post.md', startLine: 5, endLine: 6, original: '- Nile: 36 months\n- Indus: 6 months\n', replacement: TABLE });
    expect(r).toMatchObject({ startLine: 5, endLine: 8, replaced: 2, inserted: 4, undoable: 1 });
    expect(await readFile(article, 'utf8')).toBe(['# T', '', 'Intro.', '', TABLE, '', 'After.', ''].join('\n'));
    expect(await readdir(dir)).toEqual(['.cache', 'post.md']);
    expect(existsSync(path.join(cacheDir, 'changes'))).toBe(true);
  });

  it('refuses when the lines no longer read as expected, and changes nothing', async () => {
    const { changes, article } = await setup();
    await expect(changes.apply({ path: 'post.md', startLine: 5, endLine: 6, original: '- Nile: 37 months\n- Indus: 6 months', replacement: 'x' })).rejects.toThrow(
      /no longer read as expected, so nothing was changed[\s\S]*- Nile: 36 months/,
    );
    await expect(changes.apply({ path: 'post.md', startLine: 8, endLine: 20, original: '', replacement: 'x' })).rejects.toThrow(ImageError);
    expect(await readFile(article, 'utf8')).toBe(ARTICLE);
  });
});

describe('undo_change', () => {
  it('puts the original back', async () => {
    const { changes, article } = await setup();
    await changes.apply({ path: 'post.md', startLine: 5, endLine: 6, original: '- Nile: 36 months\n- Indus: 6 months', replacement: TABLE });
    expect(await changes.undo({ path: 'post.md' })).toMatchObject({ startLine: 5, endLine: 6, restored: 2, undoable: 0 });
    expect(await readFile(article, 'utf8')).toBe(ARTICLE);
    await expect(changes.undo({ path: 'post.md' })).rejects.toThrow(/no change to undo/);
  });

  it('works after other parts of the file were edited, finding the new text where it moved', async () => {
    const { changes, article } = await setup();
    await changes.apply({ path: 'post.md', startLine: 5, endLine: 6, original: '- Nile: 36 months\n- Indus: 6 months', replacement: TABLE });
    const edited = (await readFile(article, 'utf8')).replace('Intro.', 'A new first line.\n\nIntro, rewritten.').replace('After.', 'After, edited.');
    await writeFile(article, edited);
    await changes.undo({ path: 'post.md' });
    expect(await readFile(article, 'utf8')).toBe(['# T', '', 'A new first line.', '', 'Intro, rewritten.', '', '- Nile: 36 months', '- Indus: 6 months', '', 'After, edited.', ''].join('\n'));
  });

  it('refuses when the new text itself was edited, and changes nothing', async () => {
    const { changes, article } = await setup();
    await changes.apply({ path: 'post.md', startLine: 5, endLine: 6, original: '- Nile: 36 months\n- Indus: 6 months', replacement: TABLE });
    const edited = (await readFile(article, 'utf8')).replace('| Nile | 36 |', '| Nile | 38 |');
    await writeFile(article, edited);
    await expect(changes.undo({ path: 'post.md' })).rejects.toThrow(/edited since, so it can’t be undone safely/);
    expect(await readFile(article, 'utf8')).toBe(edited);
  });

  it('goes back through earlier changes one at a time, including a deletion', async () => {
    const { changes, article } = await setup();
    await changes.apply({ path: 'post.md', startLine: 3, endLine: 3, original: 'Intro.', replacement: 'Intro, shorter.' });
    await changes.apply({ path: 'post.md', startLine: 8, endLine: 8, original: 'After.', replacement: '' });
    expect(await readFile(article, 'utf8')).not.toMatch(/After\./);
    await changes.undo({ path: 'post.md' });
    expect(await readFile(article, 'utf8')).toMatch(/After\./);
    expect(await readFile(article, 'utf8')).toMatch(/Intro, shorter\./);
    await changes.undo({ path: 'post.md' });
    expect(await readFile(article, 'utf8')).toBe(ARTICLE);
  });
});

describe('edits other tools make', () => {
  it('are recorded as one change from the first to the last line that differs, and undo reverses them', async () => {
    const { changes, article } = await setup();
    const after = ARTICLE.replace('Intro.', 'Intro, now longer.').replace('After.', '![chart](images/c.png)\n\n*Figure 1. Chart.*\n\nAfter.');
    await writeFile(article, after);
    expect(await changes.record(article, ARTICLE, after, 'render_table')).toBe(1);
    const [entry] = await changes.list(article);
    expect(entry).toMatchObject({ tool: 'render_table', start: 2, original: ARTICLE.split('\n').slice(2, 6) });
    const u = await changes.undo({ path: 'post.md' });
    expect(u).toMatchObject({ tool: 'render_table', undoable: 0, note: expect.stringMatching(/Google Sheet .* is still in your Drive/) });
    expect(await readFile(article, 'utf8')).toBe(ARTICLE);
  });

  it('record a pure insertion and a pure deletion so undo can find the spot again', async () => {
    const { changes, article } = await setup();
    const inserted = ARTICLE.replace('Intro.\n', 'Intro.\n\n![quote](images/q.png)\n');
    await writeFile(article, inserted);
    await changes.record(article, ARTICLE, inserted, 'render_pullquote');
    expect(await changes.undo({ path: 'post.md' })).toMatchObject({ tool: 'render_pullquote', note: expect.stringMatching(/pull quote image/) });
    expect(await readFile(article, 'utf8')).toBe(ARTICLE);

    const deleted = ARTICLE.replace('- Indus: 6 months\n', '');
    await writeFile(article, deleted);
    await changes.record(article, ARTICLE, deleted, 'apply_change');
    await changes.undo({ path: 'post.md' });
    expect(await readFile(article, 'utf8')).toBe(ARTICLE);
  });

  it('record nothing when the text is the same', async () => {
    const { changes, article } = await setup();
    expect(await changes.record(article, ARTICLE, ARTICLE, 'renumber_figures')).toBeNull();
    expect(await changes.list(article)).toEqual([]);
  });

  it('read histories written before the tool field as apply_change', async () => {
    const { changes } = await setup();
    await changes.apply({ path: 'post.md', startLine: 3, endLine: 3, original: 'Intro.', replacement: 'Hi.' });
    expect(await changes.undo({ path: 'post.md' })).toMatchObject({ tool: 'apply_change' });
  });
});
