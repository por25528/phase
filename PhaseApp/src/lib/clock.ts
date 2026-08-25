/**
 * The one clock-time format in the app.
 *
 * Follows the locale's hour cycle: a 24-hour locale sees `13:00`, a 12-hour one
 * `1pm`. The compact lowercase style is deliberate and stays either way —
 * `toLocaleTimeString` alone would render "1:00 PM", which is wider than the
 * time column and louder than the rest of the metadata tier.
 *
 * A block can end after midnight (a 23:00–00:30 span has `endMin` 1470), so a
 * trailing "+1" marks the day rollover instead of silently wrapping to 12:30am.
 */
let cachedHourCycle: boolean | null = null;

function prefers24Hour(): boolean {
  // Resolved once: this is called per rendered label, and constructing an
  // Intl.DateTimeFormat for every row of a day's schedule is not free.
  if (cachedHourCycle !== null) return cachedHourCycle;
  cachedHourCycle = resolve24Hour();
  return cachedHourCycle;
}

function resolve24Hour(): boolean {
  if (typeof Intl === 'undefined') return false;
  try {
    const resolved = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
    // hourCycle is 'h23'/'h24' for 24-hour locales, 'h11'/'h12' otherwise.
    if (resolved.hourCycle) return resolved.hourCycle.startsWith('h2');
    return resolved.hour12 === false;
  } catch {
    return false;
  }
}

export function clockLabel(minute: number, use24Hour = prefers24Hour()): string {
  const dayOffset = Math.floor(minute / 1440);
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;

  const base = use24Hour
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    : (() => {
        const suffix = h < 12 ? 'am' : 'pm';
        const display = h % 12 === 0 ? 12 : h % 12;
        return m === 0 ? `${display}${suffix}` : `${display}:${String(m).padStart(2, '0')}${suffix}`;
      })();

  return dayOffset > 0 ? `${base}+${dayOffset}` : base;
}
