import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ImageError } from '../src/images.js';
import { PullQuotes } from '../src/pullquotes.js';
import { findBlockquotes } from '../src/quotes.js';
import { loadStyle } from '../src/styles.js';
import { workspace } from './helpers.js';

const ARTICLE = [
  '# Wells', // 1
  '',
  '> Whiskey is for drinking;', // 3
  '> water is for fighting over.',
  '>',
  '> — Attributed to Mark Twain', // 6
  '',
  '> [!NOTE]', // 8
  '> Figures are from 2024.',
  '',
  '```md', // 11
  '> not a quote',
  '```',
  '',
  '> A quote with **bold**,', // 15
  '> and a second paragraph.',
  '>',
  '> Here it is.',
  '',
  'After.', // 20
  '',
].join('\n');

describe('find_blockquotes', () => {
  it('lists each blockquote with its lines, text and attribution, ignoring code', () => {
    const found = findBlockquotes(ARTICLE);
    expect(found.map((b) => [b.startLine, b.endLine, b.kind])).toEqual([
      [3, 6, 'quote'],
      [8, 9, 'alert'],
      [15, 18, 'quote'],
    ]);
    expect(found[0]).toMatchObject({ text: 'Whiskey is for drinking; water is for fighting over.', attribution: 'Attributed to Mark Twain' });
    expect(found[2]).toMatchObject({ text: 'A quote with bold, and a second paragraph.\n\nHere it is.', attribution: null });
  });

  it('doesn’t take a dash list item for an attribution', () => {
    expect(findBlockquotes('> Two things:\n> - one\n> - two\n')[0]!.attribution).toBeNull();
    expect(findBlockquotes('> A line.\n> -- Someone\n')[0]!.attribution).toBe('Someone');
    expect(findBlockquotes('> Just one line\n')[0]!.attribution).toBeNull();
  });
});

describe('render_pullquote on a blockquote', () => {
  async function setup() {
    const ws = await workspace({ article: ARTICLE });
    const html: string[] = [];
    const pq = new PullQuotes({
      cwd: ws.dir,
      imagesFolder: 'images',
      style: loadStyle('default', ws.dir),
      render: async (h) => {
        html.push(h);
        return Buffer.from('png');
      },
      now: () => new Date('2026-11-25T12:00:00Z'),
    });
    return { ...ws, pq, html };
  }

  it('replaces the blockquote with its image, attribution in the image and full text as alt', async () => {
    const { pq, article, html } = await setup();
    const r = await pq.render({ path: 'post.md', line: 4 });
    expect(r).toMatchObject({ kind: 'blockquote', attribution: 'Attributed to Mark Twain', source: [3, 6] });
    expect(r.alt).toBe('Whiskey is for drinking; water is for fighting over. — Attributed to Mark Twain');
    expect(html[0]).toContain('— Attributed to Mark Twain');
    const lines = (await readFile(article, 'utf8')).split('\n');
    expect(lines.slice(0, 5)).toEqual(['# Wells', '', `![${r.alt}](images/whiskey-is-for-drinking-water-is-for-fighting-pullquote.png)`, '', '> [!NOTE]']);
    const prov = JSON.parse(await readFile(r.provenance, 'utf8'));
    expect(prov).toMatchObject({ kind: 'blockquote', quote: r.quote, attribution: 'Attributed to Mark Twain', article: { lines: [3, 6] } });
    expect(path.dirname(r.image)).toBe(path.dirname(r.provenance));
  });

  it('refuses a GitHub alert, and a line that isn’t a blockquote', async () => {
    const { pq, article } = await setup();
    await expect(pq.render({ path: 'post.md', line: 8 })).rejects.toThrow(/GitHub alert/);
    await expect(pq.render({ path: 'post.md', line: 20 })).rejects.toThrow(ImageError);
    expect(await readFile(article, 'utf8')).toBe(ARTICLE);
  });
});
