import type { Confidence } from '../db/types';
import type { ExecutionAdvice } from './executionAdvisor';
import type { ExpectedTime, WorkRef } from './expectedTime';
import { DEFAULT_FOCUS_LEVEL, type FocusLevel } from './focusLens';
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
  /** `'rating'` is the question a logged sitting on a topic ends in. */
  phase: 'active' | 'break' | 'confirming' | 'rating';
  /**
   * A topic under a study goal: the card draws a confidence mark, never a
   * tick, and `'rating'` is the phase that asks for one. Both absent for a
   * step or a task.
   */
  topic?: true;
  confidence?: Confidence;
  /** Whole minutes of active work so far — breaks excluded. */
  elapsedMin: number;
  expected: ExpectedTime;
  /** Set while confirming: the figure the user is being asked about. */
  proposedMinutes?: number;
  /**
   * `break` only: the app took this break because you had gone, rather than
   * because you pressed anything. The surface owes an explanation for the
   * first and nothing at all for the second, and the phase alone cannot tell
   * them apart.
   */
  autoBreak?: true;
  /** Whole minutes away, once the return was observed. Absent until then. */
  awayMin?: number;
  /**
   * Where a pomodoro session is in its cycle. Absent on a calm one, which is
   * how the surface knows to say nothing about intervals at all.
   *
   * Two numbers and not the whole cycle: the shelf states a POSITION, and the
   * durations are the pill's and the tray's business. What never crosses
   * cannot become a second opinion about how long an interval is.
   */
  cycle?: { completed: number; longEvery: number };
}

export type AssistantSnapshot =
  | { status: 'loading' }
  | {
      status: 'ready';
      advice: ExecutionAdvice;
      activeFocus: AssistantFocusView | null;
      /** How long the user says they have. Decides what fits. */
      timeLevel: TimeLevel;
      /** How much focus is available. Decides what the work has to be light enough for. */
      focusLevel: FocusLevel;
      /**
       * The RESOLVED palette — never the stored `'system'` preference.
       *
       * The floating shelf rendered light while the app beside it rendered
       * dark, and the cause is subtler than "nothing sets the class":
       * `assistant.html` carries a no-FOUC script that adds `.dark` itself. But
       * that script GUESSES, and it guesses exactly once. It reads the raw
       * `phase-theme` preference from a second renderer and falls back to the
       * OS, so a user whose preference is `dark` on a light OS gets a light
       * shelf — and it runs at page load, while the overlay window is created
       * once and thereafter hidden and shown rather than reloaded, so a theme
       * changed at any point after that never reaches it at all.
       *
       * Both halves are fixed the way this surface fixes everything: over the
       * snapshot. The OWNER resolves `'system'` against the OS — it is already
       * the only place that does — and the overlay applies what it is told. The
       * inline script keeps its job of painting the first frame; this is what
       * makes every frame after it true.
       *
       * REQUIRED, not optional. An absent theme is indistinguishable from
       * light, which is the bug wearing a default.
       */
      theme: 'light' | 'dark';
      /**
       * How the shelf is shaped — the CONTENT half of `shelfPrefs` and only
       * that half. Width and placement are the window's business and go
       * straight to main; what crosses here is what the surface draws.
       *
       * It rides the snapshot for exactly the reason `theme` does: the shelf
       * is a separate renderer that does not own the store, so anything it
       * must KNOW comes over this relay. REQUIRED, because an absent shelf
       * shape is indistinguishable from the default — which is the bug the
       * theme field was made required to close.
       */
      shelf: {
        density: 'compact' | 'comfortable';
        sections: { alternatives: boolean; dials: boolean };
      };
      notice?: { tone: 'neutral' | 'warning'; text: string };
    };

export type AssistantAction =
  /**
   * `mode` is the choice made at the START and nowhere else: absent is the
   * calm session this app has always run, and `'pomodoro'` asks the host to
   * freeze the settings dial onto the draft. There is no global switch, so
   * there is nothing here to remember between sessions.
   */
  | { type: 'start-focus'; ref: WorkRef; mode?: 'pomodoro' }
  | { type: 'set-time-level'; level: TimeLevel }
  | { type: 'set-focus-level'; level: FocusLevel }
  | { type: 'pause-focus' }
  | { type: 'resume-focus' }
  | { type: 'complete-focus' }
  | { type: 'confirm-focus'; minutes: number | null }
  /** The rating answer for a `'rating'` focus: a word, or null for Skip. */
  | { type: 'rate-focus'; confidence: Confidence | null }
  | { type: 'switch-focus'; ref: WorkRef }
  /** End the WORK, not the sitting. `complete-focus` is the sitting. */
  | { type: 'complete-work'; ref: WorkRef }
  /** Park the WORK (set aside / skip for now). */
  | { type: 'park-work'; ref: WorkRef }
  /** Insert new work BEFORE `ref` and pin it as the primary. Title-only. */
  | { type: 'insert-before'; ref: WorkRef; title: string }
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
 *
 * The level here is the DISPLAY dial, not the time one. Dropping the
 * comparison is a statement about how much you want in front of you — "the
 * pressure in a running session was never the elapsed figure, it is the figure
 * it is being measured against" — and that is the display axis exactly. How
 * long your gap was has no bearing on how much of the readout you want.
 */
export function elapsedAgainstExpected(
  elapsedMin: number,
  expected: ExpectedTime,
  level: FocusLevel = DEFAULT_FOCUS_LEVEL,
): string {
  const done = fmtMinutes(elapsedMin);
  // At low focus the number survives and the verdict does not. The pressure in
  // a running session was never the elapsed figure — it is the figure it is
  // being measured against, and a target is the last thing you need when you
  // have already told the shelf you are running on empty.
  if (level === 'low') return `${done} so far`;
  return expected.kind === 'history'
    ? `${done} of ${expected.lowMin}–${expected.highMin}m`
    : `${done} of ${expected.minutes}m`;
}
