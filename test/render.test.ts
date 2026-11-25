import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import { BrowserNotFoundError, fillTemplate, findBrowser, renderHtml, type RenderOptions } from '../src/render/index.js';
import { TEST_CHROME, testBrowserPath } from './test-browser.js';

const fixtures = path.resolve('test/fixtures');
const reference = path.join(fixtures, 'sample-table.png');
const output = path.resolve('test/output');

// The test browser inherits this: a fixed font setup instead of the
// machine's own. See test/fixtures/fonts.conf.
process.env['FONTCONFIG_FILE'] = path.join(fixtures, 'fonts.conf');

// Faint anti-aliasing differences between machines are fine; a changed
// layout, color, font or digit is not. pixelmatch's threshold sets how
// different one pixel may be before it counts, which ignores faint shading at
// glyph edges. MAX_CHANGED caps how many pixels may count. Measured Nov 25:
// repeat renders on one machine differ by 0 pixels, and changing one digit
// (860 to 861) changes about 30, so a percentage limit (0.5% is ~470 pixels
// here) would let real changes through. The one-digit test below holds that.
const PIXEL_THRESHOLD = 0.1;
const MAX_CHANGED = 8;

/** Renders with the pinned test browser (see test/test-browser.ts). */
function render(html: string, options: RenderOptions = {}): Promise<Buffer> {
  const browser = testBrowserPath();
  if (!existsSync(browser)) {
    throw new Error(`The render tests need Chrome for Testing ${TEST_CHROME}. Run: npm run test-browser`);
  }
  // Our own fixtures with the network off. Ubuntu blocks the sandbox for
  // Chrome for Testing, so it would not start otherwise.
  return renderHtml(html, { executablePath: browser, noSandbox: true, ...options });
}

async function renderSample(edit: (html: string) => string = (h) => h): Promise<Buffer> {
  const template = await readFile(path.join(fixtures, 'sample-table.html'), 'utf8');
  const html = fillTemplate(edit(template), {
    col1: 'Region',
    col2: 'Storage (acre-ft)',
    col3: 'Change',
    caption: 'Figure 1. Sample data for the render test.',
  });
  return render(html, {
    width: 800,
    height: 400,
    scale: 1,
    fonts: [{ family: 'Draftsman Test Sans', path: path.join(fixtures, 'fonts', 'DejaVuSans.ttf') }],
  });
}

/** Pixels that differ from the reference, or Infinity if the size differs. Writes what it drew to test/output/ on a mismatch. */
async function changedPixels(png: Buffer, save: boolean): Promise<number> {
  const actual = PNG.sync.read(png);
  const expected = PNG.sync.read(await readFile(reference));
  const diff = new PNG({ width: actual.width, height: actual.height });
  const changed =
    actual.width !== expected.width || actual.height !== expected.height
      ? Infinity
      : pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, { threshold: PIXEL_THRESHOLD });
  if (save && changed > MAX_CHANGED) {
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'sample-table.actual.png'), png);
    if (changed !== Infinity) await writeFile(path.join(output, 'sample-table.diff.png'), PNG.sync.write(diff));
  }
  return changed;
}

describe('render', () => {
  it('renders a sample table that matches the reference image', async () => {
    const png = await renderSample();

    // UPDATE_REFERENCE=1 npm test rewrites the reference after a deliberate change.
    if (process.env['UPDATE_REFERENCE'] === '1' || !existsSync(reference)) {
      if (process.env['CI']) throw new Error('reference image missing in CI; generate it locally and commit it');
      await writeFile(reference, png);
    }

    const changed = await changedPixels(png, true);
    expect(changed, `${changed} pixels differ from the reference; see test/output/`).toBeLessThanOrEqual(MAX_CHANGED);
  });

  it('fails the comparison when one digit in the table changes', async () => {
    const png = await renderSample((html) => html.replace('>860<', '>861<'));
    expect(await changedPixels(png, false)).toBeGreaterThan(MAX_CHANGED);
  });

  it('fails loudly when a font does not load, instead of drawing with another font', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'draftsman-font-'));
    const broken = path.join(dir, 'broken.ttf');
    await writeFile(broken, 'this is not a font');
    await expect(render('<p style="font-family: Broken">x</p>', { fonts: [{ family: 'Broken', path: broken }] })).rejects.toThrow(
      /did not load: Broken/,
    );
  });

  it('makes no network requests unless asked to', async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests++;
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const html = `<img src="http://127.0.0.1:${port}/a.png"><link rel="stylesheet" href="http://127.0.0.1:${port}/b.css">x`;
    try {
      await render(html);
      expect(requests).toBe(0);
      // The same page with the network allowed does reach the server, so the
      // zero above means blocked, not missed.
      await render(html, { allowNetwork: true });
      expect(requests).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });
});

describe('findBrowser', () => {
  it('fails with what to install when no Chrome or Edge is found, and downloads nothing', () => {
    expect(() => findBrowser({}, () => false)).toThrow(BrowserNotFoundError);
    expect(() => findBrowser({}, () => false)).toThrow(/Install Google Chrome or Microsoft Edge/);
  });

  it('uses DRAFTSMAN_BROWSER when set, and fails if that path is missing', () => {
    expect(findBrowser({ DRAFTSMAN_BROWSER: '/opt/x/chrome' }, (p) => p === '/opt/x/chrome')).toBe('/opt/x/chrome');
    expect(() => findBrowser({ DRAFTSMAN_BROWSER: '/opt/x/chrome' }, () => false)).toThrow(/DRAFTSMAN_BROWSER/);
  });

  it('takes the first installed Chrome or Edge', () => {
    const edge = '/usr/bin/microsoft-edge-stable';
    if (process.platform === 'linux') expect(findBrowser({}, (p) => p === edge)).toBe(edge);
  });
});
