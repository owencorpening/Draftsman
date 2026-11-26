import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';

const json = (f: string) => JSON.parse(readFileSync(path.resolve(f), 'utf8')) as Record<string, unknown>;
const pkg = json('package.json') as { name: string; version: string; bin: Record<string, string> };

/** What `npm pack` would put in the package (it builds first, through prepack). */
function packedFiles(): string[] {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--silent'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path).sort();
}

describe('npm package', () => {
  it('holds the server, sources, styles, criteria and skills, and nothing from tests', { timeout: 120_000 }, () => {
    const files = packedFiles();
    for (const f of ['dist/server.js', 'sources/pixabay.json', 'styles/default.json', 'styles/fonts/DejaVuSans.ttf', 'criteria/pullquotes.md', 'criteria/lists.md', 'skills/lists/SKILL.md', 'skills/carousel/SKILL.md', 'skills/images/SKILL.md', 'skills/pull-quotes/SKILL.md', 'skills/tables/SKILL.md', 'package.json', 'README.md']) {
      expect(files).toContain(f);
    }
    expect(files.filter((f) => /^(test|src|scripts|\.cache|\.github)\/|fixtures|recordings/.test(f))).toEqual([]);
    expect(pkg.bin).toEqual({ draftsman: 'dist/server.js' });
  });

  // Installs the packed tarball into an empty folder from the npm registry, so
  // it needs the network. CI runs it (DRAFTSMAN_TEST_PACK=1).
  it.runIf(process.env['DRAFTSMAN_TEST_PACK'] === '1')('installs from its tarball and serves its tools over stdio', { timeout: 300_000 }, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'draftsman-pack-'));
    const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', dir], { encoding: 'utf8' }).trim().split('\n').pop()!;
    execFileSync('npm', ['init', '-y'], { cwd: dir, stdio: 'ignore' });
    execFileSync('npm', ['install', '--no-audit', '--no-fund', path.join(dir, tgz)], { cwd: dir, stdio: 'ignore' });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StdioClientTransport({ command: path.join(dir, 'node_modules/.bin/draftsman'), args: [], cwd: dir, stderr: 'pipe' }));
    const { tools } = await client.listTools();
    await client.close();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['find_slots', 'render_table', 'render_pullquote', 'get_criteria']));
  });
});

describe('agent plugin', () => {
  const vscode = json('plugin.json');
  const claude = json('.claude-plugin/plugin.json');
  const market = json('.claude-plugin/marketplace.json') as { name: string; owner: { name: string }; plugins: { name: string; source: string; version: string }[] };

  it('has an Agent Plugins 1.0 manifest for VS Code and a Claude Code manifest, both named draftsman', () => {
    expect(vscode['$schema']).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
    expect(vscode['name']).toBe('draftsman');
    expect(claude['name']).toBe('draftsman');
    expect(typeof vscode['description']).toBe('string');
    expect(market).toMatchObject({ name: 'draftsman', plugins: [{ name: 'draftsman', source: './' }] });
    expect(market.owner.name).toBeTruthy();
  });

  it('starts the server with npx at the package’s own version, in both MCP configs', () => {
    for (const f of ['mcp.json', '.mcp.json']) {
      expect(json(f), f).toEqual({ mcpServers: { draftsman: { command: 'npx', args: ['-y', `draftsman@${pkg.version}`] } } });
    }
  });

  it('keeps every version number in step with package.json', () => {
    expect(vscode['version']).toBe(pkg.version);
    expect(claude['version']).toBe(pkg.version);
    expect(market.plugins[0]!.version).toBe(pkg.version);
    expect(pkg.name).toBe('draftsman');
  });
});
