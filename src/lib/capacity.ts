import type { AvailabilityWindow, BusyBlock } from '../db/types';
import { windowForDate } from './availability';

/**
 * The current moment, injected. Capacity is measured from here forward, so this
 * module stays pure and every result is deterministic in tests.
 */
export interface Now {
  date: string;   // 'YYYY-MM-DD' local
  minute: number; // minutes from local midnight
}

export interface Interval {
  startMin: number;
  endMin: number;
}

/**
 * Collapse intervals into a disjoint, ascending set. Two overlapping meetings
 * must contribute their UNION — summing their durations would deduct the
 * overlap twice and understate free time.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.startMin - b.startMin);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, cur.endMin);
    } else {
      out.push({ startMin: cur.startMin, endMin: cur.endMin });
    }
  }
  return out;
}

/**
 * The part of `date`'s availability window that is still ahead of `now`.
 * Returns null when the day is off, already past, or its window has closed.
 */
function remainingWindow(
  date: string,
  windows: AvailabilityWindow[],
  now: Now,
): Interval | null {
  if (date < now.date) return null; // the past is not capacity
  const w = windowForDate(date, windows);
  if (!w) return null;
  const startMin = date === now.date ? Math.max(w.startMin, now.minute) : w.startMin;
  return startMin < w.endMin ? { startMin, endMin: w.endMin } : null;
}

/**
 * Minutes still available on `date`: the remaining availability window minus
 * the merged busy time intersecting it.
 *
 * `allDayBlocks` is applied HERE, at read time, rather than at fetch time — so
 * toggling the preference never requires a refetch (spec §3.2).
 */
export function freeMinutes(
  date: string,
  windows: AvailabilityWindow[],
  blocks: BusyBlock[],
  now: Now,
  allDayBlocks: boolean,
): number {
  const win = remainingWindow(date, windows, now);
  if (!win) return 0;

  const today = blocks.filter((b) => b.date === date && (allDayBlocks || !b.allDay));
  if (today.some((b) => b.allDay)) return 0; // an all-day event consumes the day

  const busy = mergeIntervals(today).reduce((sum, b) => {
    const start = Math.max(b.startMin, win.startMin);
    const end = Math.min(b.endMin, win.endMin);
    return sum + Math.max(0, end - start);
  }, 0);

  return Math.max(0, (win.endMin - win.startMin) - busy);
}
