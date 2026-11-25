import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkLicense, LICENSES } from '../src/licenses.js';
import { loadSources } from '../src/sources/load.js';
import type { ApiSourceDefinition, FolderSourceDefinition } from '../src/sources/schema.js';
import { resultsOf, searchFolder, toCandidate, type Candidate } from '../src/sources/search.js';
import { workspace } from './helpers.js';
import { loadRecording } from './recordings.js';

async function preset<T extends ApiSourceDefinition | FolderSourceDefinition>(id: string): Promise<T> {
  return loadSources((await workspace()).dir).sources.find((s) => s.def.id === id)!.def as T;
}

/** The candidates from a recorded search, run through the preset's field and license rules. */
async function recorded(source: string, name: string): Promise<Candidate[]> {
  const def = await preset<ApiSourceDefinition>(source);
  return resultsOf(def, loadRecording(source, name).response.body).map((item) => toCandidate(def, item)!);
}

const verdicts = (cs: Candidate[]) => cs.map((c) => ({ id: c.id, ...checkLicense(c.license) }));

describe('check_license on each preset (recorded results)', () => {
  it('Pixabay: passes a result from pixabay.com, rejects one whose page isn’t there', async () => {
    const [ok, notFromPixabay] = verdicts(await recorded('pixabay', 'search-lighthouse'));
    expect(ok).toMatchObject({ pass: true, license: { id: 'pixabay' } });
    expect(ok!.obligations.join(' ')).toMatch(/don't sell or distribute the image on its own/);
    expect(notFromPixabay).toMatchObject({ pass: false });
    expect(notFromPixabay!.reasons.join(' ')).toMatch(/isn't on Pixabay, so its license can't be confirmed/);
  });

  it('Pexels: passes a result from pexels.com, rejects one from elsewhere', async () => {
    const [ok, elsewhere] = verdicts(await recorded('pexels', 'search-lighthouse'));
    expect(ok).toMatchObject({ pass: true, license: { id: 'pexels' } });
    expect(elsewhere).toMatchObject({ pass: false });
  });

  it('Openverse: passes CC BY, rejects non-commercial and no-derivatives licenses', async () => {
    const vs = verdicts(await recorded('openverse', 'search-lighthouse'));
    const by = (raw: string) => vs.find((v) => v.raw === raw)!;
    expect(by('by')).toMatchObject({ pass: true, license: { id: 'cc-by', version: '2.0' } });
    expect(by('by').obligations.join(' ')).toMatch(/Credit is required/);
    expect(by('by-nc')).toMatchObject({ pass: false, reasons: ['CC BY-NC: no commercial use'] });
    expect(by('by-nc-sa')).toMatchObject({ pass: false });
    expect(by('by-nc-nd')).toMatchObject({ pass: false, reasons: ['CC BY-NC-ND: no commercial use and no changes allowed'] });
  });

  it('Wikimedia Commons: passes CC BY and CC BY-SA, rejects files marked trademarked', async () => {
    const vs = verdicts(await recorded('wikimedia', 'search-lighthouse'));
    expect(vs.every((v) => v.pass)).toBe(true);
    const sa = vs.find((v) => v.license?.id === 'cc-by-sa')!;
    expect(sa.obligations.join(' ')).toMatch(/Share-alike/);
    expect(vs.some((v) => v.license?.id === 'cc-by')).toBe(true);

    const logos = verdicts(await recorded('wikimedia', 'search-trademark-logo'));
    expect(logos.length).toBeGreaterThan(0);
    for (const v of logos) {
      expect(v.raw).toBe('Public domain'); // the license alone would pass...
      expect(v.pass).toBe(false); // ...but the restriction fails it
      expect(v.reasons.join(' ')).toMatch(/reuse restrictions \(such as trademarks/);
    }
  });

  it('Local folder: passes an image whose sidecar says it’s your own, rejects one with no sidecar', async () => {
    const def = await preset<FolderSourceDefinition>('local');
    const dir = await mkdtemp(path.join(tmpdir(), 'draftsman-local-'));
    await writeFile(path.join(dir, 'harbor-light.png'), 'png');
    await writeFile(path.join(dir, 'harbor-light.json'), JSON.stringify({ license: 'own', title: 'Harbor light', creator: 'Me' }));
    await writeFile(path.join(dir, 'harbor-dock.png'), 'png');
    const [dock, light] = verdicts(await searchFolder(def, dir, 'harbor', 10)).sort((a, b) => a.id.localeCompare(b.id));
    expect(dock).toMatchObject({ id: 'harbor-dock.png', pass: false });
    expect(dock!.reasons).toContain('no sidecar file harbor-dock.json giving its license');
    expect(light).toMatchObject({ id: 'harbor-light.png', pass: true, license: { id: 'own' } });
  });
});

describe('checkLicense', () => {
  const input = (licenseId: string | undefined, raw = licenseId ?? '') => ({ licenseId, raw, rejected: [], prohibited: [] });

  it('fails anything unknown or missing', () => {
    expect(checkLicense(input(undefined, 'Some Custom License'))).toMatchObject({ pass: false });
    expect(checkLicense(input(undefined, 'Some Custom License')).reasons[0]).toMatch(/isn’t one Draftsman knows/);
    expect(checkLicense(input(undefined, ''))).toMatchObject({ pass: false, reasons: ['the source gives no license'] });
  });

  it('passes only licenses that allow both commercial use and changes', () => {
    const passing = Object.values(LICENSES).filter((l) => checkLicense(input(l.id)).pass).map((l) => l.id);
    expect(passing.sort()).toEqual(['cc-by', 'cc-by-sa', 'cc0', 'own', 'pdm', 'pexels', 'pixabay', 'public-domain']);
    for (const l of Object.values(LICENSES)) {
      if (!l.commercial || !l.modify) expect(checkLicense(input(l.id)).pass, l.id).toBe(false);
    }
    expect(checkLicense(input('sampling')).pass).toBe(false);
    expect(checkLicense(input('gfdl')).reasons[0]).toMatch(/full copy of the license text/);
  });

  it('fails when the source flagged the file, whatever the license', () => {
    expect(checkLicense({ ...input('cc0'), rejected: ['marked non-free'] })).toMatchObject({ pass: false, reasons: ['marked non-free'] });
  });

  it('lists nothing to do on a failure, and the prohibited uses on a pass', () => {
    expect(checkLicense({ ...input('cc-by-nc'), prohibited: ['x'] }).obligations).toEqual([]);
    expect(checkLicense({ ...input('cc0'), prohibited: ['Don’t sell it as is.'] }).obligations).toEqual(['Don’t sell it as is.']);
  });
});
