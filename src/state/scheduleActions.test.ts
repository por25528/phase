import { describe, it, expect } from 'vitest';
import type { AvailabilityWindow, GoalNode } from '../db/types';
import { weekOf } from '../lib/plan';
import { addPlannedSlot, clampResize, setPlannedSlot, clearPlannedSlot } from './scheduleActions';

const WED = '2026-07-15';
const WINDOWS: AvailabilityWindow[] = [{ dow: 2, startMin: 540, endMin: 1080 }];

describe('the plannedWeek invariant', () => {
  /*
   * The week COMMITMENT and the sitting are two facts, and placing work on a
   * Wednesday commits to that Wednesday's week. Routing every write through
   * `setPlannedSlot` is what stops them drifting.
   */
  it('setPlannedSlot always writes plannedWeek as the Monday of the sitting', () => {
    const cases = [
      { day: '2026-07-13', week: '2026-07-13' }, // a Monday
      { day: '2026-07-15', week: '2026-07-13' }, // midweek
      { day: '2026-07-19', week: '2026-07-13' }, // a Sunday
      { day: '2026-07-20', week: '2026-07-20' }, // the next Monday
    ];
    for (const { day, week } of cases) {
      const node: GoalNode = { id: 'n1', title: 'x' };
      setPlannedSlot(node, day, 600, 60);
      expect(node.plannedWeek).toBe(week);
      expect(node.blocks).toEqual([expect.objectContaining({ date: day, startMin: 600, minutes: 60 })]);
      expect(node.plannedWeek).toBe(weekOf(node.blocks![0].date));
    }
  });

  /**
   * A leaf can hold several sittings now, so "put it here" has to mean exactly
   * that. Leaving Tuesday's block behind when the user drops the task on
   * Thursday would silently double the work it has booked.
   */
  it('setPlannedSlot replaces every sitting, rather than adding one', () => {
    const node: GoalNode = { id: 'n1', title: 'x' };
    setPlannedSlot(node, '2026-07-15', 600, 60);
    setPlannedSlot(node, '2026-07-16', 540, 90);
    expect(node.blocks).toHaveLength(1);
    expect(node.blocks![0]).toMatchObject({ date: '2026-07-16', startMin: 540, minutes: 90 });
  });

  it('addPlannedSlot leaves the existing sittings where they are', () => {
    const node: GoalNode = { id: 'n1', title: 'x' };
    setPlannedSlot(node, '2026-07-15', 600, 60);
    addPlannedSlot(node, '2026-07-16', 540, 90);
    expect(node.blocks?.map((b) => b.date)).toEqual(['2026-07-15', '2026-07-16']);
  });

  /**
   * Both, because "unschedule" means the work is not happening. Leaving the
   * week behind would drop the leaf into the rail's "to place" bucket, which
   * reads as a commitment the user has just withdrawn.
   */
  it('clearPlannedSlot removes the week commitment and every sitting', () => {
    const node: GoalNode = { id: 'n1', title: 'x' };
    setPlannedSlot(node, '2026-07-15', 600, 60);
    addPlannedSlot(node, '2026-07-16', 540, 60);
    clearPlannedSlot(node);
    expect('plannedWeek' in node).toBe(false);
    expect('blocks' in node).toBe(false);
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

  // Pins the end-EXCLUSIVE gap-containment check: `find`'s predicate is
  // `startMin >= g.startMin && startMin < g.endMin`. Without the strict `<`,
  // a block whose startMin lands EXACTLY on a gap's endMin — i.e. right where
  // the next busy block begins, not actually inside that earlier gap at all —
  // would wrongly match the earlier gap and be allowed to "resize" from a
  // position it doesn't actually occupy freely. A block occupies 10:00–11:00,
  // so the gaps are 09:00–10:00 and 11:00–18:00; startMin=600 (10:00) is
  // exactly the first gap's endMin, and must NOT match it.
  it('does not treat a block sitting at a gap\'s end as inside that (earlier) gap', () => {
    expect(clampResize({
      date: WED, startMin: 600, requestedMin: 60,
      windows: WINDOWS, blocks: [], placed: [{ startMin: 600, endMin: 660 }], allDayBlocks: true,
    })).toBeNull(); // 10:00 is exactly where the 09:00–10:00 gap ends — not inside it
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
