// The validated desktop-shell bridge for the MAIN renderer, as a deep module.
//
// Three narrow invoke verbs and four sends, all validated at the sender seam:
// the main window's webContents id is the only id allowed to drive the shell,
// matched exactly against the live window. There are no renderer-supplied
// channels and no forwarding — `register` installs exactly these seven,
// `dispose` removes exactly those seven, and everything else the renderer might
// try is refused. `openSettings` and `sendFocusRequest` are the two
// main→renderer pushes and are sent by the MAIN process itself, never by a
// renderer.
//
// The focus status is a SEND rather than an invoke because nothing answers it:
// the renderer publishes what the session is doing and moves on, and a tray
// that failed to come up must never be something a transition waits for. The
// payload is normalized here, at the one seam that receives it, so the menu
// bar and the idle watcher are handed a snapshot they can trust rather than
// each re-deciding what a renderer meant.
//
// OS login-item exception handling deliberately lives in the main.cjs
// dependency functions (the shell adapter), not here: this module trusts the
// injected `getLaunchAtLogin`/`setLaunchAtLogin` and returns whatever they
// return.

const SHELL_CHANNEL_PREFIX = 'phase-shell';
const FOCUS_STATUS_CHANNEL = `${SHELL_CHANNEL_PREFIX}:focus-status`;
const FOCUS_REQUEST_CHANNEL = `${SHELL_CHANNEL_PREFIX}:focus-request`;
const PILL_PREFS_CHANNEL = `${SHELL_CHANNEL_PREFIX}:pill-prefs`;
const FOCUS_NOTIFY_CHANNEL = `${SHELL_CHANNEL_PREFIX}:focus-notify`;
const SHELF_PREFS_CHANNEL = `${SHELL_CHANNEL_PREFIX}:shelf-prefs`;

// A notice is text the OS paints over every other window, so its shape is
// settled here rather than trusted: an empty string is not a notification, and
// a paragraph is not a title.
const NOTICE_MAX = 200;

function isShortText(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= NOTICE_MAX;
}

const FOCUS_PHASES = ['active', 'break', 'confirming'];

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The optional pomodoro structure on a snapshot, or undefined.
 *
 * The asymmetry with `normalizeFocusStatus` is deliberate and load-bearing: a
 * malformed cycle drops the FIELD, never the snapshot. A running session must
 * not vanish from the menu bar because one number came across odd — the worst
 * a bad cycle can do is cost the countdown, and an elapsed figure is still a
 * true thing to show.
 */
function normalizeCycle(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  if (!isFinitePositive(raw.workMin)) return undefined;
  if (!isFinitePositive(raw.breakMin)) return undefined;
  if (!isFinitePositive(raw.longBreakMin)) return undefined;
  if (!isFinitePositive(raw.longEvery)) return undefined;
  if (!isFiniteNonNegative(raw.completed)) return undefined;
  if (raw.breakStartedMs !== undefined && !isFiniteNonNegative(raw.breakStartedMs)) return undefined;
  if (raw.breakKind !== undefined && raw.breakKind !== 'short' && raw.breakKind !== 'long') return undefined;
  const cycle = {
    workMin: raw.workMin,
    breakMin: raw.breakMin,
    longBreakMin: raw.longBreakMin,
    longEvery: raw.longEvery,
    completed: raw.completed,
  };
  if (raw.breakStartedMs !== undefined) cycle.breakStartedMs = raw.breakStartedMs;
  if (raw.breakKind !== undefined) cycle.breakKind = raw.breakKind;
  return cycle;
}

/**
 * The renderer's payload, reduced to a snapshot or to nothing.
 *
 * `null` means "no session" and is a real answer. `undefined` is what this
 * returns for a payload that is neither — a shape nobody in this repo sends,
 * so the only way to see one is a compromised or confused renderer, and
 * treating that as "no session" would silently erase a running timer. The
 * caller drops it instead.
 */
function normalizeFocusStatus(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return undefined;
  if (!FOCUS_PHASES.includes(raw.phase)) return undefined;
  if (raw.activeSinceMs !== null && !isFiniteNonNegative(raw.activeSinceMs)) return undefined;
  if (!isFiniteNonNegative(raw.accumulatedMs)) return undefined;
  if (typeof raw.title !== 'string') return undefined;
  const snapshot = {
    phase: raw.phase,
    activeSinceMs: raw.activeSinceMs,
    accumulatedMs: raw.accumulatedMs,
    title: raw.title,
  };
  const cycle = normalizeCycle(raw.cycle);
  if (cycle !== undefined) snapshot.cycle = cycle;
  return snapshot;
}

function createShellIpc(deps) {
  const {
    getMainWindow, openAssistant, showMainWindow, getLaunchAtLogin, setLaunchAtLogin,
    onFocusStatus, onPillPrefs, onFocusNotify, onShelfPrefs,
  } = deps;

  // The live-window helper: a destroyed handle is no handle at all.
  function liveMain() {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? win : null;
  }

  // Sender validation is an exact id match against the live main webContents —
  // not a name, not a prefix, not a stale handle.
  function isMainSender(event) {
    const main = liveMain();
    return !!main && event.sender.id === main.webContents.id;
  }

  function onOpenAssistant(event) {
    if (!isMainSender(event)) return false;
    openAssistant();
    return true;
  }

  function onGetLaunchAtLogin(event) {
    if (!isMainSender(event)) return null;
    return getLaunchAtLogin();
  }

  function onSetLaunchAtLogin(event, enabled) {
    if (!isMainSender(event)) return null;
    if (typeof enabled !== 'boolean') return null;
    return setLaunchAtLogin(enabled);
  }

  function onFocusStatusMessage(event, payload) {
    if (!isMainSender(event)) return;
    const snapshot = normalizeFocusStatus(payload);
    if (snapshot === undefined) return;
    onFocusStatus(snapshot);
  }

  /**
   * The pill's whole settings row, and a send for the same reason the status
   * is: the renderer flips a control and moves on, and a pill that failed to
   * come up must never be something a preference waits for.
   *
   * The payload is passed on as an OBJECT and validated field-by-field on the
   * far side, by `normalizePillPrefs` — nine settings validated twice would be
   * two lists to keep in step, and the pill's own module is the one that knows
   * what a size or a corner is. What this seam owes is the sender check and
   * the shape: anything that is not a plain object is refused here.
   */
  function onPillPrefsMessage(event, raw) {
    if (!isMainSender(event)) return;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    onPillPrefs(raw);
  }

  /**
   * The shelf's own settings row, forwarded whole.
   *
   * The same division of labour the pill's row takes: this seam owes the
   * sender check and the shape, and `assistantWindow.cjs` — the module that
   * knows what a width IS, and whose height budget is measured at one — owns
   * the values.
   */
  function onShelfPrefsMessage(event, raw) {
    if (!isMainSender(event)) return;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    onShelfPrefs(raw);
  }

  /**
   * A cycle boundary the renderer has already written, announced.
   *
   * A send for the same reason the status is: the transition is banked before
   * this is called, so a notification that cannot be raised costs a line in
   * the log and nothing else.
   */
  function onFocusNotifyMessage(event, notice) {
    if (!isMainSender(event)) return;
    if (!notice || typeof notice !== 'object') return;
    if (!isShortText(notice.title) || !isShortText(notice.body)) return;
    onFocusNotify({ title: notice.title, body: notice.body });
  }

  /**
   * Raise the app, then ask the renderer for a view once it can hear.
   *
   * A renderer still loading its first frame drops a push on the floor, so the
   * send waits for the one load and then happens exactly once.
   */
  function raiseAndAsk(channel) {
    showMainWindow();
    const main = liveMain();
    if (!main) return;
    if (main.webContents.isLoadingMainFrame()) {
      main.webContents.once('did-finish-load', () => {
        main.webContents.send(channel);
      });
    } else {
      main.webContents.send(channel);
    }
  }

  return {
    register(ipcMain) {
      ipcMain.handle(`${SHELL_CHANNEL_PREFIX}:open-assistant`, onOpenAssistant);
      ipcMain.handle(`${SHELL_CHANNEL_PREFIX}:get-launch-at-login`, onGetLaunchAtLogin);
      ipcMain.handle(`${SHELL_CHANNEL_PREFIX}:set-launch-at-login`, onSetLaunchAtLogin);
      ipcMain.on(FOCUS_STATUS_CHANNEL, onFocusStatusMessage);
      ipcMain.on(PILL_PREFS_CHANNEL, onPillPrefsMessage);
      ipcMain.on(FOCUS_NOTIFY_CHANNEL, onFocusNotifyMessage);
      ipcMain.on(SHELF_PREFS_CHANNEL, onShelfPrefsMessage);
    },
    dispose(ipcMain) {
      ipcMain.removeHandler(`${SHELL_CHANNEL_PREFIX}:open-assistant`);
      ipcMain.removeHandler(`${SHELL_CHANNEL_PREFIX}:get-launch-at-login`);
      ipcMain.removeHandler(`${SHELL_CHANNEL_PREFIX}:set-launch-at-login`);
      ipcMain.removeAllListeners(FOCUS_STATUS_CHANNEL);
      ipcMain.removeAllListeners(PILL_PREFS_CHANNEL);
      ipcMain.removeAllListeners(FOCUS_NOTIFY_CHANNEL);
      ipcMain.removeAllListeners(SHELF_PREFS_CHANNEL);
    },
    /**
     * Ask the main renderer — still the only writer — to do something to the
     * running session.
     *
     * Fire-and-forget, and deliberately WITHOUT `openSettings`' wait for
     * `did-finish-load`: every one of these is about a session that is running
     * right now, and a renderer still loading its first frame has no draft to
     * act on. Replaying a menu click a page load later would pause a session
     * the user has since resumed.
     */
    sendFocusRequest(request) {
      const main = liveMain();
      if (!main) return false;
      main.webContents.send(FOCUS_REQUEST_CHANNEL, request);
      return true;
    },
    /** Raise the app and ask the main renderer to open settings once it can. */
    openSettings() {
      raiseAndAsk(`${SHELL_CHANNEL_PREFIX}:open-settings`);
    },
    /**
     * Raise the app on Today — what a click on the floating pill means.
     *
     * The same shape as `openSettings` and deliberately the same FUNCTION
     * underneath: both raise the window and then ask the renderer for a view,
     * and both have to survive a renderer still loading its first frame. Two
     * near-copies is how one of them quietly loses the wait.
     */
    openToday() {
      raiseAndAsk(`${SHELL_CHANNEL_PREFIX}:open-today`);
    },
  };
}

module.exports = {
  SHELL_CHANNEL_PREFIX, FOCUS_STATUS_CHANNEL, FOCUS_REQUEST_CHANNEL,
  PILL_PREFS_CHANNEL, FOCUS_NOTIFY_CHANNEL, SHELF_PREFS_CHANNEL, createShellIpc,
};
