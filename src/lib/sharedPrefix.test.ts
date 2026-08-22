import { describe, expect, it } from 'vitest';
import { dropSharedPrefix, sharedProjectPrefix } from './sharedPrefix';

describe('sharedProjectPrefix', () => {
  // The case that started it: a term's courses, all filed under one goal name.
  it('finds the prefix a term of courses shares', () => {
    expect(sharedProjectPrefix([
      'Midterm — 2301265 DATA STRUC ALGOR',
      'Midterm — 2301230 DISCRETE CS',
      'Midterm — 2301274 COMP SYS',
    ])).toBe('Midterm — ');
  });

  /*
   * The whole reason for the cut-back. Character-wise the shared prefix here is
   * `Midterm — 230`, and stripping that would leave `1265` and `1230` — numbers
   * that are no longer the numbers they name.
   */
  it('cuts back to a token boundary rather than through a course code', () => {
    const prefix = sharedProjectPrefix([
      'Midterm — 2301265 DATA STRUC ALGOR',
      'Midterm — 2301230 DISCRETE CS',
    ]);
    expect(prefix).toBe('Midterm — ');
    expect(dropSharedPrefix('Midterm — 2301230 DISCRETE CS', prefix)).toBe('2301230 DISCRETE CS');
  });

  it('finds nothing when the projects are unrelated', () => {
    expect(sharedProjectPrefix(['Algorithms', 'Website', 'Thesis'])).toBe('');
  });

  // One label shares a prefix with nobody.
  it('finds nothing in a single label', () => {
    expect(sharedProjectPrefix(['Midterm — 2301265 DATA STRUC ALGOR'])).toBe('');
    expect(sharedProjectPrefix([])).toBe('');
  });

  /*
   * A row with no project cannot vouch that the prefix was already stated
   * somewhere else — and the shelf's loose tasks are exactly that row.
   */
  it('finds nothing when any label is missing', () => {
    expect(sharedProjectPrefix(['Midterm — A', undefined, 'Midterm — B'])).toBe('');
  });

  it('refuses a prefix too short to be worth a reader\'s guess', () => {
    expect(sharedProjectPrefix(['A one', 'A two'])).toBe('');
  });

  it('refuses to reduce a name to a fragment', () => {
    expect(sharedProjectPrefix(['Comparative Literature A', 'Comparative Literature B'])).toBe('');
  });

  it('never strips a whole label away', () => {
    // The prefix is real for the second label but consumes the first entirely.
    expect(sharedProjectPrefix(['Physics — ', 'Physics — Lab'])).toBe('');
  });
});

describe('dropSharedPrefix', () => {
  it('leaves a title that does not carry the prefix alone', () => {
    expect(dropSharedPrefix('Website', 'Midterm — ')).toBe('Website');
  });

  it('is the identity when there is no prefix', () => {
    expect(dropSharedPrefix('Midterm — Physics', '')).toBe('Midterm — Physics');
  });

  it('trims the separator the prefix left behind', () => {
    expect(dropSharedPrefix('Midterm —   Physics', 'Midterm —')).toBe('Physics');
  });

  /*
   * A label that vanished would read as work belonging to NO project, which is
   * a different fact from work whose project was already named above.
   */
  it('returns the whole title rather than nothing', () => {
    expect(dropSharedPrefix('Midterm — ', 'Midterm — ')).toBe('Midterm — ');
  });
});
