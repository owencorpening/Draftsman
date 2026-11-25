import { describe, expect, it } from 'vitest';

import { findTables, plainText, splitRow } from '../src/tables.js';

const doc = [
  '# Storage',
  '',
  'Reservoirs held less this year.',
  '',
  '| Region | Storage (acre-ft) | Change |',
  '| :--- | ---: | :---: |',
  '| North basin | 1,240 | −12% |',
  '| Central valley | 860 | −4% |',
  '',
  'After the table.',
].join('\n');

describe('find_tables', () => {
  it('finds a table with its lines, header, alignment, rows and the paragraph before it', () => {
    expect(findTables(doc)).toEqual([
      {
        startLine: 5,
        endLine: 8,
        header: ['Region', 'Storage (acre-ft)', 'Change'],
        align: ['left', 'right', 'center'],
        rows: [
          ['North basin', '1,240', '−12%'],
          ['Central valley', '860', '−4%'],
        ],
        markdown: doc.split('\n').slice(4, 8).join('\n'),
        before: 'Reservoirs held less this year.',
      },
    ]);
  });

  it('accepts tables without outer pipes, pads short rows and drops extra cells', () => {
    const [t] = findTables('a | b\n--- | ---\n1 | 2\n3\n4 | 5 | 6\n');
    expect(t).toMatchObject({ header: ['a', 'b'], align: [null, null], rows: [['1', '2'], ['3', ''], ['4', '5']] });
  });

  it('keeps pipes in inline code and escaped pipes inside their cell', () => {
    const [t] = findTables('| Op | Meaning |\n|---|---|\n| `a | b` | or |\n| x \\| y | escaped |\n');
    expect(t!.rows).toEqual([
      ['`a | b`', 'or'],
      ['x | y', 'escaped'],
    ]);
  });

  it('ignores tables in code, and rows that don’t match the header', () => {
    expect(findTables('```\n| a | b |\n|---|---|\n| 1 | 2 |\n```\n')).toEqual([]);
    expect(findTables('| a | b |\n|---|---|---|\n')).toEqual([]);
    expect(findTables('Just | a line with a pipe.\n')).toEqual([]);
  });

  it('ends a table at a blank line or a new block, and finds several', () => {
    const text = '| a |\n|---|\n| 1 |\n# Next\n\n| b |\n|---|\n| 2 |\n\n| 3 |';
    expect(findTables(text).map((t) => [t.startLine, t.endLine, t.rows.length])).toEqual([
      [1, 3, 1],
      [6, 8, 1],
    ]);
  });

  it('gives the text right above the table as its context when there’s no blank line', () => {
    const [t] = findTables('Intro line\n| a |\n|---|\n| 1 |\n');
    expect(t).toMatchObject({ startLine: 2, before: 'Intro line' });
  });
});

describe('cells', () => {
  it('splits rows', () => {
    expect(splitRow('| a | b |')).toEqual(['a', 'b']);
    expect(splitRow('a|b')).toEqual(['a', 'b']);
    expect(splitRow('| only |')).toEqual(['only']);
  });

  it('reduce to plain text for the sheet', () => {
    expect(plainText('**North** _basin_ `code` [link](https://x.test) ~~old~~ a\\|b')).toBe('North basin code link old a|b');
  });
});
