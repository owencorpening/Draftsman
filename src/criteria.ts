// Criteria files: the user's rules for judging a job, such as picking pull
// quotes. Draftsman doesn't interpret them; it hands the text to the AI, which
// judges. The user's own file wins over the shipped sample.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from './sources/load.js';

export const CRITERIA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../criteria');

export const CRITERIA_JOBS = ['pullquotes', 'lists'] as const;
export type CriteriaJob = (typeof CRITERIA_JOBS)[number];

export class CriteriaError extends Error {}

export interface Criteria {
  job: CriteriaJob;
  /** Where the text came from: "config", "project" or "sample". */
  from: 'config' | 'project' | 'sample';
  file: string;
  text: string;
}

/** The criteria for a job: the config's file, else .draftsman/criteria/<job>.md, else the shipped sample. */
export async function getCriteria(job: CriteriaJob, cwd: string, config: Pick<Config, 'criteria'>, criteriaDir = CRITERIA_DIR): Promise<Criteria> {
  const configured = config.criteria[job];
  if (configured) {
    const file = path.resolve(cwd, configured);
    if (!existsSync(file)) throw new CriteriaError(`The ${job} criteria file ${file} (from .draftsman/config.json) was not found.`);
    return { job, from: 'config', file, text: await readFile(file, 'utf8') };
  }
  const project = path.join(cwd, '.draftsman', 'criteria', `${job}.md`);
  if (existsSync(project)) return { job, from: 'project', file: project, text: await readFile(project, 'utf8') };
  const sample = path.join(criteriaDir, `${job}.md`);
  return { job, from: 'sample', file: sample, text: await readFile(sample, 'utf8') };
}
