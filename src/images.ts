// Image search, the license check and placing an image: the work behind the
// search_images, check_license and place_image tools.
//
// Candidates live in this object for the session. place_image takes only a
// candidate's ref, never license facts from the caller, and refuses any
// candidate that hasn't passed check_license here.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SearchCache } from './cache.js';
import type { Http } from './http.js';
import { howToAddKey, scrubKeys, type KeyLookup } from './keys.js';
import { checkLicense, type LicenseVerdict } from './licenses.js';
import { findBlocks, formatDoc, isBlank, parseDoc } from './markdown.js';
import { findSlots } from './slots.js';
import { escapeMarkdown, fillCredit, markdownUrl } from './sources/fields.js';
import type { Config, LoadedSource } from './sources/load.js';
import type { ApiSourceDefinition } from './sources/schema.js';
import { resultsOf, searchFolder, searchUrl, toCandidate, withKey, type Candidate } from './sources/search.js';
import { VERSION } from './version.js';

export class ImageError extends Error {}

export interface ImageServiceOptions {
  sources: LoadedSource[];
  config: Config;
  http: Http;
  keys: KeyLookup;
  cacheDir: string;
  cwd: string;
  /** Where warnings go; every message passes through key scrubbing first. */
  log?: (message: string) => void;
  now?: () => Date;
}

export interface SearchResult {
  query: string;
  results: CandidateSummary[];
  /** Sources that were searched but failed. */
  errors: { source: string; message: string }[];
  /** Enabled sources that couldn't be searched, such as a missing key. */
  skipped: { source: string; reason: string }[];
}

/** What the AI sees of a candidate. Every result names its source, as Pixabay's terms ask. */
export type CandidateSummary = Omit<Candidate, 'license' | 'onPickUrl'> & { license: string };

export interface PlaceResult {
  path: string;
  line: number;
  markdown: string;
  credit: string;
  image: { file?: string; hotlink?: string };
  provenance: string;
}

const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export class ImageService {
  private readonly candidates = new Map<string, Candidate>();
  private readonly verdicts = new Map<string, LicenseVerdict & { checkedAt: string }>();
  private readonly queries = new Map<string, string>();
  /** Every key used this session, so anything written or logged can be scrubbed of them. */
  private readonly usedKeys = new Set<string>();
  private readonly cache: SearchCache;
  private readonly now: () => Date;

  constructor(private readonly o: ImageServiceOptions) {
    this.now = o.now ?? (() => new Date());
    this.cache = new SearchCache(o.cacheDir, () => this.now().getTime());
  }

  private log(message: string): void {
    this.o.log?.(this.scrub(message));
  }

  /** Removes any key used this session from text. */
  scrub(text: string): string {
    return scrubKeys(text, this.usedKeys);
  }

  enabledSources(): LoadedSource[] {
    return this.o.sources.filter((s) => s.enabled);
  }

  async search(query: string, count = 10, only?: string[]): Promise<SearchResult> {
    const q = query.trim();
    if (!q) throw new ImageError('The search is empty.');
    const enabled = this.enabledSources().filter((s) => !only?.length || only.includes(s.def.id));
    if (only?.length) {
      const unknown = only.filter((id) => !this.enabledSources().some((s) => s.def.id === id));
      if (unknown.length) throw new ImageError(`Not enabled or unknown source(s): ${unknown.join(', ')}. Enabled: ${this.enabledSources().map((s) => s.def.id).join(', ') || 'none'}.`);
    }
    const result: SearchResult = { query: q, results: [], errors: [], skipped: [] };

    await Promise.all(
      enabled.map(async (s) => {
        try {
          const found = await this.searchOne(s, q, count, result);
          for (const c of found) {
            this.candidates.set(c.ref, c);
            this.queries.set(c.ref, q);
            const { license, onPickUrl: _onPick, ...rest } = c;
            result.results.push({ ...rest, license: license.raw || 'none given' });
          }
        } catch (e) {
          const message = this.scrub((e as Error).message);
          this.log(`search ${s.def.id}: ${message}`);
          result.errors.push({ source: s.def.id, message });
        }
      }),
    );
    // Keep each source's results together, in the order the sources are listed.
    const order = enabled.map((s) => s.def.id);
    result.results.sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
    return result;
  }

  private async searchOne(s: LoadedSource, query: string, count: number, result: SearchResult): Promise<Candidate[]> {
    const def = s.def;
    if (def.kind === 'folder') {
      if (!s.folder) {
        result.skipped.push({ source: def.id, reason: `Set the folder in .draftsman/config.json: "sources": { "${def.id}": { "folder": "~/Pictures" } }` });
        return [];
      }
      return searchFolder(def, s.folder, query, count);
    }

    let key: string | undefined;
    if (def.auth.type !== 'none') {
      key = (await this.o.keys({ id: def.id, env: def.auth.env }))?.key;
      if (!key) {
        result.skipped.push({ source: def.id, reason: howToAddKey({ id: def.id, name: def.name, env: def.auth.env, getKeyUrl: def.auth.getKeyUrl }) });
        return [];
      }
      this.usedKeys.add(key);
    }

    const url = searchUrl(def, query, count);
    const cached = await this.cache.get(`${def.id} ${url}`);
    const body = cached ?? (await this.fetchJson(def, url, key));
    if (cached === undefined) await this.cache.set(`${def.id} ${url}`, body, def.use.cacheSeconds);
    return resultsOf(def, body)
      .map((item) => toCandidate(def, item))
      .filter((c): c is Candidate => !!c)
      .slice(0, count);
  }

  private async fetchJson(def: ApiSourceDefinition, url: string, key: string | undefined): Promise<unknown> {
    const req = withKey(def, url, key);
    const res = await this.o.http(req.url, { method: 'GET', headers: req.headers });
    const text = res.body.toString('utf8');
    if (res.status !== 200) throw new ImageError(`${def.name} answered ${res.status}: ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new ImageError(`${def.name} sent a response that isn't JSON`);
    }
  }

  /** The license check. A pass is remembered for this session; place_image requires it. */
  check(ref: string): LicenseVerdict & { ref: string; checkedAt: string } {
    const c = this.candidates.get(ref);
    if (!c) throw new ImageError(`No image "${ref}" from a search in this session. Search first, then use a ref from the results.`);
    const verdict = { ...checkLicense(c.license), checkedAt: this.now().toISOString() };
    this.verdicts.set(ref, verdict);
    return { ref, ...verdict };
  }

  async place(args: { path: string; line: number; ref: string; alt?: string }): Promise<PlaceResult> {
    const c = this.candidates.get(args.ref);
    if (!c) throw new ImageError(`No image "${args.ref}" from a search in this session. Search first, then check its license.`);
    const verdict = this.verdicts.get(args.ref);
    if (!verdict) throw new ImageError(`"${args.ref}" hasn't been through check_license. Check it first; only images that pass can be placed.`);
    if (!verdict.pass) throw new ImageError(`"${args.ref}" failed check_license: ${verdict.reasons.join('; ')}. It can't be placed.`);
    // Re-check with the same rules, so nothing that changed since can slip through.
    if (!checkLicense(c.license).pass) throw new ImageError(`"${args.ref}" no longer passes the license check.`);

    const loaded = this.o.sources.find((s) => s.def.id === c.source);
    if (!loaded) throw new ImageError(`Source ${c.source} is not loaded.`);
    const def = loaded.def;

    const article = path.resolve(this.o.cwd, args.path);
    if (!/\.(md|markdown)$/i.test(article)) throw new ImageError(`${args.path} is not a markdown file (.md or .markdown).`);
    const text = await readFile(article, 'utf8').catch(() => {
      throw new ImageError(`${article} does not exist.`);
    });
    const slot = findSlots(text).find((s) => s.line === args.line);
    if (!slot) throw new ImageError(`There's no image placeholder on line ${args.line} of ${args.path}. Use find_slots to list them.`);

    const alt = (args.alt ?? slot.description).trim() || c.title || 'image';
    if (/[\r\n]/.test(alt)) throw new ImageError('The alt text must be one line.');

    const dir = path.dirname(article);
    const imagesDir = path.join(dir, this.o.config.imagesFolder);
    const base = `${slug(alt)}-${def.id}-${slug(c.id).slice(0, 40)}`;
    const written: string[] = [];

    try {
      // 1. The image: downloaded beside the article, or linked where it is.
      let link: string;
      let file: string | undefined;
      let fileInfo: { sha256: string; bytes: number; contentType: string } | undefined;
      if (def.use.mode === 'download') {
        const { body, contentType } = await this.fetchImage(c.imageUrl);
        const ext = MIME_EXT[contentType] ?? extFromUrl(c.imageUrl);
        if (!ext) throw new ImageError(`${def.name} sent "${contentType || 'no type'}", not a JPEG, PNG, WebP or GIF image.`);
        await mkdir(imagesDir, { recursive: true });
        file = path.join(imagesDir, `${base}.${ext}`);
        await writeFile(file, body);
        written.push(file);
        fileInfo = { sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length, contentType: contentType || `image/${ext}` };
        link = path.relative(dir, file).split(path.sep).join('/');
      } else {
        link = c.imageUrl;
      }

      // 2. The credit, in the source's format.
      const credit = this.credit(def.credit, def.name, c, verdict);

      // 3. The on-pick call, where the source has one.
      let onPick: { url: string; method: string; status: number | string } | undefined;
      if (def.use.onPick) {
        const url = c.onPickUrl;
        if (!url) throw new ImageError(`${def.name} asks for a call when an image is used, but this result has no address for it.`);
        try {
          const key = def.kind === 'api' && def.auth.type !== 'none' ? (await this.o.keys({ id: def.id, env: def.auth.env }))?.key : undefined;
          if (key) this.usedKeys.add(key);
          const req = def.kind === 'api' ? withKey(def, url, key) : { url, headers: {} };
          const res = await this.o.http(req.url, { method: def.use.onPick.method, headers: req.headers });
          onPick = { url: this.scrub(url), method: def.use.onPick.method, status: res.status };
        } catch (e) {
          onPick = { url: this.scrub(url), method: def.use.onPick.method, status: `failed: ${this.scrub((e as Error).message)}` };
          this.log(`on-pick call for ${c.ref} failed: ${(e as Error).message}`);
        }
      }

      // 4. Provenance, beside the image.
      const provenanceFile = path.join(imagesDir, `${base}.provenance.json`);
      const provenance = {
        draftsman: VERSION,
        placedAt: this.now().toISOString(),
        article: { file: path.relative(imagesDir, article).split(path.sep).join('/'), line: args.line },
        image: {
          ...(file ? { file: path.basename(file), ...fileInfo } : { hotlink: link }),
          alt,
        },
        source: { id: def.id, name: def.name, termsRead: def.terms.read, terms: def.terms.links.map((l) => l.url), use: def.use.mode },
        original: {
          id: c.id,
          title: c.title ?? null,
          pageUrl: c.pageUrl,
          imageUrl: c.imageUrl,
          creator: c.creator ?? null,
          creatorUrl: c.creatorUrl ?? null,
          width: c.width ?? null,
          height: c.height ?? null,
        },
        license: {
          pass: verdict.pass,
          id: verdict.license?.id ?? null,
          name: verdict.license?.name ?? null,
          version: verdict.license?.version ?? null,
          url: verdict.license?.url ?? null,
          asStated: verdict.raw,
          checkedAt: verdict.checkedAt,
          obligations: verdict.obligations,
        },
        credit,
        search: { query: this.queries.get(c.ref) ?? null },
        onPick: onPick ?? null,
      };
      await mkdir(imagesDir, { recursive: true });
      await writeFile(provenanceFile, this.scrub(JSON.stringify(provenance, null, 2)) + '\n');
      written.push(provenanceFile);

      // 5. The article, last: the placeholder becomes the image, and the credit follows as its own paragraph.
      const updated = placeInArticle(text, slot.line, slot.column, slot.markdown, `![${escapeAlt(alt)}](${markdownUrl(link)})`, `*${credit}*`);
      await writeFile(article, updated);

      return {
        path: article,
        line: slot.line,
        markdown: `![${escapeAlt(alt)}](${markdownUrl(link)})`,
        credit,
        image: file ? { file } : { hotlink: link },
        provenance: provenanceFile,
      };
    } catch (e) {
      // Leave nothing half done: the article hasn't been touched, so remove what was written.
      await Promise.all(written.map((f) => rm(f, { force: true })));
      throw e instanceof ImageError ? e : new ImageError(this.scrub((e as Error).message));
    }
  }

  private async fetchImage(url: string): Promise<{ body: Buffer; contentType: string }> {
    if (url.startsWith('file:')) {
      const file = fileURLToPath(url);
      const ext = path.extname(file).slice(1).toLowerCase();
      return { body: await readFile(file), contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` };
    }
    const res = await this.o.http(url, { method: 'GET', headers: {} });
    if (res.status !== 200) throw new ImageError(`Downloading the image failed: HTTP ${res.status}.`);
    return { body: res.body, contentType: res.contentType.split(';')[0]!.trim().toLowerCase() };
  }

  private credit(template: string, sourceName: string, c: Candidate, verdict: LicenseVerdict): string {
    const link = (text: string | undefined, url: string | undefined) =>
      text ? (url ? `[${escapeMarkdown(text)}](${markdownUrl(url)})` : escapeMarkdown(text)) : undefined;
    const licenseName = verdict.license ? [verdict.license.name, verdict.license.version].filter(Boolean).join(' ') : undefined;
    return fillCredit(template, {
      title: c.title ? escapeMarkdown(c.title) : undefined,
      creator: c.creator ? escapeMarkdown(c.creator) : undefined,
      creatorLink: link(c.creator, c.creatorUrl),
      page: c.pageUrl ? markdownUrl(c.pageUrl) : undefined,
      licenseName,
      licenseLink: link(licenseName, verdict.license?.url),
      sourceName,
    });
  }
}

/** Replaces the placeholder with the image, then adds the credit as its own paragraph after the block. */
export function placeInArticle(text: string, line: number, column: number, placeholder: string, image: string, credit: string): string {
  const doc = parseDoc(text);
  const i = line - 1;
  const current = doc.lines[i]!;
  const at = column - 1;
  if (current.slice(at, at + placeholder.length) !== placeholder) throw new ImageError(`The placeholder on line ${line} changed; run find_slots again.`);
  doc.lines[i] = current.slice(0, at) + image + current.slice(at + placeholder.length);

  const block = findBlocks(doc.lines).find(([s, e]) => s <= i && i <= e)!;
  const after = block[1] + 1;
  const insert = ['', credit];
  if (after < doc.lines.length && !isBlank(doc.lines[after]!)) insert.push('');
  doc.lines.splice(after, 0, ...insert);
  return formatDoc(doc);
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
      .replace(/-+$/, '') || 'image'
  );
}

function escapeAlt(alt: string): string {
  return alt.replace(/[\\[\]]/g, '\\$&');
}

function extFromUrl(url: string): string | undefined {
  const m = /\.(jpe?g|png|webp|gif)(?:$|[?#])/i.exec(url);
  return m ? m[1]!.toLowerCase().replace('jpeg', 'jpg') : undefined;
}
