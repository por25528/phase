import type { BusyBlock, Goal, Task } from '../../db/types';
import type { Interval } from '../../lib/capacity';
import { assignLanes, type LaneSpan } from '../../lib/grid';
import { scheduledOn } from '../../lib/scheduled';
import { EventBlock, type GridBlock } from './EventBlock';
import type { PlanDragData } from './dropTarget';

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
 * `blocks` is always `[]` in this slice (Plan.tsx has no real calendar feed
 * yet — that arrives in a later task), so the busy/all-day path below is
 * currently unexercised. It still has to be correct when it lights up.
 */
export function DayBlocks({
  date, goals, tasks, blocks, range, allDayBlocks, readOnly, onRemove, onComplete, onResize,
  gridHeightPx,
}: {
  date: string;
  goals: Goal[];
  tasks: Task[];
  blocks: BusyBlock[];
  range: Interval;
  allDayBlocks: boolean;
  /**
   * True on a past week — suppresses the remove (×) affordance, the completion
   * (✓) affordance and the resize handle.
   */
  readOnly?: boolean;
  onRemove: (kind: 'step' | 'task', id: string, goalId: string | null) => void;
  /** No `goalId`: both `toggleTask` and `toggleLeaf` key off the id alone. */
  onComplete: (kind: 'step' | 'task', id: string) => void;
  onResize: (kind: 'step' | 'task', id: string, minutes: number) => void;
  gridHeightPx: number;
}) {
  const work: DayItem[] = scheduledOn(goals, tasks, date).map((item) => ({
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

  const dayBlocks = blocks.filter((b) => b.date === date);
  const timedBlocks = dayBlocks.filter((b) => !b.allDay);
  const allDayEvent = allDayBlocks ? dayBlocks.find((b) => b.allDay) : undefined;

  const busy: DayItem[] = allDayEvent
    ? [{
        // An all-day event, when the preference treats it as occupying the
        // whole day, is rendered as a single busy block spanning the entire
        // visible range — so the day reads as unavailable rather than open.
        key: `busy:${date}:allday`,
        kind: 'busy',
        title: allDayEvent.title,
        startMin: range.startMin,
        endMin: range.endMin,
        done: false,
        estimated: true,
        goalId: null,
        id: null,
      }]
    : timedBlocks.map((b, i) => ({
        key: `busy:${date}:${i}`,
        kind: 'busy' as const,
        title: b.title,
        startMin: b.startMin,
        endMin: b.endMin,
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
            range={range}
            gridHeightPx={gridHeightPx}
            drag={drag}
            onRemove={
              isWork && !readOnly ? () => onRemove(item.kind as 'step' | 'task', item.id!, item.goalId) : undefined
            }
            onComplete={
              isWork && !readOnly ? () => onComplete(item.kind as 'step' | 'task', item.id!) : undefined
            }
            onResize={
              isWork && !readOnly ? (minutes) => onResize(item.kind as 'step' | 'task', item.id!, minutes) : undefined
            }
          />
        );
      })}
    </>
  );
}
