import { describe, it, expect } from 'vitest';
import {
  fetchRange, coversWeek, outsideHorizon,
  BASE_BACK_DAYS, BASE_FORWARD_DAYS, MAX_FORWARD_DAYS,
} from './calendarRange';
import { addDays } from './dates';

const M = '2026-08-03'; // a Monday

describe('fetchRange', () => {
  it('covers one week back and eight weeks forward by default', () => {
    expect(fetchRange(M, M)).toEqual({
      rangeStart: addDays(M, -BASE_BACK_DAYS),
      rangeEnd: addDays(M, BASE_FORWARD_DAYS),
    });
  });

  it('leaves the range alone for a week already inside it', () => {
    const base = fetchRange(M, M);
    expect(fetchRange(M, addDays(M, 21), base.rangeEnd)).toEqual(base);
  });

  // The visited week must be covered COMPLETELY, not just its Monday. A range
  // ending on the visited Monday leaves Tue-Sun reading as unknown.
  it('extends far enough to cover the whole visited week, not just its Monday', () => {
    const visited = addDays(M, 63); // week +9, past the 8-week base
    const out = fetchRange(M, visited, addDays(M, BASE_FORWARD_DAYS));
    expect(out.rangeEnd).toBe(addDays(visited, 7));
    expect(coversWeek(out, visited)).toBe(true);
  });

  it('never gives back ground it already covers', () => {
    const wide = addDays(M, 100);
    expect(fetchRange(M, M, wide).rangeEnd).toBe(wide);
  });

  it('does not extend for a visited week beyond the 26-week cap', () => {
    const out = fetchRange(M, addDays(M, 180), addDays(M, BASE_FORWARD_DAYS));
    expect(out.rangeEnd).toBe(addDays(M, BASE_FORWARD_DAYS));
    expect(coversWeek(out, addDays(M, 180))).toBe(false);
  });

  it('caps an already-wide previous end too', () => {
    expect(fetchRange(M, M, addDays(M, 400)).rangeEnd).toBe(addDays(M, MAX_FORWARD_DAYS));
  });

  it('extends for a visited week beyond the base window but inside the cap', () => {
    const visited = addDays(M, 100);
    const out = fetchRange(M, visited, addDays(M, BASE_FORWARD_DAYS));
    expect(out.rangeEnd).toBe(addDays(visited, 7));
    expect(coversWeek(out, visited)).toBe(true);
  });

  it('never extends backward for a week before the range', () => {
    const out = fetchRange(M, addDays(M, -70));
    expect(out.rangeStart).toBe(addDays(M, -BASE_BACK_DAYS));
  });

  // Leaving the app open across Sunday midnight must roll the window forward
  // rather than stranding it on last week's anchor.
  it('re-anchors the start when the current Monday advances', () => {
    const next = addDays(M, 7);
    const out = fetchRange(next, next, addDays(M, BASE_FORWARD_DAYS));
    expect(out.rangeStart).toBe(addDays(next, -BASE_BACK_DAYS));
  });

  it('always returns a positive-width range', () => {
    for (const visited of [M, addDays(M, -70), addDays(M, 300)]) {
      const out = fetchRange(M, visited);
      expect(out.rangeEnd > out.rangeStart, visited).toBe(true);
    }
  });
});

describe('coversWeek', () => {
  const base = fetchRange(M, M);

  it('accepts a week wholly inside the range', () => {
    expect(coversWeek(base, addDays(M, 14))).toBe(true);
  });

  it('accepts the first week of the range', () => {
    expect(coversWeek(base, base.rangeStart)).toBe(true);
  });

  it('rejects a week before the range', () => {
    expect(coversWeek(base, addDays(base.rangeStart, -7))).toBe(false);
  });

  // The end is exclusive, so a week starting ON rangeEnd is outside, and so is
  // the last week that would run past it.
  it('rejects a week that starts inside but ends past the range', () => {
    expect(coversWeek(base, addDays(base.rangeEnd, -3))).toBe(false);
  });

  it('accepts the last week that fits exactly', () => {
    expect(coversWeek(base, addDays(base.rangeEnd, -7))).toBe(true);
  });
});

/**
 * A week the range can never reach, and WHICH SIDE it is out on.
 *
 * `fetchRange` clamps forward at `MAX_FORWARD_DAYS` and never grows backward,
 * so a week outside either edge comes back uncovered however many times it is
 * asked for — and asking again on every navigation is a fetch per keystroke
 * that cannot change the answer. The direction matters because the two edges
 * are nothing alike: one is six months out, the other is last week.
 */
describe('outsideHorizon', () => {
  const MONDAY = '2026-08-03';

  it('is null for the current week', () => {
    expect(outsideHorizon(MONDAY, MONDAY)).toBeNull();
  });

  it('is null for a week the base window already covers', () => {
    expect(outsideHorizon(MONDAY, addDays(MONDAY, 21))).toBeNull();
  });

  it('is null for a week past the base window but inside the cap', () => {
    expect(outsideHorizon(MONDAY, addDays(MONDAY, BASE_FORWARD_DAYS + 7))).toBeNull();
  });

  // The boundary is the week's END, not its start: a Monday exactly at the cap
  // still needs six more days that the range cannot hold.
  it('is after for the last week that does not fit whole', () => {
    expect(outsideHorizon(MONDAY, addDays(MONDAY, MAX_FORWARD_DAYS))).toBe('after');
  });

  it('is null for the last week that does fit whole', () => {
    expect(outsideHorizon(MONDAY, addDays(MONDAY, MAX_FORWARD_DAYS - 7))).toBeNull();
  });

  it('is after far beyond the cap', () => {
    expect(outsideHorizon(MONDAY, addDays(MONDAY, 400))).toBe('after');
  });

  /*
   * The discriminating pair. Both edges are uncoverable and both must suppress
   * a refetch — but one of them is six months away and the other is a
   * fortnight ago, and a caveat that says "reaches six months out" about last
   * month is simply false.
   */
  it('is before for a week the range cannot reach back to', () => {
    expect(outsideHorizon(MONDAY, addDays(MONDAY, -14))).toBe('before');
  });

  it('is null for the one week back the range does hold', () => {
    expect(outsideHorizon(MONDAY, addDays(MONDAY, -BASE_BACK_DAYS))).toBeNull();
  });

  // Whatever it calls out of reach must agree with what `fetchRange` actually
  // returns, or the guard would suppress a fetch that would have worked.
  it('agrees with fetchRange for every week across both edges', () => {
    for (let d = -28; d <= MAX_FORWARD_DAYS + 21; d += 7) {
      const week = addDays(MONDAY, d);
      const reachable = coversWeek(fetchRange(MONDAY, week), week);
      expect(outsideHorizon(MONDAY, week) === null).toBe(reachable);
    }
  });

  it('never calls a reachable week out of reach in either direction', () => {
    for (let d = -BASE_BACK_DAYS; d <= MAX_FORWARD_DAYS - 7; d += 7) {
      expect(outsideHorizon(MONDAY, addDays(MONDAY, d))).toBeNull();
    }
  });
});
