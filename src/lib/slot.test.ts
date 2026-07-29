import { describe, it, expect } from 'vitest';
import type { AvailabilityWindow, BusyBlock } from '../db/types';
import { durationOf, freeIntervals, resolveSlot, DEFAULT_SLOT_MIN } from './slot';
import type { Now } from './capacity';

// 2026-07-15 is a Wednesday → dow 2.
const WED = '2026-07-15';
const WINDOWS: AvailabilityWindow[] = [{ dow: 2, startMin: 540, endMin: 1080 }]; // 09:00–18:00
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
    expect(freeIntervals(WED, WINDOWS, [], [], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 1080 }]);
  });

  it('returns nothing for a day with no availability window', () => {
    expect(freeIntervals('2026-07-18', WINDOWS, [], [], EARLY, true)).toEqual([]); // Saturday
  });

  it('splits the window around a busy block', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(600, 690)], [], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 600 }, { startMin: 690, endMin: 1080 }]);
  });

  it('subtracts already-placed work as well as calendar events', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(600, 690)], [{ startMin: 690, endMin: 780 }], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 600 }, { startMin: 780, endMin: 1080 }]);
  });

  it('merges overlapping busy blocks instead of double-subtracting', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(600, 700), busy(650, 720)], [], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 600 }, { startMin: 720, endMin: 1080 }]);
  });

  it('clips busy blocks that overhang the window', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(480, 600), busy(1020, 1200)], [], EARLY, true))
      .toEqual([{ startMin: 600, endMin: 1020 }]);
  });

  it('returns nothing when an all-day event consumes the day and the pref is on', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(0, 1440, true)], [], EARLY, true)).toEqual([]);
  });

  it('ignores an all-day event when the pref is off', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(0, 1440, true)], [], EARLY, false))
      .toEqual([{ startMin: 540, endMin: 1080 }]);
  });

  it('starts today at the current minute — the past is not capacity', () => {
    const now: Now = { date: WED, minute: 700 };
    expect(freeIntervals(WED, WINDOWS, [], [], now, true))
      .toEqual([{ startMin: 700, endMin: 1080 }]);
  });

  it('returns nothing for a day already past', () => {
    const now: Now = { date: '2026-07-16', minute: 0 };
    expect(freeIntervals(WED, WINDOWS, [], [], now, true)).toEqual([]);
  });

  it('returns nothing once today’s window has closed', () => {
    const now: Now = { date: WED, minute: 1100 };
    expect(freeIntervals(WED, WINDOWS, [], [], now, true)).toEqual([]);
  });

  it('ignores busy blocks belonging to other days', () => {
    const other: BusyBlock = { date: '2026-07-16', startMin: 600, endMin: 690, title: 'x', allDay: false };
    expect(freeIntervals(WED, WINDOWS, [other], [], EARLY, true))
      .toEqual([{ startMin: 540, endMin: 1080 }]);
  });

  it('drops a gap that closes to zero width', () => {
    expect(freeIntervals(WED, WINDOWS, [busy(540, 700), busy(700, 1080)], [], EARLY, true))
      .toEqual([]);
  });
});

describe('resolveSlot', () => {
  function call(over: Partial<Parameters<typeof resolveSlot>[0]> = {}) {
    return resolveSlot({
      date: WED, aimMin: 540, durationMin: 60,
      windows: WINDOWS, blocks: [], placed: [], now: EARLY, allDayBlocks: true,
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

  it('returns null for a day that is off', () => {
    expect(call({ date: '2026-07-18' })).toBeNull(); // Saturday
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
