import type { ActiveFocusSession } from './focusSession';
import { pauseFocusSession } from './focusSession';

/**
 * Pomodoro structure laid over the calm session, and laid over it without
 * changing what a session IS.
 *
 * `focusSession.ts` banks timestamps and answers "how long have I worked" as
 * arithmetic at read time; every function here answers "how long until the
 * next boundary" out of the same banked numbers, so a countdown paints at
 * whatever rate a surface likes without a transition, without a Dexie write,
 * and without a clock this module owns. The one new timer in the app is a
 * single renderer-side timeout armed at each transition — `nextBoundaryDelayMs`
 * is what it is armed with, and `applyCycleBoundary` is what it lands.
 *
 * Because every transition is computed rather than observed, a missed timeout
 * costs nothing: a machine asleep across a boundary applies it retroactively
 * at the next read, flipping AT the true boundary rather than at the wake, so
 * hours away are never banked as work. That is the idle watcher's rule
 * restated, and it is why the exact firing moment is cheap to be wrong about.
 */

const MIN = 60_000;

export interface CycleConfig {
  /** Length of one work interval. */
  workMin: number;
  /** Length of an ordinary break. */
  breakMin: number;
  /** Length of the break that follows every `longEvery`-th interval. */
  longBreakMin: number;
  /** Every Nth break is long. */
  longEvery: number;
}

export const DEFAULT_CYCLE_CONFIG: CycleConfig = {
  workMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  longEvery: 4,
};

/**
 * The sane ranges, stated once. They are not a matter of taste: a two-minute
 * work interval is a notification generator and a four-hour one has no break
 * structure left to speak of, and both would be reachable by hand-editing the
 * settings row if the clamp lived in the UI.
 */
const RANGES: Record<keyof CycleConfig, [number, number]> = {
  workMin: [5, 120],
  breakMin: [1, 60],
  longBreakMin: [1, 60],
  longEvery: [2, 10],
};

function clampField(key: keyof CycleConfig, raw: unknown): number {
  const [lo, hi] = RANGES[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_CYCLE_CONFIG[key];
  return Math.min(hi, Math.max(lo, Math.round(raw)));
}

/** Per-field clamp; a field that is not a finite number falls back to its default. */
export function clampCycleConfig(raw: Partial<CycleConfig>): CycleConfig {
  return {
    workMin: clampField('workMin', raw.workMin),
    breakMin: clampField('breakMin', raw.breakMin),
    longBreakMin: clampField('longBreakMin', raw.longBreakMin),
    longEvery: clampField('longEvery', raw.longEvery),
  };
}

/**
 * Total, field by field: a settings row written by a future build, half-typed
 * by hand, or plain corrupt still yields four usable numbers. Losing the dial
 * must never cost someone the ability to start a session.
 */
export function parseCycleConfig(raw: unknown): CycleConfig {
  if (typeof raw !== 'string') return { ...DEFAULT_CYCLE_CONFIG };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_CYCLE_CONFIG };
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_CYCLE_CONFIG };
  return clampCycleConfig(parsed as Partial<CycleConfig>);
}

export function serializeCycleConfig(config: CycleConfig): string {
  return JSON.stringify(config);
}

/**
 * The cycle a starting session freezes onto itself. Frozen, because a dial
 * turned in Settings mid-session would retime an interval already under way —
 * the countdown on screen would jump, and the minutes already worked would be
 * measured against a length they were never run at.
 */
export function cycleFor(config: CycleConfig): NonNullable<ActiveFocusSession['cycle']> {
  return { ...clampCycleConfig(config), completed: 0 };
}

/** Banked active time plus the stretch under way — breaks excluded, as ever. */
function totalActiveMs(session: ActiveFocusSession, nowMs: number): number {
  const stretch = session.activeSinceMs === null ? 0 : Math.max(0, nowMs - session.activeSinceMs);
  return session.accumulatedMs + stretch;
}

/**
 * Milliseconds left in the CURRENT work interval, or null when there is no
 * interval running — a calm session, a break, a session being confirmed.
 *
 * The interval is measured out of the session's whole active time minus the
 * intervals already completed, so a manual pause in the middle of one simply
 * stops the clock: nothing is banked against the interval that is not banked
 * against the session.
 */
export function workRemainingMs(session: ActiveFocusSession, nowMs: number): number | null {
  const c = session.cycle;
  if (!c || session.phase !== 'active') return null;
  const progress = Math.max(0, totalActiveMs(session, nowMs) - c.completed * c.workMin * MIN);
  return Math.max(0, c.workMin * MIN - progress);
}

function breakLenMs(cycle: NonNullable<ActiveFocusSession['cycle']>): number {
  return (cycle.breakKind === 'long' ? cycle.longBreakMin : cycle.breakMin) * MIN;
}

/**
 * Milliseconds left in the break the CYCLE started, or null.
 *
 * Null covers three different situations that all mean "nothing to count
 * down": a manual break (no `breakStartedMs` — the user chose to stop, and a
 * timer over that would be the app deciding when they come back), a calm
 * session, and a break whose end has already been announced. That last one is
 * what stops the boundary firing twice: work never auto-starts, so the session
 * sits on `break` indefinitely after the notice, and a countdown that stayed
 * at zero would re-arm the timeout forever.
 */
export function breakRemainingMs(session: ActiveFocusSession, nowMs: number): number | null {
  const c = session.cycle;
  if (!c || session.phase !== 'break' || c.breakStartedMs === undefined || c.breakNotified) return null;
  return Math.max(0, c.breakStartedMs + breakLenMs(c) - nowMs);
}

/**
 * What to arm the single timeout with, or null when this draft has no boundary
 * ahead of it. A session is either working towards a work-end or resting
 * towards a break-end; it is never both, which is why one `??` is the whole
 * decision.
 */
export function nextBoundaryDelayMs(session: ActiveFocusSession, nowMs: number): number | null {
  return workRemainingMs(session, nowMs) ?? breakRemainingMs(session, nowMs);
}

/**
 * Land a due boundary, or answer null.
 *
 * A work interval ending flips the session to `break` at the boundary MOMENT
 * and not at `nowMs`: a timeout that fires late, or a laptop opened an hour
 * after the interval ran out, must not bank the overshoot as work. That is the
 * one subtlety here, and it is why `pauseFocusSession` is handed a computed
 * timestamp rather than the clock.
 *
 * A break ending changes no phase at all. Work never auto-starts — the session
 * waits for the user to come back and resume — so all this transition does is
 * mark the notice as sent.
 */
export function applyCycleBoundary(
  session: ActiveFocusSession,
  nowMs: number,
): { session: ActiveFocusSession; event: 'work-ended' | 'break-ended' } | null {
  const work = workRemainingMs(session, nowMs);
  if (work !== null && work <= 0) {
    const c = session.cycle!;
    const completed = c.completed + 1;
    const overshootMs = totalActiveMs(session, nowMs) - completed * c.workMin * MIN;
    const boundaryMs = nowMs - Math.max(0, overshootMs);
    const paused = pauseFocusSession(session, boundaryMs);
    return {
      session: {
        ...paused,
        cycle: {
          ...c,
          completed,
          breakStartedMs: boundaryMs,
          breakKind: completed % c.longEvery === 0 ? 'long' : 'short',
        },
      },
      event: 'work-ended',
    };
  }
  const brk = breakRemainingMs(session, nowMs);
  if (brk !== null && brk <= 0) {
    return {
      session: { ...session, cycle: { ...session.cycle!, breakNotified: true } },
      event: 'break-ended',
    };
  }
  return null;
}
