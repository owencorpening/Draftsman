import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';

import { createServer } from '../src/server.js';

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function tempArticle(text: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'draftsman-'));
  const file = path.join(dir, 'post.md');
  await writeFile(file, text);
  return file;
}

describe('MCP server', () => {
  async function connect(): Promise<Client> {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverSide);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientSide);
    clients.push(client);
    return client;
  }

  it('offers its tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['check_license', 'find_slots', 'find_tables', 'mark_slot', 'place_image', 'render_table', 'renumber_figures', 'search_images']);
    expect(tools.find((t) => t.name === 'find_slots')?.annotations?.readOnlyHint).toBe(true);
  });

  it('finds tables and renumbers figures through tool calls', async () => {
    const client = await connect();
    const file = await tempArticle('See Figure 2.\n\n*Figure 2. Only one.*\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
    const found = await client.callTool({ name: 'find_tables', arguments: { path: file } });
    expect(found.structuredContent).toMatchObject({ tables: [{ startLine: 5, endLine: 7, header: ['a', 'b'] }] });
    const renumbered = await client.callTool({ name: 'renumber_figures', arguments: { path: file } });
    expect(renumbered.structuredContent).toMatchObject({ figures: [{ line: 3, from: '2', to: 1 }], updated: [{ line: 1, from: 'Figure 2', to: 'Figure 1' }], problems: [] });
    expect(await readFile(file, 'utf8')).toMatch(/^See Figure 1\.\n\n\*Figure 1\. Only one\.\*/);
  });

  it('marks and finds slots through tool calls', async () => {
    const client = await connect();
    const file = await tempArticle('Intro.\n\nBody.\n');

    const marked = await client.callTool({ name: 'mark_slot', arguments: { path: file, line: 2, description: 'a reservoir' } });
    expect(marked.isError).toBeFalsy();
    expect(marked.structuredContent).toMatchObject({ path: file, slot: { line: 3, description: 'a reservoir' } });
    expect(await readFile(file, 'utf8')).toBe('Intro.\n\n![a reservoir](draftsman:pending)\n\nBody.\n');

    const found = await client.callTool({ name: 'find_slots', arguments: { path: file } });
    expect(found.structuredContent).toMatchObject({ slots: [{ line: 3, before: 'Intro.', after: 'Body.' }] });
  });

  it('returns a readable tool error for a bad line, and leaves the file alone', async () => {
    const client = await connect();
    const file = await tempArticle('One\ntwo\n');
    const res = await client.callTool({ name: 'mark_slot', arguments: { path: file, line: 2, description: 'x' } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/split it/);
    expect(await readFile(file, 'utf8')).toBe('One\ntwo\n');
  });

  async function overStdio(client: Client): Promise<Client> {
    const tsx = path.resolve('node_modules/.bin/tsx');
    await client.connect(new StdioClientTransport({ command: tsx, args: [path.resolve('src/server.ts')], stderr: 'pipe' }));
    clients.push(client);
    return client;
  }

  it('serves over stdio at protocol 2026-07-28', async () => {
    const client = await overStdio(new Client({ name: 'test', version: '0.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } }));
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['check_license', 'find_slots', 'find_tables', 'mark_slot', 'place_image', 'render_table', 'renumber_figures', 'search_images']);
  });

  it('still serves hosts that open with the older initialize handshake', async () => {
    const client = await overStdio(new Client({ name: 'test', version: '0.0.0' }));
    expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(8);
  });
});
