import { describe, expect, it } from 'vitest';
import { monthCapacity } from './monthCapacity';
import { makeBlock } from '../../lib/blocks';
import type { BusyBlock, Goal, Task } from '../../db/types';
import type { DateRange } from '../../lib/calendarRange';

const input = {
  ym: '2026-08',
  goals: [] as Goal[],
  tasks: [] as Task[],
  blocks: [] as BusyBlock[],
  now: { date: '2026-08-16', minute: 600 },
  allDayBlocks: false,
  range: null as DateRange | null,
};

// August 2026's grid draws six Monday-first rows starting 2026-07-27, which
// straddles July and August — the row `plannedWeek` this fixture aims work at
// to prove the straddling row actually carries minutes, not just a unique key.
const STRADDLING_WEEK = '2026-07-27';

/**
 * A populated fixture: real minutes in every bucket the invariant sums.
 *
 * - `n1` is a leaf committed to the straddling week with an estimate and NO
 *   sitting — that is `backlogMin` ("to place"), billed to the week it is
 *   committed to (weekCapacity's own rule: a leaf has no day-level
 *   commitment, only a week).
 * - `n2` is a leaf with a real sitting (`makeBlock`) ON a day inside the
 *   straddling week (2026-07-28, a Tuesday) — that is `plannedMin`.
 * - `n3` is a leaf committed to the straddling week with NO estimate — that
 *   is `unestimated`.
 * - `t1` is a dated task, also inside the straddling week, with no estimate
 *   of its own — adds to `backlogMin`/`unestimated` via the task path.
 */
const POPULATED_GOAL: Goal = {
  id: 'g1',
  title: 'Populated project',
  column: 0, // Now — inside PLANNING_HORIZONS
  nodes: [
    { id: 'n1', title: 'Committed, unplaced', estimateMin: 90, plannedWeek: STRADDLING_WEEK },
    { id: 'n2', title: 'Sat down and worked', estimateMin: 60, blocks: [makeBlock('2026-07-28', 600, 45)] },
    { id: 'n3', title: 'Committed, unpriced', plannedWeek: STRADDLING_WEEK },
  ],
};

const POPULATED_TASK: Task = {
  id: 't1',
  title: 'A dated task',
  done: false,
  goalId: null,
  date: '2026-07-29',
};

const populatedInput = {
  ...input,
  goals: [POPULATED_GOAL],
  tasks: [POPULATED_TASK],
};

describe('monthCapacity', () => {
  it('returns one row per week the grid draws', () => {
    const m = monthCapacity(input);
    // August 2026 starts Sat 1st and ends Mon 31st: 6 Monday-first rows.
    expect(m.rows.length).toBe(6);
    expect(m.rows[0].week).toBe('2026-07-27');
  });

  // THE invariant. If this fails the header and the gutter are lying to each
  // other, which is the entire reason this module exists rather than a
  // month-wide capacity computation.
  //
  // Run against a POPULATED fixture: with empty goals/tasks every sum is
  // `0 === 0` and three of the four assertions below prove nothing. Each
  // total is also asserted non-zero, so this cannot silently go vacuous
  // again if the fixture above is ever pared back down to nothing.
  it('sums its rows exactly into its total', () => {
    const m = monthCapacity(populatedInput);
    const sum = (pick: (c: { plannedMin: number; backlogMin: number; unestimated: number }) => number) =>
      m.rows.reduce((n, r) => n + pick(r.capacity), 0);
    expect(m.total.plannedMin).toBe(sum((c) => c.plannedMin));
    expect(m.total.backlogMin).toBe(sum((c) => c.backlogMin));
    expect(m.total.unestimated).toBe(sum((c) => c.unestimated));

    expect(m.total.plannedMin).toBeGreaterThan(0);
    expect(m.total.backlogMin).toBeGreaterThan(0);
    expect(m.total.unestimated).toBeGreaterThan(0);
  });

  it('labels its span with the first and last day it actually covers', () => {
    const m = monthCapacity(input);
    expect(m.spanLabel).toMatch(/^Jul 27\b/);
    expect(m.spanLabel).toMatch(/Sep 6$/);
  });

  it('counts a straddling week once, in its own row, with its minutes in it', () => {
    const m = monthCapacity(populatedInput);
    const weeks = m.rows.map((r) => r.week);
    expect(new Set(weeks).size).toBe(weeks.length);

    // The straddling row is the first — prove it actually carries the
    // fixture's minutes, not just a unique key.
    const straddling = m.rows.find((r) => r.week === STRADDLING_WEEK);
    expect(straddling).toBeDefined();
    expect(straddling!.capacity.plannedMin).toBe(45); // n2's sitting
    expect(straddling!.capacity.backlogMin).toBeGreaterThan(0); // n1 + t1
    expect(straddling!.capacity.unestimated).toBeGreaterThan(0); // n3

    // And counted exactly once: no other row should also carry n2's sitting
    // or n1/n3's week commitment.
    const others = m.rows.filter((r) => r.week !== STRADDLING_WEEK);
    expect(others.reduce((n, r) => n + r.capacity.plannedMin, 0)).toBe(0);
    expect(others.reduce((n, r) => n + r.capacity.backlogMin, 0)).toBe(0);
    expect(others.reduce((n, r) => n + r.capacity.unestimated, 0)).toBe(0);
  });

  // February 2027 starts Monday 1st and ends Sunday 28th — a whole number of
  // weeks, so the grid draws exactly four Monday-first rows and never spills
  // into a fifth for either neighbouring month.
  it('handles a four-row month', () => {
    const m = monthCapacity({ ...input, ym: '2027-02' });
    expect(m.rows.length).toBe(4);
    expect(m.total.plannedMin).toBe(m.rows.reduce((n, r) => n + r.capacity.plannedMin, 0));
  });

  // September 2026 starts Tuesday 1st, so its first row is the trailing week
  // of August (Mon 31 Aug) and its last is the leading week of October — five
  // Monday-first rows, verified against monthGrid directly before writing
  // this: Aug 31, Sep 7, 14, 21, 28.
  it('handles a five-row month', () => {
    const m = monthCapacity({ ...input, ym: '2026-09' });
    expect(m.rows.length).toBe(5);
    expect(m.rows[0].week).toBe('2026-08-31');
    expect(m.total.plannedMin).toBe(m.rows.reduce((n, r) => n + r.capacity.plannedMin, 0));
  });

  it('numbers its rows', () => {
    const m = monthCapacity(input);
    expect(m.rows.every((r) => /^W\d{1,2}$/.test(r.isoWeekLabel))).toBe(true);
  });
});

/**
 * The month grid draws the same busy time the week grid does. Passing `[]`
 * here while the week passes real blocks would make the two views disagree
 * about the same Tuesday.
 */
describe('monthCapacity and the calendar', () => {
  const MEETING: BusyBlock = {
    date: '2026-07-28', startMin: 540, endMin: 600, title: 'standup', allDay: false,
  };

  it("names the day's meetings on the row that draws it", () => {
    const out = monthCapacity({ ...input, blocks: [MEETING] });
    const day = out.rows.flatMap((r) => r.capacity.days).find((d) => d.date === '2026-07-28');
    expect(day?.blockedBy).toEqual(['standup']);
  });

  it('says it has no calendar data when it was handed no range', () => {
    const out = monthCapacity({ ...input, blocks: [MEETING] });
    expect(out.total.hasData).toBe(false);
    expect(out.rows.some((r) => r.capacity.hasData)).toBe(false);
  });

  /**
   * The discriminating test. August 2026 draws six week rows, and the cache is
   * ONE contiguous range — so a range that stops mid-month covers some of those
   * rows and not others. A single `hasData` flag handed down from the caller
   * had to pick one answer for all six, and whichever it picked was wrong for
   * the rest.
   */
  it('reports coverage per row, not one verdict for the whole month', () => {
    // Covers the first three rows (from 2026-07-27) and stops before the rest.
    const range: DateRange = { rangeStart: '2026-07-20', rangeEnd: '2026-08-17' };
    const out = monthCapacity({ ...input, blocks: [MEETING], range });

    expect(out.rows[0].capacity.hasData).toBe(true);
    expect(out.rows[out.rows.length - 1].capacity.hasData).toBe(false);
  });

  // The month's own figure covers every row it drew, so it is only "has data"
  // when all of them do — a total that claimed coverage its rows do not have
  // would let the header and the gutter disagree.
  it('claims coverage for the month only when every row has it', () => {
    const partial: DateRange = { rangeStart: '2026-07-20', rangeEnd: '2026-08-17' };
    expect(monthCapacity({ ...input, range: partial }).total.hasData).toBe(false);

    const whole: DateRange = { rangeStart: '2026-07-20', rangeEnd: '2026-09-30' };
    const out = monthCapacity({ ...input, range: whole });
    expect(out.total.hasData).toBe(true);
    expect(out.rows.every((r) => r.capacity.hasData)).toBe(true);
  });
});
