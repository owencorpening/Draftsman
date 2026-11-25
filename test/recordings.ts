// Recorded responses for tests. No test reaches a live API: replayHttp serves
// only what's recorded here, and fails on anything else.
//
// A recording is one JSON file in test/fixtures/recordings/<source>/:
//   { recordedAt, note, request: { method, url }, response: { status, contentType, body | bodyBase64 } }
// Keys are never in a recording: the URL and body have every key replaced
// with REDACTED when recorded (scripts/record.ts).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Http, HttpRequest } from '../src/http.js';

export const RECORDINGS = path.resolve('test/fixtures/recordings');

export interface Recording {
  recordedAt: string;
  note: string;
  request: { method: 'GET' | 'POST'; url: string };
  response: { status: number; contentType: string; body?: unknown; bodyBase64?: string };
}

export function loadRecording(source: string, name: string): Recording {
  return JSON.parse(readFileSync(path.join(RECORDINGS, source, `${name}.json`), 'utf8')) as Recording;
}

export function allRecordings(): { file: string; recording: Recording }[] {
  return readdirSync(RECORDINGS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      readdirSync(path.join(RECORDINGS, d.name))
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const file = path.join(RECORDINGS, d.name, f);
          return { file, recording: JSON.parse(readFileSync(file, 'utf8')) as Recording };
        }),
    );
}

export interface Replay {
  http: Http;
  /** Every request made, as sent: with the real (test) key, so tests can check it was sent. */
  requests: { url: string; request: HttpRequest }[];
}

/**
 * Serves recordings by method and URL. `keys` are the test's fake keys: they
 * are replaced with REDACTED before lookup, matching how recordings are stored.
 */
export function replayHttp(keys: string[] = [], extra: Recording[] = []): Replay {
  const byUrl = new Map<string, Recording>();
  for (const r of [...allRecordings().map((x) => x.recording), ...extra]) byUrl.set(`${r.request.method} ${r.request.url}`, r);
  const requests: Replay['requests'] = [];
  const http: Http = async (url, request) => {
    requests.push({ url, request });
    let lookup = url;
    for (const k of keys) lookup = lookup.split(encodeURIComponent(k)).join('REDACTED').split(k).join('REDACTED');
    const r = byUrl.get(`${request.method} ${lookup}`);
    if (!r) throw new Error(`no recording for ${request.method} ${lookup}; tests never call live APIs (record one with npm run record)`);
    const body =
      r.response.bodyBase64 !== undefined
        ? Buffer.from(r.response.bodyBase64, 'base64')
        : Buffer.from(typeof r.response.body === 'string' ? r.response.body : JSON.stringify(r.response.body));
    return { status: r.response.status, contentType: r.response.contentType, body };
  };
  return { http, requests };
}
