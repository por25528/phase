import type { BusyBlock, Goal, Task } from '../../db/types';
import { weekCapacity, type Now, type WeekCapacity } from '../../lib/capacity';
import { monthGrid } from '../../lib/calendar';
import { weekOf, plannedLeaves } from '../../lib/plan';
import { tasksForWeek } from '../../lib/dailyWork';
import { fmtD, isoWeekNumber } from '../../lib/dates';

export interface MonthCapacityRow {
  /** The row's Monday, 'YYYY-MM-DD'. */
  week: string;
  /** 'W32' — what the gutter prints. */
  isoWeekLabel: string;
  capacity: WeekCapacity;
}

export interface MonthCapacity {
  rows: MonthCapacityRow[];
  /** The sum of `rows`. See the note below on why this is not the month. */
  total: WeekCapacity;
  /** What `total` covers, e.g. 'Jul 27 – Sep 6'. */
  spanLabel: string;
}

export interface MonthCapacityInput {
  ym: string;
  goals: Goal[];
  tasks: Task[];
  /** The same busy time the week grid draws — not a second opinion about it. */
  blocks: BusyBlock[];
  now: Now;
  allDayBlocks: boolean;
  /**
   * Whether the cached calendar covers what this month draws. Threaded to the
   * rows AND the total, or the gutter and the header disagree about the same
   * month.
   */
  hasData: boolean;
}

/**
 * Capacity for the month grid: one figure per week row, and their sum.
 *
 * ── Why this is the weeks DRAWN and not the calendar month ───────────────────
 *
 * `WeekHeader` used to hide every figure in month mode, and its comment gave
 * the right reason: "A month's capacity is a different computation." It is,
 * and the difficulty is `plannedWeek`. A leaf committed to a week carries no
 * day, so a week straddling 31 July and 2 August has no principled owner for
 * its committed minutes — and whichever month you award them to, the OTHER
 * month's figure stops matching the rows on its own screen.
 *
 * So this does not compute a month. It computes the six (or four, or five)
 * weeks the grid actually draws, and adds them up. The consequences are all
 * the point:
 *
 *  - The gutter rows sum to the header EXACTLY, by construction rather than by
 *    a test that has to keep two computations in step.
 *  - Week-committed work is billed to its own week, the only place it has a
 *    real claim, and is counted once.
 *  - `lib/capacity.ts` is untouched. This is a projection for one surface, not
 *    a new fact about time, which is why it lives in the view folder beside
 *    `capacityLabel.ts` rather than up in `lib`.
 *
 * The cost is that `total` does NOT cover the month named in the heading, and
 * that is precisely what `spanLabel` is for: the header prints it next to the
 * figures, so the reader is never invited to read 'August' onto a number that
 * starts on 27 July. A figure whose span is not the heading's has to say so.
 */
export function monthCapacity(input: MonthCapacityInput): MonthCapacity {
  const { ym, goals, tasks, blocks, now, allDayBlocks, hasData } = input;
  const grid = monthGrid(ym);
  // `monthGrid` is Monday-first, so the first cell of each row IS that row's
  // Monday — no need to re-derive it. `weekOf` is used anyway as the single
  // definition of "which week is this date in", so a change there cannot leave
  // this module holding a different opinion.
  const weeks = grid.map((row) => weekOf(row[0]));

  const rows: MonthCapacityRow[] = weeks.map((week) => ({
    week,
    isoWeekLabel: `W${isoWeekNumber(week)}`,
    capacity: weekCapacity({
      week,
      blocks,
      leaves: plannedLeaves(goals, week),
      tasks: tasksForWeek(tasks, week),
      now,
      allDayBlocks,
      hasData,
    }),
  }));

  const total: WeekCapacity = {
    days: rows.flatMap((r) => r.capacity.days),
    plannedMin: rows.reduce((n, r) => n + r.capacity.plannedMin, 0),
    backlogMin: rows.reduce((n, r) => n + r.capacity.backlogMin, 0),
    unestimated: rows.reduce((n, r) => n + r.capacity.unestimated, 0),
    hasData,
  };

  const first = grid[0][0];
  const lastRow = grid[grid.length - 1];
  const last = lastRow[lastRow.length - 1];

  return { rows, total, spanLabel: `${fmtD(first)} – ${fmtD(last)}` };
}
