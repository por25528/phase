// The validated desktop-shell bridge for the MAIN renderer, as a deep module.
//
// Three narrow invoke verbs and one send, all validated at the sender seam:
// the main window's webContents id is the only id allowed to drive the shell,
// matched exactly against the live window. There are no renderer-supplied
// channels and no forwarding — `register` installs exactly these four,
// `dispose` removes exactly those four, and everything else the renderer might
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
const OVERLAY_ENABLED_CHANNEL = `${SHELL_CHANNEL_PREFIX}:overlay-enabled`;

const FOCUS_PHASES = ['active', 'break', 'confirming'];

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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
  return {
    phase: raw.phase,
    activeSinceMs: raw.activeSinceMs,
    accumulatedMs: raw.accumulatedMs,
    title: raw.title,
  };
}

function createShellIpc(deps) {
  const {
    getMainWindow, openAssistant, showMainWindow, getLaunchAtLogin, setLaunchAtLogin,
    onFocusStatus, onOverlayEnabled,
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

  // The Settings toggle, and a send for the same reason the status is: the
  // renderer flips a switch and moves on, and a pill that failed to come up
  // must never be something a preference waits for.
  function onOverlayEnabledMessage(event, enabled) {
    if (!isMainSender(event)) return;
    if (typeof enabled !== 'boolean') return;
    onOverlayEnabled(enabled);
  }

  return {
    register(ipcMain) {
      ipcMain.handle(`${SHELL_CHANNEL_PREFIX}:open-assistant`, onOpenAssistant);
      ipcMain.handle(`${SHELL_CHANNEL_PREFIX}:get-launch-at-login`, onGetLaunchAtLogin);
      ipcMain.handle(`${SHELL_CHANNEL_PREFIX}:set-launch-at-login`, onSetLaunchAtLogin);
      ipcMain.on(FOCUS_STATUS_CHANNEL, onFocusStatusMessage);
      ipcMain.on(OVERLAY_ENABLED_CHANNEL, onOverlayEnabledMessage);
    },
    dispose(ipcMain) {
      ipcMain.removeHandler(`${SHELL_CHANNEL_PREFIX}:open-assistant`);
      ipcMain.removeHandler(`${SHELL_CHANNEL_PREFIX}:get-launch-at-login`);
      ipcMain.removeHandler(`${SHELL_CHANNEL_PREFIX}:set-launch-at-login`);
      ipcMain.removeAllListeners(FOCUS_STATUS_CHANNEL);
      ipcMain.removeAllListeners(OVERLAY_ENABLED_CHANNEL);
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
      showMainWindow();
      const main = liveMain();
      if (!main) return;
      // A renderer that is still loading would drop the push on the floor;
      // wait for the one load to finish, then send exactly once.
      if (main.webContents.isLoadingMainFrame()) {
        main.webContents.once('did-finish-load', () => {
          main.webContents.send(`${SHELL_CHANNEL_PREFIX}:open-settings`);
        });
      } else {
        main.webContents.send(`${SHELL_CHANNEL_PREFIX}:open-settings`);
      }
    },
  };
}

module.exports = {
  SHELL_CHANNEL_PREFIX, FOCUS_STATUS_CHANNEL, FOCUS_REQUEST_CHANNEL,
  OVERLAY_ENABLED_CHANNEL, createShellIpc,
};
