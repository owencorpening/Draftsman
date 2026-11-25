// Records a live response for the tests, with every key scrubbed.
//
//   npm run record -- search <source> "<query>" <name> [count] [extra query string]
//   npm run record -- get <source> <url> <name>
//
// The key, if the source needs one, comes from its environment variable or the
// keychain, as at run time. It is replaced with REDACTED in the saved URL and
// body, and the saved file is checked for it before it's written.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { liveHttp } from '../src/http.js';
import { howToAddKey, keyLookup, scrubKeys } from '../src/keys.js';
import { loadSources } from '../src/sources/load.js';
import { searchUrl, withKey } from '../src/sources/search.js';
import type { Recording } from '../test/recordings.js';

const [mode, sourceId, arg, name, countArg, extra] = process.argv.slice(2);
if (!mode || !sourceId || !arg || !name || !['search', 'get'].includes(mode)) {
  console.error('usage: npm run record -- search <source> "<query>" <name> [count] [extra]\n       npm run record -- get <source> <url> <name>');
  process.exit(2);
}

const { sources } = loadSources(process.cwd());
const def = sources.find((s) => s.def.id === sourceId)?.def;
if (!def || def.kind !== 'api') throw new Error(`no API source "${sourceId}"`);

let key: string | undefined;
if (def.auth.type !== 'none') {
  key = (await keyLookup()({ id: def.id, env: def.auth.env }))?.key;
  if (!key) throw new Error(howToAddKey({ id: def.id, name: def.name, env: def.auth.env, getKeyUrl: def.auth.getKeyUrl }));
}
const keys = key ? [key, encodeURIComponent(key)] : [];

const url = mode === 'search' ? searchUrl(def, arg, Number(countArg ?? 5)) + (extra ?? '') : arg;
const req = mode === 'search' ? withKey(def, url, key) : { url, headers: {} };
const res = await liveHttp(req.url, { method: 'GET', headers: req.headers });

const isJson = res.contentType.includes('json');
const recording: Recording = {
  recordedAt: new Date().toISOString().slice(0, 10),
  note: `Live response from ${def.name}, recorded with scripts/record.ts.`,
  request: { method: 'GET', url: scrubKeys(mode === 'search' ? withKey(def, url, key ? 'REDACTED' : undefined).url : url, keys) },
  response: {
    status: res.status,
    contentType: res.contentType,
    ...(isJson ? { body: JSON.parse(scrubKeys(res.body.toString('utf8'), keys)) } : { bodyBase64: res.body.toString('base64') }),
  },
};
const text = JSON.stringify(recording, null, 2) + '\n';
if (key && text.includes(key)) throw new Error('the key is still in the recording; not saving it');

const file = path.resolve('test/fixtures/recordings', def.id, `${name}.json`);
await mkdir(path.dirname(file), { recursive: true });
await writeFile(file, text);
console.log(`${res.status} ${res.contentType} ${res.body.length} bytes -> ${path.relative(process.cwd(), file)}`);
