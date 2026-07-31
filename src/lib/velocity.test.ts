import { describe, it, expect } from 'vitest';
import {
  projectVelocity, describeVelocity,
  VELOCITY_WINDOW_DAYS, MIN_VELOCITY_SAMPLES,
} from './velocity';
import type { Goal, GoalNode } from '../db/types';

const TODAY = '2026-07-31';
/** Inside the trailing window. */
const RECENT = '2026-07-25';
/** Outside it — 14 days back from TODAY is 2026-07-17. */
const OLD = '2026-06-01';

const goal = (nodes: GoalNode[]): Goal => ({ id: 'g', title: 'Open-ended', nodes });

const doneLeaf = (id: string, doneAt?: string, estimateMin?: number): GoalNode => ({
  id, title: id, done: true, ...(doneAt ? { doneAt } : {}), ...(estimateMin ? { estimateMin } : {}),
});
const openLeaf = (id: string, estimateMin?: number): GoalNode => ({
  id, title: id, done: false, ...(estimateMin ? { estimateMin } : {}),
});

describe('projectVelocity', () => {
  it('counts completions inside the window and open leaves', () => {
    const v = projectVelocity(
      goal([doneLeaf('a', RECENT), doneLeaf('b', RECENT), openLeaf('c'), openLeaf('d')]),
      TODAY,
    );
    expect(v).toMatchObject({ completed: 2, open: 2, windowDays: VELOCITY_WINDOW_DAYS });
  });

  it('excludes completions older than the window', () => {
    const v = projectVelocity(goal([doneLeaf('a', OLD), openLeaf('b')]), TODAY);
    expect(v.completed).toBe(0);
  });

  it('excludes a completion with no doneAt, rather than guessing when it happened', () => {
    // Legacy and imported data. Biasing the rate DOWN is the safe direction:
    // it withholds a forecast instead of inventing an optimistic one.
    const v = projectVelocity(goal([doneLeaf('a'), openLeaf('b')]), TODAY);
    expect(v.completed).toBe(0);
  });

  it('ignores a doneAt in the future', () => {
    const v = projectVelocity(goal([doneLeaf('a', '2026-12-01'), openLeaf('b')]), TODAY);
    expect(v.completed).toBe(0);
  });

  it('walks nested containers', () => {
    const v = projectVelocity(
      goal([{ id: 'c', title: 'c', children: [doneLeaf('a', RECENT), openLeaf('b')] }]),
      TODAY,
    );
    expect(v).toMatchObject({ completed: 1, open: 1 });
  });

  it('sums remaining effort only when every open leaf is estimated', () => {
    const all = projectVelocity(goal([openLeaf('a', 60), openLeaf('b', 30)]), TODAY);
    expect(all.remainingMin).toBe(90);

    // All-or-nothing, exactly as the weighted roll-up does: a partial sum
    // reads as a total and understates the work left.
    const partial = projectVelocity(goal([openLeaf('a', 60), openLeaf('b')]), TODAY);
    expect(partial.remainingMin).toBeUndefined();
  });

  it('counts only OPEN leaves toward remaining effort', () => {
    const v = projectVelocity(goal([doneLeaf('a', RECENT, 999), openLeaf('b', 30)]), TODAY);
    expect(v.remainingMin).toBe(30);
  });

  it('offers no forecast below the sample floor', () => {
    const nodes = Array.from({ length: MIN_VELOCITY_SAMPLES - 1 }, (_, i) => doneLeaf(`d${i}`, RECENT));
    const v = projectVelocity(goal([...nodes, openLeaf('o')]), TODAY);
    expect(v.completed).toBe(MIN_VELOCITY_SAMPLES - 1);
    expect(v.weeksLeft).toBeUndefined();
  });

  it('forecasts once there is enough history', () => {
    // 6 completed in 14 days = 3/week; 6 open → 2 weeks.
    const done = Array.from({ length: 6 }, (_, i) => doneLeaf(`d${i}`, RECENT));
    const open = Array.from({ length: 6 }, (_, i) => openLeaf(`o${i}`));
    expect(projectVelocity(goal([...done, ...open]), TODAY).weeksLeft).toBeCloseTo(2, 5);
  });

  it('offers no forecast and no remaining effort when nothing is open', () => {
    const done = Array.from({ length: 6 }, (_, i) => doneLeaf(`d${i}`, RECENT));
    const v = projectVelocity(goal(done), TODAY);
    expect(v.open).toBe(0);
    expect(v.weeksLeft).toBeUndefined();
    expect(v.remainingMin).toBeUndefined();
  });

  it('handles a project with no steps', () => {
    expect(projectVelocity(goal([]), TODAY)).toEqual({
      completed: 0, open: 0, windowDays: VELOCITY_WINDOW_DAYS,
    });
  });
});

describe('describeVelocity', () => {
  it('says nothing when there is no open work — the caller has better words', () => {
    expect(describeVelocity({ completed: 4, windowDays: 14, open: 0 })).toBeNull();
  });

  /*
   * A stall is the most useful thing an open-ended project can report, and it
   * is exactly what a deadline-based pace line cannot see.
   */
  it('calls out a stall', () => {
    expect(describeVelocity({ completed: 0, windowDays: 14, open: 8 })).toBe(
      'nothing finished in 14 days · 8 steps open',
    );
  });

  it('singularises one open step', () => {
    expect(describeVelocity({ completed: 0, windowDays: 14, open: 1 })).toBe(
      'nothing finished in 14 days · 1 step open',
    );
  });

  it('reports the rate and what is left', () => {
    expect(describeVelocity({ completed: 3, windowDays: 14, open: 8 })).toBe(
      '3 done in 14 days · 8 left',
    );
  });

  it('adds remaining effort when every open step is estimated', () => {
    expect(describeVelocity({ completed: 3, windowDays: 14, open: 8, remainingMin: 330 })).toBe(
      '3 done in 14 days · 8 left · ~5.5h of work',
    );
  });

  it('uses minutes for under an hour of remaining work', () => {
    expect(describeVelocity({ completed: 3, windowDays: 14, open: 1, remainingMin: 45 })).toBe(
      '3 done in 14 days · 1 left · ~45m of work',
    );
  });

  it('drops the decimal on large remaining totals', () => {
    expect(describeVelocity({ completed: 3, windowDays: 14, open: 9, remainingMin: 1200 })).toBe(
      '3 done in 14 days · 9 left · ~20h of work',
    );
  });

  it('adds a runway when a forecast exists', () => {
    expect(describeVelocity({ completed: 6, windowDays: 14, open: 6, weeksLeft: 2 })).toBe(
      '6 done in 14 days · 6 left · ~2 weeks at this rate',
    );
  });

  it('rounds a sub-week runway to words rather than a fraction', () => {
    expect(describeVelocity({ completed: 6, windowDays: 14, open: 2, weeksLeft: 0.67 })).toBe(
      '6 done in 14 days · 2 left · about a week at this rate',
    );
  });

  // Never claims a finish date: a trailing average over a handful of steps
  // cannot support one, and printing it would be invented authority.
  it('never names a date', () => {
    const text = describeVelocity({
      completed: 6, windowDays: 14, open: 6, remainingMin: 600, weeksLeft: 2,
    })!;
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
