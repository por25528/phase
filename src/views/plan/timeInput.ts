const MINUTES_PER_DAY = 1440;

/**
 * Minutes since local midnight → the value an `<input type="time">` expects.
 * 1440 (midnight of the NEXT day, used as an exclusive end bound) formats as
 * "24:00" rather than wrapping to "00:00" — the two mean different things
 * and must not collide.
 */
export function minutesToTimeValue(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The inverse of minutesToTimeValue. Returns undefined for anything that
 * isn't a strict "HH:MM" in 00:00..24:00 — the caller keeps the previous
 * value rather than risk writing a malformed AvailabilityWindow.
 */
export function timeValueToMinutes(value: string): number | undefined {
  const m = value.match(/^(\d{2}):(\d{2})$/);
  if (!m) return undefined;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (mm >= 60) return undefined;
  const total = hh * 60 + mm;
  return total >= 0 && total <= MINUTES_PER_DAY ? total : undefined;
}
