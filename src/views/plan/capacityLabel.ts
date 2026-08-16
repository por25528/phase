export function formatMinutes(min: number): string {
  const safe = Math.max(0, Math.round(min));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * The shape both DayCapacity and WeekCapacity satisfy. One formatter serves
 * both — day and week differ in what they aggregate, not in how they read.
 */
export interface CapacityFigures {
  freeMin: number;
  plannedMin: number;
  /** Committed but not on the calendar. See `DayCapacity.backlogMin`. */
  backlogMin: number;
  unestimated: number;
  hasData: boolean;
}

/**
 * Free / planned / unestimated as separate strings — never fused into one
 * number. A blended figure would read as authoritative while being partly
 * invented from work that carries no estimate (spec §4.4).
 *
 * The free figure is always rendered, even without calendar data: it is
 * derived from the availability window the user typed, so it is a real
 * number — just an upper bound until meetings are known. The "no calendar
 * data" caveat lives separately, in `capacityNote`.
 */
export function capacityParts(c: CapacityFigures): string[] {
  const unestimated = unestimatedLabel(c);
  return unestimated ? [...loadParts(c), unestimated] : loadParts(c);
}

/**
 * The priced part of the readout: free, planned, and committed-but-not-placed.
 *
 * Split out of `capacityParts` because the unestimated count is the one part
 * that is a CONTROL rather than a statement — it names work whose price is
 * unknown, and the only useful response is to go and price it. The week header
 * renders these as text and the count as a button; `capacityParts` still joins
 * all of them for the day heading's plain-text `title` tooltip, where nothing
 * can be clicked.
 */
export function loadParts(
  c: Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'backlogMin'>,
): string[] {
  const parts = [`${formatMinutes(c.freeMin)} free`];
  if (c.plannedMin > 0) parts.push(`${formatMinutes(c.plannedMin)} planned`);
  // Separate from "planned", because it is exactly the work the rail beside
  // this is listing under "To plan". Folding the two together made the header
  // claim hours were scheduled onto days that were visibly empty.
  if (c.backlogMin > 0) parts.push(`${formatMinutes(c.backlogMin)} to place`);
  return parts;
}

/**
 * The week's free figure, split by tense: what is still ahead, and what has
 * already gone.
 *
 * `weekCapacity` sums a PAST day's whole window into `freeMin` — the
 * NO_PAST_LIMIT rule, which is correct so retrospectives read "you had six
 * hours and planned two" rather than "you have nothing left". But it means the
 * week total is mostly ELAPSED time on any day but Monday: "45h free" on a
 * Saturday is 45 hours that were all Mon–Fri and are all gone. The header is
 * read as "how much can I still get done", and that number answers a different
 * question in the same font.
 *
 * So the free figure splits the way `planned`/`to place` already split. A day
 * is `spent` once its date is strictly before today; today's own remaining
 * window is `left`, because it genuinely still is. `leftMin` is derived from
 * the week total rather than re-summed from the future days, so `left + spent`
 * is exactly `freeMin` even if `days` is ever handed empty.
 */
export function weekFreeSplit(
  c: Pick<CapacityFigures, 'freeMin'> & { days: readonly { date: string; freeMin: number }[] },
  today: string,
): { leftMin: number; spentMin: number } {
  const spentMin = c.days.reduce((sum, d) => (d.date < today ? sum + d.freeMin : sum), 0);
  return { leftMin: Math.max(0, c.freeMin - spentMin), spentMin };
}

/**
 * The week header's priced parts, with the free figure split by tense.
 *
 * A fully-future week has nothing spent, so the split collapses back to a bare
 * `45h free` and the week reads exactly as it does today — a future week is
 * never made uglier to fix a current one. The planned / to-place tail is the
 * same as `loadParts`.
 */
export function weekLoadParts(
  c: Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'backlogMin'> & { days: readonly { date: string; freeMin: number }[] },
  today: string,
): string[] {
  const { leftMin, spentMin } = weekFreeSplit(c, today);
  const parts = spentMin === 0
    ? [`${formatMinutes(leftMin)} free`]
    : [`${formatMinutes(leftMin)} left`, `${formatMinutes(spentMin)} spent`];
  if (c.plannedMin > 0) parts.push(`${formatMinutes(c.plannedMin)} planned`);
  if (c.backlogMin > 0) parts.push(`${formatMinutes(c.backlogMin)} to place`);
  return parts;
}

/** `null` when everything is priced — there is then nothing to act on. */
export function unestimatedLabel(c: Pick<CapacityFigures, 'unestimated'>): string | null {
  return c.unestimated > 0 ? `${c.unestimated} unestimated` : null;
}

/**
 * The honesty signal split out of the free figure: tells the user the free
 * number does not yet account for meetings, without suppressing the number
 * itself.
 *
 * `hasData` means "the cache covers this range" — it is NOT the same as "a
 * calendar is connected". The two happen to coincide today only because
 * slice 1 ships no calendar integration at all, which is the only reason the
 * literal string 'calendar not connected' is accurate.
 *
 * Slice 2 breaks that coincidence: per the design spec §5.6, a provenance
 * mismatch (account/calendar/timezone changed, or range not covered) and an
 * expired/revoked refresh token both produce `hasData: false` while a
 * calendar IS connected. At that point this string becomes a false
 * statement. Slice 2 must derive this note from a richer state (e.g. an enum
 * of "not connected" / "stale" / "provenance mismatch" / "reconnect needed")
 * rather than the current boolean.
 *
 * Related trap, carried over from the deleted PlanWeekOverlay and worth
 * re-checking against WeekHeader, the current caller: the note was only shown
 * when `blockedBy.length === 0` (`blockedBy.length > 0 ? blockedBy :
 * capacityNote(...)`), which makes the caveat conditional on having no
 * blocks. In slice 2 a partially-populated, stale, or provenance-mismatched
 * cache can have `blockedBy` entries AND `hasData: false` simultaneously —
 * exactly the state this caveat exists to surface — so that conditional
 * would hide the note precisely when it matters most.
 */
export function capacityNote(c: Pick<CapacityFigures, 'hasData'>): string | null {
  return c.hasData ? null : 'calendar not connected';
}

/**
 * The compact per-day load for the grid's day headings: "1h 30m / 6h", read as
 * planned over free.
 *
 * `weekCapacity` has always computed a full `DayCapacity` for all seven days —
 * free, planned, unestimated, blockedBy — and nothing ever read it. The only
 * figure on screen was the week aggregate, so dropping four things onto Tuesday
 * told you nothing about Tuesday; you had to add the blocks up by eye. Every
 * calendar this is measured against surfaces per-day load.
 *
 * Null on a day with nothing planned that is not over-committed: seven columns
 * of "0m / 6h" is noise, and an empty day already looks empty. An off day with
 * work somehow on it still reports, because `0m free` is exactly the case worth
 * seeing.
 */
export function dayLoadLabel(c: Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'backlogMin'>): string | null {
  if (c.plannedMin === 0 && c.backlogMin === 0 && !isOverCommitted(c)) return null;
  // The chip reports what is ON the day. Anything merely dated to it lives in
  // the rail and is named in the tooltip instead — a column heading claiming
  // hours over an empty column is the contradiction this split exists to end.
  return `${formatMinutes(c.plannedMin)} / ${formatMinutes(c.freeMin)}`;
}

/** The same figures spelled out, for the heading's `title` tooltip. */
export function dayLoadHint(c: CapacityFigures): string {
  const parts = capacityParts(c).join(' · ');
  return isOverCommitted(c) ? `${parts} — over-committed` : parts;
}

/**
 * Planned exceeding free is over-commitment regardless of calendar data:
 * without it, `freeMin` is an upper bound on availability, so this can only
 * under-report over-commitment, never false-alarm.
 */
export function isOverCommitted(
  c: Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'backlogMin'>,
): boolean {
  // Everything committed, placed or not — work you have taken on but not yet
  // put on a day still has to fit in the week, and reporting only the placed
  // half would call an impossible week healthy right up until you scheduled it.
  return c.plannedMin + c.backlogMin > c.freeMin;
}
