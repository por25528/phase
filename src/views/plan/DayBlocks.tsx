import type { BusyBlock } from '../../db/types';
import { dayBusySpans } from '../../lib/busyLayout';
import { assignLanes, type LaneSpan } from '../../lib/grid';
import type { ScheduledItem } from '../../lib/scheduled';
import { EventBlock, type GridBlock } from './EventBlock';
import type { PlanDragData } from './dropTarget';
import { revealDomId, type RevealTarget } from '../../lib/reveal';

/**
 * One layout-ready entry: geometry (`startMin`/`endMin`, for `assignLanes`)
 * plus everything `EventBlock` and the remove handler need. Building this in
 * one pass means `assignLanes` hands back `item` fully formed — no lookup
 * map, no re-parsing a key to recover an id, no second `scheduledOn` call.
 */
interface DayItem extends LaneSpan {
  key: string;
  kind: 'step' | 'task' | 'busy';
  title: string;
  done: boolean;
  estimated: boolean;
  goalId: string | null; // null for busy
  id: string | null;     // nodeId or taskId; null for busy
}

/**
 * Everything drawn inside one day column.
 *
 * Work and calendar events go through ONE assignLanes pass. Placed work never
 * overlaps other placed work, but it can overlap an event that landed in the
 * calendar after it was scheduled — laying them out together is what keeps
 * that case legible instead of stacking one on top of the other.
 *
 * `blocks` is still `[]` from Plan.tsx until the renderer wiring lands, but
 * the layout rules are no longer inline and unexercised: they live in
 * `src/lib/busyLayout.ts` with a sibling test that pins the two defects this
 * path used to carry.
 */
export function DayBlocks({
  date, items, blocks, allDayBlocks, readOnly, onRemove, onComplete, onResize,
  reveal,
}: {
  date: string;
  /** This day's slice of `scheduledByDate` — already filtered and sorted. */
  items: ScheduledItem[];
  blocks: BusyBlock[];
  allDayBlocks: boolean;
  /**
   * True on a past week — suppresses the remove (×) affordance and the resize
   * handle.
   *
   * Deliberately NOT the completion (✓) affordance. `readOnly` exists to stop
   * you rescheduling history: moving, resizing or unscheduling work in a week
   * that has already happened. Ticking something off is not editing the plan,
   * it is recording what happened to it — and work scheduled last Thursday and
   * finished but never ticked is not in the backlog either (it has a day and a
   * start minute, so `backlogGroups` excludes it), so gating ✓ here would leave
   * it with no route to done anywhere in the app. Do not "restore consistency"
   * by adding `!readOnly` below.
   */
  readOnly?: boolean;
  onRemove: (kind: 'step' | 'task', id: string, goalId: string | null) => void;
  /** No `goalId`: both `toggleTask` and `toggleLeaf` key off the id alone. */
  onComplete: (kind: 'step' | 'task', id: string) => void;
  onResize: (kind: 'step' | 'task', id: string, minutes: number) => void;
  /** Task the command palette is pointing at — marked wherever it turns up. */
  reveal?: RevealTarget | null;
}) {
  // Handed in, not re-derived. This used to call `scheduledOn(goals, tasks,
  // date)` itself — a full walk of every goal's leaf tree plus every task, once
  // per day column, on top of the identical seven passes Plan itself had
  // already done. Plan no longer does those passes either; the `scheduledSpans`
  // memo that used to compute them was deleted in favour of `scheduledByDate`.
  const work: DayItem[] = items.map((item) => ({
    key: `${item.kind}:${item.id}`,
    kind: item.kind,
    title: item.title,
    startMin: item.startMin,
    endMin: item.endMin,
    done: item.done,
    estimated: item.estimated,
    goalId: item.goalId,
    id: item.id,
  }));

  const busy: DayItem[] = dayBusySpans(date, blocks, allDayBlocks).map((span) => ({
    key: span.key,
    kind: 'busy' as const,
    title: span.title,
    startMin: span.startMin,
    endMin: span.endMin,
    done: false,
    estimated: true,
    goalId: null,
    id: null,
  }));

  const laid = assignLanes([...work, ...busy]);

  return (
    <>
      {laid.map(({ item, lane, laneCount }) => {
        const block: GridBlock = {
          key: item.key,
          kind: item.kind,
          title: item.title,
          startMin: item.startMin,
          endMin: item.endMin,
          done: item.done,
          estimated: item.estimated,
          goalId: item.goalId,
        };
        const isWork = item.kind !== 'busy' && item.id !== null;
        const drag: PlanDragData | undefined = isWork
          ? { kind: item.kind as 'step' | 'task', id: item.id!, goalId: item.goalId, title: item.title }
          : undefined;
        return (
          <EventBlock
            key={item.key}
            block={block}
            lane={lane}
            laneCount={laneCount}
            drag={drag}
            onRemove={
              isWork && !readOnly ? () => onRemove(item.kind as 'step' | 'task', item.id!, item.goalId) : undefined
            }
            onComplete={
              // Not gated on `readOnly` — see the prop's note above.
              isWork ? () => onComplete(item.kind as 'step' | 'task', item.id!) : undefined
            }
            onResize={
              isWork && !readOnly ? (minutes) => onResize(item.kind as 'step' | 'task', item.id!, minutes) : undefined
            }
            // A revealed task can be in the rail OR already on the grid; only
            // one of the two renders it, so both carry the same id and mark.
            domId={isWork ? revealDomId(item.kind as 'step' | 'task', item.id!) : undefined}
            revealed={reveal != null && reveal.kind === item.kind && reveal.id === item.id}
          />
        );
      })}
    </>
  );
}
