import type { Task } from '../db/types';
import type { BacklogGroup } from './backlog';
import { LOOSE_GROUP_KEY } from './backlog';
import { weekOf } from './plan';

/**
 * Pointing the Plan view at one specific row.
 *
 * The command palette can find a task or a habit, but neither has a detail
 * surface to open — the calendar is where both are lived with. Before this,
 * choosing one switched to Plan and stopped there, which for anything not
 * already on the visible week was indistinguishable from the palette ignoring
 * the Enter key. Revealing means three things have to agree: the right week is
 * shown, whatever collapses the row (the backlog cap, the habits panel) is
 * opened, and the row itself is scrolled to and marked. The pure parts of that
 * live here so they can be tested without a DOM.
 */
export type RevealKind = 'task' | 'habit' | 'step';

/**
 * How long the highlight stays up. Long enough to find with the eye after a
 * smooth scroll, short enough that it reads as an answer to the search rather
 * than as a selection the user now has to clear.
 */
export const REVEAL_MS = 2600;

export interface RevealTarget {
  kind: RevealKind;
  id: string;
  /**
   * Distinguishes two reveals of the SAME id. Without it, searching a task,
   * dismissing the highlight, then searching the same task again sets state to
   * a value it already holds — React bails out, no effect re-runs, and the
   * second search looks broken in exactly the way the first one did.
   */
  nonce: number;
}

/**
 * The DOM id a revealable row carries. One function so the renderer and the
 * scroll-to effect cannot drift apart; `step` is included because steps share
 * the backlog rail with tasks even though only tasks are reachable from search.
 */
export function revealDomId(kind: RevealKind, id: string): string {
  return `plan-row-${kind}-${id}`;
}

/**
 * The week the Plan view must show for `target` to be on screen.
 *
 * A task with a date belongs to that date's week whether or not it also has a
 * start minute: with one it is a block on the grid, without one it is a row in
 * that week's backlog. A dateless task is unplanned and therefore in the
 * *current* week's backlog, so the view should not move. Habits are not
 * week-scoped at all — the panel shows the same habits whichever week is up —
 * and a revealed step is by construction one the rail is already showing for
 * the week in view.
 */
export function weekForReveal(
  target: RevealTarget,
  tasks: Task[],
  currentWeek: string,
): string {
  if (target.kind !== 'task') return currentWeek;
  const task = tasks.find((t) => t.id === target.id);
  return task?.date ? weekOf(task.date) : currentWeek;
}

/**
 * The backlog group key holding `target`, or null when it isn't in the rail
 * (a habit, or work that is on the grid, done, or gone). The Backlog uses this
 * to force a capped group open — revealing a row the "+N more" cap is hiding
 * would otherwise scroll to nothing.
 */
export function groupKeyContaining(
  groups: BacklogGroup[],
  target: RevealTarget,
): string | null {
  if (target.kind === 'habit') return null;
  for (const group of groups) {
    if (group.items.some((i) => i.kind === target.kind && i.id === target.id)) {
      return group.goalId ?? LOOSE_GROUP_KEY;
    }
  }
  return null;
}
