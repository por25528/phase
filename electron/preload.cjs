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
  /** Push the hydrated accelerator preference; resolves with registration status. */
  configureShortcut: (accelerator) => ipcRenderer.invoke('phase-assistant:set-shortcut', accelerator),
});

// The MAIN renderer's door to the desktop shell: raise the assistant overlay,
// hear the shell asking for the settings surface, and read/write the OS
// login-item. Fixed channels only — nothing here accepts a channel name, and
// every ipcRenderer call names a literal 'phase-shell:…' channel, so a
// compromised renderer still has no escape hatch. shellIpc.test.ts pins the
// main-process side; assistantIpc.test.ts pins this surface.
contextBridge.exposeInMainWorld('phaseShell', {
  /** Ask the shell to raise the assistant overlay; resolves true when it ran. */
  openAssistant: () => ipcRenderer.invoke('phase-shell:open-assistant'),
  /** Fires when the shell wants the settings surface open. Returns unsubscribe. */
  onOpenSettings: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('phase-shell:open-settings', listener);
    return () => ipcRenderer.removeListener('phase-shell:open-settings', listener);
  },
  /** Resolves the OS login-item state, or null when the shell refused. */
  getLaunchAtLogin: () => ipcRenderer.invoke('phase-shell:get-launch-at-login'),
  /** Set the OS login-item state; resolves the applied state, or null when refused. */
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('phase-shell:set-launch-at-login', enabled),
});

// The MAIN renderer's half of the agent bridge: hear a request that arrived
// over the socket, answer it once. Fixed channels only — nothing here accepts
// a channel name. agentIpc.test.ts reads this file to stop the two lists
// drifting, exactly as calendarIpc.test.ts does for the calendar door.
contextBridge.exposeInMainWorld('phaseAgent', {
  /** Fires with an id and a request to execute. Returns unsubscribe. */
  onRequest: (fn) => {
    const listener = (_event, envelope) => fn(envelope.id, envelope.request);
    ipcRenderer.on('phase-agent:request', listener);
    return () => ipcRenderer.removeListener('phase-agent:request', listener);
  },
  /** Answer exactly one request. */
  reply: (id, response) => ipcRenderer.invoke('phase-agent:reply', { id, response }),
});
