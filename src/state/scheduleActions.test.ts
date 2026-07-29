import { describe, it, expect } from 'vitest';
import type { AvailabilityWindow, GoalNode } from '../db/types';
import { weekOf } from '../lib/plan';
import { clampResize, setPlannedSlot, clearPlannedSlot } from './scheduleActions';

const WED = '2026-07-15';
const WINDOWS: AvailabilityWindow[] = [{ dow: 2, startMin: 540, endMin: 1080 }];

describe('the plannedWeek invariant', () => {
  // plannedWeek is redundant with plannedDay and kept only to avoid a 31-site
  // refactor (see the spec). This is the test that keeps the two from drifting.
  it('setPlannedSlot always writes plannedWeek as the Monday of plannedDay', () => {
    const cases = [
      { day: '2026-07-13', week: '2026-07-13' }, // a Monday
      { day: '2026-07-15', week: '2026-07-13' }, // midweek
      { day: '2026-07-19', week: '2026-07-13' }, // a Sunday
      { day: '2026-07-20', week: '2026-07-20' }, // the next Monday
    ];
    for (const { day, week } of cases) {
      const node: GoalNode = { id: 'n1', title: 'x' };
      setPlannedSlot(node, day, 600);
      expect(node.plannedWeek).toBe(week);
      expect(node.plannedDay).toBe(day);
      expect(node.plannedStartMin).toBe(600);
      expect(node.plannedWeek).toBe(weekOf(node.plannedDay!));
    }
  });

  it('clearPlannedSlot removes all three fields together', () => {
    const node: GoalNode = { id: 'n1', title: 'x' };
    setPlannedSlot(node, '2026-07-15', 600);
    clearPlannedSlot(node);
    expect('plannedWeek' in node).toBe(false);
    expect('plannedDay' in node).toBe(false);
    expect('plannedStartMin' in node).toBe(false);
  });
});

describe('clampResize', () => {
  it('allows a resize that stays inside the free gap', () => {
    expect(clampResize({
      date: WED, startMin: 540, requestedMin: 120,
      windows: WINDOWS, blocks: [], placed: [], allDayBlocks: true,
    })).toBe(120);
  });

  it('clamps a resize that would run into the next block', () => {
    expect(clampResize({
      date: WED, startMin: 540, requestedMin: 300,
      windows: WINDOWS, blocks: [], placed: [{ startMin: 660, endMin: 720 }], allDayBlocks: true,
    })).toBe(120); // 09:00 → 11:00
  });

  it('clamps a resize that would run past the end of the window', () => {
    expect(clampResize({
      date: WED, startMin: 1020, requestedMin: 300,
      windows: WINDOWS, blocks: [], placed: [], allDayBlocks: true,
    })).toBe(60); // 17:00 → 18:00
  });

  it('refuses a non-positive request', () => {
    expect(clampResize({
      date: WED, startMin: 540, requestedMin: 0,
      windows: WINDOWS, blocks: [], placed: [], allDayBlocks: true,
    })).toBeNull();
  });

  it('refuses when the block no longer sits in any free gap', () => {
    expect(clampResize({
      date: WED, startMin: 300, requestedMin: 60,
      windows: WINDOWS, blocks: [], placed: [], allDayBlocks: true,
    })).toBeNull(); // 05:00 is outside the 09:00–18:00 window
  });

  // The cap must win even when it undercuts the 5-minute floor: a gap that
  // small is still real free time, and returning the floor instead would hand
  // back a duration that overlaps the next block by 2 minutes.
  it('caps below the 5-minute floor when fewer than 5 minutes remain in the gap', () => {
    expect(clampResize({
      date: WED, startMin: 540, requestedMin: 60,
      windows: WINDOWS, blocks: [], placed: [{ startMin: 543, endMin: 1080 }], allDayBlocks: true,
    })).toBe(3); // only 09:00–09:03 is free before the next block
  });
});
