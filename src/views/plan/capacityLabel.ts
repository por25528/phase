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
