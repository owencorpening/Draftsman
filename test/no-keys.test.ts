// Keys never appear in the repo, test recordings, logs, provenance files, the
// search cache or tool results (SPEC.md, Definition of done item 12).

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';

import { createServer } from '../src/server.js';
import { fakeKeys, workspace } from './helpers.js';
import { loadRecording, replayHttp, type Recording } from './recordings.js';

// Shaped like real keys, so the repo scan below would catch them too, but
// assembled here so this file never holds one whole.
const PIXABAY_KEY = ['48151623', 'abcdef0123456789abcdef0123456789'].join('-');
const PEXELS_KEY = ['Zq9', 'X'.repeat(50), 'kT7'].join('');

/** Shapes of real keys: Pixabay is digits, a dash and 32 hex; Pexels is 56 letters and digits. */
const KEY_SHAPES = [/\b\d{5,10}-[0-9a-f]{32}\b/, /(?<![A-Za-z0-9+/])[A-Za-z0-9]{56}(?![A-Za-z0-9+/=])/];

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((f) => path.join(dir, f))
    .filter((f) => statSync(f).isFile());
}

async function connect(ws: { dir: string; cacheDir: string }, extra: Recording[] = []) {
  const logs: string[] = [];
  const replay = replayHttp([PIXABAY_KEY, PEXELS_KEY], extra);
  const server = createServer({
    cwd: ws.dir,
    cacheDir: ws.cacheDir,
    http: replay.http,
    keys: fakeKeys({ DRAFTSMAN_PIXABAY_KEY: PIXABAY_KEY, DRAFTSMAN_PEXELS_KEY: PEXELS_KEY }),
    log: (m) => logs.push(m),
    now: () => new Date('2026-11-25T12:00:00Z'),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(a);
  clients.push(client);
  const results: string[] = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    results.push(JSON.stringify(r));
    return r;
  };
  return { call, logs, results, replay };
}

describe('keys never leak', () => {
  it('the test keys are shaped like real ones', () => {
    expect(PIXABAY_KEY).toMatch(KEY_SHAPES[0]!);
    expect(PEXELS_KEY).toMatch(KEY_SHAPES[1]!);
  });

  it('a search and a placement with keys leave them nowhere: files, cache, logs or tool results', async () => {
    const ws = await workspace({ config: { sources: { pexels: true } } });
    const { call, logs, results, replay } = await connect(ws);

    const found = await call('search_images', { query: 'lighthouse', count: 5 });
    expect(found.isError).toBeFalsy();
    expect((found.structuredContent as { results: unknown[] }).results).toHaveLength(4);
    // Both keys were really sent: Pixabay in the query string, Pexels in a header.
    expect(replay.requests.some((r) => r.url.includes(`key=${PIXABAY_KEY}`))).toBe(true);
    expect(replay.requests.some((r) => r.request.headers['Authorization'] === PEXELS_KEY)).toBe(true);

    expect((await call('check_license', { ref: 'pixabay:1000001' })).isError).toBeFalsy();
    const placed = await call('place_image', { path: 'post.md', line: 5, ref: 'pixabay:1000001' });
    expect(placed.isError).toBeFalsy();

    const written = filesUnder(ws.dir);
    expect(written.some((f) => f.endsWith('.provenance.json'))).toBe(true);
    expect(written.some((f) => f.includes(`${path.sep}.cache${path.sep}`))).toBe(true);
    for (const file of written) {
      const text = readFileSync(file).toString('latin1');
      expect(text.includes(PIXABAY_KEY), file).toBe(false);
      expect(text.includes(PEXELS_KEY), file).toBe(false);
    }
    for (const text of [...logs, ...results]) {
      expect(text).not.toContain(PIXABAY_KEY);
      expect(text).not.toContain(PEXELS_KEY);
    }
  });

  it('a source that echoes the key in an error has it scrubbed from the tool result and the log', async () => {
    const echo = {
      ...loadRecording('pixabay', 'search-lighthouse'),
      response: { status: 400, contentType: 'text/plain', body: `[ERROR 400] Invalid API key ${PIXABAY_KEY}` },
    };
    const ws = await workspace();
    const { call, logs, results } = await connect(ws, [echo]);
    const res = await call('search_images', { query: 'lighthouse', count: 5 });
    expect((res.structuredContent as { errors: { message: string }[] }).errors[0]!.message).toBe('Pixabay answered 400: [ERROR 400] Invalid API key REDACTED');
    expect(logs.join('\n')).toContain('Invalid API key REDACTED');
    for (const text of [...logs, ...results]) expect(text).not.toContain(PIXABAY_KEY);
  });

  it('Google tokens leave no trace either: a table rendered with a sheet, and an error that echoes the token', async () => {
    const REFRESH = 'test-refresh-' + 'r'.repeat(20);
    const ACCESS = 'ya29.test-access-' + 'a'.repeat(20);
    const token = { ...loadRecording('google', 'token-refresh'), response: { status: 200, contentType: 'application/json', body: { access_token: ACCESS, expires_in: 3599, token_type: 'Bearer' } } };
    const echo = {
      ...loadRecording('google', 'permissions-create'),
      response: { status: 401, contentType: 'application/json', body: { error: { message: `Bad credentials: Bearer ${ACCESS}` } } },
    };
    const table = '| a | b |\n|---|---|\n| 1 | 2 |\n';
    const ws = await workspace({ article: table, config: { google: { clientId: 'test-client.apps.googleusercontent.com' } } });
    const logs: string[] = [];
    const server = createServer({
      cwd: ws.dir,
      cacheDir: ws.cacheDir,
      env: {},
      http: replayHttp([], [token, echo]).http,
      keys: fakeKeys({ DRAFTSMAN_GOOGLE_REFRESH_TOKEN: REFRESH }),
      render: async () => Buffer.from('png'),
      log: (m) => logs.push(m),
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(a);
    clients.push(client);

    const r = await client.callTool({ name: 'render_table', arguments: { path: 'post.md', line: 1, caption: 'Numbers' } });
    expect(r.isError).toBeFalsy();
    const result = JSON.stringify(r);
    expect(result).toContain('Bad credentials: Bearer REDACTED');
    for (const text of [result, ...logs, ...filesUnder(ws.dir).map((f) => readFileSync(f).toString('latin1'))]) {
      expect(text).not.toContain(REFRESH);
      expect(text).not.toContain(ACCESS);
    }
  });

  it('the repo, test recordings included, holds nothing shaped like a key, and none of the keys set here', () => {
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
      .filter((f) => statSync(f, { throwIfNoEntry: false })?.isFile());
    expect(files.some((f) => f.startsWith('test/fixtures/recordings/'))).toBe(true);

    // Real keys in this environment, if any, by their variable names: checked for, never printed.
    const realKeys = Object.entries(process.env)
      .filter(([name, value]) => /^DRAFTSMAN_[A-Z0-9_]*KEY$/.test(name) && value && value.length >= 8)
      .map(([, value]) => value!);

    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file).toString('latin1');
      if (KEY_SHAPES.some((shape) => shape.test(text))) hits.push(`${file}: something shaped like a key`);
      if (realKeys.some((k) => text.includes(k))) hits.push(`${file}: a key from this environment`);
    }
    expect(hits).toEqual([]);
  });
});
