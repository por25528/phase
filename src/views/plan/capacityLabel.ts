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
  const parts = [`${formatMinutes(c.freeMin)} free`];
  if (c.plannedMin > 0) parts.push(`${formatMinutes(c.plannedMin)} planned`);
  // Separate from "planned", because it is exactly the work the rail beside
  // this is listing under "To plan". Folding the two together made the header
  // claim hours were scheduled onto days that were visibly empty.
  if (c.backlogMin > 0) parts.push(`${formatMinutes(c.backlogMin)} to place`);
  if (c.unestimated > 0) parts.push(`${c.unestimated} unestimated`);
  return parts;
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
