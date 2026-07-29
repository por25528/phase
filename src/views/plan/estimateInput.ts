/** A single day of effort. Anything above this wants breaking down instead. */
const MAX_ESTIMATE_MINUTES = 1440;

/** Shared bound check for every parse branch: 0 is rejected, so is anything over 24h. */
function withinBounds(minutes: number): number | undefined {
  return minutes > 0 && minutes <= MAX_ESTIMATE_MINUTES ? minutes : undefined;
}

/**
 * Parse a human estimate.
 *   number  → minutes
 *   null    → deliberate clear (empty input)
 *   undefined → unparseable; the caller keeps the previous value
 * Three outcomes, because "clear it" and "that isn't a number" are different
 * intentions and must not collapse into one.
 */
export function parseEstimateInput(raw: string): number | null | undefined {
  const s = raw.trim().toLowerCase();
  if (s === '') return null;

  // 1h30, 1h30m, 1h
  const hm = s.match(/^(\d+)\s*h\s*(\d+)?\s*m?$/);
  if (hm) {
    const minutes = Number(hm[1]) * 60 + Number(hm[2] ?? 0);
    return withinBounds(minutes);
  }

  // 1.5h, 0.5h — hours may be fractional
  const fractional = s.match(/^(\d*\.?\d+)\s*h$/);
  if (fractional) {
    const minutes = Math.round(Number(fractional[1]) * 60);
    return withinBounds(minutes);
  }

  // 45, 45m, 90 min — minutes must be an integer; a bare decimal ('1.5',
  // '.5') is ambiguous (did they mean minutes or hours?) so it's refused
  // rather than guessed at.
  const mins = s.match(/^(\d+)\s*(m|min|mins|minutes)?$/);
  if (mins) {
    const minutes = Number(mins[1]);
    return withinBounds(minutes);
  }

  return undefined;
}

export function formatEstimateValue(minutes: number | undefined): string {
  if (!minutes) return '';
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}`;
}
