import type { ExpectedTime, WorkRef } from './expectedTime';
import { uid } from './tree';

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
  /** Set while confirming: the elapsed minutes the user is being asked about. */
  proposedMinutes?: number;
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
  return { ...session, activeSinceMs: nowMs, phase: 'active' };
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
    ...(s.proposedMinutes === undefined ? {} : { proposedMinutes: s.proposedMinutes }),
  };
}
