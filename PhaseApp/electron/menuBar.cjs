// Owns the macOS menu-bar item and its four actions, as a deep module.
//
// Every Electron capability is injected — Tray, Menu, nativeImage all stay in
// the main.cjs composition root — so the creation ordering, the template
// contract, and the failure isolation below are unit-testable without
// Electron. The one rule that matters: a menu-bar item is a nicety, never a
// requirement, so any failure in creation is caught, the partial Tray is
// destroyed, the handle is cleared, and the exact log line is the only trace
// the app shows — the Hub, the global shortcut, and the shelf all keep
// working. Quit Phase routes through the injected onQuit callback, never
// Electron's role: 'quit', because the lifecycle module must observe one
// deliberate route out of the app.

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
    logError,
  } = deps;

  let tray = null;

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
      nativeTray.setContextMenu(buildMenu([
        { label: 'Open Phase', click: onOpenPhase },
        { label: 'Open assistant', click: onOpenAssistant },
        { label: 'Settings', click: onOpenSettings },
        { type: 'separator' },
        { label: 'Quit Phase', click: onQuit },
      ]));
    } catch (error) {
      // Any partial Tray must not outlive the failed attempt.
      if (tray) {
        try { tray.destroy(); } catch { /* already gone */ }
        tray = null;
      }
      logError('[phase-shell] menu bar unavailable', error);
    }
  }

  function dispose() {
    if (!tray) return;
    const nativeTray = tray;
    tray = null;
    try {
      nativeTray.destroy();
    } catch {
      // Nothing to recover: the process is on its way out.
    }
  }

  return { create, dispose };
}

module.exports = { createMenuBar };
