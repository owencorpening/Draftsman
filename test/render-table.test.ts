import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import { Google } from '../src/google.js';
import { ImageError } from '../src/images.js';
import { renderHtml } from '../src/render/index.js';
import { cellHtml, tableHtml } from '../src/render/table.js';
import { DefinitionError } from '../src/sources/load.js';
import { loadStyle, parseStyle, STYLES_DIR, styleJsonSchema } from '../src/styles.js';
import { TableFigures } from '../src/table-figures.js';
import { findTables } from '../src/tables.js';
import { fakeKeys, workspace } from './helpers.js';
import { loadRecording, replayHttp, type Recording } from './recordings.js';
import { TEST_CHROME, testBrowserPath } from './test-browser.js';

const fixtures = path.resolve('test/fixtures');
process.env['FONTCONFIG_FILE'] = path.join(fixtures, 'fonts.conf');

const TABLE = [
  '| Region | Storage (acre-ft) | Change | Note |',
  '| :--- | ---: | :---: | --- |',
  '| North basin | 1,240 | −12% | **lowest** since 2011 |',
  '| Central valley | 860 | −4% | `gauge 7` offline |',
  '| Coastal plain | 2,015 | +3% | [report](https://x.test) |',
].join('\n');

const SHEET_ID = '1SampleSheetIdForDraftsmanTests';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

describe('styles', () => {
  it('ship a neutral default and a sample brand, both valid', () => {
    expect(loadStyle('default', '/tmp').style.name).toBe('Neutral');
    const brand = loadStyle('sample-brand', '/tmp');
    expect(brand.style.watermark).toEqual({ text: 'example.com', position: 'bottom-right' });
    expect(brand.fonts.every((f) => existsSync(f.path))).toBe(true);
  });

  it('match the committed JSON Schema (npm run schema regenerates it)', () => {
    expect(JSON.parse(readFileSync(path.join(STYLES_DIR, 'style.schema.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(styleJsonSchema())));
  });

  it('name the file and field when a style is wrong, and catch missing font files', () => {
    const good = JSON.parse(readFileSync(path.join(STYLES_DIR, 'default.json'), 'utf8'));
    const err = (s: unknown) => {
      try {
        parseStyle(path.join(STYLES_DIR, 'mine.json'), JSON.stringify(s));
      } catch (e) {
        expect(e).toBeInstanceOf(DefinitionError);
        return (e as Error).message;
      }
      throw new Error('expected an error');
    };
    expect(err({ ...good, colors: { ...good.colors, text: 'blue' } })).toMatch(/mine\.json is not a valid style:\n {2}colors\.text: a hex color/);
    expect(err({ ...good, fonts: { text: { family: 'X', faces: [{ file: 'fonts/Nope.ttf' }] } } })).toMatch(/fonts\.text\.faces\.0\.file: fonts\/Nope\.ttf not found/);
  });

  it('can be the user’s own, by path, and an unknown id says what exists', async () => {
    const { dir } = await workspace();
    const own = { ...JSON.parse(readFileSync(path.join(STYLES_DIR, 'default.json'), 'utf8')), id: 'mine', name: 'Mine' };
    own.fonts.text.faces = own.fonts.text.faces.map((f: { file: string }) => ({ ...f, file: path.join(STYLES_DIR, f.file) }));
    own.fonts.code.faces = own.fonts.code.faces.map((f: { file: string }) => ({ ...f, file: path.join(STYLES_DIR, f.file) }));
    await writeFile(path.join(dir, 'mine.json'), JSON.stringify(own));
    expect(loadStyle('mine.json', dir).style.id).toBe('mine');
    expect(() => loadStyle('fancy', dir)).toThrow(/Unknown style "fancy". Shipped styles: .*default.*sample-brand/);
  });
});

describe('table images', () => {
  it('keep bold, italic and code in cells, and show links as their text', () => {
    expect(cellHtml('**a** _b_ `c|d` [e](https://x.test) <script> \\*f\\*')).toBe(
      '<strong>a</strong> <em>b</em> <code>c|d</code> e &lt;script&gt; *f*',
    );
  });

  // Same comparison as test/render.test.ts: anti-aliasing drift is fine, a changed digit is not.
  for (const id of ['default', 'sample-brand']) {
    it(`match the reference image in the ${id} style`, async () => {
      const browser = testBrowserPath();
      if (!existsSync(browser)) throw new Error(`Needs Chrome for Testing ${TEST_CHROME}: npm run test-browser`);
      const style = loadStyle(id, '/tmp');
      const png = await renderHtml(tableHtml(findTables(TABLE)[0]!, style), {
        width: 1200,
        height: 800,
        scale: 1,
        executablePath: browser,
        noSandbox: true,
        fonts: style.fonts,
      });
      const reference = path.join(fixtures, `table-${id}.png`);
      if (process.env['UPDATE_REFERENCE'] === '1' || !existsSync(reference)) {
        if (process.env['CI']) throw new Error('reference image missing in CI');
        await writeFile(reference, png);
      }
      const a = PNG.sync.read(png);
      const b = PNG.sync.read(readFileSync(reference));
      const changed = a.width !== b.width || a.height !== b.height ? Infinity : pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1 });
      if (changed > 8) {
        await mkdir(path.resolve('test/output'), { recursive: true });
        await writeFile(path.resolve(`test/output/table-${id}.actual.png`), png);
      }
      expect(changed).toBeLessThanOrEqual(8);
    });
  }
});

const FAKE_PNG = Buffer.from('fake png bytes');

async function setup(o: { google?: boolean; extra?: Recording[]; article?: string; render?: () => Promise<Buffer> } = {}) {
  const article =
    o.article ??
    ['# Storage', '', 'Reservoirs held less, as Figure 1 shows.', '', '![Map](images/map.png)', '', '*Figure 1. The basins.*', '', TABLE, '', 'After.', ''].join('\n');
  const ws = await workspace({ article });
  const keys: Record<string, string> = o.google ? { DRAFTSMAN_GOOGLE_REFRESH_TOKEN: 'test-refresh-token' } : {};
  const replay = replayHttp(Object.values(keys), o.extra ?? []);
  const google = new Google({ http: replay.http, keys: fakeKeys(keys), clientId: o.google ? 'test-client.apps.googleusercontent.com' : undefined });
  const logs: string[] = [];
  const tables = new TableFigures({
    cwd: ws.dir,
    imagesFolder: 'images',
    style: loadStyle('default', ws.dir),
    google,
    render: o.render ?? (async () => FAKE_PNG),
    log: (m) => logs.push(m),
    now: () => new Date('2026-11-25T12:00:00Z'),
  });
  return { ...ws, tables, replay, logs };
}

describe('render_table', () => {
  it('without Google: the table becomes an unlinked image with a numbered caption, and says why there’s no sheet', async () => {
    const { tables, article } = await setup();
    const r = await tables.render({ path: 'post.md', line: 10, caption: 'Reservoir storage by region' });
    expect(r.figure).toBe(2);
    expect(r.sheet).toBeNull();
    expect(r.warnings[0]).toMatch(/^No sheet: Google isn’t set up: no OAuth client ID/);
    expect(await readFile(r.image)).toEqual(FAKE_PNG);
    const lines = (await readFile(article, 'utf8')).split('\n');
    expect(lines.slice(8, 13)).toEqual([
      `![${r.alt}](images/reservoir-storage-by-region-table.png)`,
      '',
      '*Figure 2. Reservoir storage by region.*',
      '',
      'After.',
    ]);
    expect(r.alt).toBe('Table: Reservoir storage by region. Columns: Region, Storage (acre-ft), Change, Note. 3 rows.');
  });

  it('with Google: makes a sheet of the data, shares it with anyone who has the link, and links the image to it', async () => {
    const { tables, article, replay } = await setup({ google: true });
    const r = await tables.render({ path: 'post.md', line: 9, caption: 'Reservoir storage by region', alt: 'Storage fell in two of three regions.' });
    expect(r.sheet).toEqual({ id: SHEET_ID, url: SHEET_URL, shared: true });
    expect(r.warnings).toEqual([]);
    expect((await readFile(article, 'utf8')).split('\n')[8]).toBe(`[![Storage fell in two of three regions.](images/reservoir-storage-by-region-table.png)](${SHEET_URL})`);

    // What was sent: a refresh with no client secret, the sheet, the values, and anyone-with-link view access.
    const sent = replay.requests.map((q) => [q.request.method, q.url.split('?')[0]]);
    expect(sent).toEqual([
      ['POST', 'https://oauth2.googleapis.com/token'],
      ['POST', 'https://sheets.googleapis.com/v4/spreadsheets'],
      ['PUT', `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Data!A1`],
      ['POST', `https://www.googleapis.com/drive/v3/files/${SHEET_ID}/permissions`],
    ]);
    const token = new URLSearchParams(replay.requests[0]!.request.body);
    expect(Object.fromEntries(token)).toEqual({ client_id: 'test-client.apps.googleusercontent.com', refresh_token: 'test-refresh-token', grant_type: 'refresh_token' });
    expect(replay.requests[1]!.request.headers['Authorization']).toBe('Bearer test-access-token');
    expect(JSON.parse(replay.requests[2]!.request.body!).values).toEqual([
      ['Region', 'Storage (acre-ft)', 'Change', 'Note'],
      ['North basin', '1,240', '−12%', 'lowest since 2011'],
      ['Central valley', '860', '−4%', 'gauge 7 offline'],
      ['Coastal plain', '2,015', '+3%', 'report'],
    ]);
    expect(JSON.parse(replay.requests[3]!.request.body!)).toEqual({ type: 'anyone', role: 'reader' });
  });

  it('keeps a cell starting with "=" as text in the sheet, never a formula', async () => {
    const article = '| Formula |\n|---|\n| =IMPORTXML("https://x.test","//a") |\n';
    const { tables, replay } = await setup({ google: true, article });
    await tables.render({ path: 'post.md', line: 1, caption: 'Formulas' });
    expect(JSON.parse(replay.requests[2]!.request.body!).values[1]).toEqual([`'=IMPORTXML("https://x.test","//a")`]);
  });

  it('when sharing fails: the sheet exists but the image isn’t linked, and the warning says so', async () => {
    const denied = { ...loadRecording('google', 'permissions-create'), response: { status: 403, contentType: 'application/json', body: { error: { code: 403, message: 'Insufficient permissions for this file' } } } };
    const { tables, article } = await setup({ google: true, extra: [denied] });
    const r = await tables.render({ path: 'post.md', line: 9, caption: 'Storage' });
    expect(r.sheet).toEqual({ id: SHEET_ID, url: SHEET_URL, shared: false });
    expect(r.warnings[0]).toMatch(/couldn't be shared with anyone who has the link: Google answered 403: Insufficient permissions/);
    expect((await readFile(article, 'utf8')).split('\n')[8]).toMatch(/^!\[/);
  });

  it('when the sign-in has expired: no sheet, an unlinked image, and how to sign in again', async () => {
    const expired = { ...loadRecording('google', 'token-refresh'), response: { status: 400, contentType: 'application/json', body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } };
    const { tables, logs } = await setup({ google: true, extra: [expired] });
    const r = await tables.render({ path: 'post.md', line: 9, caption: 'Storage' });
    expect(r.sheet).toBeNull();
    expect(r.warnings).toEqual(['No sheet: Google sign-in has expired or was revoked. Run `draftsman google-sign-in` again.']);
    expect(logs.join('\n')).toMatch(/expired or was revoked/);
  });

  it('writes provenance beside the image, with the original table, the sheet and the style', async () => {
    const { tables } = await setup({ google: true });
    const r = await tables.render({ path: 'post.md', line: 9, caption: 'Reservoir storage by region' });
    const p = JSON.parse(await readFile(r.provenance, 'utf8'));
    expect(path.dirname(r.provenance)).toBe(path.dirname(r.image));
    expect(p).toMatchObject({
      kind: 'table',
      renderedAt: '2026-11-25T12:00:00.000Z',
      article: { file: '../post.md', lines: [9, 13] },
      image: { file: 'reservoir-storage-by-region-table.png', bytes: FAKE_PNG.length },
      figure: { number: 2, caption: 'Reservoir storage by region' },
      style: { id: 'default', name: 'Neutral' },
      table: { markdown: TABLE, header: ['Region', 'Storage (acre-ft)', 'Change', 'Note'], align: ['left', 'right', 'center', null] },
      sheet: { id: SHEET_ID, url: SHEET_URL, shared: true },
      warnings: [],
    });
    expect(p.image.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('numbers the new figure in place and moves later figures and their references along', async () => {
    const article = ['Figure 1 is first; Figure 2 is the photo.', '', '*Figure 1. First.*', '', TABLE, '', '*Figure 2. Photo.*', ''].join('\n');
    const { tables } = await setup({ article });
    const r = await tables.render({ path: 'post.md', line: 5, caption: 'Storage' });
    expect(r.figure).toBe(2);
    const text = await readFile(path.join(path.dirname(r.image), '..', 'post.md'), 'utf8');
    expect(text).toContain('Figure 1 is first; Figure 3 is the photo.');
    expect(text).toContain('*Figure 2. Storage.*');
    expect(text).toContain('*Figure 3. Photo.*');
    expect(r.renumbered.updated).toEqual([
      { line: 1, from: 'Figure 2', to: 'Figure 3' },
    ]);
  });

  it('leaves the article unchanged, and removes what it wrote, when a step fails', async () => {
    const { tables, article, dir } = await setup({
      render: async () => {
        throw new Error('the browser crashed');
      },
    });
    const before = await readFile(article, 'utf8');
    await expect(tables.render({ path: 'post.md', line: 9, caption: 'Storage' })).rejects.toThrow(/the browser crashed/);
    expect(await readFile(article, 'utf8')).toBe(before);
    expect(existsSync(path.join(dir, 'images')) ? await readdir(path.join(dir, 'images')) : []).toEqual([]);
  });

  it('refuses a line with no table and an empty caption', async () => {
    const { tables } = await setup();
    await expect(tables.render({ path: 'post.md', line: 3, caption: 'X' })).rejects.toThrow(/no table at line 3/);
    await expect(tables.render({ path: 'post.md', line: 9, caption: '  ' })).rejects.toBeInstanceOf(ImageError);
  });

  it('doesn’t overwrite an earlier image with the same caption', async () => {
    const article = [TABLE, '', TABLE, ''].join('\n');
    const { tables } = await setup({ article });
    const a = await tables.render({ path: 'post.md', line: 1, caption: 'Storage' });
    const b = await tables.render({ path: 'post.md', line: 9, caption: 'Storage' });
    expect(path.basename(a.image)).toBe('storage-table.png');
    expect(path.basename(b.image)).toBe('storage-table-2.png');
    expect([a.figure, b.figure]).toEqual([1, 2]);
  });
});
