// The pill page's ONLY door, and the narrowest preload in the app: hear the
// rendered model, ask for Phase. Fixed channels, no channel names accepted,
// nothing else crosses — the page cannot see the snapshot, only the string
// main already decided to show.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('phaseOverlay', {
  /** Fires with { glyph, text } to paint. Returns unsubscribe. */
  onModel: (fn) => {
    const listener = (_event, model) => fn(model);
    ipcRenderer.on('phase-overlay:model', listener);
    return () => ipcRenderer.removeListener('phase-overlay:model', listener);
  },
  /** Ask the shell to raise the Hub. Fire-and-forget. */
  openPhase: () => ipcRenderer.send('phase-overlay:open-phase'),
});
