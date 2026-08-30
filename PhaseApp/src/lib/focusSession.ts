import type { ExpectedTime, WorkRef } from './expectedTime';
import { DEFAULT_TIME_LEVEL, isTimeLevel, type TimeLevel } from './timeLens';
import { findNode, uid } from './tree';
import { isDone } from './status';
import type { Goal, Task } from '../db/types';

/**
 * A calm focus session: no countdown, no ticking writes, no state that only a
 * timer can advance.
 *
 * Everything here is a pure transition over injected `nowMs` timestamps. The
 * draft records WHEN work started and how much active time has been banked;
 * "how long have I worked" is arithmetic over those numbers at read time, so a
 * one-second interval can paint the UI without a single transition — and
 * without a single Dexie write — depending on it.
 *
 * A draft is not history. It becomes a `Session` only when the user completes
 * or confirms it (`finishFocusSession` returning a log request the store hands
 * to `logSession`), which is why `Session` needs no `confirmed` field: nothing
 * unconfirmed ever reaches that table.
 */

export interface ActiveFocusSession {
  id: string;
  ref: WorkRef;
  /** Frozen at start: a renamed task does not silently relabel a running session. */
  title: string;
  goalTitle?: string;
  startedAtMs: number;
  /** When the current active stretch began, or null on a break / while confirming. */
  activeSinceMs: number | null;
  /** Active milliseconds banked by completed stretches. Never includes breaks. */
  accumulatedMs: number;
  phase: 'active' | 'break' | 'confirming';
  expected: ExpectedTime;
  /**
   * The window the session was started in. Stored under its original name
   * because this object is a settings row: a rename would read as absent to
   * every session already in flight. It reaches history as `Session.focus` and
   * nowhere else.
   */
  focusLevel: TimeLevel;
  /** Set while confirming: the elapsed minutes the user is being asked about. */
  proposedMinutes?: number;
  /**
   * Set only by the idle watcher's retroactive pause, cleared by any resume.
   *
   * It is what lets a surface tell "I pressed Take break" from "the app
   * noticed I had gone", which are the same `break` phase and must not read
   * the same. It never reaches `Session` history — a draft is not history —
   * and an older draft that predates the field is an ordinary manual break,
   * which is the safe reading: the notice is an explanation, and explaining a
   * break the user took themselves would be noise.
   */
  autoBreak?: true;
  /**
   * How long the absence lasted, FROZEN at the moment the watcher saw the
   * user come back. Deliberately not derived from the clock at read time:
   * away time stops when you return, so a figure that kept growing while the
   * shelf sat open would state a longer absence every second you looked at it.
   * Absent until the return is observed — a lid still shut has no answer yet.
   */
  awayMs?: number;
}

/**
 * When a session stops being believable as one sitting. Three hours by
 * default; when the student's own history says this work runs long, twice its
 * high end — a 2h pset making a 3.5h session plausible is exactly what the
 * evidence is for.
 */
export const STALE_FOCUS_MIN = 180;

export function staleFocusLimitMin(expected: ExpectedTime): number {
  if (expected.kind === 'history') return Math.max(STALE_FOCUS_MIN, expected.highMin * 2);
  return STALE_FOCUS_MIN;
}

export interface StartFocusInput {
  ref: WorkRef;
  title: string;
  goalTitle?: string;
  expected: ExpectedTime;
  focusLevel: TimeLevel;
  nowMs: number;
}

export function startFocusSession(input: StartFocusInput): ActiveFocusSession {
  return {
    id: uid(),
    ref: input.ref,
    title: input.title,
    ...(input.goalTitle === undefined ? {} : { goalTitle: input.goalTitle }),
    startedAtMs: input.nowMs,
    activeSinceMs: input.nowMs,
    accumulatedMs: 0,
    phase: 'active',
    expected: input.expected,
    focusLevel: input.focusLevel,
  };
}

/** Milliseconds of the current active stretch, clamped so a backwards clock banks nothing. */
function stretchMs(session: ActiveFocusSession, nowMs: number): number {
  if (session.activeSinceMs === null) return 0;
  return Math.max(0, nowMs - session.activeSinceMs);
}

export function pauseFocusSession(session: ActiveFocusSession, nowMs: number): ActiveFocusSession {
  if (session.phase !== 'active') return session;
  return {
    ...session,
    accumulatedMs: session.accumulatedMs + stretchMs(session, nowMs),
    activeSinceMs: null,
    phase: 'break',
  };
}

export function resumeFocusSession(session: ActiveFocusSession, nowMs: number): ActiveFocusSession {
  if (session.phase !== 'break') return session;
  const { autoBreak: _autoBreak, awayMs: _awayMs, ...rest } = session;
  // Both fields describe THIS break and nothing else, so resuming spends them.
  // Leaving them on the draft would have the next manual break inherit an
  // explanation about an absence that ended a session-stretch ago.
  return { ...rest, activeSinceMs: nowMs, phase: 'active' };
}

/**
 * The retroactive pause the idle watcher asks for.
 *
 * `idleStartMs` is when input STOPPED, not when the five-minute threshold
 * fired, which is the whole point: the minutes spent away are never banked.
 * `pauseFocusSession` already accepts an arbitrary `nowMs`, so this is that
 * transition plus the clamp and the mark.
 *
 * The clamp matters for the report rather than for the arithmetic —
 * `stretchMs` already refuses to bank a negative stretch — but a pause stamped
 * before the stretch began would make `awayMs` describe time the session had
 * not started for.
 */
export function autoPauseFocusSession(
  session: ActiveFocusSession,
  idleStartMs: number,
): ActiveFocusSession {
  if (session.phase !== 'active') return session;
  const at = session.activeSinceMs === null
    ? idleStartMs
    : Math.max(idleStartMs, session.activeSinceMs);
  return { ...pauseFocusSession(session, at), autoBreak: true };
}

/**
 * Freeze how long the absence lasted, once the watcher has seen the user back.
 *
 * Only an auto-break can carry the figure: a break someone took on purpose is
 * not an absence to be explained. A draft that moved on while the machine was
 * asleep — resumed, completed, reconciled into `confirming` — is returned
 * untouched, so a late message is dropped rather than reopening a settled
 * question.
 */
export function markFocusReturn(
  session: ActiveFocusSession,
  awayMs: number,
): ActiveFocusSession {
  if (session.phase !== 'break' || session.autoBreak !== true) return session;
  return { ...session, awayMs: Math.max(0, awayMs) };
}

/** Whole minutes of active work so far — breaks excluded, rounded to the nearest minute. */
export function elapsedFocusMinutes(session: ActiveFocusSession, nowMs: number): number {
  return Math.round((session.accumulatedMs + stretchMs(session, nowMs)) / 60_000);
}

export type FocusFinish =
  | { kind: 'log'; minutes: number }
  /**
   * The session is too long to write into history unasked. The returned draft
   * is parked in `confirming` with the figure the user is being asked about;
   * nothing has been logged.
   */
  | { kind: 'needs-confirmation'; session: ActiveFocusSession };

export function finishFocusSession(session: ActiveFocusSession, nowMs: number): FocusFinish {
  const minutes = elapsedFocusMinutes(session, nowMs);
  if (minutes > staleFocusLimitMin(session.expected)) {
    return {
      kind: 'needs-confirmation',
      session: {
        ...session,
        accumulatedMs: session.accumulatedMs + stretchMs(session, nowMs),
        activeSinceMs: null,
        phase: 'confirming',
        proposedMinutes: minutes,
      },
    };
  }
  return { kind: 'log', minutes: Math.max(1, minutes) };
}

/**
 * What a draft becomes when the work it names changes under it.
 *
 * The shelf's own checkbox settles a draft through `finishWork`, but it is not
 * the only way to finish work: Today's row, the tree's bulk bar and the agent
 * socket all reach `toggleLeaf`/`toggleTask`, and a delete can remove the
 * step outright. A draft left running past any of those showed the shelf a
 * session still ticking on a task the page beneath it had struck through.
 *
 * Three answers. Work still open → the same draft, untouched. Work gone → no
 * draft, because there is nothing left to ask about (a logged `Session` may
 * dangle; an unasked question may not). Work DONE → `confirming`, with the
 * elapsed minutes proposed: the tick is certain and already written, the
 * minutes are not, and logging them here would be a second write sweeping the
 * undo the first one armed — so the shelf asks, as it already knows how to.
 * A draft already `confirming` is left alone; it is already the question.
 */
export function reconcileFocusDraft(
  draft: ActiveFocusSession | null,
  goals: Goal[],
  tasks: Task[],
  nowMs: number,
): ActiveFocusSession | null {
  if (!draft || draft.phase === 'confirming') return draft;
  const { ref } = draft;
  let exists = false;
  let done = false;
  if (ref.kind === 'step') {
    for (const goal of goals) {
      const node = findNode(goal.nodes, ref.id);
      if (!node) continue;
      exists = true;
      done = isDone(node);
      break;
    }
  } else {
    const task = tasks.find((t) => t.id === ref.id);
    exists = task !== undefined;
    done = task?.done === true;
  }
  if (!exists) return null;
  if (!done) return draft;
  return {
    ...draft,
    accumulatedMs: draft.accumulatedMs + stretchMs(draft, nowMs),
    activeSinceMs: null,
    phase: 'confirming',
    proposedMinutes: elapsedFocusMinutes(draft, nowMs),
  };
}

/**
 * Discarding produces nothing, ever. The type says so: there is no way to get
 * a log request out of a discard.
 */
export function discardFocusSession(_session: ActiveFocusSession): null {
  return null;
}

export function serializeActiveFocusSession(session: ActiveFocusSession): string {
  return JSON.stringify(session);
}

const PHASES = new Set(['active', 'break', 'confirming']);

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validRef(raw: unknown): raw is WorkRef {
  if (!raw || typeof raw !== 'object') return false;
  const ref = raw as Partial<WorkRef>;
  if (typeof ref.id !== 'string' || ref.id === '') return false;
  if (ref.kind === 'step') return typeof ref.goalId === 'string' && ref.goalId !== '';
  if (ref.kind === 'task') return typeof ref.goalId === 'string' || ref.goalId === null;
  return false;
}

function validExpected(raw: unknown): raw is ExpectedTime {
  if (!raw || typeof raw !== 'object') return false;
  const e = raw as Record<string, unknown>;
  if (e.kind === 'history') {
    return isFiniteNonNegative(e.lowMin)
      && isFiniteNonNegative(e.highMin)
      && (e.confidence === 'medium' || e.confidence === 'high')
      && isFiniteNonNegative(e.sampleCount);
  }
  if (e.kind === 'estimate') return isFiniteNonNegative(e.minutes);
  if (e.kind === 'starter') return e.minutes === 30;
  return false;
}

/**
 * A persisted draft, or null. Total: any malformed shape — hand-edited storage,
 * a draft written by a future build, plain corruption — reads as "no session"
 * rather than as an exception at startup.
 */
export function parseActiveFocusSession(raw: unknown): ActiveFocusSession | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const s = parsed as Record<string, unknown>;

  if (typeof s.id !== 'string' || s.id === '') return null;
  if (!validRef(s.ref)) return null;
  if (typeof s.title !== 'string') return null;
  if (s.goalTitle !== undefined && typeof s.goalTitle !== 'string') return null;
  if (!isFiniteNonNegative(s.startedAtMs)) return null;
  if (s.activeSinceMs !== null && !isFiniteNonNegative(s.activeSinceMs)) return null;
  if (!isFiniteNonNegative(s.accumulatedMs)) return null;
  if (typeof s.phase !== 'string' || !PHASES.has(s.phase)) return null;
  if (!validExpected(s.expected)) return null;
  if (s.proposedMinutes !== undefined && !isFiniteNonNegative(s.proposedMinutes)) return null;

  return {
    id: s.id,
    ref: s.ref,
    title: s.title,
    ...(s.goalTitle === undefined ? {} : { goalTitle: s.goalTitle }),
    startedAtMs: s.startedAtMs,
    activeSinceMs: s.activeSinceMs as number | null,
    accumulatedMs: s.accumulatedMs,
    phase: s.phase as ActiveFocusSession['phase'],
    expected: s.expected,
    // Absent or malformed reads as the default rather than as "no session":
    // a draft written before this field existed is still a real session, and
    // losing it would cost the user time they actually worked.
    focusLevel: isTimeLevel(s.focusLevel) ? s.focusLevel : DEFAULT_TIME_LEVEL,
    ...(s.proposedMinutes === undefined ? {} : { proposedMinutes: s.proposedMinutes }),
    // Both absent on every draft written before the idle watcher existed, and
    // absent on every manual break after it. Anything but the exact expected
    // shape reads as "not an auto-break" rather than as a corrupt draft: the
    // pair is an EXPLANATION, and losing an explanation must never cost
    // someone the session it was attached to.
    ...(s.autoBreak === true ? { autoBreak: true as const } : {}),
    ...(s.autoBreak === true && isFiniteNonNegative(s.awayMs) ? { awayMs: s.awayMs } : {}),
  };
}
