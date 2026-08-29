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
  plannedMin: number;
  /** Committed but not on the calendar. See `DayCapacity.backlogMin`. */
  backlogMin: number;
  unestimated: number;
  hasData: boolean;
}

/**
 * Planned / to place / unestimated as separate strings — never fused into one
 * number. A blended figure would read as authoritative while being partly
 * invented from work that carries no estimate (spec §4.4).
 *
 * There is no free figure. Nothing prices a span against available hours any
 * more, so everything here is a COMMITMENT: what you have taken on, with no
 * claim about whether it fits. The "no calendar data" caveat lives separately,
 * in `calendarHealth.ts`, and is about the event cache rather than about time.
 */
export function capacityParts(c: CapacityFigures): string[] {
  const unestimated = unestimatedLabel(c);
  return unestimated ? [...loadParts(c), unestimated] : loadParts(c);
}

/**
 * The priced part of the readout: planned, and committed-but-not-placed.
 *
 * Split out of `capacityParts` because the unestimated count is the one part
 * that is a CONTROL rather than a statement — it names work whose price is
 * unknown, and the only useful response is to go and price it. The week header
 * renders these as text and the count as a button; `capacityParts` still joins
 * all of them for the day heading's plain-text `title` tooltip, where nothing
 * can be clicked.
 */
export function loadParts(
  c: Pick<CapacityFigures, 'plannedMin' | 'backlogMin'>,
): string[] {
  const parts: string[] = [];
  if (c.plannedMin > 0) parts.push(`${formatMinutes(c.plannedMin)} planned`);
  // Separate from "planned", because it is exactly the work the rail beside
  // this is listing under "To plan". Folding the two together made the header
  // claim hours were scheduled onto days that were visibly empty.
  if (c.backlogMin > 0) parts.push(`${formatMinutes(c.backlogMin)} to place`);
  return parts;
}

/**
 * One labelled figure on the header's rule: a key, a value, and how loudly it
 * speaks.
 *
 * The Instrument header states its figures as `Left / 9h` rather than as the
 * phrase `9h left`, because four phrases of equal weight are four facts of
 * equal weight — and "9h left" is a budget you plan against while "45h spent"
 * is a retrospective and "1 unestimated" is an exception. The hierarchy is
 * structural (a key row over a value row, one of them `head`) rather than a
 * font-weight choice made at each call site.
 *
 * `head` is spent EXACTLY ONCE per readout, on the figure the week is planned
 * against. Everything else is `quiet`. Two headlines is no headline.
 */
export interface LoadCell {
  key: string;
  value: string;
  tone: 'head' | 'quiet';
}

/**
 * The week header's priced figures, as labelled cells on a rule.
 *
 * `head` is spent EXACTLY ONCE per readout, and it is `Planned` — the week is
 * planned against what is on it, now that nothing measures what would fit.
 * Two headlines is no headline.
 *
 * An untouched week returns `[]`, and the header then draws its stamp and its
 * range alone. That is the honest answer rather than a hole: there is nothing
 * to say about a week nobody has put anything in.
 *
 * This is the ONE derivation behind both the header's cells and the strings
 * `weekLoadParts` returns, so the day-heading tooltip and the Plan header
 * cannot disagree about a week.
 */
export function weekLoadCells(
  c: Pick<CapacityFigures, 'plannedMin' | 'backlogMin'>,
): LoadCell[] {
  const cells: LoadCell[] = [];
  if (c.plannedMin > 0) {
    cells.push({ key: 'Planned', value: formatMinutes(c.plannedMin), tone: 'head' });
  }
  if (c.backlogMin > 0) {
    cells.push({
      key: 'To place',
      value: formatMinutes(c.backlogMin),
      // `head` only when there is no Planned cell above to carry it. A week
      // whose whole commitment is unplaced still has one figure to lead with,
      // and a readout with no head at all is this shape's hierarchy undone.
      tone: cells.length === 0 ? 'head' : 'quiet',
    });
  }
  return cells;
}

/**
 * The same figures as sentences, for anywhere that has no room for a rule.
 *
 * Derived from `weekLoadCells` rather than written twice: `12h planned` and
 * the `Planned / 12h` cell are the same claim, and the moment they are two
 * expressions one of them starts drifting. Lower-casing the key is what makes
 * `To place` read as `3h to place` without a second table of words.
 */
export function weekLoadParts(
  c: Pick<CapacityFigures, 'plannedMin' | 'backlogMin'>,
): string[] {
  return weekLoadCells(c).map((cell) => `${cell.value} ${cell.key.toLowerCase()}`);
}

/** `null` when everything is priced — there is then nothing to act on. */
export function unestimatedLabel(c: Pick<CapacityFigures, 'unestimated'>): string | null {
  return c.unestimated > 0 ? `${c.unestimated} unestimated` : null;
}

// `capacityNote` lived here. It turned `hasData: false` into the fixed words
// 'calendar not connected', which was only ever accurate because no calendar
// COULD be connected. A provenance mismatch, an expired refresh token, or a
// week outside the cached range all produce `hasData: false` with a calendar
// connected, and the sentence became a false one. Its replacement is
// `calendarCaveat` in `src/lib/calendarHealth.ts`, which decides from the
// whole state and names the fix rather than guessing at the diagnosis.
//
// The related trap it warned about is now pinned by a test: the caveat must
// NOT be conditional on `blockedBy` being empty. A stale or partly-covered
// cache carries blocks AND a caveat at once — see WeekHeader.test.tsx.

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
 * Null on a day with nothing planned and nothing committed: an empty day
 * already looks empty, and seven columns of `0m` is noise on the calmest
 * surface in the app.
 *
 * It read `1h 30m / 6h` while free time existed. That denominator is gone, so
 * what is left is the numerator — the minutes ON the day.
 */
export function dayLoadLabel(c: Pick<CapacityFigures, 'plannedMin' | 'backlogMin'>): string | null {
  if (c.plannedMin === 0 && c.backlogMin === 0) return null;
  // The chip reports what is ON the day. Anything merely dated to it lives in
  // the rail and is named in the tooltip instead — a column heading claiming
  // hours over an empty column is the contradiction this split exists to end.
  // Which is exactly why a committed-but-unplaced day reads `0m` rather than
  // going quiet: the column IS empty, and the rail beside it says why.
  return formatMinutes(c.plannedMin);
}

/**
 * The same figures spelled out, for the heading's `title` tooltip.
 *
 * Empty on a day with nothing on it — the caller withholds the attribute
 * rather than setting an empty tooltip.
 */
export function dayLoadHint(c: CapacityFigures): string {
  return capacityParts(c).join(' · ');
}
