// Finds an installed Chrome or Edge to render with. Draftsman never downloads
// a browser on its own: the spec says that happens only after asking the
// user, and that flow isn't built yet, so for now a missing browser is an
// error that says what to do.

import { existsSync } from 'node:fs';
import path from 'node:path';

export class BrowserNotFoundError extends Error {
  constructor(tried: string[]) {
    super(
      'No Chrome or Edge found to render images with. Install Google Chrome or Microsoft Edge, ' +
        'or set DRAFTSMAN_BROWSER to the path of a Chrome or Edge executable.\n' +
        `Looked in:\n${tried.map((p) => `  ${p}`).join('\n')}`,
    );
    this.name = 'BrowserNotFoundError';
  }
}

/** Where Chrome and Edge install themselves, most common first. */
export function browserCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'win32') {
    const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']].filter((r): r is string => !!r);
    return [
      ...roots.map((r) => path.win32.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map((r) => path.win32.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    ];
  }
  if (platform === 'darwin') {
    const apps = ['/Applications', ...(env['HOME'] ? [path.posix.join(env['HOME'], 'Applications')] : [])];
    return [
      ...apps.map((a) => `${a}/Google Chrome.app/Contents/MacOS/Google Chrome`),
      ...apps.map((a) => `${a}/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`),
    ];
  }
  return [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/opt/google/chrome/chrome',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/microsoft-edge',
    '/opt/microsoft/msedge/msedge',
  ];
}

/** The browser to render with: DRAFTSMAN_BROWSER if set, else the first installed Chrome or Edge. */
export function findBrowser(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string {
  const override = env['DRAFTSMAN_BROWSER'];
  if (override) {
    if (!exists(override)) throw new BrowserNotFoundError([`${override} (from DRAFTSMAN_BROWSER)`]);
    return override;
  }
  const candidates = browserCandidates(process.platform, env);
  const found = candidates.find(exists);
  if (!found) throw new BrowserNotFoundError(candidates);
  return found;
}
