// Runs inside VS Code. A small runner with node:assert, so no test framework is needed.
import assert from 'node:assert/strict';

import * as vscode from 'vscode';

import { placeholderEdit, placeholderText } from '../placeholder';

const COMMAND = 'draftsman.markImageSpot';

const tests: [string, () => Promise<void> | void][] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

async function editorWith(text: string, line: number, language = 'markdown'): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ language, content: text });
  const editor = await vscode.window.showTextDocument(doc);
  editor.selection = new vscode.Selection(line, 0, line, 0);
  return editor;
}

test('the placeholder escapes brackets and stays on one line', () => {
  assert.equal(placeholderText(' a [big]\n map \\ '), '![a \\[big\\] map \\\\](draftsman:pending)');
});

test('on a blank line between paragraphs, it takes the line and adds blank lines around it', () => {
  assert.deepEqual(placeholderEdit(['One.', '', 'Two.'], 1, 'x'), { line: 1, text: '\n![x](draftsman:pending)\n' });
});

test('inside a paragraph, it goes after the paragraph, never splitting it', () => {
  assert.deepEqual(placeholderEdit(['First line', 'second line', '', 'Next.'], 0, 'x'), { line: 1, text: 'second line\n\n![x](draftsman:pending)' });
});

test('the command is registered', async () => {
  const all = await vscode.commands.getCommands(true);
  assert.ok(all.includes(COMMAND));
});

test('the command inserts the placeholder at the cursor in a markdown file', async () => {
  const editor = await editorWith('# Wells\n\nWells have dropped for decades.\nFarmers pump the hardest.\n\nThe end.\n', 2);
  assert.equal(await vscode.commands.executeCommand(COMMAND, 'drought map of Texas'), true);
  assert.equal(
    editor.document.getText(),
    '# Wells\n\nWells have dropped for decades.\nFarmers pump the hardest.\n\n![drought map of Texas](draftsman:pending)\n\nThe end.\n',
  );
});

test('the command does nothing outside markdown', async () => {
  const editor = await editorWith('const x = 1;\n', 0, 'javascript');
  assert.equal(await vscode.commands.executeCommand(COMMAND, 'x'), false);
  assert.equal(editor.document.getText(), 'const x = 1;\n');
});

export async function run(): Promise<void> {
  // The extension activates on its command; make sure it's loaded before checking registration.
  await vscode.extensions.getExtension('owencorpening.draftsman-mark')?.activate();
  const failures: string[] = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
      failures.push(name);
    }
  }
  console.log(`${tests.length - failures.length} passed, ${failures.length} failed`);
  if (failures.length) throw new Error(`${failures.length} extension test(s) failed`);
}
