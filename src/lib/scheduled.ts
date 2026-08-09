import type { Goal, Task } from '../db/types';
import { normalizeEstimate } from './capacity';
import { walkLeaves } from './plan';
import { type PlacedSpan } from './slot';
import { blocksOf, blocksOn } from './blocks';
import { isDone } from './status';

/** One block on the grid, from either kind of commitment. */
export interface ScheduledItem {
  kind: 'step' | 'task';
  id: string;              // nodeId or taskId
  /**
   * WHICH sitting this is.
   *
   * A task can have several, so `id` stopped being unique per drawn block the
   * moment blocks became a list — it is no longer a usable React key, and it is
   * no longer the right thing to exclude when repositioning one sitting, which
   * must not be allowed to collide with itself but must still respect its
   * siblings.
   */
  blockId: string;
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
 * A leaf or task contributes one item PER SITTING on that day — so a task split
 * into a morning hour and an afternoon hour draws twice, from one task, without
 * being duplicated anywhere it is counted.
 *
 * A block's height comes from its own `minutes`, not from the estimate. That is
 * the difference the split bought: resizing one sitting changes that sitting,
 * and two sittings of a three-hour task are not two three-hour bars.
 */
export function scheduledOn(goals: Goal[], tasks: Task[], date: string): ScheduledItem[] {
  const out: ScheduledItem[] = [];

  for (const g of goals) {
    if (g.completedAt) continue; // archived projects never surface commitments
    walkLeaves(g, (n) => {
      for (const b of blocksOn(n, date)) {
        out.push({
          kind: 'step', id: n.id, blockId: b.id, goalId: g.id, goalTitle: g.title,
          title: n.title, done: isDone(n), date, startMin: b.startMin,
          endMin: b.startMin + b.minutes,
          estimated: normalizeEstimate(n.estimateMin) !== undefined,
        });
      }
    });
  }

  for (const t of tasks) {
    for (const b of blocksOn(t, date)) {
      out.push({
        kind: 'task', id: t.id, blockId: b.id, goalId: t.goalId, goalTitle: '',
        title: t.title, done: t.done, date, startMin: b.startMin,
        endMin: b.startMin + b.minutes,
        estimated: normalizeEstimate(t.estimateMin) !== undefined,
      });
    }
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
      for (const b of blocksOf(n)) {
        const bucket = out.get(b.date);
        if (!bucket) continue;
        bucket.push({
          kind: 'step', id: n.id, blockId: b.id, goalId: g.id, goalTitle: g.title,
          title: n.title, done: isDone(n), date: b.date, startMin: b.startMin,
          endMin: b.startMin + b.minutes,
          estimated: normalizeEstimate(n.estimateMin) !== undefined,
        });
      }
    });
  }

  for (const t of tasks) {
    for (const b of blocksOf(t)) {
      const bucket = out.get(b.date);
      if (!bucket) continue;
      bucket.push({
        kind: 'task', id: t.id, blockId: b.id, goalId: t.goalId, goalTitle: '',
        title: t.title, done: t.done, date: b.date, startMin: b.startMin,
        endMin: b.startMin + b.minutes,
        estimated: normalizeEstimate(t.estimateMin) !== undefined,
      });
    }
  }

  for (const bucket of out.values()) {
    bucket.sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
  }
  return out;
}

/**
 * The occupied spans on `date`, for `resolveSlot`'s `placed` argument.
 *
 * `exclude` drops SITTINGS, by block id — never by task id. The distinction
 * carries two different intents:
 *
 * - Moving one bar excludes just that bar, or it collides with its own current
 *   position and can never be repositioned inside the gap it already occupies.
 *   Its task's OTHER sittings stay in, because they are real occupancy it has
 *   to work around.
 * - REPLACING a task's placement excludes all of them, because every one is
 *   about to be removed — leaving them in makes the task collide with the self
 *   it is in the middle of vacating, and the drop slides past its own aim.
 */
export function spansOn(
  goals: Goal[],
  tasks: Task[],
  date: string,
  exclude?: string | ReadonlySet<string>,
): PlacedSpan[] {
  const drop = typeof exclude === 'string' ? new Set([exclude]) : exclude;
  return scheduledOn(goals, tasks, date)
    .filter((i) => !drop?.has(i.blockId))
    .map((i) => ({ startMin: i.startMin, endMin: i.endMin }));
}
