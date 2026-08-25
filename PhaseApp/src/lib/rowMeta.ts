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
 * Leaves only. A container is a RULE rather than a row now — its name in the
 * tinted cell at one end, its progress on the other — so it has no metadata
 * line at all, and it never carried an estimate or a schedule of its own by
 * design (`setNodeEstimate` refuses one; a group is scheduled through its
 * tasks).
 *
 * The ESTIMATE is deliberately not a reason to take line 2 any more. It moved
 * out of `LeafMeta` and onto the row's own reading edge, where it shows at
 * rest — mono, tabular, `—` when unpriced — so that a goal card saying "4
 * unestimated" can be checked against the tree without hovering every row.
 * A column of figures only reads as a column if every row states its figure at
 * the same x, and that cannot be true while half the rows put it on line 1 and
 * half on line 2. Leaving the clause here would have cost a leaf whose only
 * metadata was its estimate a second line with nothing but a hover control on
 * it.
 */
export function metaPlacement(n: GoalNode, today: string): MetaPlacement {
  if (scheduleCell(n, today) !== null) return 'below';
  // The RAW field, never the resolved value: `demandIndex` inherits a goal's
  // value onto every leaf, and thirty rows saying "Deep" is a column that says
  // one word thirty times.
  if (n.demand !== undefined) return 'below';
  if (stepStatus(n) === 'blocked' && n.blockedOn) return 'below';
  return 'inline';
}
