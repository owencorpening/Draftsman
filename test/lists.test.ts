import { describe, expect, it } from 'vitest';

import { findLists } from '../src/lists.js';

const ARTICLE = [
  '# Basins', // 1
  '',
  'The ranking:', // 3
  '',
  '- Nile: 36 months, $950M', // 5
  '- Indus: 6 months, $4M',
  '  still the fastest', // 7
  '- Mekong: 24 months, $610M',
  '    - with a treaty', // 9
  '    - without one',
  '',
  'Steps:', // 12
  '1. Survey',
  '2. Build',
  '',
  '3. Staff', // 16
  '',
  '```', // 18
  '- not a list',
  '```',
  '',
  '> - quoted list', // 22
  '',
  '---', // 24
  '* * *',
  '',
  'Last words.', // 27
  '',
].join('\n');

describe('find_lists', () => {
  const lists = findLists(ARTICLE);

  it('finds each list outside code, blockquotes and rules', () => {
    expect(lists.map((l) => [l.startLine, l.endLine, l.ordered])).toEqual([
      [5, 10, false],
      [13, 16, true],
    ]);
  });

  it('nests items under their parent and joins continuation lines', () => {
    const [bullets] = lists;
    expect(bullets!.items.map((i) => [i.line, i.text, i.children.map((c) => c.text)])).toEqual([
      [5, 'Nile: 36 months, $950M', []],
      [6, 'Indus: 6 months, $4M still the fastest', []],
      [8, 'Mekong: 24 months, $610M', ['with a treaty', 'without one']],
    ]);
  });

  it('keeps a loose list together across blank lines', () => {
    expect(lists[1]!.items.map((i) => i.text)).toEqual(['Survey', 'Build', 'Staff']);
  });

  it('gives the list as written and the text around it', () => {
    expect(lists[0]!.markdown.split('\n')[0]).toBe('- Nile: 36 months, $950M');
    expect(lists[0]!.before).toBe('The ranking:');
    expect(lists[0]!.after).toBe('Steps:\n1. Survey\n2. Build');
    expect(lists[1]!.before).toBe('Steps:');
  });

  it('ends a list where the marker changes', () => {
    expect(findLists('- a\n- b\n+ c\n').map((l) => [l.startLine, l.endLine])).toEqual([
      [1, 2],
      [3, 3],
    ]);
  });
});
