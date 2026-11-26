// Google: signing in once from a terminal, and making the sheet behind each
// table image.
//
// Sign-in uses Google's flow for desktop apps: the browser opens Google's
// consent page, Google sends the user back to a one-time address on this
// computer (http://127.0.0.1:<port>), and the code it carries is exchanged for
// tokens. PKCE protects the exchange. Google still requires the client secret
// on the token endpoint for Desktop clients, though it calls them public
// clients that can't keep one. The only permission asked for is drive.file:
// files this app creates, nothing else.
//
// The refresh token is kept in the OS keychain (service "draftsman", account
// "google") or DRAFTSMAN_GOOGLE_REFRESH_TOKEN; the client secret in the
// keychain (account "google-client-secret") or DRAFTSMAN_GOOGLE_CLIENT_SECRET.
// Neither is ever written to a file, logged, or returned in a tool result.

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Http } from './http.js';
import type { KeyLookup } from './keys.js';

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
export const DRIVE_URL = 'https://www.googleapis.com/drive/v3/files';

export class GoogleError extends Error {}

/** The OAuth client ID: DRAFTSMAN_GOOGLE_CLIENT_ID, else the config's google.clientId. */
export function clientId(env: NodeJS.ProcessEnv, configured: string | undefined): string | undefined {
  return env['DRAFTSMAN_GOOGLE_CLIENT_ID']?.trim() || configured;
}

/** Where the client secret is looked up: the environment, then the keychain. */
export const CLIENT_SECRET_KEY = { id: 'google-client-secret', env: 'DRAFTSMAN_GOOGLE_CLIENT_SECRET' };

const MISSING_SECRET =
  'Google needs this OAuth client’s secret. Set DRAFTSMAN_GOOGLE_CLIENT_SECRET, or store it in the keychain ' +
  '(Linux: secret-tool store --label="Draftsman Google client secret" service draftsman account google-client-secret).';

/** The token request's fields, with the client secret when there is one. */
const withSecret = (values: Record<string, string>, secret: string | undefined) => (secret ? { ...values, client_secret: secret } : values);

const base64url =(b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export function authorizationUrl(o: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    state: o.state,
    // Ask again each time, so Google always returns a refresh token.
    prompt: 'consent',
    access_type: 'offline',
  }).toString();
  return u.toString();
}

function form(values: Record<string, string>): { body: string; headers: Record<string, string> } {
  return { body: new URLSearchParams(values).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
}

async function tokenRequest(http: Http, values: Record<string, string>): Promise<Record<string, unknown>> {
  const f = form(values);
  const res = await http(TOKEN_URL, { method: 'POST', headers: f.headers, body: f.body });
  const json = JSON.parse(res.body.toString('utf8') || '{}') as Record<string, unknown>;
  if (res.status !== 200) {
    if (!values['client_secret'] && /client_secret is missing/i.test(String(json['error_description'] ?? ''))) {
      throw new GoogleError(MISSING_SECRET);
    }
    if (json['error'] === 'invalid_grant') {
      throw new GoogleError('Google sign-in has expired or was revoked. Run `draftsman google-sign-in` again.');
    }
    throw new GoogleError(`Google sign-in failed: ${String(json['error'] ?? res.status)}${json['error_description'] ? ` (${String(json['error_description'])})` : ''}`);
  }
  return json;
}

/**
 * Listens on a free port on 127.0.0.1 for Google to send the browser back
 * with a code. Only a reply carrying this sign-in's `state` is accepted.
 */
export async function waitForCode(state: string, timeoutMs = 5 * 60_000): Promise<{ redirectUri: string; code: Promise<string>; close: () => void }> {
  let done!: (code: string) => void;
  let fail!: (e: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    done = resolve;
    fail = reject;
  });

  const server: Server = createServer((req, res) => {
    // Read the path literally: a path like "//x" must not be taken for a host.
    let url: URL;
    try {
      url = new URL(`http://127.0.0.1${req.url?.startsWith('/') ? req.url : '/'}`);
    } catch {
      return void res.writeHead(400).end();
    }
    if (url.pathname !== '/') return void res.writeHead(404).end();
    const ok = url.searchParams.get('state') === state && !!url.searchParams.get('code');
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(ok ? 'Draftsman is signed in to Google. You can close this tab.' : 'Sign-in did not complete. Go back to the terminal.');
    if (ok) done(url.searchParams.get('code')!);
    else fail(new GoogleError(`Google sign-in was not completed: ${url.searchParams.get('error') ?? 'the reply did not match this sign-in'}`));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const timer = setTimeout(() => fail(new GoogleError('Timed out waiting for Google sign-in.')), timeoutMs);
  const close = () => {
    clearTimeout(timer);
    server.close();
  };
  code.then(close, close);
  const { port } = server.address() as AddressInfo;
  return { redirectUri: `http://127.0.0.1:${port}`, code, close };
}

export interface SignInDeps {
  http: Http;
  clientId: string;
  /** The client secret, when Google requires one. */
  clientSecret?: string | undefined;
  /** Opens the consent page; by default the system browser. */
  open?: (url: string) => void;
  /** Saves the refresh token; by default the OS keychain. */
  store: (refreshToken: string) => Promise<void>;
  say?: (message: string) => void;
}

/** The one-time sign-in. Returns once the refresh token is stored. */
export async function signIn(deps: SignInDeps): Promise<void> {
  const { verifier, challenge } = pkce();
  const state = base64url(randomBytes(16));
  const wait = await waitForCode(state);
  const url = authorizationUrl({ clientId: deps.clientId, redirectUri: wait.redirectUri, challenge, state });
  deps.say?.(`Opening Google sign-in in your browser. If it doesn't open, visit:\n${url}`);
  (deps.open ?? openBrowser)(url);
  try {
    const code = await wait.code;
    const tokens = await tokenRequest(
      deps.http,
      withSecret({ client_id: deps.clientId, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: wait.redirectUri }, deps.clientSecret),
    );
    const refresh = tokens['refresh_token'];
    if (typeof refresh !== 'string' || !refresh) throw new GoogleError('Google did not return a refresh token.');
    const granted = String(tokens['scope'] ?? '');
    if (granted && !granted.split(' ').includes(SCOPE)) throw new GoogleError(`Google granted "${granted}", not the Drive file permission Draftsman asked for.`);
    await deps.store(refresh);
  } finally {
    wait.close();
  }
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  execFile(cmd as string, args as string[], () => undefined);
}

/** Stores the refresh token in the OS keychain. Throws, saying what to install or set, when there's no keychain tool. */
export function keychainStore(run: (cmd: string, args: string[], input?: string) => Promise<boolean>, platform = process.platform) {
  return async (token: string) => {
    let ok = false;
    if (platform === 'linux') ok = await run('secret-tool', ['store', '--label=Draftsman Google', 'service', 'draftsman', 'account', 'google'], token);
    // macOS's security tool takes the secret only as an argument, so it is
    // briefly visible to other processes of this user; secret-tool reads stdin.
    else if (platform === 'darwin') ok = await run('security', ['add-generic-password', '-U', '-s', 'draftsman', '-a', 'google', '-w', token]);
    if (!ok) {
      throw new GoogleError(
        platform === 'linux'
          ? 'Could not save to the keychain: install secret-tool (on Ubuntu: sudo apt install libsecret-tools) and sign in again.'
          : 'Could not save to the keychain. Sign in on Linux or macOS, or set DRAFTSMAN_GOOGLE_REFRESH_TOKEN yourself.',
      );
    }
  };
}

/** Runs a command, writing `input` to its stdin; true if it succeeded. */
export function runWithInput(cmd: string, args: string[], input?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: 60_000 }, (error) => resolve(!error));
    child.on('error', () => resolve(false));
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end();
  });
}

export interface Sheet {
  id: string;
  url: string;
  shared: boolean;
}

/** Access to Google for one session: a fresh access token from the stored refresh token. */
export class Google {
  private access?: { token: string; expires: number };
  /** Every token seen this session, so anything written or logged can be scrubbed of them. */
  readonly secrets = new Set<string>();

  constructor(
    private readonly o: { http: Http; keys: KeyLookup; clientId: string | undefined; now?: () => number },
  ) {}

  /** Why tables can't get a sheet right now, or undefined if they can. */
  async unavailable(): Promise<string | undefined> {
    if (!this.o.clientId) return 'Google isn’t set up: no OAuth client ID (set DRAFTSMAN_GOOGLE_CLIENT_ID or google.clientId in .draftsman/config.json).';
    if (!(await this.refreshToken())) return 'Not signed in to Google. Run `draftsman google-sign-in` in a terminal once.';
    return undefined;
  }

  private async refreshToken(): Promise<string | undefined> {
    const found = await this.o.keys({ id: 'google', env: 'DRAFTSMAN_GOOGLE_REFRESH_TOKEN' });
    if (found) this.secrets.add(found.key);
    return found?.key;
  }

  private async token(): Promise<string> {
    const now = (this.o.now ?? Date.now)();
    if (this.access && this.access.expires > now + 60_000) return this.access.token;
    const refresh = await this.refreshToken();
    if (!refresh || !this.o.clientId) throw new GoogleError((await this.unavailable()) ?? 'Google is not available.');
    const secret = await this.o.keys(CLIENT_SECRET_KEY);
    if (secret) this.secrets.add(secret.key);
    const json = await tokenRequest(this.o.http, withSecret({ client_id: this.o.clientId, refresh_token: refresh, grant_type: 'refresh_token' }, secret?.key));
    const token = String(json['access_token'] ?? '');
    if (!token) throw new GoogleError('Google did not return an access token.');
    this.secrets.add(token);
    this.access = { token, expires: now + Number(json['expires_in'] ?? 3600) * 1000 };
    return token;
  }

  private async call(method: 'POST' | 'PUT', url: string, body: unknown): Promise<Record<string, unknown>> {
    const token = await this.token();
    const res = await this.o.http(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = res.body.toString('utf8');
    if (res.status < 200 || res.status > 299) {
      let message = text.slice(0, 300);
      try {
        message = String((JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message);
      } catch {
        // not JSON; keep the text
      }
      throw new GoogleError(`Google answered ${res.status}: ${message}`);
    }
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  /**
   * Makes a new sheet holding the rows, then shares it so anyone with the link
   * can view it. If sharing fails the sheet still exists, and `shared` is false.
   */
  async createSheet(title: string, rows: string[][]): Promise<Sheet & { shareError?: string }> {
    const created = await this.call('POST', SHEETS_URL, {
      properties: { title },
      sheets: [{ properties: { title: 'Data', gridProperties: { frozenRowCount: 1 } } }],
    });
    const id = String(created['spreadsheetId'] ?? '');
    if (!id) throw new GoogleError('Google did not return the new sheet’s id.');
    const url = String(created['spreadsheetUrl'] ?? `https://docs.google.com/spreadsheets/d/${id}/edit`);

    // USER_ENTERED reads values as if typed, so numbers become numbers. A cell
    // starting with "=" would become a formula; a leading apostrophe keeps it text.
    const values = rows.map((r) => r.map((v) => (v.startsWith('=') ? `'${v}` : v)));
    await this.call('PUT', `${SHEETS_URL}/${id}/values/${encodeURIComponent('Data!A1')}?valueInputOption=USER_ENTERED`, {
      range: 'Data!A1',
      majorDimension: 'ROWS',
      values,
    });

    try {
      await this.call('POST', `${DRIVE_URL}/${id}/permissions`, { type: 'anyone', role: 'reader' });
      return { id, url, shared: true };
    } catch (e) {
      return { id, url, shared: false, shareError: (e as Error).message };
    }
  }
}
