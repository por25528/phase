// Notices that you walked away from a running session, and says when you came
// back — as a deep module with every capability injected.
//
// `powerMonitor`, the timers and the renderer channel all stay in the main.cjs
// composition root, so the whole state machine below runs in a unit test with
// three fakes and no Electron. It imports nothing from `src/`, like every
// other module in this folder.
//
// **It observes; the renderer writes.** Nothing here touches a session. It
// sends one of two observations — "input stopped at this moment" and "they are
// back, and were gone this long" — and the renderer, still the only writer,
// decides what those mean by calling the same store actions the buttons call.
//
// **It polls only when there is something to notice.** No session, a break the
// user took themselves, a sitting parked in `confirming` — all three mean no
// timer at all. The one exception is the interval between an auto-break and
// the return that ends it, which is the only time this watches a session that
// is not active: the whole point of that stretch is to catch the moment the
// user comes back.

/**
 * Five minutes of no input is a walk away rather than a pause to think. There
 * is deliberately no setting: the cost of the threshold being slightly wrong
 * is nil — the pause is RETROACTIVE to the moment input stopped, so every
 * minute of the absence is excluded whether the trigger fires at five minutes
 * or at fifteen. What a setting would buy is a different moment to be told,
 * which is not worth a row in Settings.
 */
const IDLE_BREAK_SEC = 300;

/** Often enough that "when did you come back" is accurate to the half-minute. */
const POLL_MS = 30_000;

/**
 * Below this, someone is at the machine. It matches the poll interval on
 * purpose: a return anywhere in the gap between two polls reads as idle for at
 * most one interval, so no return can hide under the threshold.
 */
const RETURN_IDLE_SEC = 30;

function createIdleWatch(deps) {
  const {
    getIdleSeconds,
    onSuspend,
    onLockScreen,
    setTimer,
    now,
    notifyRenderer,
    logError,
  } = deps;

  /** The last snapshot the renderer published, or null for "no session". */
  let status = null;
  /** The live poll's cancel, or null when nothing is scheduled. */
  let stopPoll = null;
  /**
   * When the absence began, while an auto-break is waiting for its return —
   * and null the rest of the time. It is the double-fire guard as well as the
   * clock: an auto-break that has already been sent cannot be sent again until
   * a return (or a new active stretch) clears it.
   */
  let awayFromMs = null;
  let offSuspend = null;
  let offLockScreen = null;

  /** Whether there is anything left to notice. */
  function watching() {
    return (status !== null && status.phase === 'active') || awayFromMs !== null;
  }

  function cancelPoll() {
    if (!stopPoll) return;
    const cancel = stopPoll;
    stopPoll = null;
    try {
      cancel();
    } catch {
      // Nothing to recover: the timer is either gone or was never real.
    }
  }

  function schedule() {
    stopPoll = setTimer(() => {
      stopPoll = null;
      tick();
    }, POLL_MS);
  }

  function armPoll() {
    if (stopPoll) return;
    schedule();
  }

  function send(request) {
    try {
      notifyRenderer(request);
    } catch (error) {
      // A renderer that is gone is not a reason to stop watching: the window
      // can come back, and the hydrate-time re-push re-arms this from state.
      logError('[phase-shell] idle watch could not reach the window', error);
    }
  }

  function tick() {
    let idleSeconds;
    try {
      idleSeconds = getIdleSeconds();
    } catch (error) {
      // The OS refusing to answer once is not a session ending. Log it and
      // ask again next interval rather than silently going quiet for the day.
      logError('[phase-shell] idle time unavailable', error);
      if (watching()) armPoll();
      return;
    }

    if (awayFromMs === null) {
      if (status !== null && status.phase === 'active' && idleSeconds >= IDLE_BREAK_SEC) {
        // When input STOPPED, not when this poll noticed — that difference is
        // the entire feature. Banking would otherwise start again at the
        // threshold and count the five minutes nobody was there.
        const idleStartMs = now() - idleSeconds * 1000;
        awayFromMs = idleStartMs;
        send({ type: 'auto-break', idleStartMs });
      }
    } else if (idleSeconds < RETURN_IDLE_SEC) {
      const awayMs = Math.max(0, now() - awayFromMs);
      awayFromMs = null;
      send({ type: 'returned', awayMs });
    }

    if (watching()) armPoll();
    else cancelPoll();
  }

  /**
   * A closing lid or a locked screen is not something to wait five minutes
   * about: the absence is already certain, and the pause is stamped NOW
   * because now is the last moment anyone was there.
   *
   * Timers do not run while the machine is asleep, so the poll that notices
   * the return is the first one after it wakes — which is exactly when the
   * user is back at the keyboard.
   */
  function leftNow() {
    if (status === null || status.phase !== 'active') return;
    if (awayFromMs !== null) return;
    const at = now();
    awayFromMs = at;
    send({ type: 'auto-break', idleStartMs: at });
    armPoll();
  }

  return {
    /** Subscribe to the two events that mean "gone" with no waiting. */
    start() {
      if (offSuspend || offLockScreen) return;
      offSuspend = onSuspend(leftNow);
      offLockScreen = onLockScreen(leftNow);
    },

    /**
     * Adopt the renderer's latest snapshot, and start or stop watching.
     *
     * An `active` snapshot clears any pending return: the user is
     * demonstrably back, whether or not this module saw it happen, and a
     * `returned` sent afterwards would explain an absence the session has
     * already moved past.
     */
    setFocusStatus(next) {
      status = next ?? null;
      if (status !== null && status.phase === 'active') {
        awayFromMs = null;
        armPoll();
        return;
      }
      if (status === null || status.phase === 'confirming' || status.phase === 'rating') {
        // Gone, or a question the shelf already owns — the confirming
        // minutes, or the rating a sitting on a topic ends in. Either way
        // there is no running session for an absence to be about.
        awayFromMs = null;
        cancelPoll();
        return;
      }
      // A break. Watched only when this module is the reason for it — a break
      // the user pressed is a decision, and following someone around after it
      // to announce their own break back to them is noise.
      if (awayFromMs === null) cancelPoll();
      else armPoll();
    },

    dispose() {
      cancelPoll();
      status = null;
      awayFromMs = null;
      if (offSuspend) {
        try { offSuspend(); } catch { /* already gone */ }
        offSuspend = null;
      }
      if (offLockScreen) {
        try { offLockScreen(); } catch { /* already gone */ }
        offLockScreen = null;
      }
    },
  };
}

module.exports = { createIdleWatch, IDLE_BREAK_SEC, POLL_MS, RETURN_IDLE_SEC };
