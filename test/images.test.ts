import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ImageError, ImageService } from '../src/images.js';
import { loadSources } from '../src/sources/load.js';
import { fakeKeys, workspace } from './helpers.js';
import { loadRecording, replayHttp, type Recording } from './recordings.js';

const PIXABAY_KEY = 'test-pixabay-key-0000';

async function setup(options: { config?: object; extra?: Recording[]; keys?: Record<string, string>; files?: Record<string, string>; article?: string } = {}) {
  const ws = await workspace({
    config: options.config ?? { sources: { openverse: true, wikimedia: true } },
    ...(options.files ? { files: options.files } : {}),
    ...(options.article ? { article: options.article } : {}),
  });
  const keys = options.keys ?? { DRAFTSMAN_PIXABAY_KEY: PIXABAY_KEY };
  const replay = replayHttp(Object.values(keys), options.extra ?? []);
  const { sources, config } = loadSources(ws.dir);
  let now = new Date('2026-11-25T12:00:00Z');
  const logs: string[] = [];
  const images = new ImageService({
    sources,
    config,
    cwd: ws.dir,
    http: replay.http,
    keys: fakeKeys(keys),
    cacheDir: ws.cacheDir,
    log: (m) => logs.push(m),
    now: () => now,
  });
  return { ...ws, images, replay, logs, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

const openverseBy = () => {
  const r = loadRecording('openverse', 'search-lighthouse').response.body as { results: { id: string; license: string }[] };
  return `openverse:${r.results.find((x) => x.license === 'by')!.id}`;
};
const openverseNc = () => {
  const r = loadRecording('openverse', 'search-lighthouse').response.body as { results: { id: string; license: string }[] };
  return `openverse:${r.results.find((x) => x.license === 'by-nc')!.id}`;
};

describe('search_images', () => {
  it('searches every enabled source and says where each result is from', async () => {
    const { images, replay } = await setup({ config: { sources: { openverse: true, wikimedia: true } } });
    const res = await images.search('lighthouse', 5);
    const bySource = (id: string) => res.results.filter((r) => r.source === id);
    expect(bySource('pixabay')).toHaveLength(2);
    expect(bySource('openverse')).toHaveLength(5);
    expect(bySource('wikimedia')).toHaveLength(5);
    expect(res.results.every((r) => r.sourceName && r.ref.startsWith(`${r.source}:`) && r.pageUrl !== undefined)).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.skipped).toEqual([]);
    // Pixabay's key went in the query string; it's never in what the AI sees.
    expect(replay.requests.find((r) => r.url.startsWith('https://pixabay.com/api/'))!.url).toContain(`key=${PIXABAY_KEY}`);
    expect(JSON.stringify(res)).not.toContain(PIXABAY_KEY);
  });

  it('skips a source with no key, saying how to add one, and searches the rest', async () => {
    const { images } = await setup({ config: { sources: { openverse: true, pexels: true } }, keys: {} });
    const res = await images.search('lighthouse', 5);
    expect(res.skipped.map((s) => s.source).sort()).toEqual(['pexels', 'pixabay']);
    expect(res.skipped.find((s) => s.source === 'pexels')!.reason).toMatch(/Set the DRAFTSMAN_PEXELS_KEY environment variable/);
    expect(res.results.filter((r) => r.source === 'openverse')).toHaveLength(5);
  });

  it('sends the Pexels key in the Authorization header', async () => {
    const { images, replay } = await setup({ config: { sources: { pixabay: false, pexels: true } }, keys: { DRAFTSMAN_PEXELS_KEY: 'test-pexels-key-0000' } });
    const res = await images.search('lighthouse', 5);
    expect(res.results).toHaveLength(2);
    expect(replay.requests[0]!.request.headers).toEqual({ Authorization: 'test-pexels-key-0000' });
  });

  it('keeps going when one source fails', async () => {
    const failing = { ...loadRecording('wikimedia', 'search-lighthouse'), response: { status: 503, contentType: 'text/plain', body: 'down for maintenance' } };
    const { images, logs } = await setup({ extra: [failing] });
    const res = await images.search('lighthouse', 5);
    expect(res.errors).toEqual([{ source: 'wikimedia', message: 'Wikimedia Commons answered 503: down for maintenance' }]);
    expect(res.results.some((r) => r.source === 'openverse')).toBe(true);
    expect(logs.join('\n')).toMatch(/search wikimedia: .*503/);
  });

  it('answers a repeated search from the cache within the source’s cache time', async () => {
    const { images, replay, advance } = await setup({ config: { sources: { openverse: true } } });
    await images.search('lighthouse', 5);
    expect(replay.requests).toHaveLength(2);
    advance(30 * 60 * 1000); // 30 minutes: both cached
    await images.search('lighthouse', 5);
    expect(replay.requests).toHaveLength(2);
    advance(60 * 60 * 1000); // 90 minutes: Openverse (1 hour) expired, Pixabay (24 hours) not
    await images.search('lighthouse', 5);
    expect(replay.requests.map((r) => new URL(r.url).host).sort()).toEqual(['api.openverse.org', 'api.openverse.org', 'pixabay.com']);
  });
});

describe('place_image', () => {
  it('refuses an image no search returned, one not yet checked, and one that failed the check', async () => {
    const { images, article } = await setup();
    const before = await readFile(article, 'utf8');
    await expect(images.place({ path: 'post.md', line: 5, ref: 'openverse:nope' })).rejects.toThrow(/No image "openverse:nope" from a search/);
    await images.search('lighthouse', 5);
    await expect(images.place({ path: 'post.md', line: 5, ref: openverseBy() })).rejects.toThrow(/hasn't been through check_license/);
    expect(images.check(openverseNc()).pass).toBe(false);
    await expect(images.place({ path: 'post.md', line: 5, ref: openverseNc() })).rejects.toThrow(/failed check_license: CC BY-NC: no commercial use/);
    expect(await readFile(article, 'utf8')).toBe(before);
  });

  it('downloads the image, replaces the placeholder, adds the credit and writes provenance', async () => {
    const { images, article, dir } = await setup();
    await images.search('lighthouse', 5);
    const ref = openverseBy();
    expect(images.check(ref).pass).toBe(true);
    const placed = await images.place({ path: 'post.md', line: 5, ref, alt: 'A white lighthouse on a rocky point' });

    // The image, byte for byte what the source sent.
    const recorded = Buffer.from(loadRecording('openverse', 'image-lighthouse-by').response.bodyBase64!, 'base64');
    expect(placed.image.file).toMatch(/images\/a-white-lighthouse-on-a-rocky-point-openverse-[0-9a-f-]+\.jpg$/);
    expect(await readFile(placed.image.file!)).toEqual(recorded);

    // The article: image in place of the placeholder, credit as its own paragraph.
    const text = await readFile(article, 'utf8');
    const lines = text.split('\n');
    expect(lines[4]).toBe(`![A white lighthouse on a rocky point](images/${path.basename(placed.image.file!)})`);
    expect(lines[5]).toBe('');
    expect(lines[6]).toBe(`*${placed.credit}*`);
    expect(lines[7]).toBe('');
    expect(lines[8]).toBe('More text.');
    expect(placed.credit).toMatch(/^\[.+\]\(https:\/\/www\.flickr\.com\/.+\) by \[.+\]\(.+\), \[CC BY 2\.0\]\(https:\/\/creativecommons\.org\/licenses\/by\/2\.0\/?\), via Openverse$/);

    // Provenance beside the image.
    expect(path.dirname(placed.provenance)).toBe(path.join(dir, 'images'));
    const p = JSON.parse(await readFile(placed.provenance, 'utf8'));
    expect(p).toMatchObject({
      draftsman: '0.0.0',
      placedAt: '2026-11-25T12:00:00.000Z',
      article: { file: '../post.md', line: 5 },
      image: { file: path.basename(placed.image.file!), contentType: 'image/jpeg', bytes: recorded.length, alt: 'A white lighthouse on a rocky point' },
      source: { id: 'openverse', name: 'Openverse', termsRead: '2026-11-25', use: 'download' },
      license: { pass: true, id: 'cc-by', name: 'CC BY', version: '2.0', asStated: 'by', checkedAt: '2026-11-25T12:00:00.000Z' },
      credit: placed.credit,
      search: { query: 'lighthouse' },
      onPick: null,
    });
    expect(p.image.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p.source.terms).toContain('https://docs.openverse.org/terms_of_service.html');
    expect(p.original.pageUrl).toMatch(/^https:\/\/www\.flickr\.com\//);
  });

  it('leaves the article unchanged, and removes anything written, when a step fails', async () => {
    const broken = { ...loadRecording('pixabay', 'image-lighthouse-1000001'), response: { status: 404, contentType: 'text/plain', body: 'gone' } };
    const { images, article, dir } = await setup({ extra: [broken] });
    const before = await readFile(article, 'utf8');
    await images.search('lighthouse', 5);
    images.check('pixabay:1000001');
    await expect(images.place({ path: 'post.md', line: 5, ref: 'pixabay:1000001' })).rejects.toThrow(/Downloading the image failed: HTTP 404/);
    expect(await readFile(article, 'utf8')).toBe(before);
    expect(existsSync(path.join(dir, 'images')) ? await readdir(path.join(dir, 'images')) : []).toEqual([]);
  });

  it('refuses a line with no placeholder', async () => {
    const { images } = await setup();
    await images.search('lighthouse', 5);
    images.check(openverseBy());
    await expect(images.place({ path: 'post.md', line: 3, ref: openverseBy() })).rejects.toThrow(/no image placeholder on line 3/);
  });

  it('hotlinks, and calls the on-pick URL, when a source says to', async () => {
    const def = {
      id: 'example',
      name: 'Example Images',
      kind: 'api',
      enabledByDefault: false,
      terms: { read: '2026-11-25', links: [{ url: 'https://img.example.test/terms', about: 'Terms' }], notes: ['A test source.'] },
      auth: { type: 'none' },
      search: { url: 'https://img.example.test/search?q={query}&n={count}', results: 'items', maxCount: 10 },
      fields: { id: 'id', title: 'title', pageUrl: 'page', imageUrl: 'image', creator: 'by' },
      license: { field: 'license', map: [{ match: '^cc0$', license: 'cc0' }] },
      use: { mode: 'hotlink', cacheSeconds: 0, onPick: { url: '{links.used}', method: 'GET' } },
      credit: '[{title}]({page}) by {creator}, {licenseName}',
    };
    const search: Recording = {
      recordedAt: '2026-11-25',
      note: 'test source',
      request: { method: 'GET', url: 'https://img.example.test/search?q=lighthouse&n=5' },
      response: {
        status: 200,
        contentType: 'application/json',
        body: { items: [{ id: 'e1', title: 'Light', page: 'https://img.example.test/e1', image: 'https://img.example.test/e1.jpg', by: 'Ann', license: 'cc0', links: { used: 'https://img.example.test/used/e1' } }] },
      },
    };
    const used: Recording = { recordedAt: '2026-11-25', note: 'test source', request: { method: 'GET', url: 'https://img.example.test/used/e1' }, response: { status: 204, contentType: '', body: '' } };
    const { images, article, dir, replay } = await setup({
      config: { sources: { pixabay: false, example: true }, extraSources: ['example.json'] },
      files: { 'example.json': JSON.stringify(def) },
      extra: [search, used],
    });
    await images.search('lighthouse', 5);
    images.check('example:e1');
    const placed = await images.place({ path: article, line: 5, ref: 'example:e1' });
    expect(placed.image).toEqual({ hotlink: 'https://img.example.test/e1.jpg' });
    expect((await readFile(article, 'utf8')).split('\n')[4]).toBe('![a lighthouse at dusk](https://img.example.test/e1.jpg)');
    expect(placed.credit).toBe('[Light](https://img.example.test/e1) by Ann, CC0');
    expect(replay.requests.map((r) => r.url)).toContain('https://img.example.test/used/e1');
    const p = JSON.parse(await readFile(placed.provenance, 'utf8'));
    expect(p.image).toEqual({ hotlink: 'https://img.example.test/e1.jpg', alt: 'a lighthouse at dusk' });
    expect(p.onPick).toEqual({ url: 'https://img.example.test/used/e1', method: 'GET', status: 204 });
    expect((await readdir(path.join(dir, 'images'))).filter((f) => !f.endsWith('.provenance.json'))).toEqual([]);
  });

  it('copies an image from a local folder, crediting its sidecar', async () => {
    const { images, article, dir } = await setup({
      config: { sources: { pixabay: false, local: { folder: 'pictures' } } },
      files: { 'pictures/harbor-light.png': 'not really a png', 'pictures/harbor-light.json': JSON.stringify({ license: 'own', title: 'Harbor light', creator: 'Me' }) },
    });
    const res = await images.search('harbor', 5);
    expect(res.results.map((r) => r.ref)).toEqual(['local:harbor-light.png']);
    images.check('local:harbor-light.png');
    const placed = await images.place({ path: 'post.md', line: 5, ref: 'local:harbor-light.png' });
    expect(await readFile(placed.image.file!, 'utf8')).toBe('not really a png');
    expect(placed.credit).toBe('Image by Me, Your own work');
    expect((await readFile(article, 'utf8')).split('\n')[4]).toMatch(/^!\[a lighthouse at dusk\]\(images\/a-lighthouse-at-dusk-local-harbor-light-png\.png\)$/);
    expect(path.dirname(placed.image.file!)).toBe(path.join(dir, 'images'));
  });

  it('tells the AI to set the folder when the local source has none', async () => {
    const { images } = await setup({ config: { sources: { pixabay: false, local: true } } });
    const res = await images.search('harbor', 5);
    expect(res.skipped[0]!.reason).toMatch(/Set the folder in \.draftsman\/config\.json/);
  });

  it('rejects an empty search', async () => {
    const { images } = await setup();
    await expect(images.search('  ')).rejects.toBeInstanceOf(ImageError);
  });

  it('writes nothing outside the article’s folder and the cache', async () => {
    const { images, dir, cacheDir } = await setup();
    await images.search('lighthouse', 5);
    images.check(openverseBy());
    await images.place({ path: 'post.md', line: 5, ref: openverseBy() });
    const all = await readdir(dir, { recursive: true });
    expect(all.filter((f) => !f.startsWith('.cache') && !f.startsWith('.draftsman') && !f.startsWith('images') && f !== 'post.md')).toEqual([]);
    expect(existsSync(cacheDir)).toBe(true);
  });
});
