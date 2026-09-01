// The pill page's ONLY door, and the narrowest preload in the app: hear the
// rendered model, report a drag, ask for Today. Fixed channels, no channel
// names accepted, nothing else crosses — the page cannot see the snapshot,
// only the model main already decided to paint.
//
// The drag verbs exist because `-webkit-app-region: drag` had to go: a drag
// region swallows clicks, and the whole pill is clickable now that a click
// means Today. The page reports SCREEN points and decides nothing; the window
// arithmetic lives in overlayWindow.cjs, where it is testable.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('phaseOverlay', {
  /** Fires with the model to paint — text, geometry and skin. Returns unsubscribe. */
  onModel: (fn) => {
    const listener = (_event, model) => fn(model);
    ipcRenderer.on('phase-overlay:model', listener);
    return () => ipcRenderer.removeListener('phase-overlay:model', listener);
  },
  /** A press began at this screen point. */
  dragStart: (screenX, screenY) => ipcRenderer.send('phase-overlay:drag-start', { x: screenX, y: screenY }),
  /** The pointer is here now; main moves the window by the delta. */
  dragTo: (screenX, screenY) => ipcRenderer.send('phase-overlay:drag-to', { x: screenX, y: screenY }),
  /** The hand lifted. */
  dragEnd: () => ipcRenderer.send('phase-overlay:drag-end'),
  /** The press was a CLICK: raise the app on Today. Fire-and-forget. */
  openToday: () => ipcRenderer.send('phase-overlay:open-today'),
});
