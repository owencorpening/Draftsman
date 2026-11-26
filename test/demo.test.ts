import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { findBlockquotes } from '../src/quotes.js';
import { findSlots } from '../src/slots.js';
import { findTables } from '../src/tables.js';

const article = readFileSync('demo/article.md', 'utf8');

describe('demo article', () => {
  it('has three image spots, two tables, a blockquote and a summary block', () => {
    expect(findSlots(article)).toHaveLength(3);
    expect(findTables(article)).toHaveLength(2);
    expect(findBlockquotes(article).filter((b) => b.kind === 'quote')).toHaveLength(1);
    expect(article).toMatch(/\n## Summary\n\n(- .+\n){3,}/);
  });

  it('says its numbers are made up', () => {
    expect(article).toMatch(/numbers are made up/);
  });
});
