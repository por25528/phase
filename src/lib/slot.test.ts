import { describe, it, expect } from 'vitest';
import type { BusyBlock } from '../db/types';
import {
  aimFor, durationOf, freeIntervals, longestFreeGap, resolveSlot,
  DEFAULT_SLOT_MIN, ORDINARY_DAY, WHOLE_DAY, NO_PAST_LIMIT,
} from './slot';
import type { Interval, Now } from './capacity';

// 2026-07-15 is a Wednesday → dow 2.
const WED = '2026-07-15';
/*
 * The region these tests search.
 *
 * `freeIntervals` and `resolveSlot` used to take `AvailabilityWindow[]` and
 * look the day's window up themselves — that lookup WAS the fence, and it is
 * gone: the caller now names a region. Every assertion below is unchanged,
 * because the interval arithmetic is unchanged; what moved is who decides
 * where the search may look. Passing 09:00–18:00 here keeps these pinned on
 * the same numbers they always were, and the `WHOLE_DAY` block at the end of
 * each describe is the new behaviour.
 */
const WINDOW: Interval = { startMin: 540, endMin: 1080 }; // 09:00–18:00
const EARLY: Now = { date: '2026-07-01', minute: 0 }; // before WED — no past-clamping

function busy(startMin: number, endMin: number, allDay = false): BusyBlock {
  return { date: WED, startMin, endMin, title: 'Lecture', allDay };
}

describe('durationOf', () => {
  it('uses the estimate when it is usable', () => {
    expect(durationOf(90)).toBe(90);
  });
  it('falls back to DEFAULT_SLOT_MIN for absent or unusable estimates', () => {
    expect(durationOf(undefined)).toBe(DEFAULT_SLOT_MIN);
    expect(durationOf(0)).toBe(DEFAULT_SLOT_MIN);
    expect(durationOf(-30)).toBe(DEFAULT_SLOT_MIN);
  });
});

describe('freeIntervals', () => {
  it('returns the whole window when the day is empty', () => {
    expect(freeIntervals(WED, WINDOW, [], [], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 1080 }]);
  });

  // Was "a day with no availability window", where the null came from the
  // lookup this function used to do itself. The lookup is the caller's now, so
  // the case being pinned is the same one stated directly: a null region has
  // no gaps in it. `proposeReplan` is what still produces that null, by
  // passing `windowForDate` for a day that is switched off.
  it('returns nothing when there is no region to search', () => {
    expect(freeIntervals(WED, null, [], [], EARLY, true)).toEqual([]);
  });

  it('splits the window around a busy block', () => {
    expect(freeIntervals(WED, WINDOW, [busy(600, 690)], [], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 600 }, { startMin: 690, endMin: 1080 }]);
  });

  it('subtracts already-placed work as well as calendar events', () => {
    expect(freeIntervals(WED, WINDOW, [busy(600, 690)], [{ startMin: 690, endMin: 780 }], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 600 }, { startMin: 780, endMin: 1080 }]);
  });

  it('merges overlapping busy blocks instead of double-subtracting', () => {
    expect(freeIntervals(WED, WINDOW, [busy(600, 700), busy(650, 720)], [], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 600 }, { startMin: 720, endMin: 1080 }]);
  });

  it('clips busy blocks that overhang the window', () => {
    expect(freeIntervals(WED, WINDOW, [busy(480, 600), busy(1020, 1200)], [], EARLY, true))
      .toEqual([{ startMin: 600, endMin: 1020 }]);
  });

  it('returns nothing when an all-day event consumes the day and the pref is on', () => {
    expect(freeIntervals(WED, WINDOW, [busy(0, 1440, true)], [], EARLY, true)).toEqual([]);
  });

  // The all-day-event test above does not discriminate the early return from
  // plain interval subtraction: a 0..1440 block also subtracts the ENTIRE
  // 540..1080 window down to [] on its own, so deleting the early return still
  // passes it. This block's own startMin/endMin (0..100) sit entirely BEFORE
  // the window and would be skipped by the subtraction loop's "entirely behind
  // the cursor" branch, leaving the window untouched — [{540,1080}] — if the
  // early return were gone. An all-day event must consume the WHOLE day
  // regardless of its own timed span, so the early return is what makes this
  // (correctly) return [] instead.
  it('lets a nominally early all-day event still consume the entire day', () => {
    expect(freeIntervals(WED, WINDOW, [busy(0, 100, true)], [], EARLY, true)).toEqual([]);
  });

  it('ignores an all-day event when the pref is off', () => {
    expect(freeIntervals(WED, WINDOW, [busy(0, 1440, true)], [], EARLY, false))
      .toEqual([{ startMin: 540, endMin: 1080 }]);
  });

  it('starts today at the current minute — the past is not capacity', () => {
    const now: Now = { date: WED, minute: 700 };
    expect(freeIntervals(WED, WINDOW, [], [], now, true))
      .toEqual([{ startMin: 700, endMin: 1080 }]);
  });

  it('returns nothing for a day already past', () => {
    const now: Now = { date: '2026-07-16', minute: 0 };
    expect(freeIntervals(WED, WINDOW, [], [], now, true)).toEqual([]);
  });

  it('returns nothing once today’s window has closed', () => {
    const now: Now = { date: WED, minute: 1100 };
    expect(freeIntervals(WED, WINDOW, [], [], now, true)).toEqual([]);
  });

  it('ignores busy blocks belonging to other days', () => {
    const other: BusyBlock = { date: '2026-07-16', startMin: 600, endMin: 690, title: 'x', allDay: false };
    expect(freeIntervals(WED, WINDOW, [other], [], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 1080 }]);
  });

  it('drops a gap that closes to zero width', () => {
    expect(freeIntervals(WED, WINDOW, [busy(540, 700), busy(700, 1080)], [], EARLY, true))
      .toEqual([]);
  });
});

describe('resolveSlot', () => {
  function call(over: Partial<Parameters<typeof resolveSlot>[0]> = {}) {
    return resolveSlot({
      date: WED, aimMin: 540, durationMin: 60,
      span: WINDOW, blocks: [], placed: [], now: EARLY, allDayBlocks: true,
      ...over,
    });
  }

  it('honours an aim that already sits in a free gap', () => {
    expect(call({ aimMin: 720 })).toBe(720);
  });

  it('slides forward past a busy block to the first gap that fits', () => {
    // aim 10:30 (630) lands inside a 10:00–11:30 lecture; 1h30 fits from 11:30.
    expect(call({ aimMin: 630, durationMin: 90, blocks: [busy(600, 690)] })).toBe(690);
  });

  it('slides backward when the earlier gap is nearer than the later one', () => {
    // gap A 09:00–10:00, lecture 10:00–15:00, gap B 15:00–18:00. Aim 09:50.
    expect(call({ aimMin: 590, durationMin: 60, blocks: [busy(600, 900)] })).toBe(540);
  });

  it('clamps to the end of a gap rather than overflowing it', () => {
    // gap 09:00–11:00, aim 10:45, duration 60 → latest legal start is 10:00.
    expect(call({ aimMin: 645, durationMin: 60, blocks: [busy(660, 900)] })).toBe(600);
  });

  it('skips a gap too small and uses the next one that fits', () => {
    // gaps: 09:00–09:30 (too small), 11:00–18:00.
    expect(call({ aimMin: 540, durationMin: 60, blocks: [busy(570, 660)] })).toBe(660);
  });

  it('returns null when nothing fits anywhere in the day', () => {
    expect(call({ durationMin: 600, blocks: [busy(600, 660)] })).toBeNull();
  });

  // Was "returns null for a day that is off", which asserted the FENCE: the
  // day was Saturday, this function looked its window up and found none, and
  // refused. It cannot look anything up now, so the case is stated the way it
  // actually reaches here — a caller that decided there is no region. Only the
  // two replan paths still produce that, by passing `windowForDate` for a day
  // the user switched off; every manual placement passes `WHOLE_DAY` and the
  // block on a Saturday lands (see the WHOLE_DAY describe below).
  it('returns null when the caller supplies no region', () => {
    expect(call({ span: null })).toBeNull();
  });

  it('returns null for a non-positive or non-finite duration', () => {
    expect(call({ durationMin: 0 })).toBeNull();
    expect(call({ durationMin: -30 })).toBeNull();
    expect(call({ durationMin: Number.NaN })).toBeNull();
  });

  it('rounds the aim to the 5-minute grid before searching', () => {
    expect(call({ aimMin: 722 })).toBe(720);
    expect(call({ aimMin: 723 })).toBe(725);
  });

  it('lets a clamp to a gap edge win over the 5-minute grid', () => {
    // lecture ends 10:47; aim 10:00; the gap before it is too small for 60m.
    expect(call({ aimMin: 600, durationMin: 60, blocks: [busy(540, 647)] })).toBe(647);
  });

  it('will not schedule into hours that have already passed today', () => {
    expect(call({ aimMin: 540, now: { date: WED, minute: 700 } })).toBe(700);
  });

  it('breaks an exact tie toward the earlier start', () => {
    // Gaps 09:00–10:00 and 11:40–18:00. The first is exactly 60m long so its
    // only legal start is 09:00; the second's earliest is 11:40. An aim of
    // 10:20 sits 80m from each, so the earlier gap must win.
    expect(call({ aimMin: 620, durationMin: 60, blocks: [busy(600, 700)] })).toBe(540);
  });

  it('treats already-placed work as occupied', () => {
    expect(call({ aimMin: 540, placed: [{ startMin: 540, endMin: 600 }] })).toBe(600);
  });
});

/*
 * Job 1: availability is not a fence.
 *
 * These are the tests that would have failed before the change, and they are
 * deliberately phrased against `WHOLE_DAY` rather than against "no windows" —
 * the point is not that the windows are empty, it is that the placement path
 * cannot see them at all.
 */
describe('WHOLE_DAY — the region a manual placement searches', () => {
  it('accepts an aim outside any working window', () => {
    // 21:00 on a day whose window is 09:00–18:00. Under the fence this slid
    // back to 17:00; it now lands where it was aimed.
    expect(resolveSlot({
      date: WED, aimMin: 1260, durationMin: 60,
      span: WHOLE_DAY, blocks: [], placed: [], now: EARLY, allDayBlocks: true,
    })).toBe(1260);
  });

  it('accepts a placement on a day that has no window at all', () => {
    // Saturday, with WINDOWS covering only Wednesday. This used to be the
    // "day off" refusal — `resolveSlot` returned null and the store toasted.
    expect(resolveSlot({
      date: '2026-07-18', aimMin: 600, durationMin: 90,
      span: WHOLE_DAY, blocks: [], placed: [], now: EARLY, allDayBlocks: true,
    })).toBe(600);
  });

  it('still slides off work already placed — collision handling is untouched', () => {
    // Aimed at 21:00, which is taken. The nearest gap edge wins and the two
    // candidates (20:00 and 22:00) are exactly 60 minutes from the aim, so the
    // earlier one takes it — the documented tie-break, unchanged.
    expect(resolveSlot({
      date: WED, aimMin: 1260, durationMin: 60,
      span: WHOLE_DAY, blocks: [], placed: [{ startMin: 1260, endMin: 1320 }],
      now: EARLY, allDayBlocks: true,
    })).toBe(1200);
    // Block the earlier side too and it has to take the later gap.
    expect(resolveSlot({
      date: WED, aimMin: 1260, durationMin: 60,
      span: WHOLE_DAY, blocks: [],
      placed: [{ startMin: 1200, endMin: 1320 }],
      now: EARLY, allDayBlocks: true,
    })).toBe(1320);
  });

  it('still refuses when the whole day is booked solid', () => {
    // The only refusal left: 24 hours with no 60-minute gap anywhere in them.
    expect(resolveSlot({
      date: WED, aimMin: 600, durationMin: 60,
      span: WHOLE_DAY, blocks: [], placed: [{ startMin: 0, endMin: 1440 }],
      now: EARLY, allDayBlocks: true,
    })).toBeNull();
  });

  it('lands in the past when aimed there, so a person can record what happened', () => {
    const now: Now = { date: WED, minute: 700 };
    expect(resolveSlot({
      date: WED, aimMin: 540, durationMin: 60,
      // NO_PAST_LIMIT is what the store passes for every manual placement; the
      // wall clock is kept only by `todayPlan` and `proposeReplan`.
      span: WHOLE_DAY, blocks: [], placed: [], now: EARLY, allDayBlocks: true,
    })).toBe(540);
    // And with the real clock it is still clamped — the two are separate
    // decisions and this pins that they have not been flattened together.
    expect(resolveSlot({
      date: WED, aimMin: 540, durationMin: 60,
      span: WHOLE_DAY, blocks: [], placed: [], now, allDayBlocks: true,
    })).toBe(700);
  });
});

describe('aimFor', () => {
  it('points at the start of the ordinary day', () => {
    expect(aimFor(WED, EARLY)).toBe(ORDINARY_DAY.startMin);
  });

  it('points at the same hour on a Saturday', () => {
    // There are no days off any more, so there is no day this answers
    // differently about. Nothing refuses the placement either; the only
    // question left is which hour a verb naming a DAY should point at.
    expect(aimFor('2026-07-18', EARLY)).toBe(ORDINARY_DAY.startMin);
  });

  it('clamps forward to the clock on today', () => {
    // "Put this on today" said at 3pm cannot mean 8am — the aim is the only
    // thing left carrying that intent now that the search is unfenced.
    expect(aimFor(WED, { date: WED, minute: 900 })).toBe(900);
  });

  it('does not clamp a later day to today\'s clock', () => {
    expect(aimFor('2026-07-22', { date: WED, minute: 900 })).toBe(ORDINARY_DAY.startMin);
  });
});

/*
 * ORDINARY_DAY is an AIM and not a fence, and these two tests are the whole
 * distinction: the app searching on your behalf stays inside the ordinary day,
 * and a person aiming at 2am gets 2am.
 */
describe('ORDINARY_DAY as an aim', () => {
  it('keeps an automatic placement out of the small hours', () => {
    expect(resolveSlot({
      date: '2026-07-22',
      aimMin: aimFor('2026-07-22', { date: WED, minute: 900 }),
      durationMin: 60,
      span: ORDINARY_DAY,
      blocks: [],
      placed: [],
      now: NO_PAST_LIMIT,
      allDayBlocks: false,
    })).toBe(ORDINARY_DAY.startMin);
  });

  it('lets a manual placement land at 2am', () => {
    expect(resolveSlot({
      date: '2026-07-22',
      aimMin: 2 * 60,
      durationMin: 60,
      span: WHOLE_DAY,
      blocks: [],
      placed: [],
      now: NO_PAST_LIMIT,
      allDayBlocks: false,
    })).toBe(2 * 60);
  });
});

describe('longestFreeGap', () => {
  it('measures the widest unbooked RUN, never the sum of the gaps', () => {
    const gap = longestFreeGap(
      '2026-07-22',
      ORDINARY_DAY,
      [],
      [{ startMin: 9 * 60, endMin: 10 * 60 }, { startMin: 11 * 60, endMin: 12 * 60 }],
      NO_PAST_LIMIT,
      false,
    );
    // 8-9, 10-11 and 12-20 are free. The sum is 10h; the widest run is 8h, and
    // only the second is a sitting anyone could actually take.
    expect(gap).toBe(8 * 60);
  });

  it('is 0 on a day booked solid across the span', () => {
    expect(longestFreeGap(
      '2026-07-22', ORDINARY_DAY, [], [{ startMin: 0, endMin: 1440 }], NO_PAST_LIMIT, false,
    )).toBe(0);
  });

  it('spans the whole day when asked to', () => {
    expect(longestFreeGap(
      '2026-07-22', WHOLE_DAY, [], [], NO_PAST_LIMIT, false,
    )).toBe(1440);
  });
});
