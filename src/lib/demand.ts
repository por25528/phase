/**
 * How much of you a piece of work wants.
 *
 * The second axis. `timeLens` asks how long something takes and has three
 * kinds of evidence for it — history, an estimate, a starter. Nothing measured
 * how HARD it was, so a twenty-minute expense claim and a twenty-minute "decide
 * the data model" were the same size and the same offer.
 *
 * The words are deliberately NOT the dial's words. The dial reads
 * `Low / Medium / High` and means capability; this reads `Light / Moderate /
 * Deep` and means requirement. They are opposite poles of one scale, and a chip
 * reading `Low` on a row could be read either way — the same reason
 * `expectedTimeLabel` prefixes `Usually / Planned / Suggested` rather than
 * printing a bare figure.
 */

export type Demand = 'light' | 'moderate' | 'deep';

/** Ascending, and the order every selector renders in. */
export const DEMANDS: readonly Demand[] = ['light', 'moderate', 'deep'];

export const DEMAND_WORD: Record<Demand, string> = {
  light: 'Light',
  moderate: 'Moderate',
  deep: 'Deep',
};

/** Compared against `FOCUS_ADMITS`. Monotone, so a dial is a dial. */
export const DEMAND_RANK: Record<Demand, number> = {
  light: 1,
  moderate: 2,
  deep: 3,
};

export function isDemand(raw: unknown): raw is Demand {
  return raw === 'light' || raw === 'moderate' || raw === 'deep';
}
