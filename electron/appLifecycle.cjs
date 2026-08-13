// Owns the app's background lifecycle as a deep module: the quitting flag,
// the Hub's close-to-hide protection, the dock/menu activation callback, and
// the explicit-quit release callback. All Electron access flows through the
// injected app emitter so every ordering rule is unit-testable without
// Electron. The one rule that matters: closing the Hub must HIDE it, never
// destroy it — the Hub renderer is the single store owner that keeps the
// background state alive — and only an explicit quit (Command–Q or the
// menu-bar Quit Phase, which both call app.quit) may let the window close.

function shouldShowMainAtLaunch(settings) {
  return settings.wasOpenedAtLogin !== true;
}

function createAppLifecycle({ app, onActivate, onWillQuit }) {
  let quitting = false;
  let registered = false;

  const beforeQuit = () => { quitting = true; };
  const activate = () => onActivate();
  const willQuit = () => onWillQuit();

  return {
    register() {
      if (registered) return;
      registered = true;
      app.on('before-quit', beforeQuit);
      app.on('activate', activate);
      app.on('will-quit', willQuit);
    },
    protectMainWindow(win) {
      win.on('close', (event) => {
        if (quitting) return;
        event.preventDefault();
        win.hide();
      });
    },
    isQuitting() {
      return quitting;
    },
    dispose() {
      if (!registered) return;
      registered = false;
      app.removeListener('before-quit', beforeQuit);
      app.removeListener('activate', activate);
      app.removeListener('will-quit', willQuit);
    },
  };
}

module.exports = { createAppLifecycle, shouldShowMainAtLaunch }
