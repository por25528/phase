import { describe, it, expect } from 'vitest';
import { DEMANDS, DEMAND_RANK, DEMAND_WORD, isDemand } from './demand';

describe('the vocabulary', () => {
  it('ranks light below moderate below deep', () => {
    expect(DEMAND_RANK.light).toBeLessThan(DEMAND_RANK.moderate);
    expect(DEMAND_RANK.moderate).toBeLessThan(DEMAND_RANK.deep);
  });

  it('names every value exactly once, in ascending order', () => {
    expect(DEMANDS).toEqual(['light', 'moderate', 'deep']);
    expect(DEMANDS.map((d) => DEMAND_WORD[d])).toEqual(['Light', 'Moderate', 'Deep']);
  });

  it('does not reuse the dial words, which mean the opposite pole', () => {
    const words = Object.values(DEMAND_WORD);
    expect(words).not.toContain('Low');
    expect(words).not.toContain('High');
  });
});

describe('isDemand', () => {
  it('accepts the three values', () => {
    expect(isDemand('light')).toBe(true);
    expect(isDemand('moderate')).toBe(true);
    expect(isDemand('deep')).toBe(true);
  });

  it('is total: anything else is not a demand', () => {
    for (const raw of ['Light', 'low', '', null, undefined, 3, {}, []]) {
      expect(isDemand(raw)).toBe(false);
    }
  });
});
