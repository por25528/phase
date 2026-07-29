import { describe, it, expect } from 'vitest';
import type { AvailabilityWindow, BusyBlock } from '../db/types';
import { durationOf, freeIntervals, DEFAULT_SLOT_MIN } from './slot';
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
