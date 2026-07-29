import type { Goal, Task } from '../db/types';
import { normalizeEstimate } from './capacity';
import { walkLeaves } from './plan';
import { durationOf, type PlacedSpan } from './slot';

/** One block on the grid, from either kind of commitment. */
export interface ScheduledItem {
  kind: 'step' | 'task';
  id: string;              // nodeId or taskId
  goalId: string | null;
  goalTitle: string;       // '' for a task with no project
  title: string;
  done: boolean;
  date: string;
  startMin: number;
  endMin: number;
  estimated: boolean;      // false ⇒ using the DEFAULT_SLOT_MIN fallback
}

/**
 * Everything drawn on `date`, in start order.
 *
 * An item counts as scheduled only when it has BOTH a day and a start minute —
 * the invariant from the spec. A half-state is skipped rather than guessed at,
 * so a bug that writes one field without the other stays visible instead of
 * silently rendering at midnight.
 */
export function scheduledOn(goals: Goal[], tasks: Task[], date: string): ScheduledItem[] {
  const out: ScheduledItem[] = [];

  for (const g of goals) {
    if (g.completedAt) continue; // archived projects never surface commitments
    walkLeaves(g, (n) => {
      if (n.plannedDay !== date || n.plannedStartMin === undefined) return;
      const duration = durationOf(n.estimateMin);
      out.push({
        kind: 'step', id: n.id, goalId: g.id, goalTitle: g.title, title: n.title,
        done: !!n.done, date, startMin: n.plannedStartMin,
        endMin: n.plannedStartMin + duration,
        estimated: normalizeEstimate(n.estimateMin) !== undefined,
      });
    });
  }

  for (const t of tasks) {
    if (t.date !== date || t.startMin === undefined) continue;
    const duration = durationOf(t.estimateMin);
    out.push({
      kind: 'task', id: t.id, goalId: t.goalId, goalTitle: '', title: t.title,
      done: t.done, date, startMin: t.startMin, endMin: t.startMin + duration,
      estimated: normalizeEstimate(t.estimateMin) !== undefined,
    });
  }

  return out.sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
}

/**
 * The occupied spans on `date`, for `resolveSlot`'s `placed` argument.
 *
 * `excludeId` drops one item. Moving an already-placed block MUST exclude
 * itself, or it collides with its own current position and can never be
 * repositioned inside the gap it already occupies.
 */
export function spansOn(
  goals: Goal[],
  tasks: Task[],
  date: string,
  excludeId?: string,
): PlacedSpan[] {
  return scheduledOn(goals, tasks, date)
    .filter((i) => i.id !== excludeId)
    .map((i) => ({ startMin: i.startMin, endMin: i.endMin }));
}
