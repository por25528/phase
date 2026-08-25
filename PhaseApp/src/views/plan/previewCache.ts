import { SLOT_GRANULARITY_MIN } from '../../lib/slot';

/** What `previewPlacement` answers: a resolved slot, or nothing to draw. */
export type PreviewSlot = { startMin: number; durationMin: number } | null;

/**
 * Everything the answer depends on.
 *
 * The last three are the drag: which day, where in it, and which sitting (if
 * any) is being moved. The first three are the WORLD — `previewPlacement` walks
 * `state.goals` and `state.tasks` through `spansOn`, and reads `allDayBlocks`,
 * so a write landing mid-drag has to invalidate. Identity is the right test:
 * every store write replaces those arrays rather than mutating them, and
 * `Plan.tsx` re-renders on the new ones, so a stale closure cannot be the thing
 * that answers.
 *
 * Nothing writes to the calendar from the UI while a drag is in the air, but
 * the agent socket can (`agentWrites.ts` dispatches into the same actions at
 * any moment), and a cache that could not see that would be lying rather than
 * merely slow.
 */
export interface PreviewInputs {
  goals: readonly unknown[];
  tasks: readonly unknown[];
  allDayBlocks: boolean;
  date: string;
  aimMin: number;
  itemId: string;
  blockId?: string;
}

/**
 * The aim, coarsened to the grid the search will snap it to anyway.
 *
 * `resolveSlot` does `Math.round(aim / SLOT_GRANULARITY_MIN) * ...` before it
 * looks for a gap, so two aims in the same 5-minute bucket cannot produce
 * different answers. Rounding here is therefore not a second opinion about
 * where the block goes — the raw aim is still what gets passed to the store,
 * and this only decides whether the store is asked at all. It imports the
 * constant rather than restating `5` precisely so the two cannot drift: a
 * finer granularity there with a coarser bucket here would serve stale slots.
 */
export function bucketAim(aimMin: number): number {
  return Math.round(aimMin / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN;
}

function same(a: PreviewInputs, b: PreviewInputs): boolean {
  return a.goals === b.goals
    && a.tasks === b.tasks
    && a.allDayBlocks === b.allDayBlocks
    && a.date === b.date
    && a.itemId === b.itemId
    && a.blockId === b.blockId
    && bucketAim(a.aimMin) === bucketAim(b.aimMin);
}

export interface PreviewCache {
  /** The cached slot for these inputs, or `compute()` — remembered. */
  read(inputs: PreviewInputs, compute: () => PreviewSlot): PreviewSlot;
  /** Forget. Called at drag start and at drag end. */
  clear(): void;
}

/**
 * One slot, remembered for the length of one drag.
 *
 * **What it saves.** `previewPlacement` → `resolvePlacement` → `spansOn` builds
 * a fresh `Set` of the item's block ids and walks the ENTIRE goal forest plus
 * the whole task list, and then `resolveSlot` recomputes the day's free
 * intervals from the result. dnd-kit fires `onDragMove` on every pointermove
 * AND on every autoscroll frame, so on a large database that walk was the
 * heaviest thing on the drag path — and `handleDragMove`'s identity check only
 * spared the React re-render, never the work that produced the identical answer.
 *
 * **How much.** The grid is 1px per minute (`PX_PER_MINUTE`), so a drag from
 * 09:00 to 18:00 crosses 540 minutes and, dragged slowly, emits on the order of
 * one move event per pixel — several hundred walks, one per event, plus one per
 * autoscroll frame while the view follows. The answer only changes per 5-minute
 * bucket, so that same drag now costs at most 108 walks in a column: the
 * recompute count is bounded by the number of distinct `(date, 5-minute slot,
 * blockId)` triples the drag actually VISITS, not by the number of events it
 * generates. Horizontal travel within one column, sub-pixel jitter and every
 * autoscroll frame that does not carry the ghost into the next bucket are all
 * free. It is a ~5× floor and much better than that in practice.
 *
 * **Never across drags.** `Plan.tsx` clears it on `onDragStart` and on
 * `onDragEnd`/`onDragCancel`. A cache that outlived the drag would be keyed on
 * a world that has just been written to by the drop it was serving.
 */
export function makePreviewCache(): PreviewCache {
  let last: { inputs: PreviewInputs; slot: PreviewSlot } | null = null;
  return {
    read(inputs, compute) {
      if (last && same(last.inputs, inputs)) return last.slot;
      const slot = compute();
      last = { inputs, slot };
      return slot;
    },
    clear() {
      last = null;
    },
  };
}
