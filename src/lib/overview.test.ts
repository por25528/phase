import { describe, expect, it } from 'vitest';
import type { Goal, GoalNode } from '../db/types';
import { firstOpenLeaf } from './tree';
import { weekOf } from './plan';
import {
  OVERVIEW_NEXT_MAX,
  OVERVIEW_UPCOMING_MAX,
  goalWeekLoad,
  goalOverview,
  overviewIsEmpty,
} from './overview';

const leaf = (id: string, over: Partial<GoalNode> = {}): GoalNode => ({
  id,
  title: id,
  ...over,
});

const goal = (nodes: GoalNode[]): Goal => ({ id: 'g', title: 'Goal', nodes });

const TODAY = '2026-08-09';

describe('goalOverview — next', () => {
  it('agrees with firstOpenLeaf about what is next', () => {
    // The goal header and the Overview tab are on screen together. If these two
    // ever disagreed, the page would name two different "next" tasks at once.
    const g = goal([
      leaf('a'),
      leaf('b', { status: 'doing' }),
      leaf('c'),
    ]);
    expect(goalOverview(g, TODAY).next[0].id).toBe(firstOpenLeaf(g.nodes)?.id);
  });

  it('puts started work ahead of untouched work, across the whole tree', () => {
    const g = goal([
      { id: 'p1', title: 'p1', children: [leaf('a'), leaf('b')] },
      { id: 'p2', title: 'p2', children: [leaf('c', { status: 'doing' })] },
    ]);
    expect(goalOverview(g, TODAY).next.map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });

  it('skips blocked work — open, but not available', () => {
    const g = goal([leaf('a', { status: 'blocked' }), leaf('b')]);
    expect(goalOverview(g, TODAY).next.map((n) => n.id)).toEqual(['b']);
  });

  it('skips done work', () => {
    const g = goal([leaf('a', { status: 'done' }), leaf('b')]);
    expect(goalOverview(g, TODAY).next.map((n) => n.id)).toEqual(['b']);
  });

  it('keeps a milestone that is genuinely next', () => {
    // firstOpenLeaf does not filter these out either, and in a study plan's
    // last week the exam really is the next thing on the goal.
    const g = goal([leaf('exam', { checkpoint: true, deadline: '2026-08-20' })]);
    expect(goalOverview(g, TODAY).next.map((n) => n.id)).toEqual(['exam']);
  });

  it('caps the list', () => {
    const g = goal(Array.from({ length: 9 }, (_, i) => leaf(`t${i}`)));
    expect(goalOverview(g, TODAY).next).toHaveLength(OVERVIEW_NEXT_MAX);
  });

  it('names the container a task sits in, and nothing at the root', () => {
    const g = goal([
      { id: 'area', title: 'Mechanics', children: [leaf('a')] },
      leaf('loose'),
    ]);
    const [first, second] = goalOverview(g, TODAY).next;
    expect(first.parentTitle).toBe('Mechanics');
    expect(second.parentTitle).toBeUndefined();
  });

  it('carries the estimate through when there is one, and no zero when there is not', () => {
    const g = goal([leaf('a', { estimateMin: 45 }), leaf('b')]);
    const [a, b] = goalOverview(g, TODAY).next;
    expect(a.estimateMin).toBe(45);
    expect(b.estimateMin).toBeUndefined();
  });

  it('reports nothing next when every open task is blocked', () => {
    const g = goal([leaf('a', { status: 'blocked' })]);
    const o = goalOverview(g, TODAY);
    expect(o.next).toEqual([]);
    expect(o.blocked).toBe(1);
    // Same contract firstOpenLeaf carries: this is "unblock something",
    // never "nothing to do".
    expect(firstOpenLeaf(g.nodes)).toBeNull();
  });
});

describe('goalOverview — upcoming', () => {
  it('lists milestones in date order', () => {
    const g = goal([
      leaf('late', { checkpoint: true, deadline: '2026-09-01' }),
      leaf('soon', { checkpoint: true, deadline: '2026-08-12' }),
    ]);
    expect(goalOverview(g, TODAY).upcoming.map((u) => u.id)).toEqual(['soon', 'late']);
  });

  it('flags a milestone whose date has passed', () => {
    const g = goal([
      leaf('past', { checkpoint: true, deadline: '2026-08-01' }),
      leaf('ahead', { checkpoint: true, deadline: '2026-08-20' }),
    ]);
    const [past, ahead] = goalOverview(g, TODAY).upcoming;
    expect(past.overdue).toBe(true);
    expect(ahead.overdue).toBe(false);
  });

  it('does not treat today as overdue', () => {
    const g = goal([leaf('now', { checkpoint: true, deadline: TODAY })]);
    expect(goalOverview(g, TODAY).upcoming[0].overdue).toBe(false);
  });

  it('ignores a milestone with no date, and an ordinary dated task', () => {
    const g = goal([
      leaf('undated', { checkpoint: true }),
      leaf('ordinary', { deadline: '2026-08-11', start: '2026-08-11' }),
    ]);
    expect(goalOverview(g, TODAY).upcoming).toEqual([]);
  });

  it('caps the list', () => {
    const g = goal(
      Array.from({ length: 7 }, (_, i) =>
        leaf(`m${i}`, { checkpoint: true, deadline: `2026-09-0${i + 1}` }),
      ),
    );
    expect(goalOverview(g, TODAY).upcoming).toHaveLength(OVERVIEW_UPCOMING_MAX);
  });
});

describe('goalOverview — effort and blocked', () => {
  it('reports the goal effort unchanged', () => {
    const g = goal([
      leaf('a', { estimateMin: 60 }),
      leaf('b', { status: 'done' }),
      leaf('c'),
    ]);
    const { effort } = goalOverview(g, TODAY);
    expect(effort.total).toBe(3);
    expect(effort.done).toBe(1);
    expect(effort.remainingMin).toBe(60);
    expect(effort.unestimated).toBe(1);
  });

  it('counts blocked leaves anywhere in the tree', () => {
    const g = goal([
      { id: 'p', title: 'p', children: [leaf('a', { status: 'blocked' })] },
      leaf('b', { status: 'blocked' }),
      leaf('c'),
    ]);
    expect(goalOverview(g, TODAY).blocked).toBe(2);
  });
});

describe('overviewIsEmpty', () => {
  it('is empty for a goal with no tasks', () => {
    expect(overviewIsEmpty(goalOverview(goal([]), TODAY))).toBe(true);
  });

  it('is not empty once there is work', () => {
    expect(overviewIsEmpty(goalOverview(goal([leaf('a')]), TODAY))).toBe(false);
  });

  it('is not empty for a finished goal — the totals are still worth stating', () => {
    const g = goal([leaf('a', { status: 'done' })]);
    expect(overviewIsEmpty(goalOverview(g, TODAY))).toBe(false);
  });

  it('is not empty when the only open work is blocked', () => {
    const g = goal([leaf('a', { status: 'blocked' })]);
    expect(overviewIsEmpty(goalOverview(g, TODAY))).toBe(false);
  });
});

describe('goalWeekLoad', () => {
  const WEEK = weekOf('2026-08-12');

  it('counts leaves committed to the week and prices the open ones', () => {
    const g = goal([
      leaf('a', { plannedWeek: WEEK, estimateMin: 60 }),
      leaf('b', { plannedWeek: WEEK, estimateMin: 30 }),
    ]);
    const load = goalWeekLoad(g, WEEK);
    expect(load.total).toBe(2);
    expect(load.done).toBe(0);
    expect(load.minutes).toBe(90);
    expect(load.unestimated).toBe(0);
  });

  /** A finished task is still planned this week; it is just not work left. */
  it('counts a done leaf in total but not in minutes', () => {
    const g = goal([
      leaf('a', { plannedWeek: WEEK, estimateMin: 60, status: 'done' }),
      leaf('b', { plannedWeek: WEEK, estimateMin: 30 }),
    ]);
    const load = goalWeekLoad(g, WEEK);
    expect(load.total).toBe(2);
    expect(load.done).toBe(1);
    expect(load.minutes).toBe(30);
  });

  /**
   * An unpriced open leaf must not read as free. `minutes` stays a floor and
   * the count says why — the same split `GoalEffort.unestimated` exists for.
   */
  it('reports unpriced open work separately rather than as zero minutes', () => {
    const g = goal([
      leaf('a', { plannedWeek: WEEK, estimateMin: 45 }),
      leaf('b', { plannedWeek: WEEK }),
    ]);
    const load = goalWeekLoad(g, WEEK);
    expect(load.minutes).toBe(45);
    expect(load.unestimated).toBe(1);
  });

  it('ignores leaves committed to a different week', () => {
    const g = goal([
      leaf('a', { plannedWeek: WEEK, estimateMin: 45 }),
      leaf('b', { plannedWeek: weekOf('2026-09-30'), estimateMin: 45 }),
    ]);
    expect(goalWeekLoad(g, WEEK).total).toBe(1);
  });

  it('is all zeroes for a goal with nothing planned', () => {
    const load = goalWeekLoad(goal([leaf('a')]), WEEK);
    expect(load).toEqual({ total: 0, done: 0, minutes: 0, unestimated: 0 });
  });
});
