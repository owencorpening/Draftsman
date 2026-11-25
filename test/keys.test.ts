import { describe, expect, it } from 'vitest';

import { howToAddKey, keyLookup, scrubKeys, type RunCommand } from '../src/keys.js';

const source = { id: 'pixabay', env: 'DRAFTSMAN_PIXABAY_KEY' };

function recordingRun(answer: string | undefined) {
  const calls: { cmd: string; args: string[] }[] = [];
  const run: RunCommand = async (cmd, args) => {
    calls.push({ cmd, args });
    return answer;
  };
  return { run, calls };
}

describe('keys', () => {
  it('reads the environment variable first, without touching the keychain', async () => {
    const { run, calls } = recordingRun('from-keychain');
    expect(await keyLookup({ DRAFTSMAN_PIXABAY_KEY: ' from-env ' }, run, 'linux')(source)).toEqual({ key: 'from-env', from: 'env' });
    expect(calls).toEqual([]);
  });

  it('falls back to the Linux keychain (secret-tool) and the macOS keychain (security)', async () => {
    const linux = recordingRun('from-libsecret\n');
    expect(await keyLookup({}, linux.run, 'linux')(source)).toEqual({ key: 'from-libsecret', from: 'keychain' });
    expect(linux.calls).toEqual([{ cmd: 'secret-tool', args: ['lookup', 'service', 'draftsman', 'account', 'pixabay'] }]);

    const mac = recordingRun('from-keychain');
    expect(await keyLookup({}, mac.run, 'darwin')(source)).toEqual({ key: 'from-keychain', from: 'keychain' });
    expect(mac.calls[0]).toEqual({ cmd: 'security', args: ['find-generic-password', '-s', 'draftsman', '-a', 'pixabay', '-w'] });
  });

  it('finds nothing when there is no key, or no keychain tool, and uses only the variable on Windows', async () => {
    expect(await keyLookup({}, recordingRun(undefined).run, 'linux')(source)).toBeUndefined();
    const win = recordingRun('ignored');
    expect(await keyLookup({}, win.run, 'win32')(source)).toBeUndefined();
    expect(win.calls).toEqual([]);
  });

  it('tells the user how to add a key', () => {
    expect(howToAddKey({ ...source, name: 'Pixabay', getKeyUrl: 'https://pixabay.com/api/docs/' })).toBe(
      'Pixabay needs an API key (get one at https://pixabay.com/api/docs/). Set the DRAFTSMAN_PIXABAY_KEY environment variable, ' +
        'or store it in the keychain under service "draftsman", account "pixabay".',
    );
  });

  it('scrubs every known key out of text', () => {
    expect(scrubKeys('a k1 b k2 k1', ['k1', 'k2', ''])).toBe('a REDACTED b REDACTED REDACTED');
  });
});
