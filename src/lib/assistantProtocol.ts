import type { ExecutionAdvice } from './executionAdvisor';
import type { ExpectedTime, WorkRef } from './expectedTime';
import type { TimeLevel } from './timeLens';
import { fmtMinutes } from './effort';

/**
 * The only data allowed to cross into the assistant overlay, and the only
 * verbs allowed to come back.
 *
 * Everything here is plain JSON — no functions, no class instances, no store
 * handles — because the same snapshot drives the in-app surface (as props) and
 * the floating Electron window (over IPC), and the second consumer can only be
 * trusted with what survives `structuredClone`. The snapshot deliberately
 * carries no notes, no asset ids or blobs, no raw calendar event titles, no
 * cache rows, no tokens and no URLs: the overlay is a separate renderer with a
 * narrower preload, and what it never receives it can never leak.
 */

/** What the surface knows about the running focus session. A projection, not the draft. */
export interface AssistantFocusView {
  /** The one acknowledgement that a requested session really started. */
  ref: WorkRef;
  title: string;
  goalTitle?: string;
  phase: 'active' | 'break' | 'confirming';
  /** Whole minutes of active work so far — breaks excluded. */
  elapsedMin: number;
  expected: ExpectedTime;
  /** Set while confirming: the figure the user is being asked about. */
  proposedMinutes?: number;
}

export type AssistantSnapshot =
  | { status: 'loading' }
  | {
      status: 'ready';
      advice: ExecutionAdvice;
      activeFocus: AssistantFocusView | null;
      timeLevel: TimeLevel;
      notice?: { tone: 'neutral' | 'warning'; text: string };
    };

export type AssistantAction =
  | { type: 'start-focus'; ref: WorkRef }
  | { type: 'set-time-level'; level: TimeLevel }
  | { type: 'pause-focus' }
  | { type: 'resume-focus' }
  | { type: 'complete-focus' }
  | { type: 'confirm-focus'; minutes: number | null }
  | { type: 'switch-focus'; ref: WorkRef }
  | { type: 'close' };

/**
 * Honest words for each evidence level. History speaks as a range, a plain
 * estimate stays labelled as the plan it is, and the starter says out loud that
 * it is a suggestion — none of the three ever claims to be a prediction it
 * cannot back.
 *
 * All three name their PROVENANCE and then the figure: Usually / Planned /
 * Suggested. The starter used to read `Start with 30m`, which broke that
 * parallel by opening with a verb, and on Today it sits immediately left of a
 * button reading `Start session` — so one row offered the same word twice and
 * the readout read as a second control.
 *
 * The prefix is what this function is FOR. Dropping the starter to a bare
 * `30m` was the first fix considered and it is the wrong one: it throws away
 * where the number came from, and the history case is a RANGE that no single
 * number can state.
 */
export function expectedTimeLabel(expected: ExpectedTime): string {
  switch (expected.kind) {
    case 'history': return `Usually ${expected.lowMin}–${expected.highMin}m`;
    case 'estimate': return `Planned ${expected.minutes}m`;
    case 'starter': return `Suggested ${expected.minutes}m`;
  }
}

/**
 * The same expectation, restated for a session already under way.
 *
 * `expectedTimeLabel` describes work that has NOT begun — "Suggested 30m" —
 * which is wrong the moment it has: a paused session read
 * `0m worked · on a break · Start with 30m` (the wording of the day), offering
 * you a length for the thing you were already doing. Renaming the starter did
 * not fix that and was never meant to; the split between the two functions is
 * what fixes it. This states progress instead. The range
 * survives as a range, because "12m of 45–60m" is the only honest thing to say
 * about a session whose evidence is a range.
 *
 * The elapsed side is `fmtMinutes` and the expected side is raw minutes. That
 * looks mixed and is deliberate: each half is spelled the way the surface
 * already spells it — `Log 3h 20m` on one, `Planned 30m` on the other — so
 * neither this function nor `expectedTimeLabel` can drift from the button
 * beside it.
 */
export function elapsedAgainstExpected(
  elapsedMin: number,
  expected: ExpectedTime,
  level: TimeLevel = 'medium',
): string {
  const done = fmtMinutes(elapsedMin);
  // At low focus the number survives and the verdict does not. The pressure in
  // a running session was never the elapsed figure — it is the figure it is
  // being measured against.
  if (level === 'low') return `${done} so far`;
  return expected.kind === 'history'
    ? `${done} of ${expected.lowMin}–${expected.highMin}m`
    : `${done} of ${expected.minutes}m`;
}
