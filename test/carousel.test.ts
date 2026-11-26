import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import { articleImages, Carousel, deckHtml, deckMarkdown, findSummary, styleTheme, type deckPdf } from '../src/carousel.js';
import { ImageError } from '../src/images.js';
import { renderHtml } from '../src/render/index.js';
import { loadStyle } from '../src/styles.js';
import { workspace } from './helpers.js';
import { TEST_CHROME, testBrowserPath } from './test-browser.js';

const fixtures = path.resolve('test/fixtures');
process.env['FONTCONFIG_FILE'] = path.join(fixtures, 'fonts.conf');

describe('the summary block', () => {
  it('reads bullets under "Executive Summary", with the paragraph before them as the lead', () => {
    const s = findSummary('# T\n\n## Executive Summary\n\nThe thesis in one line.\n\n- First point\n- Second point,\n  continued\n\n## Next\n\n- not this\n');
    expect(s).toMatchObject({ line: 3, heading: 'Executive Summary', lead: 'The thesis in one line.' });
    expect(s!.points).toEqual([
      { label: null, markdown: 'First point' },
      { label: null, markdown: 'Second point, continued' },
    ]);
  });

  it('reads bold-labeled paragraphs inside a blockquote with a titled heading', () => {
    const s = findSummary(
      [
        '> ### **Executive Summary: Part IX — Corridors**',
        '>',
        '> **The Core Thesis:** Systems fail in isolation.',
        '>',
        '> **The Cost:** $5B over 4 years.',
        '',
        'Body text, not summary.',
      ].join('\n'),
    );
    expect(s!.points).toEqual([
      { label: 'The Core Thesis', markdown: 'Systems fail in isolation.' },
      { label: 'The Cost', markdown: '$5B over 4 years.' },
    ]);
  });

  it('takes a single paragraph as one point, stops at a thematic break, and accepts other heading names', () => {
    expect(findSummary('## Summary\n\nOne paragraph says it all.\n\n---\n\nNot this.\n')!.points).toEqual([{ label: null, markdown: 'One paragraph says it all.' }]);
    expect(findSummary('## In brief\n\n- a\n')).toBeNull();
    expect(findSummary('## In brief\n\n- a\n', ['In brief'])!.points).toHaveLength(1);
  });

  it('ignores a summary heading inside code', () => {
    expect(findSummary('```\n## Summary\n- a\n```\n')).toBeNull();
  });
});

describe('the article’s images', () => {
  it('are local photos with their credits, not placeholders, remote links, tables or pull quotes', async () => {
    const { dir } = await workspace();
    await mkdir(path.join(dir, 'images'));
    for (const f of ['photo.png', 'own.png', 'table.png', 'quote.png']) await copyFile(path.join(fixtures, 'sample-table.png'), path.join(dir, 'images', f));
    await writeFile(path.join(dir, 'images', 'photo.provenance.json'), JSON.stringify({ credit: 'Photo by A, CC BY 4.0', license: { obligations: ['credit the creator'] } }));
    await writeFile(path.join(dir, 'images', 'table.provenance.json'), JSON.stringify({ kind: 'table' }));
    await writeFile(path.join(dir, 'images', 'quote.provenance.json'), JSON.stringify({ kind: 'pullquote' }));
    const text = [
      '![spot](draftsman:pending)',
      '![remote](https://x.test/a.png)',
      '![a photo](images/photo.png)',
      '![table](images/table.png)',
      '![quote](images/quote.png)',
      '![missing](images/gone.png)',
      '![mine](images/own.png)',
    ].join('\n\n');
    expect(await articleImages(text, dir)).toEqual([
      { src: 'images/photo.png', alt: 'a photo', credit: 'Photo by A, CC BY 4.0', obligations: ['credit the creator'] },
      { src: 'images/own.png', alt: 'mine', credit: null, obligations: [] },
    ]);
  });
});

describe('the deck', () => {
  const summary = { line: 1, heading: 'Summary', lead: 'Lead.', points: [{ label: null, markdown: 'One' }, { label: 'Two', markdown: 'Second' }, { label: null, markdown: 'Three' }] };

  it('has a title slide, a slide per point and a closing slide with the link', () => {
    const images = [
      { src: 'images/a.png', alt: '', credit: 'Photo by A', obligations: [] },
      { src: 'images/b.png', alt: '', credit: null, obligations: [] },
    ];
    const deck = deckMarkdown({ title: 'The Title', summary, images, theme: 'draftsman', link: 'https://example.com/p' });
    const slides = deck.split(/\n---\n/).slice(1);
    expect(slides).toHaveLength(5);
    expect(deck).toMatch(/^---\nmarp: true\ntheme: draftsman\nsize: 1080x1350\n/);
    expect(slides[0]).toMatch(/!\[h:620\]\(images\/a\.png\)[\s\S]*# The Title[\s\S]*Lead\.[\s\S]*Photo by A/);
    expect(slides[1]).toMatch(/!\[h:560\]\(images\/b\.png\)[\s\S]*One/);
    expect(slides[2]).toMatch(/## Two\n\nSecond/);
    expect(slides[4]).toMatch(/Read the full article\n\nhttps:\/\/example\.com\/p/);
  });
});

const fakePdf: typeof deckPdf = async (deck) => ({ pdf: Buffer.from('%PDF fake'), pages: deck.split(/\n---\n/).length - 1 });
const ARTICLE = '# Wells\n\n## Summary\n\n- One\n- Two\n\nBody.\n';

describe('build_carousel', () => {
  it('writes the deck and PDF beside the article', async () => {
    const { dir } = await workspace({ article: ARTICLE });
    const r = await new Carousel({ cwd: dir, style: loadStyle('default', dir), pdf: fakePdf }).build({ path: 'post.md' });
    expect(r).toMatchObject({ deck: path.join(dir, 'post-carousel.md'), pdf: path.join(dir, 'post-carousel.pdf'), slides: 3, points: 2, rebuiltDeck: true });
    expect(r.warnings).toContain('The article has no local images, so the slides have none.');
  });

  it('builds the PDF from an edited deck, and rebuilds the deck only when asked', async () => {
    const { dir } = await workspace({ article: ARTICLE });
    const carousel = new Carousel({ cwd: dir, style: loadStyle('default', dir), pdf: fakePdf });
    await carousel.build({ path: 'post.md' });
    const deckFile = path.join(dir, 'post-carousel.md');
    const edited = (await readFile(deckFile, 'utf8')).replace('One', 'One, edited');
    await writeFile(deckFile, edited);
    expect(await carousel.build({ path: 'post.md' })).toMatchObject({ rebuiltDeck: false, points: null });
    expect(await readFile(deckFile, 'utf8')).toBe(edited);
    await carousel.build({ path: 'post.md', fromArticle: true });
    expect(await readFile(deckFile, 'utf8')).not.toMatch(/edited/);
  });

  it('says what to add when there is no summary, and checks the user’s theme', async () => {
    const { dir } = await workspace({ article: '# T\n\nNo summary.\n' });
    await expect(new Carousel({ cwd: dir, style: loadStyle('default', dir), pdf: fakePdf }).build({ path: 'post.md' })).rejects.toThrow(
      /no summary block. Add a heading named "Executive Summary" or "Summary" or "Key takeaways"/,
    );
    await writeFile(path.join(dir, 'theme.css'), 'section { color: red; }');
    await expect(new Carousel({ cwd: dir, style: loadStyle('default', dir), theme: 'theme.css', pdf: fakePdf }).build({ path: 'post.md' })).rejects.toThrow(ImageError);
  });
});

/** Every page's MediaBox in a PDF, in points. */
const mediaBoxes = (pdf: Buffer) => [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe('carousel PDF', () => {
  const browser = testBrowserPath();

  it('has a portrait 1080 by 1350 page for the title, every summary point, and the closing', { timeout: 60_000 }, async () => {
    if (!existsSync(browser)) throw new Error(`Needs Chrome for Testing ${TEST_CHROME}: npm run test-browser`);
    const demo = readFileSync('demo/article.md', 'utf8');
    const { dir } = await workspace({ article: demo });
    const r = await new Carousel({ cwd: dir, style: loadStyle('sample-brand', dir), renderOptions: { executablePath: browser, noSandbox: true } }).build({
      path: 'post.md',
      link: 'https://example.com/post',
    });
    const points = findSummary(demo)!.points;
    expect(r.slides).toBe(points.length + 2);
    const deck = await readFile(r.deck, 'utf8');
    for (const p of points) expect(deck).toContain(p.markdown);
    const boxes = mediaBoxes(await readFile(r.pdf));
    expect(boxes).toHaveLength(r.slides);
    // 1080 by 1350 CSS pixels is 810 by 1012.5 points; Chrome rounds page sizes to a hundredth of an inch.
    for (const [w, h] of boxes) {
      expect(Math.abs(w! - 810)).toBeLessThanOrEqual(1);
      expect(Math.abs(h! - 1012.5)).toBeLessThanOrEqual(1);
    }
  });

  for (const id of ['default', 'sample-brand']) {
    it(`point slide matches the reference image in the ${id} style`, { timeout: 60_000 }, async () => {
      if (!existsSync(browser)) throw new Error(`Needs Chrome for Testing ${TEST_CHROME}: npm run test-browser`);
      const style = loadStyle(id, '/tmp');
      const deck = deckMarkdown({
        title: 'Who Keeps the Water Running',
        summary: { line: 1, heading: 'Summary', lead: null, points: [{ label: 'The Problem', markdown: 'Small water systems often depend on **one operator** who carries the system in their head.' }] },
        images: [],
        theme: 'draftsman',
        ...(style.style.watermark ? { footer: style.style.watermark.text } : {}),
      });
      const html = await deckHtml(deck, { deckDir: '/tmp', themes: [styleTheme(style)] });
      const png = await renderHtml(html, { width: 1080, height: 1350, scale: 0.5, selector: 'div.marpit > section:nth-of-type(2)', executablePath: browser, noSandbox: true, fonts: style.fonts });
      const reference = path.join(fixtures, `carousel-${id}.png`);
      if (process.env['UPDATE_REFERENCE'] === '1' || !existsSync(reference)) {
        if (process.env['CI']) throw new Error('reference image missing in CI');
        await writeFile(reference, png);
      }
      const a = PNG.sync.read(png);
      const b = PNG.sync.read(readFileSync(reference));
      const changed = a.width !== b.width || a.height !== b.height ? Infinity : pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1 });
      if (changed > 8) {
        await mkdir(path.resolve('test/output'), { recursive: true });
        await writeFile(path.resolve(`test/output/carousel-${id}.actual.png`), png);
      }
      expect(changed).toBeLessThanOrEqual(8);
    });
  }
});
