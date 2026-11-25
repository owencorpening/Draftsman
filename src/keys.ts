// API keys come from an environment variable or the OS keychain, never from a
// file Draftsman writes. Nothing here logs or returns a key except to the one
// caller that sends it.
//
// Keychain entries are looked up under service "draftsman" and the source's
// id as the account:
//   Linux (libsecret):  secret-tool store --label="Draftsman pixabay" service draftsman account pixabay
//   macOS (Keychain):   security add-generic-password -s draftsman -a pixabay -w
// Windows has no keychain reader here yet; use the environment variable.

import { execFile } from 'node:child_process';

export type RunCommand = (cmd: string, args: string[]) => Promise<string | undefined>;

/** Runs a command and returns its output, or undefined if it fails or isn't installed. Never throws. */
const runCommand: RunCommand = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : stdout.replace(/\r?\n$/, '') || undefined);
    });
  });

export interface KeyLookup {
  (source: { id: string; env: string }): Promise<{ key: string; from: 'env' | 'keychain' } | undefined>;
}

export function keyLookup(
  env: NodeJS.ProcessEnv = process.env,
  run: RunCommand = runCommand,
  platform: NodeJS.Platform = process.platform,
): KeyLookup {
  return async ({ id, env: name }) => {
    const fromEnv = env[name]?.trim();
    if (fromEnv) return { key: fromEnv, from: 'env' };
    let fromKeychain: string | undefined;
    if (platform === 'linux') fromKeychain = await run('secret-tool', ['lookup', 'service', 'draftsman', 'account', id]);
    else if (platform === 'darwin') fromKeychain = await run('security', ['find-generic-password', '-s', 'draftsman', '-a', id, '-w']);
    return fromKeychain?.trim() ? { key: fromKeychain.trim(), from: 'keychain' } : undefined;
  };
}

/** How to add a key, for a source that needs one and has none. */
export function howToAddKey(source: { id: string; name: string; env: string; getKeyUrl: string }): string {
  return (
    `${source.name} needs an API key (get one at ${source.getKeyUrl}). ` +
    `Set the ${source.env} environment variable, or store it in the keychain under service "draftsman", account "${source.id}".`
  );
}

/** Replaces every known key in text with REDACTED. */
export function scrubKeys(text: string, keys: Iterable<string>): string {
  let out = text;
  for (const key of keys) if (key) out = out.split(key).join('REDACTED');
  return out;
}
