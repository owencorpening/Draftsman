import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findSlotsInFile, markSlotInFile } from '../src/files.js';
import { findSlots, markSlot, placeholder, SlotError } from '../src/slots.js';

const article = [
  '# Dry wells',
  '',
  'Wells across the plain have dropped for decades.',
  '',
  '![drought map of Texas](draftsman:pending)',
  '',
  'The map shows where the decline is worst.',
  'Farmers there pump the hardest.',
  '',
].join('\n');

describe('findSlots', () => {
  it('finds a placeholder with its line, description and the blocks around it', () => {
    expect(findSlots(article)).toEqual([
      {
        line: 5,
        column: 1,
        description: 'drought map of Texas',
        markdown: '![drought map of Texas](draftsman:pending)',
        paragraph: '![drought map of Texas](draftsman:pending)',
        before: 'Wells across the plain have dropped for decades.',
        after: 'The map shows where the decline is worst.\nFarmers there pump the hardest.',
      },
    ]);
  });

  it('gives the whole paragraph when the placeholder sits inside one', () => {
    const text = 'First line of a paragraph\nwith ![a pump](draftsman:pending) in the middle\nand a last line.\n\nNext.';
    const [slot] = findSlots(text);
    expect(slot).toMatchObject({ line: 2, column: 6, description: 'a pump' });
    expect(slot?.paragraph).toBe('First line of a paragraph\nwith ![a pump](draftsman:pending) in the middle\nand a last line.');
    expect(slot?.before).toBe('');
    expect(slot?.after).toBe('Next.');
  });

  it('finds several on one line, and accepts a title, angle brackets and escaped brackets', () => {
    const text = '![one](draftsman:pending) ![two [b]](<draftsman:pending>) ![a \\] b](draftsman:pending "Title")';
    expect(findSlots(text).map((s) => [s.column, s.description])).toEqual([
      [1, 'one'],
      [27, 'two [b]'],
      [59, 'a ] b'],
    ]);
  });

  it('ignores ordinary images and other draftsman addresses', () => {
    expect(findSlots('![done](https://example.com/a.png)\n![x](draftsman:filled)\n[link](draftsman:pending)')).toEqual([]);
  });

  it('ignores placeholders in fenced code and inline code', () => {
    const text = [
      'Write `![x](draftsman:pending)` to mark a spot.',
      '',
      '```md',
      '![in code](draftsman:pending)',
      '',
      '```',
      '',
      '~~~~',
      '![tilde](draftsman:pending)',
      '~~~~',
      '',
      '![real](draftsman:pending)',
    ].join('\n');
    expect(findSlots(text).map((s) => [s.line, s.description])).toEqual([[12, 'real']]);
  });

  it('treats an unclosed fence as code to the end of the file', () => {
    expect(findSlots('```\n![x](draftsman:pending)\n')).toEqual([]);
  });

  it('reads files with Windows line endings', () => {
    const [slot] = findSlots(article.replace(/\n/g, '\r\n'));
    expect(slot).toMatchObject({ line: 5, after: 'The map shows where the decline is worst.\nFarmers there pump the hardest.' });
  });

  it('returns nothing for an empty file', () => {
    expect(findSlots('')).toEqual([]);
  });
});

describe('placeholder', () => {
  it('escapes brackets and backslashes so the description round-trips', () => {
    const md = placeholder('  chart [2026] a\\b ');
    expect(md).toBe('![chart \\[2026\\] a\\\\b](draftsman:pending)');
    expect(findSlots(md)[0]?.description).toBe('chart [2026] a\\b');
  });

  it('refuses an empty or multi-line description', () => {
    expect(() => placeholder('   ')).toThrow(SlotError);
    expect(() => placeholder('two\nlines')).toThrow(SlotError);
  });
});

describe('markSlot', () => {
  const doc = 'Intro paragraph.\n\nSecond paragraph.\n';

  it('inserts at a blank line, adding a blank line above so it is its own block', () => {
    const { text, slot } = markSlot(doc, 2, 'a water tower');
    expect(text).toBe('Intro paragraph.\n\n![a water tower](draftsman:pending)\n\nSecond paragraph.\n');
    expect(slot).toMatchObject({ line: 3, description: 'a water tower', before: 'Intro paragraph.', after: 'Second paragraph.' });
  });

  it('inserts at the start of a block, adding a blank line below', () => {
    const { text, slot } = markSlot(doc, 3, 'a canal');
    expect(text).toBe('Intro paragraph.\n\n![a canal](draftsman:pending)\n\nSecond paragraph.\n');
    expect(slot.line).toBe(3);
  });

  it('inserts at line 1 and appends one past the last line', () => {
    expect(markSlot(doc, 1, 'top').text).toBe('![top](draftsman:pending)\n\nIntro paragraph.\n\nSecond paragraph.\n');
    const end = markSlot(doc, 4, 'end');
    expect(end.text).toBe('Intro paragraph.\n\nSecond paragraph.\n\n![end](draftsman:pending)\n');
    expect(end.slot.line).toBe(5);
  });

  it('marks a spot in an empty file', () => {
    expect(markSlot('', 1, 'first').text).toBe('![first](draftsman:pending)\n');
  });

  it('keeps Windows line endings and a missing final newline', () => {
    expect(markSlot('One.\r\n\r\nTwo.', 2, 'x').text).toBe('One.\r\n\r\n![x](draftsman:pending)\r\n\r\nTwo.');
  });

  it('refuses a line that would split a paragraph', () => {
    expect(() => markSlot('Line one\nline two\n', 2, 'x')).toThrow(/split it/);
  });

  it('refuses a line inside a code block but allows the lines around it', () => {
    const code = 'Before.\n\n```\ncode\n\nmore\n```\n\nAfter.\n';
    for (const line of [4, 5, 6, 7]) expect(() => markSlot(code, line, 'x')).toThrow(/code block/);
    expect(markSlot(code, 2, 'x').slot.line).toBe(3);
    expect(markSlot(code, 8, 'x').slot.line).toBe(9);
  });

  it('refuses any line after a fence that is never closed', () => {
    expect(() => markSlot('Text.\n\n```\ncode\n', 5, 'x')).toThrow(/code block/);
  });

  it('refuses a line outside the file', () => {
    expect(() => markSlot(doc, 0, 'x')).toThrow(SlotError);
    expect(() => markSlot(doc, 5, 'x')).toThrow(/outside the file/);
    expect(() => markSlot(doc, 1.5, 'x')).toThrow(SlotError);
  });
});

describe('file tools', () => {
  it('marks a slot in a file and finds it again', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'draftsman-'));
    await writeFile(path.join(dir, 'post.md'), article);

    const marked = await markSlotInFile('post.md', 9, 'a dry riverbed', dir);
    expect(marked.slot.line).toBe(10);
    expect(await readFile(path.join(dir, 'post.md'), 'utf8')).toBe(article + '\n![a dry riverbed](draftsman:pending)\n');

    const found = await findSlotsInFile(path.join(dir, 'post.md'));
    expect(found.slots.map((s) => s.description)).toEqual(['drought map of Texas', 'a dry riverbed']);
  });

  it('refuses files that are not markdown or do not exist', async () => {
    await expect(findSlotsInFile('notes.txt')).rejects.toThrow(/not a markdown file/);
    await expect(findSlotsInFile('/nonexistent/post.md')).rejects.toThrow(/does not exist/);
  });
});
