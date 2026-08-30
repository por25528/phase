// Deliberately imports nothing from `electron` and nothing from `src/`:
// main.cjs stays the only composition root that may know powerMonitor, and the
// process seam prevents sharing declarations with the renderer (see
// busyBlocks.d.cts). Every capability is injected, so the static face here is
// the minimal truth the main process hands in.

/**
 * What the renderer says the session is doing. Structurally the
 * `FocusStatusSnapshot` declared in `src/lib/focusStatus.ts`, mirrored rather
 * than imported.
 */
export interface IdleWatchFocusStatus {
  phase: 'active' | 'break' | 'confirming';
  activeSinceMs: number | null;
  accumulatedMs: number;
  title: string;
}

/**
 * The two observations this module makes. Structurally the matching members
 * of `FocusRequest` in `src/lib/focusStatus.ts`, which is where they are
 * validated — the renderer is the first side of the seam that may.
 */
export type IdleWatchRequest =
  | { type: 'auto-break'; idleStartMs: number }
  | { type: 'returned'; awayMs: number };

export interface IdleWatchDeps {
  /** Seconds since the last user input, from the OS. */
  getIdleSeconds(): number;
  /** Subscribe to system suspend; returns unsubscribe. */
  onSuspend(fn: () => void): () => void;
  /** Subscribe to screen lock; returns unsubscribe. */
  onLockScreen(fn: () => void): () => void;
  /** One-shot; returns the cancel. Re-armed by the poll itself. */
  setTimer(fn: () => void, ms: number): () => void;
  now(): number;
  notifyRenderer(request: IdleWatchRequest): void;
  logError(message: string, error?: unknown): void;
}

export interface IdleWatch {
  /** Subscribe to suspend and lock. Idempotent. */
  start(): void;
  /** Adopt the renderer's latest snapshot, and start or stop polling. */
  setFocusStatus(status: IdleWatchFocusStatus | null): void;
  dispose(): void;
}

export declare function createIdleWatch(deps: IdleWatchDeps): IdleWatch;
export declare const IDLE_BREAK_SEC: number;
export declare const POLL_MS: number;
export declare const RETURN_IDLE_SEC: number;
