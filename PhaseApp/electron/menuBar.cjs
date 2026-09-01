// Owns the macOS menu-bar item — its four standing actions, the live session
// timer, and the session verbs that appear beside them — as a deep module.
//
// Every Electron capability is injected — Tray, Menu, nativeImage and the
// repaint timer all stay in the main.cjs composition root — so the creation
// ordering, the template contract, and the failure isolation below are
// unit-testable without Electron. The one rule that matters: a menu-bar item
// is a nicety, never a requirement, so any failure in creation is caught, the
// partial Tray is destroyed, the handle is cleared, and the exact log line is
// the only trace the app shows — the Hub, the global shortcut, and the shelf
// all keep working. Quit Phase routes through the injected onQuit callback,
// never Electron's role: 'quit', because the lifecycle module must observe one
// deliberate route out of the app.
//
// **The timer is arithmetic over a snapshot, not a clock the renderer feeds.**
// A status arrives on a TRANSITION — started, paused, resumed, finished — and
// carries `activeSinceMs` and `accumulatedMs`, so this module can repaint the
// title every minute while the store performs no transition and writes
// nothing. That is the calm-session rule restated on this side of the process
// seam: "how long" is arithmetic at read time, and the one thing a menu bar
// does is read.
//
// **It observes and never writes.** Take break / Resume / Finish session are
// injected callbacks that ask the RENDERER — still the only writer — to do it,
// exactly as the agent relay does. Nothing here mutates a session, and nothing
// here remembers one: the last snapshot is the whole of its memory.

// Whole minutes, and FLOOR rather than round. A timer that reads `1m` after
// thirty seconds is claiming a minute that has not happened; the cost is that
// this figure can sit one minute under the shelf's rounded readout for up to
// thirty seconds, which is the right way round for a clock you watch.
const MS_PER_MIN = 60_000;

// One repaint a minute, unaligned to the minute boundary on purpose: aligning
// would buy a title that changes on the second, and cost a second timer to
// compute the offset after every transition.
const REPAINT_MS = 60_000;

/** Elapsed active milliseconds, clamped so a backwards clock reports nothing extra. */
function elapsedMs(status, nowMs) {
  const stretch = status.activeSinceMs === null
    ? 0
    : Math.max(0, nowMs - status.activeSinceMs);
  return status.accumulatedMs + stretch;
}

/**
 * The countdown's own arithmetic, over the SAME banked numbers the elapsed
 * figure reads — structurally `workRemainingMs`/`breakRemainingMs` from
 * `src/lib/focusCycle.ts`, mirrored rather than imported for the reason every
 * shape at this seam is. Null means there is nothing to count down.
 */
function workRemainingMs(status, nowMs) {
  const c = status.cycle;
  if (!c || status.phase !== 'active') return null;
  const progress = Math.max(0, elapsedMs(status, nowMs) - c.completed * c.workMin * MS_PER_MIN);
  return Math.max(0, c.workMin * MS_PER_MIN - progress);
}

/**
 * Milliseconds left in a break the CYCLE started, or null.
 *
 * Null covers a manual break: one the user pressed carries no `breakStartedMs`,
 * and a timer over that would be the app deciding when they come back. A break
 * already spent returns a non-positive number, which callers read as "say it in
 * words" — work never auto-starts, so the session sits on break until it is
 * resumed, and a countdown pinned at zero would read as a stuck clock.
 */
function breakRemainingMs(status, nowMs) {
  const c = status.cycle;
  if (!c || status.phase !== 'break' || c.breakStartedMs === undefined) return null;
  const len = (c.breakKind === 'long' ? c.longBreakMin : c.breakMin) * MS_PER_MIN;
  return c.breakStartedMs + len - nowMs;
}

/**
 * CEIL, where the elapsed figure floors — and the two are the right way round.
 * A stopwatch may not claim a minute nobody worked; a countdown reading 17m
 * with 17m30s left throws away a minute that is still there.
 */
function remainingMin(ms) {
  return Math.max(0, Math.ceil(ms / MS_PER_MIN));
}

/**
 * Whether this status paints a figure that CHANGES — the only thing a repaint
 * is for. An active session always does; a break does only while the cycle is
 * still counting it down.
 */
function isCountdown(status, nowMs) {
  if (!status) return false;
  if (status.phase === 'active') return true;
  const brk = breakRemainingMs(status, nowMs);
  return brk !== null && brk > 0;
}

/**
 * What the menu bar says, and what it says by staying quiet.
 *
 * An empty title is not a missing case: outside a session the icon alone is
 * the whole signal, and the PRESENCE of text is what tells you something is
 * running from across the room. `confirming` is empty for a different reason —
 * that question belongs to the shelf, which is already asking it, and a menu
 * bar restating it would offer no way to answer.
 */
function trayTitle(status, nowMs) {
  if (!status) return '';
  if (status.phase === 'active') {
    const left = workRemainingMs(status, nowMs);
    if (left !== null) return `▶ ${remainingMin(left)}m left`;
    return `▶ ${Math.floor(elapsedMs(status, nowMs) / MS_PER_MIN)}m`;
  }
  if (status.phase === 'break') {
    const brk = breakRemainingMs(status, nowMs);
    if (brk !== null && brk > 0) return `⏸ break ${remainingMin(brk)}m`;
    return '⏸ on break';
  }
  return '';
}

function createMenuBar(deps) {
  const {
    createTray,
    buildMenu,
    loadImage,
    iconPath,
    onOpenPhase,
    onOpenAssistant,
    onOpenSettings,
    onQuit,
    onTakeBreak,
    onResume,
    onFinishSession,
    now,
    setTimer,
    logError,
  } = deps;

  let tray = null;
  /** The last snapshot the renderer published, or null for "no session". */
  let status = null;
  /** The live repaint's cancel function, or null when nothing is scheduled. */
  let stopRepaint = null;

  // The four that are always there, in the approved order. Built fresh each
  // time rather than held as a constant, because a Menu template is consumed
  // by `buildMenu` and reusing item objects across builds invites Electron to
  // hold on to the older menu's handlers.
  function standingItems() {
    return [
      { label: 'Open Phase', click: onOpenPhase },
      { label: 'Open assistant', click: onOpenAssistant },
      { label: 'Settings', click: onOpenSettings },
      { type: 'separator' },
      { label: 'Quit Phase', click: onQuit },
    ];
  }

  /**
   * The session verbs, ABOVE the standing four and present only while there is
   * a session to act on. `confirming` contributes nothing: the shelf owns that
   * question, and a menu offering "Finish session" for a sitting already
   * awaiting an answer would be a second way to answer it.
   */
  function sessionItems() {
    if (!status) return [];
    if (status.phase === 'active') {
      return [
        { label: 'Take break', click: onTakeBreak },
        { label: 'Finish session', click: onFinishSession },
        { type: 'separator' },
      ];
    }
    if (status.phase === 'break') {
      return [
        { label: 'Resume', click: onResume },
        { label: 'Finish session', click: onFinishSession },
        { type: 'separator' },
      ];
    }
    return [];
  }

  function cancelRepaint() {
    if (!stopRepaint) return;
    const cancel = stopRepaint;
    stopRepaint = null;
    try {
      cancel();
    } catch {
      // Nothing to recover: the timer is either gone or was never real.
    }
  }

  /**
   * Repaint the title, and schedule the next repaint only while it can change.
   *
   * A break and a finished session are STATIC text, so the timer stops with
   * them — a menu bar that woke every minute to rewrite the same two words
   * would be the one part of a calm session that never rests.
   */
  function paintTitle() {
    if (!tray) return;
    try {
      tray.setTitle(trayTitle(status, now()));
    } catch (error) {
      // A tray that cannot carry a title is still a tray: the menu keeps
      // working, so this stops the clock rather than tearing anything down.
      cancelRepaint();
      logError('[phase-shell] menu bar timer unavailable', error);
      return;
    }
    // Re-armed for anything that COUNTS — an elapsed figure, a work interval
    // running down, a break still being timed — and for nothing that does not.
    if (isCountdown(status, now())) {
      cancelRepaint();
      stopRepaint = setTimer(() => {
        stopRepaint = null;
        paintTitle();
      }, REPAINT_MS);
    } else {
      cancelRepaint();
    }
  }

  function paintMenu() {
    if (!tray) return;
    try {
      tray.setContextMenu(buildMenu([...sessionItems(), ...standingItems()]));
    } catch (error) {
      // Same reasoning as the title: the tray that is already up keeps its
      // previous menu rather than being destroyed under the user's cursor.
      logError('[phase-shell] menu bar unavailable', error);
    }
  }

  function create() {
    // Idempotent: a live tray is already installed; a cleared handle (failed
    // create or dispose) means the next create retries from scratch.
    if (tray) return;

    try {
      const image = loadImage(iconPath);
      if (image.isEmpty()) throw new Error('tray icon image is empty');
      image.setTemplateImage(true);

      const nativeTray = createTray(image);
      tray = nativeTray;
      nativeTray.setToolTip('Phase');
      nativeTray.setContextMenu(buildMenu([...sessionItems(), ...standingItems()]));
    } catch (error) {
      // Any partial Tray must not outlive the failed attempt.
      if (tray) {
        try { tray.destroy(); } catch { /* already gone */ }
        tray = null;
      }
      cancelRepaint();
      logError('[phase-shell] menu bar unavailable', error);
    }
  }

  /**
   * Adopt what the renderer says the session is doing.
   *
   * A snapshot that arrives with no tray is DROPPED rather than banked. The
   * tray is created at launch, long before the renderer has hydrated, so the
   * only way here is a tray that failed to come up — and the spec for that
   * case is the one this module has always kept: the menu bar is missing and
   * everything else carries on. Banking it would leave a stale session
   * painting itself onto a tray created much later for some other reason.
   */
  function setFocusStatus(next) {
    if (!tray) return;
    status = next ?? null;
    paintMenu();
    paintTitle();
  }

  function dispose() {
    // Before the tray goes, and unconditionally: a timer outliving its tray
    // would repaint a destroyed handle once a minute for the life of the app.
    cancelRepaint();
    status = null;
    if (!tray) return;
    const nativeTray = tray;
    tray = null;
    try {
      nativeTray.destroy();
    } catch {
      // Nothing to recover: the process is on its way out.
    }
  }

  return { create, dispose, setFocusStatus };
}

module.exports = { createMenuBar, trayTitle, REPAINT_MS };
