import type { Goal, GoalNode, Task } from '../db/types';
import { isPlaced } from './blocks';

/**
 * Has anything, ever, in any week, been placed on the calendar?
 *
 * "Placed" is the same predicate the backlog uses as its complement (see
 * `backlogGroups`): a day AND a start minute. A step committed to a week with
 * no day, or pinned to a day with no time, is not on the grid — it is still
 * sitting in the rail, so it does not count as evidence the user has learned
 * how to schedule.
 *
 * Week-agnostic on purpose. Scoping this to the visible week would bring the
 * hint back every time you paged to an empty future week, which is a normal
 * thing to do once you already know how the view works.
 */
export function hasPlacedWork(goals: Goal[], tasks: Task[]): boolean {
  // Tasks first: a flat array with a real early exit, versus a tree walk.
  if (tasks.some(isPlaced)) return true;
  // `walkLeaves` has no early exit, so a `found` flag still visits every leaf
  // of the goal it finds a hit in. `hasPlacedLeaf` stops at the first one —
  // this runs on every Plan render, including the 60-second now-line tick.
  return goals.some((g) => hasPlacedLeaf(g.nodes));
}

function hasPlacedLeaf(nodes: GoalNode[]): boolean {
  for (const n of nodes) {
    if (n.children && n.children.length) {
      if (hasPlacedLeaf(n.children)) return true;
    } else if (isPlaced(n)) {
      return true;
    }
  }
  return false;
}

/**
 * Should the Plan view show its "how do I get work onto the grid" hint?
 *
 * Three conditions, and all three matter:
 *
 * - Nothing has ever been placed. This is the whole point — the hint teaches a
 *   thing you only need told once, and it retires itself the moment the user
 *   demonstrates they know it. No persisted "dismissed" flag to go stale.
 * - There is something to place. On a genuinely empty install the hint would
 *   describe dragging from an empty rail; the Projects view's own empty state
 *   is the right teacher there.
 * - Working hours exist. With no availability, no day can accept a drop at all,
 *   and the view already shows a banner saying exactly that. Two stacked
 *   banners, one of which describes an action that cannot succeed, is worse
 *   than one.
 */
export function showPlanHint(
  goals: Goal[],
  tasks: Task[],
  hasAvailability: boolean,
): boolean {
  if (!hasAvailability) return false;
  if (goals.length === 0 && tasks.length === 0) return false;
  return !hasPlacedWork(goals, tasks);
}
