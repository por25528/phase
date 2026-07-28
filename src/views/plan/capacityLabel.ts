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
 */
export function capacityParts(c: CapacityFigures): string[] {
  const parts = [c.hasData ? `${formatMinutes(c.freeMin)} free` : 'no calendar data'];
  if (c.plannedMin > 0) parts.push(`${formatMinutes(c.plannedMin)} planned`);
  if (c.unestimated > 0) parts.push(`${c.unestimated} unestimated`);
  return parts;
}

/**
 * Only claimable with real calendar data. Without it, `freeMin` is a nominal
 * window figure, and calling that over-commitment would present a guess as a
 * fact.
 */
export function isOverCommitted(
  c: Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'hasData'>,
): boolean {
  return c.hasData && c.plannedMin > c.freeMin;
}
