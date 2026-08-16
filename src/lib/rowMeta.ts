import type { GoalNode } from '../db/types';
import { scheduleCell } from './rowSchedule';
import { stepStatus } from './status';

/**
 * Where a leaf's metadata renders — and therefore why the row has no column
 * headers.
 *
 * The row used to pin WHEN and the estimate to the right edge at `w-[92px]`
 * and `w-[56px]` while the title took `flex-1`, so a short title left ~700px
 * of nothing between a task and its own figures. `2h25` at the far edge needs
 * a caption; `Aug 13 11:20am · 2h25` directly under its own title does not.
 *
 * A leaf with NOTHING to say is the load-bearing case. It still needs its
 * scheduling affordance, and if that appeared as a second LINE on hover, every
 * row you passed would grow and shove the list down. So it renders `inline`,
 * on the line that already exists, and the row never changes height on hover.
 */
export type MetaPlacement = 'below' | 'inline';

/**
 * Leaves only. A container's `pct`, derived `blocked` word and demand chip stay
 * on line 1 and it has no line 2 — it carries no estimate and no schedule of
 * its own by design (`setNodeEstimate` refuses one; a group is scheduled
 * through its tasks).
 */
export function metaPlacement(n: GoalNode, today: string): MetaPlacement {
  if (scheduleCell(n, today) !== null) return 'below';
  if (n.estimateMin !== undefined) return 'below';
  // The RAW field, never the resolved value: `demandIndex` inherits a goal's
  // value onto every leaf, and thirty rows saying "Deep" is a column that says
  // one word thirty times.
  if (n.demand !== undefined) return 'below';
  if (stepStatus(n) === 'blocked' && n.blockedOn) return 'below';
  return 'inline';
}
