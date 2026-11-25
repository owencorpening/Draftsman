import { describe, expect, it } from 'vitest';

import { renumberFigures } from '../src/figures.js';

const fig = (n: number | string, title: string) => [`![${title}](images/${title}.png)`, '', `*Figure ${n}. ${title}.*`];

/** An article: intro, three figures A, B, C, and prose referring to them. */
const article = (figs: string[][], prose: string) => [`Intro.`, '', ...figs.flatMap((f) => [...f, '']), prose, ''].join('\n');

describe('renumber_figures', () => {
  it('leaves numbers already in order alone', () => {
    const text = article([fig(1, 'A'), fig(2, 'B')], 'See Figure 1 and Figure 2.');
    const r = renumberFigures(text);
    expect(r.text).toBe(text);
    expect(r.updated).toEqual([]);
    expect(r.figures.map((f) => f.to)).toEqual([1, 2]);
  });

  it('after an add: a new figure gets its place in the order, and later references follow their figures', () => {
    // B (was 2) and C (was 3) come after a new figure inserted as "?".
    const text = article([fig(1, 'A'), fig('?', 'New'), fig(2, 'B'), fig(3, 'C')], 'Figure 2 shows B; Figures 2 and 3 compare B and C; Figure 1 is A.');
    const r = renumberFigures(text);
    expect(r.figures.map((f) => [f.from, f.to])).toEqual([
      ['1', 1],
      ['?', 2],
      ['2', 3],
      ['3', 4],
    ]);
    expect(r.text).toContain('*Figure 2. New.*');
    expect(r.text).toContain('*Figure 3. B.*');
    expect(r.text).toContain('Figure 3 shows B; Figures 3 and 4 compare B and C; Figure 1 is A.');
    expect(r.problems).toEqual([]);
  });

  it('after a move: swapped figures swap numbers, and references keep pointing at the same figure', () => {
    // C (was 3) moved before B (was 2).
    const text = article([fig(1, 'A'), fig(3, 'C'), fig(2, 'B')], 'Figure 2 is B. Figure 3 is C. Figs. 1–3 cover all.');
    const r = renumberFigures(text);
    expect(r.text).toContain('*Figure 2. C.*');
    expect(r.text).toContain('*Figure 3. B.*');
    expect(r.text).toContain('Figure 3 is B. Figure 2 is C. Figs. 1–2 cover all.');
  });

  it('after a delete: later figures move up, and a reference to the deleted one is left and reported', () => {
    // B (was 2) deleted.
    const text = article([fig(1, 'A'), fig(3, 'C')], 'Figure 3 is C. Figure 2 was B.');
    const r = renumberFigures(text);
    expect(r.text).toContain('*Figure 2. C.*');
    expect(r.text).toContain('Figure 2 is C. Figure 2 was B.');
    expect(r.problems).toEqual([{ line: 11, reference: 'Figure 2', why: "there's no figure 2" }]);
  });

  it('reports a reference to a number two captions share, instead of guessing', () => {
    const r = renumberFigures(article([fig(1, 'A'), fig(1, 'A2')], 'Figure 1 is which?'));
    expect(r.figures.map((f) => f.to)).toEqual([1, 2]);
    expect(r.problems[0]!.why).toMatch(/two captions are numbered 1/);
  });

  it('reads Fig. captions, plain or bold captions, and leaves code alone', () => {
    const text = [
      '**Figure 4: Bold caption**',
      '',
      'Fig. 7. Plain caption.',
      '',
      'Inline `Figure 7` stays; Fig. 7 moves.',
      '',
      '```',
      'Figure 4 in code stays.',
      '```',
    ].join('\n');
    const r = renumberFigures(text);
    expect(r.text.split('\n')).toEqual([
      '**Figure 1: Bold caption**',
      '',
      'Fig. 2. Plain caption.',
      '',
      'Inline `Figure 7` stays; Fig. 2 moves.',
      '',
      '```',
      'Figure 4 in code stays.',
      '```',
    ]);
  });

  it('updates references inside other captions, not just prose', () => {
    const text = article([fig(2, 'A'), ['*Figure 1. B, compared with Figure 2.*']], '');
    const r = renumberFigures(text);
    expect(r.text).toContain('*Figure 2. B, compared with Figure 1.*');
  });
});
