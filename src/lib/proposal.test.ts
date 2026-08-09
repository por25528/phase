import { describe, expect, it } from 'vitest';
import { acceptedRows, parseProposal, splitEstimate } from './proposal';

const id = (i: number) => `r${i}`;
const parse = (raw: string) => parseProposal(raw, id);

describe('splitEstimate', () => {
  it.each([
    ['Read chapter 7 — 45m', 'Read chapter 7', 45],
    ['Read chapter 7 (45m)', 'Read chapter 7', 45],
    ['Read chapter 7 ~45m', 'Read chapter 7', 45],
    ['Read chapter 7 - 1h', 'Read chapter 7', 60],
  ])('reads %s as a title and a duration', (line, title, estimateMin) => {
    expect(splitEstimate(line)).toEqual({ title, estimateMin });
  });

  /**
   * Half-eating a line is worse than not parsing it: the user is left with a
   * title missing a word and no way to tell what happened.
   */
  it('leaves a line alone when the tail is not a duration', () => {
    expect(splitEstimate('Read chapter 7 — carefully')).toEqual({ title: 'Read chapter 7 — carefully' });
  });

  it('leaves a bare duration alone rather than producing an empty title', () => {
    expect(splitEstimate('45m')).toEqual({ title: '45m' });
  });

  it('passes an ordinary line straight through', () => {
    expect(splitEstimate('  Solve problems 1–15  ')).toEqual({ title: 'Solve problems 1–15' });
  });
});

describe('parseProposal', () => {
  it('takes a plain list, one per line, with whatever bullet turned up', () => {
    const out = parse('- Read chapter 7\n2. Problems 1–15\n• Mock quiz');
    expect('rows' in out && out.rows.map((r) => r.title))
      .toEqual(['Read chapter 7', 'Problems 1–15', 'Mock quiz']);
  });

  it('takes a JSON array too, since that is what the old prompt asked for', () => {
    const out = parse('["Read chapter 7", {"title": "Problems 1–15"}]');
    expect('rows' in out && out.rows).toHaveLength(2);
  });

  it('lifts the durations out of the lines', () => {
    const out = parse('Read chapter 7 — 45m\nProblems 1–15 (1h)');
    expect('rows' in out && out.rows.map((r) => r.estimateMin)).toEqual([45, 60]);
  });

  /**
   * The common case is "yes, all of it, with two words changed". Making the
   * user tick five boxes to reach it would be charging them for the feature
   * working.
   */
  it('starts every row accepted', () => {
    const out = parse('One\nTwo');
    expect('rows' in out && out.rows.every((r) => r.selected)).toBe(true);
  });

  it('gives each row a stable id, so editing a title cannot reshuffle them', () => {
    const out = parse('One\nTwo');
    expect('rows' in out && out.rows.map((r) => r.id)).toEqual(['r0', 'r1']);
  });

  it('passes the parser’s own refusal through rather than inventing a row', () => {
    expect(parse('   ')).toEqual({ error: 'Paste the AI output first.' });
  });
});

describe('acceptedRows', () => {
  const row = (over: Partial<Parameters<typeof acceptedRows>[0][number]>) =>
    ({ id: 'x', title: 't', selected: true, ...over });

  it('takes only what is ticked', () => {
    expect(acceptedRows([row({ id: 'a' }), row({ id: 'b', selected: false })]).map((r) => r.id))
      .toEqual(['a']);
  });

  /**
   * A row emptied out is a row deleted — the same gesture, without a second
   * control for it.
   */
  it('drops a row whose title has been emptied', () => {
    expect(acceptedRows([row({ title: '   ' })])).toEqual([]);
  });
});
