// The renderer's only door to the calendar producer.
//
// Preload scripts are sandboxed (Electron 20+), so this file cannot require
// calendarIpc.cjs for CHANNEL_PREFIX — only `electron` is available here. The
// channel names are therefore written out by hand, and a test in
// calendarIpc.test.ts reads this file to stop the two lists drifting.
//
// Nothing but these seven invocations is exposed. No token, no client secret,
// and no ability to name a URL ever crosses.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('phaseCalendar', {
  status: () => ipcRenderer.invoke('phase-calendar:status'),
  configure: async (input) => ipcRenderer.invoke('phase-calendar:configure', input),
  connect: () => ipcRenderer.invoke('phase-calendar:connect'),
  disconnect: () => ipcRenderer.invoke('phase-calendar:disconnect'),
  listCalendars: () => ipcRenderer.invoke('phase-calendar:listCalendars'),
  reset: () => ipcRenderer.invoke('phase-calendar:reset'),
  fetch: async (input) => ipcRenderer.invoke('phase-calendar:fetch', input),
});

// The MAIN renderer's half of the assistant relay: publish a snapshot, hear
// the overlay's requests and actions. Deliberately no `ready`, `act` or
// `close` — those are the overlay's verbs, exposed only by its own narrower
// preload (assistantPreload.cjs). assistantIpc.test.ts pins the split.
contextBridge.exposeInMainWorld('phaseAssistant', {
  publish: (snapshot) => ipcRenderer.send('phase-assistant:publish', snapshot),
  /** Fires when the overlay was shown and wants a fresh snapshot. Returns unsubscribe. */
  onRequestSnapshot: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('phase-assistant:request-snapshot', listener);
    return () => ipcRenderer.removeListener('phase-assistant:request-snapshot', listener);
  },
  /** Fires with a validated overlay action to execute. Returns unsubscribe. */
  onAction: (fn) => {
    const listener = (_event, action) => fn(action);
    ipcRenderer.on('phase-assistant:action', listener);
    return () => ipcRenderer.removeListener('phase-assistant:action', listener);
  },
});
