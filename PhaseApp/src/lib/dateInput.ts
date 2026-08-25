const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * True only for a date that exists. `new Date(2026, 1, 30)` silently rolls
 * over to March 2, which would turn a typo into a wrong deadline.
 */
function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function iso(year: number, month: number, day: number): string | null {
  return isRealDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/**
 * Parse what a user typed into a date field, returning 'YYYY-MM-DD' or null.
 *
 * Accepts the ISO form the field edits in and the `Aug 2` form the rest of the
 * app displays (either word order, optional year). It deliberately does NOT
 * accept `02/08/2026`: that string means Feb 8 to a US reader and Aug 2 to
 * everyone else, and this is the one field where a misread moves a deadline.
 *
 * `reference` supplies the year when the text omits one.
 */
export function parseDateInput(text: string, reference: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const refYear = Number(reference.slice(0, 4)) || new Date().getFullYear();
  const cleaned = trimmed.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');

  // "aug 2" / "aug 2 2027", or the same the other way round.
  const monthFirst = /^([a-z]{3,})\s+(\d{1,2})(?:\s+(\d{4}))?$/.exec(cleaned);
  const dayFirst = /^(\d{1,2})\s+([a-z]{3,})(?:\s+(\d{4}))?$/.exec(cleaned);
  const parts = monthFirst
    ? { word: monthFirst[1], day: monthFirst[2], year: monthFirst[3] }
    : dayFirst
      ? { word: dayFirst[2], day: dayFirst[1], year: dayFirst[3] }
      : null;
  if (!parts) return null;

  // Match on the three-letter prefix, but reject a longer word that isn't a
  // real month name ("augu") rather than silently accepting its prefix.
  const month = MONTHS.indexOf(parts.word.slice(0, 3)) + 1;
  if (month === 0) return null;
  if (parts.word.length > 3 && parts.word !== MONTH_NAMES[month - 1]) return null;

  return iso(parts.year ? Number(parts.year) : refYear, month, Number(parts.day));
}
