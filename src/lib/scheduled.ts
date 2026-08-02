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
 * Everything drawn across `dates`, bucketed by day, in ONE pass.
 *
 * `scheduledOn` walks every goal's full leaf tree and every task to answer for
 * a single day, so a week cost seven passes — and the Plan view used to pay
 * for that twice over, once itself and again inside each `DayBlocks`, for
 * fourteen full scans of the dataset on every render. With a couple of hundred
 * tasks and a 60-second now-line tick re-rendering the subtree, that is felt.
 *
 * Every requested date gets an entry, empty or not, so callers can index
 * without a null check. Ordering matches `scheduledOn` exactly, so the two stay
 * interchangeable.
 */
export function scheduledByDate(
  goals: Goal[],
  tasks: Task[],
  dates: string[],
): Map<string, ScheduledItem[]> {
  const out = new Map<string, ScheduledItem[]>();
  for (const date of dates) out.set(date, []);

  for (const g of goals) {
    if (g.completedAt) continue; // archived projects never surface commitments
    walkLeaves(g, (n) => {
      if (n.plannedDay === undefined || n.plannedStartMin === undefined) return;
      const bucket = out.get(n.plannedDay);
      if (!bucket) return;
      const duration = durationOf(n.estimateMin);
      bucket.push({
        kind: 'step', id: n.id, goalId: g.id, goalTitle: g.title, title: n.title,
        done: !!n.done, date: n.plannedDay, startMin: n.plannedStartMin,
        endMin: n.plannedStartMin + duration,
        estimated: normalizeEstimate(n.estimateMin) !== undefined,
      });
    });
  }

  for (const t of tasks) {
    if (t.date === undefined || t.startMin === undefined) continue;
    const bucket = out.get(t.date);
    if (!bucket) continue;
    const duration = durationOf(t.estimateMin);
    bucket.push({
      kind: 'task', id: t.id, goalId: t.goalId, goalTitle: '', title: t.title,
      done: t.done, date: t.date, startMin: t.startMin, endMin: t.startMin + duration,
      estimated: normalizeEstimate(t.estimateMin) !== undefined,
    });
  }

  for (const bucket of out.values()) {
    bucket.sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
  }
  return out;
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
