import type { Goal } from '../db/types';
import { goalPct } from './pct';
import { behindPaceBy } from './timeline';
import { addDays } from './dates';

// Read-only aggregation over the board for the Goals insight bar. Pure — never
// mutates `goals`. Thresholds reuse the same helpers the cards use so the bar
// and the cards always agree.
export interface BoardInsights {
  total: number;
  perColumn: number[]; // length = columnCount, index 0 = Highest
  dueSoonCount: number;
  nearestDeadline: string | null; // 'YYYY-MM-DD' of the soonest upcoming deadline, or null
  behindPaceCount: number;
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

    // Behind pace — mirror BoardCard exactly: round the pct first, then round
    // the shortfall, then compare, so a card's behind chip and this count never
    // disagree at the rounding boundary.
    const pct = Math.round(goalPct(g));
    const behind = Math.round(behindPaceBy(pct, g.start, g.deadline, today));
    if (behind >= 10) behindPaceCount++;
  }

  return { total: goals.length, perColumn, dueSoonCount, nearestDeadline, behindPaceCount };
}
