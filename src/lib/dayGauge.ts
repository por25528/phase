import type { AvailabilityWindow } from '../db/types';
import type { Interval, Now } from './capacity';
import { dowOf } from './availability';

/**
 * Today's working window, as geometry.
 *
 * Phase already knew the shape of your day — when the window opens, what is
 * booked inside it, and where the clock is — and said all of it in prose, one
 * clause at a time, in three different places. This turns those same facts into
 * one drawing: a track spanning the window, the sittings placed on it, ticks
 * you can read a value off, and a mark where you are standing.
 *
 * Two rules govern everything below.
 *
 * **It draws; it does not judge.** There is no capacity figure here and there
 * must never be one. Any number printed beside the gauge comes from the
 * `weekCapacity` / `offerHeading` path Today already spends, because two
 * numbers on one page that get compared to each other have to be ONE
 * derivation — the same rule `capacityMeter` is written down for, and it is
 * written down because it was broken once. In particular this module cannot
 * see busy blocks or the all-day preference, so any "free" it computed would
 * be a second, wronger answer to a question the page already answers.
 *
 * **It re-derives nothing.** The window comes from the `availability` slice via
 * `dowOf`, and the sittings arrive as `Interval`s already resolved by
 * `scheduledOn` — which reaches `WorkBlock`s through `blocks.ts`, the one
 * module allowed to speak about them. Nothing here reads a `blocks` field.
 */

/** A span of the track, as fractions of the hull. What a renderer positions. */
export interface GaugeSpan {
  startFrac: number;
  widthFrac: number;
}

/** A scale mark: where it sits, and the clock minute it stands for. */
export interface GaugeTick {
  frac: number;
  minute: number;
}

export interface DayGauge {
  /** The hull of the day's windows — the track's own scale, in minutes. */
  startMin: number;
  endMin: number;
  /**
   * The open parts of the day. Exactly one span covering the whole track
   * whenever the day has a single window, which is every day the current
   * availability model can produce; see `dayGauge` below.
   */
  open: GaugeSpan[];
  /** Sittings placed on the day, clipped to the hull, in start order. */
  blocks: GaugeSpan[];
  /** Every two-hour clock mark strictly inside the hull. */
  ticks: GaugeTick[];
  /**
   * Where the clock is — `null` for any day but today, and also `null` when
   * today's clock sits outside the window entirely. A marker pinned to the
   * track's edge would claim you are at the start of a day that has not opened
   * yet, or at the end of one that closed hours ago; both are positions on the
   * scale, and neither is where you are.
   */
  nowFrac: number | null;
  /**
   * The clock itself, when it is on the scale — always `null` exactly when
   * `nowFrac` is. It is carried rather than left to the renderer because
   * inverting a fraction back into a minute is float arithmetic that reads
   * `12:59` for one o'clock, and the legend beside the marker has to agree
   * with the marker.
   */
  nowMinute: number | null;
  /**
   * How much of the window is behind you: 0 before it opens, 1 after it
   * closes, and `null` on any day but today.
   *
   * Separate from `nowFrac` precisely so each field means one thing. `null`
   * here is the tense rule — a gauge drawn for a day that is not today dims
   * nothing, because "spent" is not a fact about tomorrow.
   */
  spentFrac: number | null;
}

const TICK_EVERY_MIN = 120;

/**
 * Build the day's gauge, or `null` when there is nothing to draw.
 *
 * `null` is the no-window case and it is a REFUSAL, not a zero. Today keeps
 * saying "no working hours set" in words; a flat empty bar would answer "you
 * are out of time" to someone who was never asked when they work, exactly the
 * distinction `goalHealth` draws between `no-forecast` and `at-risk` and
 * `todayPlan` draws between `no-hours` and an empty offer.
 *
 * `windows` is the availability slice whole, and every window matching the
 * date's weekday is taken — not the first. `parseAvailability` rejects a
 * duplicate `dow`, so today that filter always yields zero or one and `open`
 * is a single full-width span the renderer can paint without a special case.
 * It is a filter rather than a `windowForDate` because the geometry for two
 * windows and the geometry for one are the same six lines, while a version
 * written against a single window would have to be rewritten the day a lunch
 * break splits a day in half — and the hull-plus-open-spans shape already
 * draws that gap correctly for free.
 */
export function dayGauge(input: {
  date: string;
  windows: AvailabilityWindow[];
  /**
   * The day's sittings. `Interval` is the app's existing vocabulary for a
   * slice of one day (`remainingWindow`, `mergeIntervals`), and it is what
   * `scheduledOn` already hands out — so Today passes its rows through with no
   * conversion and no second walk of the tree.
   */
  sittings: readonly Interval[];
  now: Now;
}): DayGauge | null {
  const { date, windows, sittings, now } = input;

  const dow = dowOf(date);
  const open = windows.filter((w) => w.dow === dow).sort((a, b) => a.startMin - b.startMin);
  if (open.length === 0) return null;

  const startMin = open[0].startMin;
  const endMin = open.reduce((max, w) => Math.max(max, w.endMin), open[0].endMin);
  const span = endMin - startMin;
  // Guarded rather than trusted: `isWindow` enforces startMin < endMin on
  // anything `parseAvailability` returns, but this module also takes windows
  // straight from a caller, and a zero span would divide every fraction below
  // by nothing.
  if (span <= 0) return null;

  const frac = (minute: number): number => (minute - startMin) / span;

  const toSpan = (a: number, b: number): GaugeSpan => ({
    startFrac: frac(a),
    widthFrac: (b - a) / span,
  });

  /**
   * Sittings are CLIPPED to the window, never allowed to stretch it.
   *
   * The gauge's scale is the working day, and a stray 23:00 block would
   * rescale the whole instrument so the hours you actually work no longer read
   * at their true proportion — the one thing a drawing-to-scale is for. A
   * block that falls entirely outside contributes nothing here and is still a
   * row on the page: the gauge is a SECOND reading of what the page already
   * says, never the only one.
   */
  const blocks = sittings
    .map((b) => ({ startMin: Math.max(b.startMin, startMin), endMin: Math.min(b.endMin, endMin) }))
    .filter((b) => b.endMin > b.startMin)
    .sort((a, b) => a.startMin - b.startMin)
    .map((b) => toSpan(b.startMin, b.endMin));

  const ticks: GaugeTick[] = [];
  for (
    let minute = Math.ceil(startMin / TICK_EVERY_MIN) * TICK_EVERY_MIN;
    minute < endMin;
    minute += TICK_EVERY_MIN
  ) {
    // Strictly inside: a mark sitting on the track's own border is the border.
    if (minute > startMin) ticks.push({ frac: frac(minute), minute });
  }

  const isToday = now.date === date;
  const inWindow = isToday && now.minute >= startMin && now.minute <= endMin;

  return {
    startMin,
    endMin,
    open: open.map((w) => toSpan(Math.max(w.startMin, startMin), Math.min(w.endMin, endMin))),
    blocks,
    ticks,
    nowFrac: inWindow ? frac(now.minute) : null,
    nowMinute: inWindow ? now.minute : null,
    spentFrac: isToday ? Math.min(1, Math.max(0, frac(now.minute))) : null,
  };
}
