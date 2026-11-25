import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A throwaway project folder with an optional .draftsman/config.json and an article. */
export async function workspace(options: { config?: object; article?: string; files?: Record<string, string> } = {}): Promise<{
  dir: string;
  article: string;
  cacheDir: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'draftsman-ws-'));
  if (options.config) {
    await mkdir(path.join(dir, '.draftsman'), { recursive: true });
    await writeFile(path.join(dir, '.draftsman', 'config.json'), JSON.stringify(options.config, null, 2));
  }
  for (const [name, text] of Object.entries(options.files ?? {})) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), text);
  }
  const article = path.join(dir, 'post.md');
  await writeFile(article, options.article ?? '# Lights\n\nThe coast has many.\n\n![a lighthouse at dusk](draftsman:pending)\n\nMore text.\n');
  return { dir, article, cacheDir: path.join(dir, '.cache') };
}

/** Key lookup for tests: only the keys given, by environment variable name. */
export function fakeKeys(keys: Record<string, string>) {
  return async ({ env }: { id: string; env: string }) => (keys[env] ? { key: keys[env]!, from: 'env' as const } : undefined);
}
