// Search responses kept for each source's cache time (Pixabay requires 24
// hours). Keyed by the request URL without its key, so no key is ever written.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env['DRAFTSMAN_CACHE_DIR']) return env['DRAFTSMAN_CACHE_DIR'];
  const base = env['XDG_CACHE_HOME'] || (process.platform === 'win32' ? env['LOCALAPPDATA'] : undefined) || path.join(os.homedir(), '.cache');
  return path.join(base!, 'draftsman');
}

export class SearchCache {
  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private file(key: string): string {
    return path.join(this.dir, 'search', createHash('sha256').update(key).digest('hex') + '.json');
  }

  async get(key: string): Promise<unknown | undefined> {
    try {
      const entry = JSON.parse(await readFile(this.file(key), 'utf8')) as { expires: number; body: unknown };
      return entry.expires > this.now() ? entry.body : undefined;
    } catch {
      return undefined;
    }
  }

  async set(key: string, body: unknown, seconds: number): Promise<void> {
    if (seconds <= 0) return;
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ expires: this.now() + seconds * 1000, body }));
  }
}
