import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { findSlots, markSlot, SlotError, type Slot } from './slots.js';

const MARKDOWN = new Set(['.md', '.markdown']);

/** Resolves a path the AI gave (absolute, or relative to the server's working folder) and checks it is markdown. */
export function markdownPath(p: string, cwd = process.cwd()): string {
  const full = path.resolve(cwd, p);
  if (!MARKDOWN.has(path.extname(full).toLowerCase())) {
    throw new SlotError(`${p} is not a markdown file (.md or .markdown).`);
  }
  return full;
}

async function read(full: string): Promise<string> {
  try {
    return await readFile(full, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new SlotError(`${full} does not exist.`);
    throw e;
  }
}

export async function findSlotsInFile(p: string, cwd?: string): Promise<{ path: string; slots: Slot[] }> {
  const full = markdownPath(p, cwd);
  return { path: full, slots: findSlots(await read(full)) };
}

export async function markSlotInFile(p: string, line: number, description: string, cwd?: string): Promise<{ path: string; slot: Slot }> {
  const full = markdownPath(p, cwd);
  const { text, slot } = markSlot(await read(full), line, description);
  await writeFile(full, text, 'utf8');
  return { path: full, slot };
}
