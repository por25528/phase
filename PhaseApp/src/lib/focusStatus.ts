import type { ActiveFocusSession } from './focusSession';

/**
 * The focus seam: what the main process is told about a running session, and
 * the only things it may ask for back.
 *
 * Both halves live here because they are one contract with one rule behind it:
 * **main observes, the renderer writes.** Nothing in `electron/` may import
 * from `src/`, so the shape crossing the seam is declared once on this side
 * and mirrored structurally in the `.d.cts` files beside the modules that
 * consume it — exactly as `busyBlocks` is.
 *
 * The snapshot is TIMESTAMPS, never a duration. "How long has this run" stays
 * arithmetic at read time, on whichever side is asking, which is what lets the
 * menu bar repaint every minute while the store performs no transition and
 * writes nothing. A snapshot carrying `elapsedMs` would have to be re-sent to
 * stay true, and a session that wrote to Dexie once a minute is precisely what
 * the calm session model exists to avoid.
 */
export type FocusStatusSnapshot = {
  phase: 'active' | 'break' | 'confirming';
  /** When the current active stretch began, or null on a break / while confirming. */
  activeSinceMs: number | null;
  /** Active milliseconds banked by completed stretches. Never includes breaks. */
  accumulatedMs: number;
  title: string;
  /**
   * Present only on a pomodoro session, and durations rather than a remaining
   * figure — the same rule the two timestamps above follow. Every surface
   * computes "how much is left" at read time from these numbers, so the pill
   * and the tray can count down for twenty-five minutes on one push.
   *
   * `breakNotified` is deliberately NOT here: it is what stops the renderer
   * sending a second notice, and main sends none.
   */
  cycle?: {
    workMin: number;
    breakMin: number;
    longBreakMin: number;
    longEvery: number;
    completed: number;
    breakStartedMs?: number;
    breakKind?: 'short' | 'long';
  };
} | null;

/**
 * The draft, projected down to what main is allowed to know.
 *
 * A projection and not the draft itself: the ref, the goal, the evidence, the
 * focus level and the proposed minutes all stay in the renderer. The menu bar
 * needs a phase, two numbers and a name, and what never crosses can never
 * leak into a second opinion about the session.
 */
export function focusStatusOf(draft: ActiveFocusSession | null): FocusStatusSnapshot {
  if (!draft) return null;
  const cycle = draft.cycle;
  return {
    phase: draft.phase,
    activeSinceMs: draft.activeSinceMs,
    accumulatedMs: draft.accumulatedMs,
    title: draft.title,
    ...(cycle === undefined ? {} : {
      cycle: {
        workMin: cycle.workMin,
        breakMin: cycle.breakMin,
        longBreakMin: cycle.longBreakMin,
        longEvery: cycle.longEvery,
        completed: cycle.completed,
        ...(cycle.breakStartedMs === undefined ? {} : { breakStartedMs: cycle.breakStartedMs }),
        ...(cycle.breakKind === undefined ? {} : { breakKind: cycle.breakKind }),
      },
    }),
  };
}

/**
 * Everything main may ask the renderer to do to the session.
 *
 * Three of them are menu clicks and two are the idle watcher's observations,
 * and they share one channel because they are one sentence: *something outside
 * the window happened to this session*. Every one lands on an existing store
 * action — there is no new write path here, which is the same promise the
 * agent surface makes.
 */
export type FocusRequest =
  | { type: 'take-break' }
  | { type: 'resume' }
  | { type: 'finish' }
  /** Pause retroactively at `idleStartMs`, so the absence is never banked. */
  | { type: 'auto-break'; idleStartMs: number }
  /** The user is back after an auto-break, and was gone this long. */
  | { type: 'returned'; awayMs: number };

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Validation happens HERE and nowhere earlier, for the reason
 * `validAgentRequest` does: `shellIpc.cjs`, `menuBar.cjs` and `idleWatch.cjs`
 * import nothing from `src/`, so the renderer is the first side of the process
 * seam that can spend this. Total — an unknown verb is a refusal, never a
 * throw inside an IPC listener.
 */
export function validFocusRequest(raw: unknown): raw is FocusRequest {
  if (!raw || typeof raw !== 'object') return false;
  const request = raw as Record<string, unknown>;
  switch (request.type) {
    case 'take-break':
    case 'resume':
    case 'finish':
      return true;
    case 'auto-break':
      return isFiniteNonNegative(request.idleStartMs);
    case 'returned':
      return isFiniteNonNegative(request.awayMs);
    default:
      return false;
  }
}
