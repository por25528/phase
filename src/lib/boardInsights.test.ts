import { describe, it, expect } from 'vitest';
import { computeBoardInsights } from './boardInsights';
import { addDays } from './dates';
import type { Goal, GoalNode } from '../db/types';

function g(p: Partial<Goal> & { id: string }): Goal {
  return {
    id: p.id,
    title: p.title ?? p.id,
    start: p.start ?? '2026-01-01',
    deadline: p.deadline ?? '2026-12-31',
    nodes: p.nodes ?? [],
    ...(p.column === undefined ? {} : { column: p.column }),
  };
}
const done = (id = 'n'): GoalNode => ({ id, title: id, done: true });
const todo = (id = 'n'): GoalNode => ({ id, title: id, done: false });

const TODAY = '2026-07-13';

describe('computeBoardInsights', () => {
  it('empty board → all zero/null', () => {
    const r = computeBoardInsights([], TODAY, 4);
    expect(r).toEqual({
      total: 0,
      perColumn: [0, 0, 0, 0],
      dueSoonCount: 0,
      nearestDeadline: null,
      behindPaceCount: 0,
    });
  });

  describe('per-column bucketing', () => {
    it('buckets by column; absent ⇒ 0; out-of-range clamped to ends', () => {
      const goals = [
        g({ id: 'a', column: 0 }),
        g({ id: 'b', column: 0 }),
        g({ id: 'c', column: 1 }),
        g({ id: 'd' }), // column absent ⇒ 0
        g({ id: 'e', column: 3 }),
        g({ id: 'f', column: 9 }), // over-range ⇒ clamp to last (3)
        g({ id: 'h', column: -2 }), // negative ⇒ clamp to 0
      ];
      const r = computeBoardInsights(goals, TODAY, 4);
      expect(r.total).toBe(7);
      expect(r.perColumn).toEqual([4, 1, 0, 2]); // col0: a,b,d,h · col1: c · col3: e,f
    });

    it('perColumn always has length = columnCount', () => {
      expect(computeBoardInsights([g({ id: 'a' })], TODAY, 3).perColumn).toHaveLength(3);
      expect(computeBoardInsights([], TODAY, 5).perColumn).toEqual([0, 0, 0, 0, 0]);
    });
  });

  describe('due soon', () => {
    it('today (diff 0) and +14 count; +15 and past-due do not', () => {
      const goals = [
        g({ id: 'today', deadline: TODAY }),
        g({ id: 'plus14', deadline: addDays(TODAY, 14) }),
        g({ id: 'plus15', deadline: addDays(TODAY, 15) }),
        g({ id: 'past', deadline: addDays(TODAY, -1) }),
      ];
      expect(computeBoardInsights(goals, TODAY, 4).dueSoonCount).toBe(2);
    });

    it('respects a custom dueSoonDays window', () => {
      const goals = [g({ id: 'x', deadline: addDays(TODAY, 7) })];
      expect(computeBoardInsights(goals, TODAY, 4, 5).dueSoonCount).toBe(0);
      expect(computeBoardInsights(goals, TODAY, 4, 10).dueSoonCount).toBe(1);
    });
  });

  describe('nearest deadline', () => {
    it('is the soonest upcoming (today-or-later) deadline, ignoring past-due', () => {
      const goals = [
        g({ id: 'a', deadline: addDays(TODAY, 20) }),
        g({ id: 'b', deadline: addDays(TODAY, 5) }),
        g({ id: 'c', deadline: addDays(TODAY, -3) }),
      ];
      expect(computeBoardInsights(goals, TODAY, 4).nearestDeadline).toBe(addDays(TODAY, 5));
    });

    it('counts today as upcoming', () => {
      expect(computeBoardInsights([g({ id: 'a', deadline: TODAY })], TODAY, 4).nearestDeadline).toBe(TODAY);
    });

    it('is null when every deadline is past-due', () => {
      const goals = [g({ id: 'a', deadline: addDays(TODAY, -1) }), g({ id: 'b', deadline: addDays(TODAY, -30) })];
      expect(computeBoardInsights(goals, TODAY, 4).nearestDeadline).toBeNull();
    });
  });

  describe('behind pace (mirrors BoardCard exactly)', () => {
    it('rounds before the >=10 test: 9.6% expected counts, 9.4% does not', () => {
      const start = '2026-01-01';
      const deadline = addDays(start, 1000);
      const at96 = addDays(start, 96); // 0% actual, expected 9.6 → round 10 → counts
      const at94 = addDays(start, 94); // 0% actual, expected 9.4 → round 9  → excluded
      expect(computeBoardInsights([g({ id: 'a', start, deadline })], at96, 4).behindPaceCount).toBe(1);
      expect(computeBoardInsights([g({ id: 'a', start, deadline })], at94, 4).behindPaceCount).toBe(0);
    });

    it('counts a mid-progress goal that is behind (goalPct + behindPaceBy path)', () => {
      const start = '2026-01-01';
      const deadline = addDays(start, 100);
      const today = addDays(start, 40); // expected 40%
      const goal = g({ id: 'm', start, deadline, nodes: [done('1'), todo('2'), todo('3'), todo('4')] }); // 25%
      // behind = round(40 - round(25)) = 15 ≥ 10 → counts
      expect(computeBoardInsights([goal], today, 4).behindPaceCount).toBe(1);
    });

    it('does not count a goal that is on/ahead of pace', () => {
      const start = '2026-01-01';
      const deadline = addDays(start, 100);
      const today = addDays(start, 40);
      const goal = g({ id: 'ok', start, deadline, nodes: [done('1'), done('2'), done('3'), done('4')] }); // 100%
      expect(computeBoardInsights([goal], today, 4).behindPaceCount).toBe(0);
    });
  });
});
