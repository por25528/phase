import type { ExecutionAdvice } from './executionAdvisor';
import type { ExpectedTime, WorkRef } from './expectedTime';
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
      notice?: { tone: 'neutral' | 'warning'; text: string };
    };

export type AssistantAction =
  | { type: 'start-focus'; ref: WorkRef }
  | { type: 'pause-focus' }
  | { type: 'resume-focus' }
  | { type: 'complete-focus' }
  | { type: 'confirm-focus'; minutes: number | null }
  | { type: 'switch-focus'; ref: WorkRef }
  | { type: 'close' };

/**
 * Honest words for each evidence level. History speaks as a range, a plain
 * estimate stays labelled as the plan it is, and the starter is an invitation
 * — none of the three ever claims to be a prediction it cannot back.
 */
export function expectedTimeLabel(expected: ExpectedTime): string {
  switch (expected.kind) {
    case 'history': return `Usually ${expected.lowMin}–${expected.highMin}m`;
    case 'estimate': return `Planned ${expected.minutes}m`;
    case 'starter': return `Start with ${expected.minutes}m`;
  }
}

/**
 * The same expectation, restated for a session already under way.
 *
 * `expectedTimeLabel` is written as an INVITATION — "Start with 30m" — which is
 * right on work that has not begun and wrong the moment it has: a paused
 * session read `0m worked · on a break · Start with 30m`, inviting you to begin
 * the thing you were already doing. This states progress instead. The range
 * survives as a range, because "12m of 45–60m" is the only honest thing to say
 * about a session whose evidence is a range.
 *
 * The elapsed side is `fmtMinutes` and the expected side is raw minutes. That
 * looks mixed and is deliberate: each half is spelled the way the surface
 * already spells it — `Log 3h 20m` on one, `Planned 30m` on the other — so
 * neither this function nor `expectedTimeLabel` can drift from the button
 * beside it.
 */
export function elapsedAgainstExpected(elapsedMin: number, expected: ExpectedTime): string {
  const done = fmtMinutes(elapsedMin);
  return expected.kind === 'history'
    ? `${done} of ${expected.lowMin}–${expected.highMin}m`
    : `${done} of ${expected.minutes}m`;
}
