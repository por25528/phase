import type { Goal } from '../db/types';
import { addDays } from './dates';
import { weekOf, plannedLeaves, paceStatus } from './plan';

// Read-only aggregation over the board for the Goals insight bar. Pure — never
// mutates `goals`. Thresholds reuse the same helpers the cards use so the bar
// and the cards always agree.
export interface BoardInsights {
  total: number;
  perColumn: number[]; // length = columnCount, index 0 = Highest
  dueSoonCount: number;
  nearestDeadline: string | null; // 'YYYY-MM-DD' of the soonest upcoming deadline, or null
  behindPaceCount: number;
  weekPlanned: number;
  weekDone: number;
}

export function computeBoardInsights(
  goals: Goal[],
  today: string,
  columnCount: number,
  dueSoonDays = 14,
): BoardInsights {
  const cols = Math.max(0, columnCount);
  const perColumn = new Array<number>(cols).fill(0);
  const dueSoonMax = addDays(today, dueSoonDays);

  let dueSoonCount = 0;
  let behindPaceCount = 0;
  let nearestDeadline: string | null = null;

  for (const g of goals) {
    // Bucket by column: absent ⇒ 0, out-of-range clamped to the ends.
    if (cols > 0) {
      const col = Math.min(cols - 1, Math.max(0, g.column ?? 0));
      perColumn[col]++;
    }

    // Due soon: deadline within [today, today+dueSoonDays], inclusive; past-due
    // excluded. ISO 'YYYY-MM-DD' compares lexicographically = chronologically.
    if (g.deadline >= today && g.deadline <= dueSoonMax) dueSoonCount++;

    // Nearest upcoming (today-or-later) deadline, across all goals.
    if (g.deadline >= today && (nearestDeadline === null || g.deadline < nearestDeadline)) {
      nearestDeadline = g.deadline;
    }

    // The five-state verdict is authoritative so attention states remain
    // mutually exclusive (for example, needs-breakdown is never also behind).
    if (paceStatus(g, today) === 'behind') behindPaceCount++;
  }

  const wk = plannedLeaves(goals, weekOf(today));
  const weekPlanned = wk.length;
  const weekDone = wk.filter((l) => l.done).length;

  return { total: goals.length, perColumn, dueSoonCount, nearestDeadline, behindPaceCount, weekPlanned, weekDone };
}
