import { describe, expect, it } from 'vitest';
import type { Goal, GoalNode } from '../db/types';
import { describeEffort, fmtMinutes, goalEffort } from './effort';

const goal = (nodes: GoalNode[]): Goal => ({ id: 'g', title: 'G', nodes });
const leaf = (id: string, over: Partial<GoalNode> = {}): GoalNode => ({ id, title: id, ...over });

describe('goalEffort', () => {
  it('adds up the estimates on open leaves only', () => {
    const e = goalEffort(goal([
      leaf('a', { estimateMin: 60 }),
      leaf('b', { estimateMin: 30, status: 'done' }),
      leaf('c', { estimateMin: 45, status: 'doing' }),
      leaf('d', { estimateMin: 15, status: 'blocked' }),
    ]));

    // 'doing' and 'blocked' are open work — they are still ahead of you.
    expect(e.remainingMin).toBe(120);
    expect(e).toMatchObject({ unestimated: 0, total: 4, done: 1 });
  });

  it('descends containers and counts only the leaves', () => {
    const e = goalEffort(goal([
      { id: 'area', title: 'Mechanics', children: [
        leaf('a', { estimateMin: 60 }),
        leaf('b', { estimateMin: 30 }),
      ] },
      leaf('c', { estimateMin: 10 }),
    ]));

    expect(e).toMatchObject({ remainingMin: 100, total: 3, done: 0 });
  });

  it('counts an unestimated open leaf separately instead of guessing at it', () => {
    const e = goalEffort(goal([
      leaf('a', { estimateMin: 60 }),
      leaf('b'),
      leaf('c'),
    ]));

    expect(e).toMatchObject({ remainingMin: 60, unestimated: 2 });
  });

  /**
   * A checkpoint is a dated marker, not work. Counting it as unestimated made
   * every goal with an exam on it claim a task somebody had forgotten to
   * estimate, on the one node where an estimate is meaningless.
   */
  it('leaves a checkpoint out of the effort figures but keeps it in the count', () => {
    const e = goalEffort(goal([
      leaf('a', { estimateMin: 60 }),
      leaf('exam', { checkpoint: true, deadline: '2026-08-24' }),
    ]));

    expect(e).toMatchObject({ remainingMin: 60, unestimated: 0, total: 2, done: 0 });
  });

  it('reports an empty goal as empty rather than as finished', () => {
    expect(goalEffort(goal([]))).toEqual({ remainingMin: 0, unestimated: 0, total: 0, done: 0 });
  });
});

describe('fmtMinutes', () => {
  it.each([
    [0, '0m'],
    [45, '45m'],
    [60, '1h'],
    [750, '12h 30m'],
    [-5, '0m'],
  ])('formats %i as %s', (min, expected) => {
    expect(fmtMinutes(min)).toBe(expected);
  });
});

describe('describeEffort', () => {
  it('leads with the remaining effort, then the count', () => {
    expect(describeEffort({ remainingMin: 750, unestimated: 0, total: 14, done: 8 }))
      .toBe('12h 30m remaining · 8 of 14 tasks');
  });

  /**
   * The qualifier is not decoration. `remainingMin` is a FLOOR while anything
   * is unestimated, and a figure that will only grow must say so where it is
   * read, or it is quietly a lie.
   */
  it('says how much of the figure is missing', () => {
    expect(describeEffort({ remainingMin: 120, unestimated: 6, total: 14, done: 2 }))
      .toBe('2h remaining · 2 of 14 tasks · 6 unestimated');
  });

  it('says a finished goal is finished rather than reporting 0m left', () => {
    expect(describeEffort({ remainingMin: 0, unestimated: 0, total: 3, done: 3 }))
      .toBe('every task done · 3 of 3 tasks');
  });

  it('has nothing to say about a goal with no tasks', () => {
    expect(describeEffort({ remainingMin: 0, unestimated: 0, total: 0, done: 0 })).toBeNull();
  });

  /**
   * The zero this suppresses was on screen: a freshly seeded goal read
   * `0m left · 2/6 · 4 unestimated`, which claims "no work remaining" and
   * "four tasks nobody has sized" in the same breath. The first half is not a
   * small measurement, it is the absence of one, so it is not printed at all.
   */
  it('omits the minutes entirely when nothing has been estimated', () => {
    expect(describeEffort({ remainingMin: 0, unestimated: 4, total: 6, done: 2 }))
      .toBe('2 of 6 tasks · 4 unestimated');
  });

  it('still states the count when nothing is estimated and nothing is flagged', () => {
    expect(describeEffort({ remainingMin: 0, unestimated: 0, total: 6, done: 2 }))
      .toBe('2 of 6 tasks');
  });

  it('never emits a bare zero duration for an unfinished goal', () => {
    for (const unestimated of [0, 4]) {
      expect(describeEffort({ remainingMin: 0, unestimated, total: 6, done: 2 }))
        .not.toMatch(/\b0m\b/);
    }
  });
});
