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
 * The week header's priced figures, with the free figure split by tense.
 *
 * A fully-future week has nothing spent, so the split collapses back to a bare
 * `Free` cell and the week reads exactly as it did — a future week is never
 * made uglier to fix a current one. The planned / to-place tail is the same as
 * `loadParts`.
 *
 * This is the ONE derivation behind both the header's cells and the strings
 * `weekLoadParts` returns; the day-heading tooltip and the Plan header cannot
 * disagree about a week because there is only one place either could come
 * from. It is also what the seven-cell gauge is drawn beside — see
 * `dayGaugeCells`, which is likewise derived rather than recomputed.
 */
export function weekLoadCells(
  c: Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'backlogMin'> & { days: readonly { date: string; freeMin: number }[] },
  today: string,
): LoadCell[] {
  const { leftMin, spentMin } = weekFreeSplit(c, today);
  const cells: LoadCell[] = spentMin === 0
    ? [{ key: 'Free', value: formatMinutes(leftMin), tone: 'head' }]
    : [
      { key: 'Left', value: formatMinutes(leftMin), tone: 'head' },
      { key: 'Spent', value: formatMinutes(spentMin), tone: 'quiet' },
    ];
  if (c.plannedMin > 0) cells.push({ key: 'Planned', value: formatMinutes(c.plannedMin), tone: 'quiet' });
  if (c.backlogMin > 0) cells.push({ key: 'To place', value: formatMinutes(c.backlogMin), tone: 'quiet' });
  return cells;
}

/**
 * The same figures as sentences, for anywhere that has no room for a rule.
 *
 * Derived from `weekLoadCells` rather than written twice: `9h left` and the
 * `Left / 9h` cell are the same claim, and the moment they are two expressions
 * one of them starts drifting. Lower-casing the key is what makes `To place`
 * read as `3h to place` without a second table of words.
 */
export function weekLoadParts(
  c: Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'backlogMin'> & { days: readonly { date: string; freeMin: number }[] },
  today: string,
): string[] {
  return weekLoadCells(c, today).map((cell) => `${cell.value} ${cell.key.toLowerCase()}`);
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

/**
 * The header's load bar, as fractions of one track.
 *
 * The bar spans `D = max(freeMin, plannedMin + backlogMin)`, NOT `freeMin`.
 * That single choice is what makes the over-committed case well-defined: with
 * `freeMin` as the denominator the segments run past 1.0 the moment you take on
 * more than you have, and every renderer then has to invent its own clamping.
 * Spanning the larger of the two means the segments always fit exactly, and the
 * over case is expressed by the bar being FULL and by `capacityMarkFrac` moving
 * inward to show where the free time ran out.
 *
 * `over` is `isOverCommitted(c)` — delegated, never recomputed. The bar and the
 * text beside it are read as one statement, so they must be one derivation; a
 * bar reading full above text reading healthy is the planned/to-place
 * contradiction all over again.
 *
 * Note the denominator is `freeMin` and not `weekFreeSplit`'s `leftMin`. Using
 * the remaining-today figure would be more intuitive and would make the bar
 * disagree with its own warn state on every day but Monday, because
 * `isOverCommitted` compares against the whole week's `freeMin`. Two numbers
 * that get compared to each other have to cover the same days.
 */
export interface MeterGeometry {
  /** 0–1 of the bar's width. */
  plannedFrac: number;
  /** 0–1 of the bar's width. */
  backlogFrac: number;
  /**
   * Where free time runs out, as a fraction of the bar. Rendered as a hairline
   * tick, and ONLY when `over` — on a healthy week it is 1.0, which is the
   * bar's own right edge and therefore says nothing.
   */
  capacityMarkFrac: number;
  over: boolean;
}

export function capacityMeter(
  c: Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'backlogMin'>,
): MeterGeometry {
  const committed = c.plannedMin + c.backlogMin;
  const span = Math.max(c.freeMin, committed);
  // No availability and nothing committed: there is no bar to draw, and
  // dividing by zero here would put NaN into a style attribute.
  if (span <= 0) {
    return { plannedFrac: 0, backlogFrac: 0, capacityMarkFrac: 1, over: false };
  }
  return {
    plannedFrac: c.plannedMin / span,
    backlogFrac: c.backlogMin / span,
    capacityMarkFrac: Math.min(1, c.freeMin / span),
    over: isOverCommitted(c),
  };
}

/**
 * One cell of the week gauge: how full a day is drawn, and nothing else.
 *
 * A single week bar can only say "you are over". This says WHERE — you move
 * work off Thursday, not off "the week" — and the whole risk of saying that is
 * disagreeing with the grid underneath it, so the geometry is `capacityMeter`
 * applied per day rather than a second piece of arithmetic. `weekCapacity`
 * has always produced `days`; the header merely stopped summing it away.
 *
 * **There is no per-day `over`, and one must not be added here.**
 * `isOverCommitted` is a WEEK verdict: it compares the week's committed
 * minutes against the week's free minutes, and it is the ONLY judgement the
 * meter renders — the gauge takes its colour from `capacityMeter(week).over`
 * exactly as the bar it replaces did. Per-day cells invite a per-day verdict
 * that function does not make, so `over` is DROPPED at this boundary, the same
 * move `PlannedLeaf` makes with `status`: what a caller cannot see, it cannot
 * accidentally render. A day may be drawn fuller than its neighbours — a day
 * whose committed minutes exceed its free ones draws full, because
 * `capacityMeter` spans `max(free, committed)` — but full is a DRAWING, not a
 * judgement, and it wears the same colour every other cell does.
 *
 * Adding a real per-day verdict is a separate change: it belongs in
 * `capacity.ts` with its own tests, not inferred here from a fraction.
 */
export interface DayGaugeCell {
  date: string;
  /** 0–1 of the cell: sittings actually on the calendar. */
  plannedFrac: number;
  /** 0–1 of the cell: committed to the day but not placed. */
  backlogFrac: number;
}

export function dayGaugeCells(
  days: readonly (Pick<CapacityFigures, 'freeMin' | 'plannedMin' | 'backlogMin'> & { date: string })[],
): DayGaugeCell[] {
  return days.map((d) => {
    const m = capacityMeter(d);
    return { date: d.date, plannedFrac: m.plannedFrac, backlogFrac: m.backlogFrac };
  });
}
