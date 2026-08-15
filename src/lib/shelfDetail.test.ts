import { describe, expect, it } from 'vitest';
import {
  ALTERNATIVE_CAP, DETAIL_LEVELS, DETAIL_WORD, DEFAULT_DETAIL_LEVEL,
  isDetailLevel,
} from './shelfDetail';
import { MAX_ALTERNATIVES } from './executionAdvisor';

describe('shelfDetail', () => {
  it('never offers more than the advisor produces', () => {
    for (const level of DETAIL_LEVELS) {
      expect(ALTERNATIVE_CAP[level]).toBeLessThanOrEqual(MAX_ALTERNATIVES);
    }
  });

  it('is monotone — a higher setting never hides what a lower one showed', () => {
    expect(ALTERNATIVE_CAP.low).toBeLessThanOrEqual(ALTERNATIVE_CAP.medium);
    expect(ALTERNATIVE_CAP.medium).toBeLessThanOrEqual(ALTERNATIVE_CAP.high);
  });

  it('hands you one thing and no menu at its lowest', () => {
    expect(ALTERNATIVE_CAP.low).toBe(0);
  });

  it('names every level', () => {
    for (const level of DETAIL_LEVELS) {
      expect(DETAIL_WORD[level].length).toBeGreaterThan(0);
    }
    expect(DEFAULT_DETAIL_LEVEL).toBe('medium');
  });

  it('rejects anything that is not a level', () => {
    expect(isDetailLevel('low')).toBe(true);
    expect(isDetailLevel('LOW')).toBe(false);
    expect(isDetailLevel(undefined)).toBe(false);
    expect(isDetailLevel(2)).toBe(false);
  });
});
