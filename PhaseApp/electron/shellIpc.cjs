// The validated desktop-shell bridge for the MAIN renderer, as a deep module.
//
// Three narrow invoke verbs, all validated at the sender seam: the main
// window's webContents id is the only id allowed to drive the shell, matched
// exactly against the live window. There are no renderer-supplied channels and
// no forwarding — `register` installs exactly these three handlers, `dispose`
// removes exactly those three, and everything else the renderer might try is
// refused. `openSettings` is the one main→renderer push and is sent by the
// MAIN process itself, never by a renderer.
//
// OS login-item exception handling deliberately lives in the main.cjs
// dependency functions (the shell adapter), not here: this module trusts the
// injected `getLaunchAtLogin`/`setLaunchAtLogin` and returns whatever they
// return.

const SHELL_CHANNEL_PREFIX = 'phase-shell';

function createShellIpc(deps) {
  const { getMainWindow, openAssistant, showMainWindow, getLaunchAtLogin, setLaunchAtLogin } = deps;

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

  return {
    register(ipcMain) {
      ipcMain.handle(`${SHELL_CHANNEL_PREFIX}:open-assistant`, onOpenAssistant);
      ipcMain.handle(`${SHELL_CHANNEL_PREFIX}:get-launch-at-login`, onGetLaunchAtLogin);
      ipcMain.handle(`${SHELL_CHANNEL_PREFIX}:set-launch-at-login`, onSetLaunchAtLogin);
    },
    dispose(ipcMain) {
      ipcMain.removeHandler(`${SHELL_CHANNEL_PREFIX}:open-assistant`);
      ipcMain.removeHandler(`${SHELL_CHANNEL_PREFIX}:get-launch-at-login`);
      ipcMain.removeHandler(`${SHELL_CHANNEL_PREFIX}:set-launch-at-login`);
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

module.exports = { SHELL_CHANNEL_PREFIX, createShellIpc };
