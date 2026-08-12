import type { Goal, Session, Task } from '../db/types';
import { normalizeEstimate } from './capacity';
import { walkLeaves } from './plan';
import { isDone } from './status';

/**
 * Estimated versus actual time.
 *
 * Phase has always recorded what you PROMISED (`estimateMin`, `plannedStartMin`)
 * and what you FINISHED (`done`, `doneAt`), and nothing about what actually
 * happened. That gap is why estimates never improve: the pace line can say you
 * are behind but never distinguish "you did not sit down" from "your estimates
 * are half of reality".
 *
 * Everything here is a pure read over sessions that the user explicitly logged.
 * Nothing in this module infers time from a scheduled block, and nothing it
 * returns is ever written back onto an estimate — a calibration figure is shown
 * beside the user's number, never substituted for it.
 */

/** Minutes logged against one leaf. Sessions with no `nodeId` are project-level and excluded. */
export function loggedForNode(sessions: Session[], nodeId: string): number {
  let total = 0;
  for (const s of sessions) {
    if (s.nodeId === nodeId && s.minutes > 0) total += s.minutes;
  }
  return total;
}

/**
 * Minutes logged against one task.
 *
 * `nodeId` takes precedence: the two ids are documented as mutually exclusive
 * and `logSession` only ever writes one, but `importStateFromFile` does not
 * sanitise sessions, so a hand-edited backup can carry both. Without this a
 * single session would be counted once here and once by `loggedForNode` — the
 * same minutes charged to two different estimates.
 */
export function loggedForTask(sessions: Session[], taskId: string): number {
  let total = 0;
  for (const s of sessions) {
    if (s.nodeId === undefined && s.taskId === taskId && s.minutes > 0) total += s.minutes;
  }
  return total;
}

/**
 * How an estimate compared to the time it actually took.
 *
 * `ratio` is actual ÷ estimated, so 1.5 means the work ran half again as long
 * as predicted and 0.5 means it came in at half. Undefined when either side is
 * missing — there is no comparison to make, and defaulting to 1 would report a
 * confident "spot on" for work nobody timed.
 */
export interface Comparison {
  estimateMin: number;
  actualMin: number;
  ratio: number;
}

export function compareEstimate(
  estimateMin: number | undefined,
  actualMin: number,
): Comparison | null {
  const est = normalizeEstimate(estimateMin);
  if (est === undefined || actualMin <= 0) return null;
  return { estimateMin: est, actualMin, ratio: actualMin / est };
}

/**
 * The minimum number of completed, timed steps before a calibration figure is
 * worth showing.
 *
 * Below this the ratio swings wildly on a single outlier — one pset where you
 * got stuck for four hours would announce "your estimates run 4× short" off a
 * sample of one. Reporting "not enough history yet" is the same instinct that
 * keeps `capacityParts` from blending unestimated work into a total: a number
 * that looks authoritative while resting on nothing is worse than no number.
 */
export const MIN_CALIBRATION_SAMPLES = 5;

export interface Calibration {
  /** Completed leaves that had BOTH an estimate and logged time. */
  samples: number;
  /** Σ actual ÷ Σ estimated across those leaves. */
  ratio: number;
}

/**
 * How this project's estimates have compared to reality, or null when there is
 * not enough history to say.
 *
 * Weighted by total minutes rather than averaged per step, deliberately: a
 * mean of per-step ratios lets a 5-minute step that took 15 (ratio 3) outweigh
 * a 3-hour step that landed exactly (ratio 1). What the user wants to know is
 * "if I budget six hours for this project, how long will it really take", and
 * that is a question about totals.
 *
 * Only COMPLETED leaves count. A half-finished step with two hours logged has
 * not yet revealed how long it takes, and counting it would make every project
 * look like its estimates were short simply because work was in progress.
 */
export function projectCalibration(goal: Goal, sessions: Session[]): Calibration | null {
  let estimated = 0;
  let actual = 0;
  let samples = 0;

  walkLeaves(goal, (leaf) => {
    if (!isDone(leaf)) return;
    const est = normalizeEstimate(leaf.estimateMin);
    if (est === undefined) return;
    const logged = loggedForNode(sessions, leaf.id);
    if (logged <= 0) return;
    estimated += est;
    actual += logged;
    samples += 1;
  });

  if (samples < MIN_CALIBRATION_SAMPLES || estimated <= 0) return null;
  return { samples, ratio: actual / estimated };
}

/**
 * The same comparison across a whole week's logged work, for the recap.
 *
 * Unlike `projectCalibration` this does NOT require the work to be complete —
 * the recap's question is "what did last week's plan cost", and part-done work
 * still cost what it cost. It is therefore a report, not a calibration, and is
 * never fed into a forecast.
 */
export interface WeekEffort {
  estimatedMin: number;
  loggedMin: number;
}

export function weekEffort(
  goals: Goal[],
  tasks: Task[],
  sessions: Session[],
  weekDatesInOrder: string[],
): WeekEffort {
  const inWeek = new Set(weekDatesInOrder);
  const usable = sessions.filter((s) => s.minutes > 0);

  /*
   * Both sides of this comparison must describe the SAME work, or the ratio is
   * meaningless. Two ways that broke:
   *
   * 1. A session whose target no longer exists — a deleted step, or a legacy
   *    row carrying neither id (`db/types.ts` documents both as legal) — added
   *    to `loggedMin` while contributing nothing to `estimatedMin`. Deleting a
   *    step you had logged two hours against made every future recap of that
   *    week read as a massive overrun, with no way to find the offending rows.
   * 2. A leaf logged across a week boundary contributed its WHOLE estimate to
   *    each week while each week saw only part of the time. A 4h step logged 2h
   *    in each of two weeks reported "estimated at 4h and took 2h — quicker
   *    than planned" twice.
   *
   * So an item qualifies only when it still resolves AND all of its logged time
   * falls inside this week. Anything else is dropped from both sides. The
   * recap's separate `loggedTimeForWeek` total is unaffected and still reports
   * every minute — that figure answers "what did I spend", which is a different
   * question from "how did the estimate do".
   */
  const nodeTotals = new Map<string, { inWeek: number; total: number }>();
  const taskTotals = new Map<string, { inWeek: number; total: number }>();
  for (const s of usable) {
    // `nodeId` wins if a hand-edited file somehow carries both, so the session
    // is counted once rather than against two different estimates.
    const bucket = s.nodeId ? nodeTotals : s.taskId ? taskTotals : null;
    const key = s.nodeId ?? s.taskId;
    if (!bucket || !key) continue;
    const entry = bucket.get(key) ?? { inWeek: 0, total: 0 };
    entry.total += s.minutes;
    if (inWeek.has(s.date)) entry.inWeek += s.minutes;
    bucket.set(key, entry);
  }

  let estimatedMin = 0;
  let loggedMin = 0;

  const take = (
    totals: { inWeek: number; total: number } | undefined,
    estimate: number | undefined,
  ): void => {
    if (!totals || totals.inWeek === 0) return;
    if (totals.inWeek !== totals.total) return; // spans a week boundary
    estimatedMin += normalizeEstimate(estimate) ?? 0;
    loggedMin += totals.inWeek;
  };

  for (const goal of goals) {
    walkLeaves(goal, (leaf) => take(nodeTotals.get(leaf.id), leaf.estimateMin));
  }
  for (const task of tasks) {
    take(taskTotals.get(task.id), task.estimateMin);
  }

  return { estimatedMin, loggedMin };
}

/**
 * A calibration ratio as a sentence, or null when there is nothing useful to
 * say.
 *
 * The dead band matters: a project running 8% over is not a finding, it is
 * noise, and announcing it would train the user to ignore the line. Only a
 * ratio far enough from 1 to change how you would plan gets words.
 */
export function describeCalibration(c: Calibration | null): string | null {
  if (!c) return null;
  if (c.ratio >= 1.15) return `estimates run about ${c.ratio.toFixed(1)}× short`;
  if (c.ratio <= 0.85) return `work lands in about ${Math.round(c.ratio * 100)}% of the estimate`;
  return 'estimates are about right';
}
