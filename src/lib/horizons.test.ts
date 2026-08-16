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
   * Case-SENSITIVE, unlike `set_life`'s name matching. A life title is
   * something a person typed and may capitalise however they like; a horizon
   * word is an enum on a wire protocol, and `mcp/server.js` already constrains
   * it with `z.enum`. Accepting 'Now' would be inventing a second spelling of
   * a value that has exactly one.
   */
  it('does not accept a capitalised word', () => {
    expect(isHorizonWord('Now')).toBe(false);
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

  it('agrees with isPlanningHorizon about which words the calendar plans from', () => {
    expect(isPlanningHorizon(columnOfHorizonWord('now'))).toBe(true);
    expect(isPlanningHorizon(columnOfHorizonWord('next'))).toBe(true);
    expect(isPlanningHorizon(columnOfHorizonWord('later'))).toBe(false);
    expect(isPlanningHorizon(columnOfHorizonWord('someday'))).toBe(false);
  });
});
