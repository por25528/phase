// Commitment horizons, left → right (column 0 → 3). The order IS the model:
// a project's column is its horizon; height within a column is rank in-horizon.
//
// These live in `lib`, not in `views/goals/styles`, because the store needs
// them too — it names the destination in the "Moved X to Later" toast. It used
// to keep its own `const HORIZON_COUNT = 4` instead, since a store importing
// from a view is the wrong direction; one definition here removes the
// duplication rather than adding a second one.
export const HORIZON_LABELS = ['Now', 'Next', 'Later', 'Someday'] as const;
export const HORIZON_COUNT = HORIZON_LABELS.length;

/**
 * The horizons you plan a week from: Now and Next.
 *
 * The calendar rail used to draw from every unarchived project, so a board with
 * four parked reading lists on it put 63 rows in a 249px column — and the three
 * a project shows are its first three, so the shortlist for the work you are
 * actually doing sat below four shortlists for work you had explicitly deferred.
 * Parking a project is the user saying "not now"; a rail that ignores that says
 * the horizons do not mean anything.
 *
 * This is the line `cardPrimaryAction` already drew at Someday — "Plan next
 * step" was never offered on a Someday card. Moving it to 2 keeps the board and
 * the rail on ONE rule: if the rail cannot show a project's work, the card must
 * not offer to plan it, or the button navigates to the calendar and does
 * nothing. Promoting a project is a single Alt+← away.
 */
export const PLANNING_HORIZONS = 2;

/** Is this project's horizon one the calendar plans from? `column` is 0 when absent. */
export function isPlanningHorizon(column: number | undefined): boolean {
  return (column ?? 0) < PLANNING_HORIZONS;
}

/**
 * The horizon words the agent surface speaks, derived from the labels so the
 * two cannot drift. `Lowercase<>` over `HORIZON_LABELS` means adding a fifth
 * horizon adds its word for free.
 */
export type HorizonWord = Lowercase<(typeof HORIZON_LABELS)[number]>;

/**
 * Exact, lowercase, and deliberately case-SENSITIVE — see the note in
 * `horizons.test.ts`. This is a wire value, not a title someone typed.
 */
export function isHorizonWord(value: unknown): value is HorizonWord {
  return typeof value === 'string' && HORIZON_LABELS.some((l) => l.toLowerCase() === value);
}

/**
 * The column a horizon word names.
 *
 * Deliberately NOT `goalImport`'s `horizonFromWord`: that parser carries
 * aliases from the old priority scheme, where `later` meant column 3 and now
 * means column 2. Round-tripping an export is `create_project`'s problem and
 * stays there; a new verb should not inherit a word whose meaning has already
 * changed once.
 */
export function columnOfHorizonWord(word: HorizonWord): number {
  return HORIZON_LABELS.findIndex((l) => l.toLowerCase() === word);
}
