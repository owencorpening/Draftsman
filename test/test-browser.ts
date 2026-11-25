// The one browser build the render test uses, so its reference images match
// on every machine. Installed Chrome updates itself every few weeks and a new
// version can lay text out a pixel or two differently (seen Nov 25: Chrome 156
// and 157 drew the sample table 445 and 447 pixels wide), so comparing against
// installed Chrome would break with every update.
//
// This is for tests only. Draftsman itself renders with the user's installed
// Chrome or Edge.
//
// To move the pin: change TEST_CHROME, run `npm run test-browser`, then
// `UPDATE_REFERENCE=1 npm test`, look at the new images and commit them.

import path from 'node:path';

import { Browser, computeExecutablePath } from '@puppeteer/browsers';

/** Chrome for Testing build; the one puppeteer-core 25.19.0 is tested against. */
export const TEST_CHROME = '158.0.8127.88';

export const TEST_BROWSER_CACHE = path.resolve('.cache/test-browser');

export function testBrowserPath(): string {
  return computeExecutablePath({ browser: Browser.CHROME, buildId: TEST_CHROME, cacheDir: TEST_BROWSER_CACHE });
}
