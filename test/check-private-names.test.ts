import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Runs the real script against a throwaway git repo. The patterns here are
// made up; the real ones live only in the PRIVATE_NAMES secret.
const script = path.resolve('scripts/check-private-names.sh');

async function repo(files: Record<string, string>, message = 'Initial commit'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'draftsman-names-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), text);
  }
  git('add', '-A');
  git('commit', '-q', '-m', message);
  return dir;
}

function check(dir: string, names: string | undefined) {
  const env = { ...process.env };
  delete env['PRIVATE_NAMES'];
  if (names !== undefined) env['PRIVATE_NAMES'] = names;
  const r = spawnSync('bash', [script], { cwd: dir, env, encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}

describe.skipIf(process.platform === 'win32')('check-private-names.sh', () => {
  it('passes when nothing matches', async () => {
    const dir = await repo({ 'README.md': 'A public tool.\n' });
    const r = check(dir, 'zebra-unicorn\nsecret-llama\n');
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/checking against 2 pattern\(s\)/);
  });

  it('fails on a match in a file, in any case, and names the file and line but not the text', async () => {
    const dir = await repo({ 'src/a.ts': 'one\nsee Zebra-Unicorn here\n', 'b.md': 'clean\n' });
    const r = check(dir, 'zebra-unicorn');
    expect(r.status).toBe(1);
    expect(r.out).toContain('src/a.ts: line(s) 2');
    expect(r.out).not.toMatch(/zebra/i);
  });

  it('checks untracked files that are not ignored, and skips ignored ones', async () => {
    const dir = await repo({ '.gitignore': 'ignored/\n' });
    await mkdir(path.join(dir, 'ignored'));
    await writeFile(path.join(dir, 'ignored', 'x.txt'), 'zebra-unicorn\n');
    expect(check(dir, 'zebra-unicorn').status).toBe(0);
    await writeFile(path.join(dir, 'new.txt'), 'zebra-unicorn\n');
    expect(check(dir, 'zebra-unicorn').status).toBe(1);
  });

  it('fails on a matching file path without printing the path', async () => {
    const dir = await repo({ 'docs/zebra-unicorn-notes.md': 'clean\n' });
    const r = check(dir, 'zebra-unicorn');
    expect(r.status).toBe(1);
    expect(r.out).toContain('a file path matches');
    expect(r.out).not.toMatch(/zebra/i);
  });

  it('fails on a matching commit message', async () => {
    const dir = await repo({ 'a.txt': 'clean\n' }, 'Port the zebra-unicorn code');
    const r = check(dir, 'zebra-unicorn');
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/commit [0-9a-f]{12}: message/);
    expect(r.out).not.toMatch(/zebra/i);
  });

  it('ignores blank lines, spaces and Windows line endings in the list', async () => {
    const dir = await repo({ 'a.txt': 'secret-llama\n' });
    expect(check(dir, '\r\n  zebra-unicorn  \r\n\r\n secret-llama\r\n').status).toBe(1);
  });

  it('refuses to run with no patterns, so a missing secret fails CI', async () => {
    const dir = await repo({ 'a.txt': 'x\n' });
    expect(check(dir, undefined).status).toBe(2);
    expect(check(dir, ' \n\n ').status).toBe(2);
  });

  it('refuses an invalid pattern without printing it', async () => {
    const dir = await repo({ 'a.txt': 'x\n' });
    const r = check(dir, 'zebra(unicorn');
    expect(r.status).toBe(2);
    expect(r.out).not.toMatch(/zebra/i);
  });
});
