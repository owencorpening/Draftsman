// Draftsman's one editor command: mark an image spot without opening a chat.
// It needs no AI and no server; Draftsman's find_slots finds the spot later.

import * as vscode from 'vscode';

import { placeholderEdit } from './placeholder';

export const COMMAND = 'draftsman.markImageSpot';

/** Inserts the placeholder for the active markdown editor; returns false if nothing was inserted. */
export async function markImageSpot(description?: string): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    void vscode.window.showInformationMessage('Draftsman: open a markdown file to mark an image spot.');
    return false;
  }
  const text =
    description ??
    (await vscode.window.showInputBox({
      title: 'Mark image spot',
      prompt: 'What should the image show? It becomes the alt text.',
      placeHolder: 'drought map of Texas',
      validateInput: (v) => (v.trim() ? undefined : 'Describe the image in a few words.'),
    }));
  if (!text?.trim()) return false;

  const doc = editor.document;
  const lines = Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
  const edit = placeholderEdit(lines, editor.selection.active.line, text);
  const range = doc.lineAt(edit.line).range;
  return editor.edit((b) => b.replace(range, edit.text));
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(COMMAND, (description?: string) => markImageSpot(description)));
}

export function deactivate(): void {}
