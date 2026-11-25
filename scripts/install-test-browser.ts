// Downloads the pinned Chrome for Testing build the render test uses into
// .cache/test-browser (about 170 MB, once). See test/test-browser.ts.
//
//   npm run test-browser

import { existsSync } from 'node:fs';

import { Browser, install } from '@puppeteer/browsers';

import { TEST_BROWSER_CACHE, TEST_CHROME, testBrowserPath } from '../test/test-browser.js';

if (existsSync(testBrowserPath())) {
  console.log(`Chrome for Testing ${TEST_CHROME} is already installed: ${testBrowserPath()}`);
} else {
  console.log(`Downloading Chrome for Testing ${TEST_CHROME} into ${TEST_BROWSER_CACHE} ...`);
  const installed = await install({ browser: Browser.CHROME, buildId: TEST_CHROME, cacheDir: TEST_BROWSER_CACHE });
  console.log(`Installed: ${installed.executablePath}`);
}
