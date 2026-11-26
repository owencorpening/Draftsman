// Loads and checks every source definition, and the user's settings, when the
// server starts. A bad definition stops the server with an error that names
// the file, the field and what's wrong.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as z from 'zod';

import { LICENSES } from '../licenses.js';
import { SourceDefinition } from './schema.js';

/** The presets shipped with Draftsman. Works from src/ (tests) and dist/ (built). */
export const PRESETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../sources');

export class DefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitionError';
  }
}

function issues(file: string, error: z.ZodError): string {
  const lines = error.issues.map((i) => `  ${i.path.length ? i.path.join('.') : '(top level)'}: ${i.message}`);
  return `${file} is not a valid source definition:\n${lines.join('\n')}`;
}

/** Checks one definition: the schema, then the rules the schema can't express. */
export function parseDefinition(file: string, text: string): SourceDefinition {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new DefinitionError(`${file} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = SourceDefinition.safeParse(json);
  if (!parsed.success) throw new DefinitionError(issues(file, parsed.error));
  const def = parsed.data;

  const problems: string[] = [];
  const regex = (where: string, pattern: string) => {
    try {
      new RegExp(pattern, 'i');
    } catch (e) {
      problems.push(`  ${where}: not a valid regular expression (${(e as Error).message})`);
    }
  };
  if ('fixed' in def.license) {
    if (!LICENSES[def.license.fixed]) problems.push(`  license.fixed: unknown license "${def.license.fixed}"`);
    regex('license.pageUrlPattern', def.license.pageUrlPattern);
  } else {
    def.license.map.forEach((rule, i) => {
      regex(`license.map.${i}.match`, rule.match);
      if (!LICENSES[rule.license]) problems.push(`  license.map.${i}.license: unknown license "${rule.license}"`);
    });
  }
  if (def.kind === 'api') {
    const unknown = [...def.search.url.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((n) => n !== 'query' && n !== 'count');
    if (unknown.length) problems.push(`  search.url: unknown marker(s) ${unknown.map((n) => `{${n}}`).join(', ')}; use {query} and {count}`);
    if (!def.search.url.includes('{query}')) problems.push('  search.url: needs a {query} marker');
  }
  const creditMarkers = [...def.credit.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
  const allowed = ['title', 'creator', 'creatorLink', 'page', 'licenseName', 'licenseLink', 'sourceName'];
  const badMarkers = creditMarkers.filter((m) => !allowed.includes(m));
  if (badMarkers.length) problems.push(`  credit: unknown marker(s) ${badMarkers.map((n) => `{${n}}`).join(', ')}; use ${allowed.map((n) => `{${n}}`).join(', ')}`);

  if (problems.length) throw new DefinitionError(`${file} is not a valid source definition:\n${problems.join('\n')}`);
  return def;
}

const SourceSetting = z.union([
  z.boolean(),
  z.strictObject({ enabled: z.boolean().optional(), folder: z.string().optional() }),
]);

export const Config = z.strictObject({
  /** Turn sources on or off, by id: true, false, or { enabled, folder }. */
  sources: z.record(z.string(), SourceSetting).default({}),
  /** More definition files, relative to the config's folder. */
  extraSources: z.array(z.string()).default([]),
  /** Where downloaded images go, relative to the article. */
  imagesFolder: z.string().min(1).default('images'),
  /** The style for rendered images: a shipped style's id, or a path to your own style file. */
  style: z.string().min(1).default('default'),
  /** Google sign-in. The client ID isn't secret; DRAFTSMAN_GOOGLE_CLIENT_ID overrides it. */
  google: z.strictObject({ clientId: z.string().min(1).optional() }).default({}),
  /** Your own criteria files by job, relative to the project folder. */
  criteria: z.strictObject({ pullquotes: z.string().min(1).optional(), lists: z.string().min(1).optional() }).default({}),
});
export type Config = z.infer<typeof Config>;

/** The user's settings: .draftsman/config.json in the working folder, if there is one. */
export function loadConfig(cwd: string): { config: Config; file?: string } {
  const file = path.join(cwd, '.draftsman', 'config.json');
  if (!existsSync(file)) return { config: Config.parse({}) };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new DefinitionError(`${file} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = Config.safeParse(json);
  if (!parsed.success) {
    throw new DefinitionError(`${file} is not a valid Draftsman config:\n${parsed.error.issues.map((i) => `  ${i.path.join('.') || '(top level)'}: ${i.message}`).join('\n')}`);
  }
  return { config: parsed.data, file };
}

export interface LoadedSource {
  def: SourceDefinition;
  file: string;
  enabled: boolean;
  /** For a folder source: the folder, with ~ expanded. */
  folder?: string;
}

/** Loads the presets and any extra definitions, checks them all, and applies the user's on/off settings. */
export function loadSources(cwd: string, presetsDir = PRESETS_DIR): { sources: LoadedSource[]; config: Config } {
  const { config, file: configFile } = loadConfig(cwd);
  const files = readdirSync(presetsDir)
    .filter((f) => f.endsWith('.json') && f !== 'source.schema.json')
    .sort()
    .map((f) => path.join(presetsDir, f));
  const base = configFile ? path.dirname(path.dirname(configFile)) : cwd;
  files.push(...config.extraSources.map((f) => path.resolve(base, f)));

  const errors: string[] = [];
  const sources: LoadedSource[] = [];
  for (const file of files) {
    try {
      if (!existsSync(file)) throw new DefinitionError(`${file}: listed in extraSources but not found`);
      const def = parseDefinition(file, readFileSync(file, 'utf8'));
      if (sources.some((s) => s.def.id === def.id)) throw new DefinitionError(`${file}: another source already has the id "${def.id}"`);
      const setting = config.sources[def.id];
      const enabled = typeof setting === 'boolean' ? setting : (setting?.enabled ?? (setting ? true : def.enabledByDefault));
      const folder = typeof setting === 'object' && setting.folder ? setting.folder.replace(/^~(?=$|[/\\])/, os.homedir()) : undefined;
      sources.push({ def, file, enabled, ...(folder ? { folder: path.resolve(base, folder) } : {}) });
    } catch (e) {
      if (!(e instanceof DefinitionError)) throw e;
      errors.push(e.message);
    }
  }
  const unknownIds = Object.keys(config.sources).filter((id) => !sources.some((s) => s.def.id === id));
  if (unknownIds.length) errors.push(`${configFile}: sources lists unknown source id(s): ${unknownIds.join(', ')}`);
  if (errors.length) throw new DefinitionError(errors.join('\n\n'));
  return { sources, config };
}
