import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CRITERIA_DIR, CriteriaError, getCriteria } from '../src/criteria.js';
import { workspace } from './helpers.js';

describe('get_criteria', () => {
  it('falls back to the shipped sample', async () => {
    const { dir } = await workspace();
    const c = await getCriteria('pullquotes', dir, { criteria: {} });
    expect(c).toMatchObject({ job: 'pullquotes', from: 'sample', file: path.join(CRITERIA_DIR, 'pullquotes.md') });
    expect(c.text).toMatch(/^# Pull quote criteria/);
  });

  it('uses the project’s own file over the sample', async () => {
    const { dir } = await workspace();
    await mkdir(path.join(dir, '.draftsman', 'criteria'), { recursive: true });
    await writeFile(path.join(dir, '.draftsman', 'criteria', 'pullquotes.md'), 'Only quotes about water.\n');
    expect(await getCriteria('pullquotes', dir, { criteria: {} })).toMatchObject({ from: 'project', text: 'Only quotes about water.\n' });
  });

  it('uses a file named in the config over both, and says when it’s missing', async () => {
    const { dir } = await workspace();
    await mkdir(path.join(dir, '.draftsman', 'criteria'), { recursive: true });
    await writeFile(path.join(dir, '.draftsman', 'criteria', 'pullquotes.md'), 'project\n');
    await writeFile(path.join(dir, 'mine.md'), 'config\n');
    expect(await getCriteria('pullquotes', dir, { criteria: { pullquotes: 'mine.md' } })).toMatchObject({ from: 'config', text: 'config\n' });
    await expect(getCriteria('pullquotes', dir, { criteria: { pullquotes: 'gone.md' } })).rejects.toThrow(CriteriaError);
  });
});
