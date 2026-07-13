import type { Goal } from '../db/types';

/**
 * Goals ordered highest-priority first for display: by priority-board column
 * ascending (0 = leftmost/highest). Array.sort is stable, so goals sharing a
 * column keep their incoming order — the board's within-column ranking. A goal
 * with no `column` (legacy / quick-add) sorts as column 0. Returns a new array;
 * the input is left untouched.
 */
export function byPriority(goals: Goal[]): Goal[] {
  return [...goals].sort((a, b) => (a.column ?? 0) - (b.column ?? 0));
}
