// Downloads a pinned VS Code into .vscode-test (once) and runs the suite in it.
import path from 'node:path';

import { runTests } from '@vscode/test-electron';

/** The VS Code the tests run in: the oldest the extension supports. */
const VSCODE = '1.140.0';

async function main(): Promise<void> {
  // Set when this runs from inside VS Code (its terminal or an agent there); it
  // would make the test VS Code start as plain Node and reject every option.
  delete process.env['ELECTRON_RUN_AS_NODE'];
  const root = path.resolve(__dirname, '../..');
  await runTests({
    version: VSCODE,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.resolve(__dirname, 'suite.js'),
    launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--no-sandbox'],
  });
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
