import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import { fillTemplate, renderHtml } from '../src/render/index.js';
import { TEST_CHROME, testBrowserPath } from './test-browser.js';

const fixtures = path.resolve('test/fixtures');
const reference = path.join(fixtures, 'sample-table.png');
const output = path.resolve('test/output');

// Faint anti-aliasing differences between machines are fine; a changed
// layout, color, font or digit is not. pixelmatch's threshold sets how
// different one pixel may be before it counts, which ignores faint shading at
// glyph edges. MAX_CHANGED caps how many pixels may count. Measured Nov 25:
// repeat renders on one machine differ by 0 pixels, and changing one digit
// (860 to 861) changes 31, so a percentage limit (0.5% is ~470 pixels here)
// would let real changes through.
const PIXEL_THRESHOLD = 0.1;
const MAX_CHANGED = 8;

describe('render', () => {
  it('renders a sample table that matches the reference image', async () => {
    const browser = testBrowserPath();
    if (!existsSync(browser)) {
      throw new Error(`The render test needs Chrome for Testing ${TEST_CHROME}. Run: npm run test-browser`);
    }
    const html = fillTemplate(await readFile(path.join(fixtures, 'sample-table.html'), 'utf8'), {
      col1: 'Region',
      col2: 'Storage (acre-ft)',
      col3: 'Change',
      caption: 'Figure 1. Sample data for the render test.',
    });
    const png = await renderHtml(html, {
      width: 800,
      height: 400,
      scale: 1,
      executablePath: browser,
      // Our own fixture with the network off. Ubuntu blocks the sandbox for
      // Chrome for Testing, so it would not start otherwise.
      noSandbox: true,
      fonts: [{ family: 'Draftsman Test Sans', path: path.join(fixtures, 'fonts', 'DejaVuSans.ttf') }],
    });

    // UPDATE_REFERENCE=1 npm test rewrites the reference after a deliberate change.
    if (process.env['UPDATE_REFERENCE'] === '1' || !existsSync(reference)) {
      if (process.env['CI']) throw new Error('reference image missing in CI; generate it locally and commit it');
      await writeFile(reference, png);
    }

    const actual = PNG.sync.read(png);
    const expected = PNG.sync.read(await readFile(reference));
    if (actual.width !== expected.width || actual.height !== expected.height) {
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, 'sample-table.actual.png'), png);
    }
    expect({ width: actual.width, height: actual.height }).toEqual({ width: expected.width, height: expected.height });

    const diff = new PNG({ width: actual.width, height: actual.height });
    const changed = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, { threshold: PIXEL_THRESHOLD });
    if (changed > MAX_CHANGED) {
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, 'sample-table.actual.png'), png);
      await writeFile(path.join(output, 'sample-table.diff.png'), PNG.sync.write(diff));
    }
    expect(changed, `${changed} pixels differ from the reference; see test/output/`).toBeLessThanOrEqual(MAX_CHANGED);
  });

  it('fails loudly when a font does not load, instead of drawing with a fallback', async () => {
    const browser = testBrowserPath();
    if (!existsSync(browser)) throw new Error(`Run: npm run test-browser`);
    const dir = await mkdtemp(path.join(tmpdir(), 'draftsman-font-'));
    const broken = path.join(dir, 'broken.ttf');
    await writeFile(broken, 'this is not a font');
    await expect(
      renderHtml('<p style="font-family: Broken">x</p>', { executablePath: browser, noSandbox: true, fonts: [{ family: 'Broken', path: broken }] }),
    ).rejects.toThrow(/did not load: Broken/);
  });
});
