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
 * Planned exceeding free is over-commitment regardless of calendar data:
 * without it, `freeMin` is an upper bound on availability, so this can only
 * under-report over-commitment, never false-alarm.
 */
export function isOverCommitted(
  c: Pick<CapacityFigures, 'freeMin' | 'plannedMin'>,
): boolean {
  return c.plannedMin > c.freeMin;
}
