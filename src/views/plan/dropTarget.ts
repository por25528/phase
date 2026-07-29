import type { Interval } from '../../lib/capacity';
import { pctToMinute } from '../../lib/grid';

/** What a draggable carries. `goalId` is null for tasks. */
export interface PlanDragData {
  kind: 'step' | 'task';
  id: string;
  goalId: string | null;
  title: string;
}

/**
 * The minute a drop at `clientY` is aiming at.
 *
 * Clamped to the range: a drop released above or below the column still means
 * "the earliest/latest time shown" rather than an out-of-range minute that
 * resolveSlot would silently push somewhere surprising.
 */
export function aimMinuteFor(
  clientY: number,
  rectTop: number,
  rectHeight: number,
  range: Interval,
): number {
  if (rectHeight <= 0) return range.startMin;
  const pct = ((clientY - rectTop) / rectHeight) * 100;
  const minute = pctToMinute(pct, range);
  return Math.round(Math.min(Math.max(minute, range.startMin), range.endMin));
}
