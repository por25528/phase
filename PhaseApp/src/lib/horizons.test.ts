import { describe, it, expect } from 'vitest';
import {
  HORIZON_LABELS,
  isHorizonWord,
  columnOfHorizonWord,
  isPlanningHorizon,
} from './horizons';

describe('horizon words', () => {
  it('names every label, and nothing else', () => {
    for (const label of HORIZON_LABELS) {
      expect(isHorizonWord(label.toLowerCase())).toBe(true);
    }
    expect(isHorizonWord('archived')).toBe(false);
    expect(isHorizonWord('')).toBe(false);
  });

  /*
   * Case-INSENSITIVE, like `set_life`'s name matching. `list_projects` answers
   * in the CAPITALISED labels, so feeding a read's own output back into
   * `set_horizon` has to work — a model that spells the enum it was handed is
   * not inventing a new value. The trim matters for the same reason: the word
   * may arrive padded by formatting.
   */
  it('accepts either casing, and trims', () => {
    expect(isHorizonWord('Now')).toBe(true);
    expect(isHorizonWord('NOW')).toBe(true);
    expect(isHorizonWord('  Someday  ')).toBe(true);
  });

  it('rejects a non-string', () => {
    expect(isHorizonWord(0)).toBe(false);
    expect(isHorizonWord(undefined)).toBe(false);
  });

  it('maps each word to the column its label sits in', () => {
    expect(columnOfHorizonWord('now')).toBe(0);
    expect(columnOfHorizonWord('next')).toBe(1);
    expect(columnOfHorizonWord('later')).toBe(2);
    expect(columnOfHorizonWord('someday')).toBe(3);
  });

  // The validator and the resolver must normalise TOGETHER: a capitalised
  // word that passes `isHorizonWord` but misses `findIndex` would return -1,
  // and the error path renders `HORIZON_LABELS[-1]` as "did not move to
  // undefined". This test is the guard against that pair drifting apart.
  it('maps a capitalised word to the column its label sits in', () => {
    expect(columnOfHorizonWord('Now')).toBe(0);
    expect(columnOfHorizonWord(' SOMEDAY ')).toBe(3);
  });

  it('agrees with isPlanningHorizon about which words the calendar plans from', () => {
    expect(isPlanningHorizon(columnOfHorizonWord('now'))).toBe(true);
    expect(isPlanningHorizon(columnOfHorizonWord('next'))).toBe(true);
    expect(isPlanningHorizon(columnOfHorizonWord('later'))).toBe(false);
    expect(isPlanningHorizon(columnOfHorizonWord('someday'))).toBe(false);
  });
});
