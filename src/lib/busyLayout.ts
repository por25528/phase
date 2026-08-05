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
 * The all-day span comes first so `assignLanes` — which sorts by start, then
 * end — puts it in lane 0 with the timed events beside it.
 *
 * A full-height span is 1440px on the remastered grid, which is a lot of
 * column. The all-day LANE in the grid remaster's plan 3 is where these
 * belong; this function is what that plan will re-point rather than rewrite.
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
