import type { Task } from '../db/types';
import { normalizeEstimate } from './capacity';
import type { PlannedLeaf } from './plan';

/**
 * One commitment the week's capacity arithmetic could not price.
 *
 * `kind`/`id` are exactly what `revealInPlan` and `revealDomId` take, so a row
 * here can point at either the backlog row or the grid block that represents
 * the same item — whichever the item currently is.
 */
export interface UnestimatedItem {
  kind: 'step' | 'task';
  id: string;
  title: string;
  /** The owning project, for disambiguation. Null for a loose task. */
  goalId: string | null;
  goalTitle?: string;
  /** True when the item is already on the grid, so its block height is a guess. */
  placed: boolean;
}

/**
 * The commitments behind `WeekCapacity.unestimated`.
 *
 * This MUST agree with `workloadOf` in capacity.ts, which is what produces the
 * count: an item is unestimated when it is unfinished and carries no usable
 * estimate, where "usable" is `normalizeEstimate` and nothing else. The count
 * and the list are rendered next to each other — a header saying "4
 * unestimated" that opens a list of three is worse than no list at all, so the
 * predicate is imported from the same module rather than re-expressed here.
 *
 * Placed and unplaced work are both included, for the same reason
 * `weekCapacity` sums `placed.unestimated + waiting.unestimated`: an
 * unestimated item on the grid is drawn at `DEFAULT_SLOT_MIN` and contributes
 * nothing to `plannedMin`, so it is exactly as invisible to the arithmetic as
 * one still sitting in the rail.
 *
 * Order is leaves before tasks, each in the order given. Callers pass
 * already-filtered, already-sorted week sets, so this adds no ordering of its
 * own — the list reads in the same order as the rail it sits above.
 */
export function unestimatedCommitments(
  leaves: PlannedLeaf[],
  tasks: Task[],
  goalTitleById?: Map<string, string>,
): UnestimatedItem[] {
  const out: UnestimatedItem[] = [];

  for (const leaf of leaves) {
    if (leaf.done) continue;
    if (normalizeEstimate(leaf.estimateMin) !== undefined) continue;
    out.push({
      kind: 'step',
      id: leaf.nodeId,
      title: leaf.title,
      goalId: leaf.goalId,
      goalTitle: leaf.goalTitle,
      placed: leaf.plannedDay !== undefined && leaf.plannedStartMin !== undefined,
    });
  }

  for (const task of tasks) {
    if (task.done) continue;
    if (normalizeEstimate(task.estimateMin) !== undefined) continue;
    out.push({
      kind: 'task',
      id: task.id,
      title: task.title,
      goalId: task.goalId,
      goalTitle: task.goalId ? goalTitleById?.get(task.goalId) : undefined,
      placed: task.date !== undefined && task.startMin !== undefined,
    });
  }

  return out;
}
