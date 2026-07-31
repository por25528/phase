import type { Goal } from '../db/types';
import { normalizeEstimate } from './capacity';
import { addDays } from './dates';
import { walkLeaves } from './plan';

/**
 * Progress signals for a project with no schedule.
 *
 * `expectedPct` and `behindPaceBy` both need a confirmed start AND deadline
 * (`hasTrustedSchedule`), so `paceStatus` returns `'no-schedule'` for anything
 * open-ended and every pace signal switches off. The drawer then rendered the
 * literal string "No project schedule" — the app's best piece of information
 * design replaced by a statement of its own inapplicability, on exactly the
 * work where the user is least able to judge their own progress.
 *
 * A deadline gives you pace: distance from a line you drew. Without one there
 * is still a perfectly good question — *is this moving?* — and the data to
 * answer it has been on disk all along in `doneAt`, which is stamped on every
 * completed leaf and read by almost nothing.
 *
 * Trailing velocity is the honest analogue of linear pace, and it is reported
 * with the same discipline as everything else here: when the history is too
 * thin to support a forecast, it says so instead of extrapolating from one
 * data point.
 */

/**
 * How far back to count completions.
 *
 * Two weeks: long enough that a single quiet week does not read as a stall,
 * short enough to reflect what is happening now rather than what happened at
 * the start of term.
 */
export const VELOCITY_WINDOW_DAYS = 14;

/**
 * Completions needed before a "weeks remaining" figure is offered.
 *
 * Below this the forecast swings wildly — one completed step in a fortnight
 * would confidently predict a finish date from a sample of one. The count and
 * the open total are still reported; only the extrapolation is withheld.
 */
export const MIN_VELOCITY_SAMPLES = 3;

export interface VelocitySignal {
  /** Leaves completed within the window, datable via `doneAt`. */
  completed: number;
  windowDays: number;
  /** Leaves still open. */
  open: number;
  /**
   * Σ estimates of the open leaves — present only when EVERY open leaf carries
   * one, for the same all-or-nothing reason the weighted roll-up uses: a
   * partial sum reads as a total and understates the work left.
   */
  remainingMin?: number;
  /**
   * Weeks to finish the open leaves at the observed rate. Absent below
   * `MIN_VELOCITY_SAMPLES`, and absent when nothing is open.
   */
  weeksLeft?: number;
}

/**
 * Velocity over the trailing window.
 *
 * A leaf completed without a `doneAt` (legacy or imported data) counts as done
 * for the roll-up but cannot be dated, so it is excluded from `completed`.
 * That biases the rate DOWN on old data, which is the safe direction: it
 * withholds a forecast rather than inventing an optimistic one.
 */
export function projectVelocity(goal: Goal, today: string): VelocitySignal {
  const since = addDays(today, -VELOCITY_WINDOW_DAYS);
  let completed = 0;
  let open = 0;
  let remaining: number | null = 0;

  walkLeaves(goal, (leaf) => {
    if (leaf.done) {
      if (leaf.doneAt && leaf.doneAt >= since && leaf.doneAt <= today) completed += 1;
      return;
    }
    open += 1;
    const est = normalizeEstimate(leaf.estimateMin);
    if (est === undefined) remaining = null;
    else if (remaining !== null) remaining += est;
  });

  const signal: VelocitySignal = { completed, windowDays: VELOCITY_WINDOW_DAYS, open };
  if (remaining !== null && open > 0) signal.remainingMin = remaining;
  if (completed >= MIN_VELOCITY_SAMPLES && open > 0) {
    const perWeek = completed / (VELOCITY_WINDOW_DAYS / 7);
    signal.weeksLeft = open / perWeek;
  }
  return signal;
}

/**
 * The signal as a sentence for the drawer's pace line, or null when the
 * project has no open work left (the caller already has a better thing to say
 * — "every step done — ready to complete").
 *
 * Deliberately never claims a date. The output is a rate and a rough runway,
 * which is what a trailing average can honestly support; printing "finishes
 * Nov 3" from three data points would be the invented authority this codebase
 * refuses everywhere else.
 */
export function describeVelocity(signal: VelocitySignal): string | null {
  if (signal.open === 0) return null;

  const { completed, windowDays, open, weeksLeft, remainingMin } = signal;

  // A stall is the single most useful thing an open-ended project can tell
  // you, and it is precisely what a deadline-based pace line cannot see.
  if (completed === 0) {
    return `nothing finished in ${windowDays} days · ${open} step${open === 1 ? '' : 's'} open`;
  }

  const rate = `${completed} done in ${windowDays} days`;
  const left = `${open} left`;
  const parts = [rate, left];

  if (remainingMin !== undefined) {
    const hours = remainingMin / 60;
    parts.push(hours >= 1 ? `~${hours.toFixed(hours >= 10 ? 0 : 1)}h of work` : `~${remainingMin}m of work`);
  }
  if (weeksLeft !== undefined) {
    parts.push(weeksLeft < 1 ? 'about a week at this rate' : `~${Math.round(weeksLeft)} weeks at this rate`);
  }
  return parts.join(' · ');
}
