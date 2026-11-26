import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import { ImageError } from '../src/images.js';
import { PullQuotes } from '../src/pullquotes.js';
import { alreadyPlaced, locateQuote, paragraphs, QuoteError, stripInline } from '../src/quotes.js';
import { renderHtml } from '../src/render/index.js';
import { pullquoteHtml } from '../src/render/pullquote.js';
import { loadStyle } from '../src/styles.js';
import { workspace } from './helpers.js';
import { TEST_CHROME, testBrowserPath } from './test-browser.js';

const fixtures = path.resolve('test/fixtures');
process.env['FONTCONFIG_FILE'] = path.join(fixtures, 'fonts.conf');

const ARTICLE = [
  '# Water', // 1
  '',
  'The aquifer has dropped for decades. Farmers pump the hardest.', // 3
  '',
  'Water law in Texas follows the **rule of capture**: whoever pumps it',
  'owns it, and the [courts](https://x.test) have left that rule alone', // 6
  'for over a century — even as wells run dry.',
  '',
  '| a | b |', // 9
  '| - | - |',
  '| rule of capture | 1 |',
  '',
  '```', // 13
  'whoever pumps it owns it',
  '```',
  '',
  'Farmers pump the hardest.', // 17
  '',
].join('\n');

const QUOTE = 'Water law in Texas follows the rule of capture: whoever pumps it owns it, and the courts have left that rule alone for over a century — even as wells run dry.';

describe('word for word', () => {
  it('reads paragraphs of prose only: not tables, code, headings or lone images', () => {
    expect(paragraphs(ARTICLE + '\n![x](images/x.png)\n').map((p) => [p.startLine, p.endLine])).toEqual([
      [3, 3],
      [5, 7],
      [17, 17],
    ]);
  });

  it('strips inline markdown and keeps escaped characters', () => {
    expect(stripInline('A **bold** _move_ in `code_x` by [them](https://x.test)\\* and snake_case[^1]')).toBe('A bold move in code_x by them* and snake_case');
  });

  it('finds a quote across lines, ignoring markup, whitespace and typographic marks', () => {
    expect(locateQuote(ARTICLE, QUOTE)).toMatchObject({ startLine: 5, endLine: 7 });
    expect(locateQuote(ARTICLE, 'whoever pumps it\n   owns it, and the courts')).toMatchObject({ startLine: 5 });
    expect(locateQuote(ARTICLE, 'for over a century - even as wells run dry.')).toMatchObject({ startLine: 5 });
    expect(locateQuote(ARTICLE, '“The aquifer has dropped for decades.”')).toMatchObject({ startLine: 3 });
  });

  // Done criterion 7: altered text is refused.
  const altered: [string, string][] = [
    ['a changed word', QUOTE.replace('decades', 'years').replace('century', 'hundred years')],
    ['a dropped word', QUOTE.replace('the courts', 'courts')],
    ['changed punctuation', QUOTE.replace('capture:', 'capture;')],
    ['an ellipsis for cut words', 'Water law in Texas follows the rule of capture… even as wells run dry.'],
    ['three dots for cut words', 'Water law in Texas follows the rule of capture... even as wells run dry.'],
    ['two paragraphs joined', 'The aquifer has dropped for decades. Farmers pump the hardest. Water law in Texas'],
    ['words not in the article', 'Groundwater belongs to everyone.'],
    ['text only in a table', 'rule of capture | 1'],
    ['text only in code', 'whoever pumps it owns it'.toUpperCase()],
  ];
  for (const [what, quote] of altered) {
    it(`refuses ${what}`, () => {
      expect(() => locateQuote(ARTICLE, quote)).toThrow(QuoteError);
    });
  }

  it('says where the quote stops matching', () => {
    expect(() => locateQuote(ARTICLE, QUOTE.replace('the courts', 'courts'))).toThrow(
      /matches the paragraph at line 5 up to ".*owns it, and", then the article has "the courts have left/,
    );
    expect(() => locateQuote(ARTICLE, 'The aquifer has dropped for decades. Farmers pump the hardest. Water law')).toThrow(/where the paragraph ends; a pull quote has to come from one paragraph/);
  });

  it('asks for a line when the quote is in two paragraphs, and takes the line', () => {
    expect(() => locateQuote(ARTICLE, 'Farmers pump the hardest.')).toThrow(/more than one paragraph \(lines 3, 17\)/);
    expect(locateQuote(ARTICLE, 'Farmers pump the hardest.', 17)).toMatchObject({ startLine: 17 });
  });
});

async function setup(article = ARTICLE) {
  const ws = await workspace({ article });
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

describe('render_pullquote', () => {
  it('places the image right after the source paragraph, with the quote as alt text and no figure number', async () => {
    const { pq, article } = await setup();
    const r = await pq.render({ path: 'post.md', quote: QUOTE });
    expect(r).toMatchObject({ kind: 'pullquote', quote: QUOTE, alt: QUOTE, source: [5, 7], attribution: null });
    const lines = (await readFile(article, 'utf8')).split('\n');
    expect(lines.slice(6, 11)).toEqual([
      'for over a century — even as wells run dry.',
      '',
      `![${QUOTE}](images/water-law-in-texas-follows-the-rule-of-pullquote.png)`,
      '',
      '| a | b |',
    ]);
    expect(lines.join('\n')).not.toMatch(/Figure/);
    const prov = JSON.parse(await readFile(r.provenance, 'utf8'));
    expect(prov).toMatchObject({ kind: 'pullquote', quote: QUOTE, article: { file: '../post.md', lines: [5, 7] }, style: { id: 'default' } });
    expect(prov.image.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a quote that is already placed, and an altered one, leaving the article unchanged', async () => {
    const { pq, article } = await setup();
    await pq.render({ path: 'post.md', quote: QUOTE });
    const after = await readFile(article, 'utf8');
    expect(alreadyPlaced(after, QUOTE)).toBe(true);
    await expect(pq.render({ path: 'post.md', quote: QUOTE })).rejects.toThrow(/already placed/);
    await expect(pq.render({ path: 'post.md', quote: 'Farmers pump the hardest!', line: 17 })).rejects.toThrow(ImageError);
    expect(await readFile(article, 'utf8')).toBe(after);
  });

  it('refuses a quote longer than the style allows', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `Word${i} is here.`).join(' ');
    const { pq } = await setup(`# T\n\n${long}\n`);
    await expect(pq.render({ path: 'post.md', quote: long })).rejects.toThrow(/at most 300/);
  });

  it('leaves the article unchanged when rendering fails', async () => {
    const ws = await workspace({ article: ARTICLE });
    const pq = new PullQuotes({
      cwd: ws.dir,
      imagesFolder: 'images',
      style: loadStyle('default', ws.dir),
      render: async () => {
        throw new Error('browser crashed');
      },
    });
    await expect(pq.render({ path: 'post.md', quote: QUOTE })).rejects.toThrow(/browser crashed/);
    expect(await readFile(ws.article, 'utf8')).toBe(ARTICLE);
    expect(existsSync(path.join(ws.dir, 'images'))).toBe(false);
  });
});

describe('pull quote images', () => {
  for (const id of ['default', 'sample-brand']) {
    it(`match the reference image in the ${id} style`, async () => {
      const browser = testBrowserPath();
      if (!existsSync(browser)) throw new Error(`Needs Chrome for Testing ${TEST_CHROME}: npm run test-browser`);
      const style = loadStyle(id, '/tmp');
      const png = await renderHtml(pullquoteHtml(QUOTE, 'Texas water law', style), {
        width: style.style.pullquote.width,
        height: 600,
        scale: 1,
        executablePath: browser,
        noSandbox: true,
        fonts: style.fonts,
      });
      const reference = path.join(fixtures, `pullquote-${id}.png`);
      if (process.env['UPDATE_REFERENCE'] === '1' || !existsSync(reference)) {
        if (process.env['CI']) throw new Error('reference image missing in CI');
        await writeFile(reference, png);
      }
      const a = PNG.sync.read(png);
      const b = PNG.sync.read(readFileSync(reference));
      const changed = a.width !== b.width || a.height !== b.height ? Infinity : pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1 });
      if (changed > 8) {
        await mkdir(path.resolve('test/output'), { recursive: true });
        await writeFile(path.resolve(`test/output/pullquote-${id}.actual.png`), png);
      }
      expect(changed).toBeLessThanOrEqual(8);
    });
  }
});
