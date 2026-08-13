// The overlay window's ONLY door. Narrower than the main preload on purpose:
// the overlay can announce readiness, receive snapshots, submit an action and
// ask to close — and nothing else. No calendar bridge, no publish route, no
// generic send/invoke, no token, no filesystem path, no URL opener. What this
// window is never handed it can never leak, whatever renders inside it.
//
// Sandboxed preloads cannot require assistantIpc.cjs for the prefix, so the
// channel names are written out by hand; assistantIpc.test.ts reads this file
// and fails the build if the two lists drift.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('phaseAssistantOverlay', {
  /** Announce readiness; resolves with the last cached snapshot or loading. */
  ready: () => ipcRenderer.invoke('phase-assistant:ready'),
  /** Subscribe to snapshots. Returns the unsubscribe function. */
  onSnapshot: (fn) => {
    const listener = (_event, snapshot) => fn(snapshot);
    ipcRenderer.on('phase-assistant:snapshot', listener);
    return () => ipcRenderer.removeListener('phase-assistant:snapshot', listener);
  },
  /** Submit one user action; the main process validates before forwarding. */
  act: (action) => ipcRenderer.send('phase-assistant:act', action),
  close: () => ipcRenderer.send('phase-assistant:close'),
});
