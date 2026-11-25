// Searching one source and turning its results into candidates.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { mapLicense, type LicenseInput } from '../licenses.js';
import { asText, fillFromResult, fillUrl, getPath, readField } from './fields.js';
import type { ApiSourceDefinition, FolderSourceDefinition, SourceDefinition } from './schema.js';

export interface Candidate {
  /** "source:id": how the AI refers to this candidate in later calls. */
  ref: string;
  source: string;
  sourceName: string;
  id: string;
  title?: string;
  pageUrl: string;
  imageUrl: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  creator?: string;
  creatorUrl?: string;
  license: LicenseInput;
  /** The address to call if this image is placed, where the source asks for one. Not shown to the AI. */
  onPickUrl?: string;
}

/** The search URL for a query, without any key. */
export function searchUrl(def: ApiSourceDefinition, query: string, count: number): string {
  return fillUrl(def.search.url, { query, count: Math.max(1, Math.min(count, def.search.maxCount)) });
}

/** Adds the key where the source wants it: a query parameter or a header. */
export function withKey(def: ApiSourceDefinition, url: string, key: string | undefined): { url: string; headers: Record<string, string> } {
  const headers = { ...def.search.headers };
  if (def.auth.type === 'none' || !key) return { url, headers };
  if (def.auth.type === 'header') return { url, headers: { ...headers, [def.auth.name]: (def.auth.prefix ?? '') + key } };
  const u = new URL(url);
  u.searchParams.set(def.auth.name, key);
  return { url: u.toString(), headers };
}

/** The license facts of one result, by the source's license rules and reject rules. */
export function licenseOf(def: SourceDefinition, item: unknown, pageUrl: string | undefined): LicenseInput {
  const rejected = def.reject.filter((r) => {
    const v = getPath(item, r.field);
    const text = asText(v) ?? (Array.isArray(v) && v.length ? v.join(',') : undefined);
    return r.when === 'present' ? text !== undefined : text !== undefined && r.when.includes(text);
  });
  const base = { rejected: rejected.map((r) => r.reason), prohibited: def.use.prohibited };

  if ('fixed' in def.license) {
    const fromSource = !!pageUrl && new RegExp(def.license.pageUrlPattern, 'i').test(pageUrl);
    return fromSource
      ? { ...base, licenseId: def.license.fixed, raw: def.license.fixed, url: def.license.url }
      : { ...base, raw: '', rejected: [...base.rejected, `the result's page isn't on ${def.name}, so its license can't be confirmed`] };
  }
  const raw = asText(getPath(item, def.license.field)) ?? '';
  const version = def.license.versionField ? asText(getPath(item, def.license.versionField)) : undefined;
  const url = def.license.urlField ? asText(getPath(item, def.license.urlField)) : undefined;
  const licenseId = mapLicense(raw, def.license.map);
  return { ...base, raw, ...(licenseId ? { licenseId } : {}), ...(version ? { version } : {}), ...(url ? { url } : {}) };
}

const num = (v: string | undefined): number | undefined => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** One API result as a candidate, or undefined if it lacks an id, page or image. */
export function toCandidate(def: ApiSourceDefinition, item: unknown): Candidate | undefined {
  const f = def.fields;
  const id = readField(item, f.id);
  const pageUrl = readField(item, f.pageUrl);
  const imageUrl = readField(item, f.imageUrl);
  if (!id || !imageUrl) return undefined;
  const c: Candidate = {
    ref: `${def.id}:${id}`,
    source: def.id,
    sourceName: def.name,
    id,
    pageUrl: pageUrl ?? '',
    imageUrl,
    license: licenseOf(def, item, pageUrl),
  };
  const optional = {
    title: readField(item, f.title),
    thumbnailUrl: readField(item, f.thumbnailUrl),
    width: num(readField(item, f.width)),
    height: num(readField(item, f.height)),
    creator: readField(item, f.creator),
    creatorUrl: readField(item, f.creatorUrl),
    onPickUrl: def.use.onPick ? fillFromResult(def.use.onPick.url, item) : undefined,
  };
  for (const [k, v] of Object.entries(optional)) if (v !== undefined) (c as unknown as Record<string, unknown>)[k] = v;
  return c;
}

/** The list of results in a response; an object of results (like MediaWiki's) counts as a list. */
export function resultsOf(def: ApiSourceDefinition, body: unknown): unknown[] {
  const list = getPath(body, def.search.results);
  if (Array.isArray(list)) return list;
  if (list && typeof list === 'object') return Object.values(list);
  return [];
}

const IMAGE_FILE = /\.(jpe?g|png|webp|gif)$/i;

/** Searches a folder of images: every word of the query must appear in the file name or the sidecar's title. */
export async function searchFolder(def: FolderSourceDefinition, folder: string, query: string, count: number): Promise<Candidate[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const files: string[] = [];
  const walk = async (dir: string, depth: number) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 2 && !entry.name.startsWith('.')) await walk(full, depth + 1);
      else if (entry.isFile() && IMAGE_FILE.test(entry.name)) files.push(full);
    }
  };
  await walk(folder, 0);

  const out: Candidate[] = [];
  for (const file of files.sort()) {
    const sidecarFile = file.replace(IMAGE_FILE, '.json');
    // No sidecar, or one that isn't JSON, means no license: the check fails it.
    const sidecar: unknown = await readFile(sidecarFile, 'utf8')
      .then((t) => JSON.parse(t) as unknown)
      .catch(() => ({}));
    const s = def.sidecar;
    const title = asText(getPath(sidecar, s.title));
    const haystack = `${path.basename(file)} ${title ?? ''}`.toLowerCase();
    if (!words.every((w) => haystack.includes(w))) continue;
    const id = path.relative(folder, file).split(path.sep).join('/');
    const pageUrl = asText(getPath(sidecar, s.pageUrl)) ?? pathToFileURL(file).toString();
    const c: Candidate = {
      ref: `${def.id}:${id}`,
      source: def.id,
      sourceName: def.name,
      id,
      pageUrl,
      imageUrl: pathToFileURL(file).toString(),
      thumbnailUrl: pathToFileURL(file).toString(),
      license: licenseOf(def, sidecar, pageUrl),
    };
    const creator = asText(getPath(sidecar, s.creator));
    const creatorUrl = asText(getPath(sidecar, s.creatorUrl));
    if (title) c.title = title;
    if (creator) c.creator = creator;
    if (creatorUrl) c.creatorUrl = creatorUrl;
    if (!(await stat(sidecarFile).catch(() => undefined))) c.license.rejected.push(`no sidecar file ${path.basename(sidecarFile)} giving its license`);
    out.push(c);
    if (out.length >= count) break;
  }
  return out;
}
