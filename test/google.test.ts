import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { authorizationUrl, clientId, Google, GoogleError, keychainStore, pkce, SCOPE, signIn } from '../src/google.js';
import { fakeKeys } from './helpers.js';
import { loadRecording, replayHttp, type Recording } from './recordings.js';

const CLIENT = 'test-client.apps.googleusercontent.com';

/** The token endpoint's answer to a code exchange: a refresh token as well as an access token. */
const exchange = (body: object = {}): Recording => ({
  ...loadRecording('google', 'token-refresh'),
  response: {
    status: 200,
    contentType: 'application/json',
    body: { access_token: 'test-access-token', refresh_token: 'test-new-refresh-token', expires_in: 3599, scope: SCOPE, token_type: 'Bearer', ...body },
  },
});

/** Plays the browser: follows the consent page's redirect back to the loopback address. */
function browser(reply: (redirect: string, state: string) => URL) {
  const opened: string[] = [];
  const open = (url: string) => {
    opened.push(url);
    const u = new URL(url);
    void fetch(reply(u.searchParams.get('redirect_uri')!, u.searchParams.get('state')!)).catch(() => undefined);
  };
  return { open, opened };
}

describe('Google sign-in', () => {
  it('asks only for drive.file, with PKCE (S256) and a loopback address', () => {
    const { verifier, challenge } = pkce();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    const u = new URL(authorizationUrl({ clientId: CLIENT, redirectUri: 'http://127.0.0.1:5000', challenge, state: 's' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: CLIENT,
      redirect_uri: 'http://127.0.0.1:5000',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 's',
      prompt: 'consent',
      access_type: 'offline',
    });
  });

  it('sends the client secret on the code exchange when there is one', async () => {
    const replay = replayHttp([], [exchange()]);
    const b = browser((redirect, state) => new URL(`/?state=${state}&code=test-code`, redirect));
    await signIn({ http: replay.http, clientId: CLIENT, clientSecret: 'test-client-secret', open: b.open, store: async () => undefined });
    expect(Object.fromEntries(new URLSearchParams(replay.requests[0]!.request.body))).toMatchObject({ client_secret: 'test-client-secret', code_verifier: expect.any(String) });
  });

  it('says where to put the client secret when Google asks for one', async () => {
    const missing: Recording = {
      ...loadRecording('google', 'token-refresh'),
      response: { status: 400, contentType: 'application/json', body: { error: 'invalid_request', error_description: 'client_secret is missing.' } },
    };
    const b = browser((redirect, state) => new URL(`/?state=${state}&code=c`, redirect));
    await expect(signIn({ http: replayHttp([], [missing]).http, clientId: CLIENT, open: b.open, store: async () => undefined })).rejects.toThrow(
      /DRAFTSMAN_GOOGLE_CLIENT_SECRET.*account google-client-secret/,
    );
  });

  it('completes: the code comes back to 127.0.0.1, is exchanged with the PKCE verifier, and the refresh token is stored', async () => {
    const replay = replayHttp([], [exchange()]);
    const stored: string[] = [];
    const b = browser((redirect, state) => new URL(`/?state=${state}&code=test-code`, redirect));
    await signIn({ http: replay.http, clientId: CLIENT, open: b.open, store: async (t) => void stored.push(t) });

    expect(stored).toEqual(['test-new-refresh-token']);
    const sent = Object.fromEntries(new URLSearchParams(replay.requests[0]!.request.body));
    expect(sent).toMatchObject({ client_id: CLIENT, code: 'test-code', grant_type: 'authorization_code' });
    expect(sent['redirect_uri']).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(createHash('sha256').update(sent['code_verifier']!).digest('base64url')).toBe(new URL(b.opened[0]!).searchParams.get('code_challenge'));
    expect(sent).not.toHaveProperty('client_secret');
  });

  it('refuses a reply that doesn’t carry this sign-in’s state, and stores nothing', async () => {
    const stored: string[] = [];
    const b = browser((redirect) => new URL(`/?state=someone-else&code=x`, redirect));
    await expect(signIn({ http: replayHttp([], [exchange()]).http, clientId: CLIENT, open: b.open, store: async (t) => void stored.push(t) })).rejects.toThrow(
      /the reply did not match this sign-in/,
    );
    expect(stored).toEqual([]);
  });

  it('refuses a grant that isn’t the Drive file permission', async () => {
    const b = browser((redirect, state) => new URL(`/?state=${state}&code=c`, redirect));
    await expect(
      signIn({ http: replayHttp([], [exchange({ scope: 'https://www.googleapis.com/auth/drive' })]).http, clientId: CLIENT, open: b.open, store: async () => undefined }),
    ).rejects.toThrow(/not the Drive file permission/);
  });

  it('keeps the refresh token in the Linux keychain through stdin, never on the command line', async () => {
    const calls: { cmd: string; args: string[]; input?: string }[] = [];
    await keychainStore(async (cmd, args, input) => {
      calls.push({ cmd, args, ...(input ? { input } : {}) });
      return true;
    }, 'linux')('test-refresh');
    expect(calls).toEqual([{ cmd: 'secret-tool', args: ['store', '--label=Draftsman Google', 'service', 'draftsman', 'account', 'google'], input: 'test-refresh' }]);
  });

  it('says what to install when there’s no keychain tool', async () => {
    await expect(keychainStore(async () => false, 'linux')('t')).rejects.toThrow(/sudo apt install libsecret-tools/);
  });
});

describe('Google availability', () => {
  it('needs a client ID, then a sign-in', async () => {
    const http = replayHttp().http;
    expect(await new Google({ http, keys: fakeKeys({}), clientId: undefined }).unavailable()).toMatch(/no OAuth client ID/);
    expect(await new Google({ http, keys: fakeKeys({}), clientId: CLIENT }).unavailable()).toMatch(/Not signed in to Google. Run `draftsman google-sign-in`/);
    expect(await new Google({ http, keys: fakeKeys({ DRAFTSMAN_GOOGLE_REFRESH_TOKEN: 'r' }), clientId: CLIENT }).unavailable()).toBeUndefined();
  });

  it('takes the client ID from the environment over the config', () => {
    expect(clientId({ DRAFTSMAN_GOOGLE_CLIENT_ID: ' env-id ' }, 'config-id')).toBe('env-id');
    expect(clientId({}, 'config-id')).toBe('config-id');
  });

  it('reuses an access token until it’s close to expiring', async () => {
    let now = 0;
    const replay = replayHttp();
    const google = new Google({ http: replay.http, keys: fakeKeys({ DRAFTSMAN_GOOGLE_REFRESH_TOKEN: 'r' }), clientId: CLIENT, now: () => now });
    await google.createSheet('a', [['x']]);
    await google.createSheet('b', [['x']]);
    expect(replay.requests.filter((r) => r.url.includes('oauth2')).length).toBe(1);
    now = 3599_000; // within a minute of expiry
    await google.createSheet('c', [['x']]);
    expect(replay.requests.filter((r) => r.url.includes('oauth2')).length).toBe(2);
  });

  it('sends the client secret from the keys on every refresh, and treats it as a secret to scrub', async () => {
    const replay = replayHttp();
    const google = new Google({
      http: replay.http,
      keys: fakeKeys({ DRAFTSMAN_GOOGLE_REFRESH_TOKEN: 'r', DRAFTSMAN_GOOGLE_CLIENT_SECRET: 'test-client-secret' }),
      clientId: CLIENT,
    });
    await google.createSheet('a', [['x']]);
    const refresh = replay.requests.find((r) => r.url.includes('oauth2'))!;
    expect(Object.fromEntries(new URLSearchParams(refresh.request.body))).toMatchObject({ client_secret: 'test-client-secret', grant_type: 'refresh_token' });
    expect(google.secrets).toContain('test-client-secret');
  });

  it('reports Google’s own error message', async () => {
    const broken = { ...loadRecording('google', 'sheets-create'), response: { status: 429, contentType: 'application/json', body: { error: { message: 'Quota exceeded' } } } };
    const google = new Google({ http: replayHttp([], [broken]).http, keys: fakeKeys({ DRAFTSMAN_GOOGLE_REFRESH_TOKEN: 'r' }), clientId: CLIENT });
    await expect(google.createSheet('a', [['x']])).rejects.toThrow(new GoogleError('Google answered 429: Quota exceeded'));
  });
});
