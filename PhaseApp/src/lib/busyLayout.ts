import type { BusyBlock } from '../db/types';
import { DAY_START_MIN, DAY_END_MIN } from './grid';

/** One calendar event as the grid needs it: geometry plus a label. */
export interface BusySpan {
  key: string;
  title: string;
  startMin: number;
  endMin: number;
}

/**
 * The calendar events one day column draws.
 *
 * Two rules, and they exist because the grid must never contradict the day
 * header beside it — `capacity.ts`'s `blockedBy` filters on exactly
 * `(allDayBlocks || !b.allDay)`, and this must agree with it:
 *
 * 1. **Timed events always render**, including on a day that also carries an
 *    all-day event. The previous inline version returned either the all-day
 *    block or the timed ones, so a day header could read
 *    `blocked by: standup, 1:1, offsite` above a column showing one slab.
 * 2. **All all-day events on a date collapse into ONE full-height span** with
 *    joined titles. The previous version took only the first, silently
 *    dropping the rest. Joining mirrors how overlapping blocks join titles in
 *    `electron/busyBlocks.cjs`.
 *
 * The all-day span comes first so it wins `assignLanes`' tie among blocks with
 * identical bounds and usually draws in lane 0. A minute-zero block with an
 * earlier end (a multi-day timed event's continuation day) sorts ahead and
 * takes lane 0 instead; this is cosmetic — timed-event geometry is unchanged.
 *
 * Plan 3 will re-point this full-height 1440px span into the all-day LANE.
 */
export function dayBusySpans(date: string, blocks: BusyBlock[], allDayBlocks: boolean): BusySpan[] {
  const forDay = blocks.filter((b) => b.date === date);
  const spans: BusySpan[] = forDay
    .filter((b) => !b.allDay)
    .map((b, i) => ({ key: `busy:${date}:${i}`, title: b.title, startMin: b.startMin, endMin: b.endMin }));

  if (!allDayBlocks) return spans;

  const allDay = forDay.filter((b) => b.allDay);
  if (allDay.length === 0) return spans;

  return [
    {
      key: `busy:${date}:allday`,
      title: allDay.map((b) => b.title).join(', '),
      startMin: DAY_START_MIN,
      endMin: DAY_END_MIN,
    },
    ...spans,
  ];
}
