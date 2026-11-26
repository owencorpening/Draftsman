import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import { createServer } from '../src/server.js';

const SKILLS = path.resolve('skills');

/** The frontmatter fields and body of a SKILL.md: simple "key: value" lines between --- fences. */
function parse(file: string): { meta: Record<string, string>; body: string } {
  const text = readFileSync(file, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${file} has no frontmatter`);
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const kv = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`${file}: frontmatter line "${line}" isn't key: value`);
    meta[kv[1]!] = kv[2]!.trim();
  }
  return { meta, body: m[2]! };
}

const skills = readdirSync(SKILLS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => ({ dir: d.name, ...parse(path.join(SKILLS, d.name, 'SKILL.md')) }));

async function serverTools(): Promise<string[]> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => t.name);
}

describe('skills', () => {
  it('ship one per job built so far', () => {
    expect(skills.map((s) => s.dir).sort()).toEqual(['images', 'pull-quotes', 'tables']);
  });

  for (const s of skills) {
    it(`${s.dir}: valid Agent Skills frontmatter`, () => {
      expect(s.meta['name']).toBe(s.dir);
      expect(s.meta['name']).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(s.meta['name']!.length).toBeLessThanOrEqual(64);
      expect(s.meta['description']!.length).toBeGreaterThan(20);
      expect(s.meta['description']!.length).toBeLessThanOrEqual(1024);
      expect(Object.keys(s.meta).every((k) => ['name', 'description', 'argument-hint', 'user-invocable', 'disable-model-invocation', 'license', 'metadata'].includes(k))).toBe(true);
    });

    it(`${s.dir}: says to wait for the user before acting`, () => {
      expect(s.body).toMatch(/wait for the user|user agrees|let them change/i);
    });
  }

  it('name only tools the server has, and every tool is in some skill', async () => {
    const tools = await serverTools();
    const named = new Set<string>();
    for (const s of skills) {
      for (const m of s.body.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
        expect(tools, `${s.dir} names ${m[1]}`).toContain(m[1]);
        named.add(m[1]!);
      }
    }
    expect([...tools].filter((t) => !named.has(t))).toEqual([]);
  });

  it('keep the license check and the user’s criteria in charge', () => {
    const by = Object.fromEntries(skills.map((s) => [s.dir, s.body]));
    expect(by['images']).toMatch(/Never offer or place an image that hasn't passed/);
    expect(by['pull-quotes']).toMatch(/Call `get_criteria`/);
    expect(by['pull-quotes']).toMatch(/Never place a pull quote the user hasn't picked/);
  });
});
