import { useAppStore } from '../state/store';
import { PopoverItem, PopoverSeparator } from './Popover';
import { addDays, todayStr } from '../lib/dates';
import { isPlaced } from '../lib/blocks';
import type { GoalNode } from '../db/types';

/**
 * The verbs behind a task's WHEN cell.
 *
 * Scheduling was reachable from the inspector and from a drag onto the Plan
 * grid, and from nowhere on the row itself — so the most common thing to do to
 * a task you are looking at cost either a click into a panel or a trip to
 * another surface. The cell already states the answer; this makes it the
 * control that sets it.
 *
 * `aimMin: 0` means "the earliest gap that fits", the same rule `replanNode`
 * uses. The store resolves the slot and refuses with a toast when the day has
 * no room, so there is exactly one place that decides where a block lands and
 * exactly one sentence for "no room" — nothing here is optimistic and there is
 * nothing to roll back.
 */
export function ScheduleMenu({
  goalId,
  node,
  close,
}: {
  goalId: string;
  node: GoalNode;
  close: () => void;
}) {
  const { actions } = useAppStore();
  const placed = isPlaced(node);
  // A week commitment with no sitting yet (`plannedWeek` set, no `blocks`) is
  // still something to clear. Gating on `placed` alone left it unclearable from
  // every surface that opens this menu — a leaf row's WHEN cell in `GoalTree`
  // and `TaskPage`'s Schedule chip. `StepPanel` used to paper over that with a
  // hardcoded Clear button of its own; it no longer serves leaves, so the gap
  // it was hiding is fixed here instead, for both remaining callers at once.
  const committed = placed || node.plannedWeek !== undefined;

  return (
    <>
      <PopoverItem close={close} onSelect={() => actions.scheduleNode(goalId, node.id, todayStr(), 0)}>
        Today
      </PopoverItem>
      <PopoverItem
        close={close}
        onSelect={() => actions.scheduleNode(goalId, node.id, addDays(todayStr(), 1), 0)}
      >
        Tomorrow
      </PopoverItem>
      <PopoverItem close={close} onSelect={() => actions.replanNode(goalId, node.id)}>
        Next free slot
      </PopoverItem>
      {placed && (
        <PopoverItem
          close={close}
          onSelect={() => actions.scheduleNode(goalId, node.id, todayStr(), 0, { mode: 'add' })}
        >
          Sit again today
        </PopoverItem>
      )}
      {committed && (
        <>
          <PopoverSeparator />
          {/* Unschedule with no block id clears EVERY sitting AND the week
              commitment itself — the same "all of them" this menu's own
              summary counts, and the only thing to clear when there is no
              sitting yet. */}
          <PopoverItem close={close} tone="danger" onSelect={() => actions.unscheduleNode(goalId, node.id)}>
            Clear schedule
          </PopoverItem>
        </>
      )}
    </>
  );
}
