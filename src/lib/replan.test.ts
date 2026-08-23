import { describe, expect, it } from 'vitest';
import type { Goal, GoalNode, Task } from '../db/types';
import type { Now } from './capacity';
import { REPLAN_HORIZON_DAYS, proposalMinutes, proposeReplan, slippedWork } from './replan';
import { makeBlock } from './blocks';

/*
 * 2026-08-12 is a Wednesday.
 *
 * A replan proposes inside `ORDINARY_DAY` — 08:00–20:00, every day, no
 * exceptions and nothing configurable. These fixtures used a deliberately tiny
 * Mon–Fri 09:00–11:00 window to make the packing visible in two-hour bites;
 * with a fixed twelve-hour span the same demonstrations need items sized
 * against IT, so the estimates below are large on purpose.
 */
const TODAY = '2026-08-12';
const NOW: Now = { date: TODAY, minute: 0 };
const DAY_START = 8 * 60;   // ORDINARY_DAY.startMin
const DAY_MIN = 12 * 60;    // ORDINARY_DAY, end to end

const leaf = (id: string, over: Partial<GoalNode> = {}): GoalNode => ({ id, title: id, ...over });

const goal = (nodes: GoalNode[], over: Partial<Goal> = {}): Goal =>
  ({ id: 'g', title: 'Physics Final', nodes, ...over });

const input = (goals: Goal[], tasks: Task[] = []) =>
  ({ goals, tasks, today: TODAY, blocks: [], allDayBlocks: true, now: NOW });

describe('slippedWork', () => {
  it('finds unfinished work placed on a day that has passed', () => {
    const g = goal([
      leaf('a', { plannedWeek: '2026-08-10', estimateMin: 60, blocks: [makeBlock('2026-08-10', 540, 60)] }),
      leaf('b', { plannedWeek: '2026-08-10', blocks: [makeBlock('2026-08-14', 540, 60)] }),
    ]);
    expect(slippedWork([g], [], TODAY).map((s) => s.id)).toEqual(['a']);
  });

  it('ignores work that was finished, however late it was', () => {
    const g = goal([
      leaf('a', { status: 'done', plannedWeek: '2026-08-10', blocks: [makeBlock('2026-08-10', 540, 60)] }),
    ]);
    expect(slippedWork([g], [], TODAY)).toEqual([]);
  });

  /**
   * Committed to a day but never placed on the grid is a different problem —
   * it is unplanned, not missed, and the rail already offers it. Recovering it
   * here would move work that never had a time to slip from.
   */
  it('ignores work committed to a past week but never given a time', () => {
    const g = goal([leaf('a', { plannedWeek: '2026-08-03' })]);
    expect(slippedWork([g], [], TODAY)).toEqual([]);
  });

  /**
   * Only the sittings in the PAST slipped. Moving the whole task would drag a
   * later sitting backwards because an earlier one went unused.
   */
  it('takes only the past sittings of a task that has several', () => {
    const g = goal([leaf('a', {
      plannedWeek: '2026-08-10',
      blocks: [makeBlock('2026-08-10', 540, 60), makeBlock('2026-08-14', 540, 60)],
    })]);
    const slipped = slippedWork([g], [], TODAY);
    expect(slipped).toHaveLength(1);
    expect(slipped[0].from).toBe('2026-08-10');
  });

  it('ignores a completed goal entirely', () => {
    const g = goal(
      [leaf('a', { plannedWeek: '2026-08-10', blocks: [makeBlock('2026-08-10', 540, 60)] })],
      { completedAt: TODAY },
    );
    expect(slippedWork([g], [], TODAY)).toEqual([]);
  });

  it('finds loose tasks too, and puts the oldest slip first', () => {
    const tasks: Task[] = [
      { id: 't1', title: 'Recent', done: false, goalId: null, date: '2026-08-11', blocks: [makeBlock('2026-08-11', 540, 60)] },
      { id: 't2', title: 'Ancient', done: false, goalId: null, date: '2026-08-03', blocks: [makeBlock('2026-08-03', 540, 60)] },
    ];
    expect(slippedWork([], tasks, TODAY).map((s) => s.id)).toEqual(['t2', 't1']);
  });
});

describe('proposeReplan', () => {
  it('offers the earliest gap that fits', () => {
    const g = goal([
      leaf('a', { plannedWeek: '2026-08-10', estimateMin: 60, blocks: [makeBlock('2026-08-10', 540, 60)] }),
    ]);
    expect(proposeReplan(input([g])).moves[0]).toMatchObject({ to: TODAY, startMin: DAY_START });
  });

  /**
   * Each proposal takes its slot out of the pool the next one sees. Without
   * that, five slipped tasks are all offered Monday 09:00 — and applying the
   * preview either overlaps them or silently drops four, which breaks the
   * "nothing moves silently" rule in the flow built to enforce it.
   */
  it('never offers the same slot twice', () => {
    // Five hours each against a twelve-hour day: two fit today, the third
    // cannot, which is what makes the roll to tomorrow observable.
    const g = goal([1, 2, 3].map((n) => leaf(`n${n}`, { plannedWeek: '2026-08-10', estimateMin: 300, blocks: [makeBlock('2026-08-10', 540, 300)] })));
    const { moves } = proposeReplan(input([g]));

    expect(moves).toHaveLength(3);
    expect(moves.map((m) => `${m.to} ${m.startMin}`)).toEqual([
      `${TODAY} ${DAY_START}`, `${TODAY} ${DAY_START + 300}`, `2026-08-13 ${DAY_START}`,
    ]);
  });

  it('works around what is already on the calendar', () => {
    const g = goal([
      leaf('slipped', { plannedWeek: '2026-08-10', estimateMin: 60, blocks: [makeBlock('2026-08-10', 540, 60)] }),
      // Sitting on the hour the replan would otherwise aim at.
      leaf('kept', { plannedWeek: '2026-08-10', estimateMin: 60, blocks: [makeBlock(TODAY, DAY_START, 60)] }),
    ]);
    expect(proposeReplan(input([g])).moves[0]).toMatchObject({ to: TODAY, startMin: DAY_START + 60 });
  });

  /**
   * An item quietly dropped from a recovery flow is the same work slipping
   * again, one layer deeper. It is listed, not omitted.
   */
  it('names what will not fit rather than dropping it', () => {
    const huge = goal([
      // Longer than the ordinary day, so no date inside the horizon can hold it.
      leaf('marathon', { plannedWeek: '2026-08-10', estimateMin: DAY_MIN + 60, blocks: [makeBlock('2026-08-10', 540, DAY_MIN + 60)] }),
    ]);
    const { moves, unplaceable } = proposeReplan(input([huge]));

    expect(moves).toEqual([]);
    expect(unplaceable.map((u) => u.id)).toEqual(['marathon']);
  });

  it('gives up at the horizon rather than proposing next month', () => {
    // Fill every workday inside the horizon, then slip one more item.
    const filler: GoalNode[] = [];
    for (let i = 0; i < REPLAN_HORIZON_DAYS; i += 1) {
      const d = new Date(2026, 7, 12 + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      filler.push(leaf(`f${i}`, { plannedWeek: '2026-08-10', estimateMin: DAY_MIN, blocks: [makeBlock(iso, 540, DAY_MIN)] }));
    }
    const g = goal([
      ...filler,
      leaf('late', { plannedWeek: '2026-08-10', estimateMin: DAY_MIN, blocks: [makeBlock('2026-08-10', 540, DAY_MIN)] }),
    ]);

    const { unplaceable } = proposeReplan(input([g]));
    expect(unplaceable.map((u) => u.id)).toEqual(['late']);
  });

  it('proposes nothing when nothing slipped', () => {
    expect(proposeReplan(input([goal([leaf('a')])]))).toEqual({ moves: [], unplaceable: [] });
  });
});

describe('proposalMinutes', () => {
  it('totals what a proposal would move', () => {
    const g = goal([1, 2].map((n) => leaf(`n${n}`, { plannedWeek: '2026-08-10', estimateMin: 45, blocks: [makeBlock('2026-08-10', 540, 45)] })));
    expect(proposalMinutes(proposeReplan(input([g])))).toBe(90);
  });
});
