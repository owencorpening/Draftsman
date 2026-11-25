import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createServer } from '../src/server.js';
import { DefinitionError, loadSources, parseDefinition, PRESETS_DIR } from '../src/sources/load.js';
import { sourceJsonSchema } from '../src/sources/schema.js';
import { workspace } from './helpers.js';

const preset = (id: string) => JSON.parse(readFileSync(path.join(PRESETS_DIR, `${id}.json`), 'utf8')) as Record<string, unknown>;

describe('presets', () => {
  it('are all valid, with Pixabay on and the others off by default', async () => {
    const { dir } = await workspace();
    const { sources } = loadSources(dir);
    expect(sources.map((s) => [s.def.id, s.enabled]).sort()).toEqual([
      ['local', false],
      ['openverse', false],
      ['pexels', false],
      ['pixabay', true],
      ['wikimedia', false],
    ]);
  });

  it('cite the terms they follow, with the date they were read', async () => {
    const { sources } = loadSources((await workspace()).dir);
    for (const { def } of sources) {
      expect(def.terms.read, def.id).toBe('2026-11-25');
      expect(def.terms.links.length, def.id).toBeGreaterThan(0);
      expect(def.terms.notes.length, def.id).toBeGreaterThan(0);
    }
  });

  it('set each rule from the terms: Pixabay downloads and caches 24 hours; nothing has an on-pick URL', async () => {
    const { sources } = loadSources((await workspace()).dir);
    const by = Object.fromEntries(sources.map((s) => [s.def.id, s.def]));
    expect(by['pixabay']!.use).toMatchObject({ mode: 'download', cacheSeconds: 86400 });
    expect(by['pixabay']!.terms.notes.join(' ')).toMatch(/permanent hotlinking .* is not allowed/);
    expect(by['pixabay']!.terms.notes.join(' ')).toMatch(/must be cached for 24 hours/);
    expect(by['pexels']!.terms.notes.join(' ')).toMatch(/New API key issuance is currently paused/);
    expect(by['wikimedia']!.terms.notes.join(' ')).toMatch(/hotlinking .*not recommended/);
    for (const def of Object.values(by)) {
      expect(def.use.mode, def.id).toBe('download');
      expect(def.use.onPick, def.id).toBeUndefined();
    }
  });

  it('keep keys out: Pixabay and Pexels read them from environment variables', async () => {
    const { sources } = loadSources((await workspace()).dir);
    const auth = Object.fromEntries(sources.filter((s) => s.def.kind === 'api').map((s) => [s.def.id, s.def.kind === 'api' ? s.def.auth : undefined]));
    expect(auth['pixabay']).toMatchObject({ type: 'query', name: 'key', env: 'DRAFTSMAN_PIXABAY_KEY' });
    expect(auth['pexels']).toMatchObject({ type: 'header', name: 'Authorization', env: 'DRAFTSMAN_PEXELS_KEY' });
    expect(auth['openverse']).toEqual({ type: 'none' });
    expect(auth['wikimedia']).toEqual({ type: 'none' });
  });
});

describe('the definition format', () => {
  it('matches the committed JSON Schema (npm run schema regenerates it)', () => {
    const committed = JSON.parse(readFileSync(path.join(PRESETS_DIR, 'source.schema.json'), 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(sourceJsonSchema())));
  });

  const valid = () => preset('openverse');
  const errorOf = (def: unknown): string => {
    try {
      parseDefinition('my-source.json', typeof def === 'string' ? def : JSON.stringify(def));
    } catch (e) {
      expect(e).toBeInstanceOf(DefinitionError);
      return (e as Error).message;
    }
    throw new Error('expected a DefinitionError');
  };

  it('names the file, the field and the problem', () => {
    const { search: _s, ...noSearch } = valid();
    expect(errorOf(noSearch)).toMatch(/my-source\.json is not a valid source definition:\n {2}search: /);
    expect(errorOf({ ...valid(), use: { mode: 'embed', cacheSeconds: 1 } })).toMatch(/use\.mode: /);
    expect(errorOf({ ...valid(), id: 'Bad Id' })).toMatch(/id: lowercase letters, digits and dashes/);
  });

  it('rejects bad JSON, unknown licenses, bad patterns and unknown markers', () => {
    expect(errorOf('{ not json')).toMatch(/my-source\.json is not valid JSON/);
    const v = valid() as { license: { map: unknown[] } };
    expect(errorOf({ ...v, license: { ...v.license, map: [{ match: '^by$', license: 'cc-by-whatever' }] } })).toMatch(
      /license\.map\.0\.license: unknown license "cc-by-whatever"/,
    );
    expect(errorOf({ ...v, license: { ...v.license, map: [{ match: '(', license: 'cc-by' }] } })).toMatch(/license\.map\.0\.match: not a valid regular expression/);
    expect(errorOf({ ...valid(), credit: 'Photo by {author}' })).toMatch(/credit: unknown marker\(s\) \{author\}/);
    expect(errorOf({ ...valid(), search: { url: 'https://x.test/?q={q}', results: 'r', maxCount: 5 } })).toMatch(/search\.url: unknown marker\(s\) \{q\}/);
  });

  it('stops the server at startup when any definition is bad, listing every bad file', async () => {
    const { dir } = await workspace({ config: { extraSources: ['mine/a.json', 'mine/b.json'] } });
    await mkdir(path.join(dir, 'mine'));
    await writeFile(path.join(dir, 'mine', 'a.json'), JSON.stringify({ ...valid(), id: 'mine-a', credit: '' }));
    await writeFile(path.join(dir, 'mine', 'b.json'), '{');
    expect(() => createServer({ cwd: dir, cacheDir: path.join(dir, '.c') })).toThrow(/a\.json is not a valid source definition:\n {2}credit: [\s\S]*b\.json is not valid JSON/);
  });

  it('as a program, exits at startup with the readable error instead of serving', async () => {
    const { dir } = await workspace({ config: { extraSources: ['bad.json'] } });
    await writeFile(path.join(dir, 'bad.json'), JSON.stringify({ ...valid(), id: 'bad', use: { mode: 'embed', cacheSeconds: 1 } }));
    const r = spawnSync(path.resolve('node_modules/.bin/tsx'), [path.resolve('src/server.ts')], { cwd: dir, encoding: 'utf8', input: '', timeout: 20_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/draftsman: can't start\.\n.*bad\.json is not a valid source definition:\n {2}use\.mode: /);
  });

  it('loads a user’s own source and applies on/off settings, and refuses unknown source ids', async () => {
    const { dir } = await workspace({ config: { sources: { pixabay: false, openverse: true, mine: true }, extraSources: ['mine.json'] } });
    await writeFile(path.join(dir, 'mine.json'), JSON.stringify({ ...valid(), id: 'mine', name: 'Mine', enabledByDefault: false }));
    const enabled = loadSources(dir).sources.filter((s) => s.enabled).map((s) => s.def.id);
    expect(enabled.sort()).toEqual(['mine', 'openverse']);

    const bad = await workspace({ config: { sources: { pixabey: true } } });
    expect(() => loadSources(bad.dir)).toThrow(/unknown source id\(s\): pixabey/);
  });
});
