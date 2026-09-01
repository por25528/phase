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
  /**
   * Whether this window wears the macOS inset title bar, so the header has to
   * leave room for the traffic lights. A STATIC fact, not a channel: it is
   * settled by `titleBarStyle: 'hiddenInset'` at window construction and cannot
   * change for the life of the window, so a round trip would only be a slower
   * way to read `process.platform`.
   *
   * The renderer is deliberately not left to infer this from the user agent.
   * The main process is the side that sets the title bar style, and a second
   * opinion parsed out of a UA string is the kind of drift the fixed-channel
   * discipline above exists to prevent.
   */
  insetTitleBar: process.platform === 'darwin',
  /** Ask the shell to raise the assistant overlay; resolves true when it ran. */
  openAssistant: () => ipcRenderer.invoke('phase-shell:open-assistant'),
  /** Fires when the shell wants the settings surface open. Returns unsubscribe. */
  onOpenSettings: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('phase-shell:open-settings', listener);
    return () => ipcRenderer.removeListener('phase-shell:open-settings', listener);
  },
  /** Fires when the shell wants Today — the floating pill was clicked. Returns unsubscribe. */
  onOpenToday: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('phase-shell:open-today', listener);
    return () => ipcRenderer.removeListener('phase-shell:open-today', listener);
  },
  /** Resolves the OS login-item state, or null when the shell refused. */
  getLaunchAtLogin: () => ipcRenderer.invoke('phase-shell:get-launch-at-login'),
  /** Set the OS login-item state; resolves the applied state, or null when refused. */
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('phase-shell:set-launch-at-login', enabled),
  /**
   * Publish the focus draft's status to the shell — the menu-bar timer and the
   * idle watcher both read it.
   *
   * A `send` and not an `invoke`, because there is no answer to wait for and
   * the renderer must never block on the tray: a menu-bar item is a nicety.
   * Sent on TRANSITIONS only, never on a tick, so this channel carries about
   * as much traffic in an afternoon as a settings write does.
   */
  publishFocusStatus: (snapshot) => ipcRenderer.send('phase-shell:focus-status', snapshot),
  /**
   * How the floating pill should look — the whole settings row at once. A
   * send, like publishFocusStatus, and for the same reason: the renderer must
   * never block on a nicety.
   */
  setPillPrefs: (prefs) => ipcRenderer.send('phase-shell:pill-prefs', prefs),
  /**
   * Announce a cycle boundary the renderer has already written. A send for the
   * same reason the two above are: the transition is banked before this is
   * called, so a notification Notification Centre refuses costs a log line and
   * nothing else.
   */
  notifyFocus: (notice) => ipcRenderer.send('phase-shell:focus-notify', notice),
  /** Fires when the shell wants something done to the session. Returns unsubscribe. */
  onFocusRequest: (fn) => {
    const listener = (_event, request) => fn(request);
    ipcRenderer.on('phase-shell:focus-request', listener);
    return () => ipcRenderer.removeListener('phase-shell:focus-request', listener);
  },
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

// The MAIN renderer's door to the PhasePhone sync container. Three fixed
// channels, none of which accepts a channel name or a path: the folder is
// resolved in main (syncFiles.cjs) and the renderer never learns where it is,
// so this door can write exactly one file and read exactly one other.
//
// `requestJournal` exists because the push races the page: main starts polling
// the moment the app is ready, and a `send` to a webContents that has not
// finished loading is dropped. The renderer therefore PULLS once when it
// mounts and listens for pushes thereafter.
contextBridge.exposeInMainWorld('phaseSync', {
  /** Replace `state.json` in the container. Resolves when the bytes landed. */
  writeState: (text) => ipcRenderer.invoke('phase-sync:write-state', text),
  /** The journal as it stands right now, or null when there is none. */
  requestJournal: () => ipcRenderer.invoke('phase-sync:request-journal'),
  /** Fires with the whole journal text whenever it changed. Returns unsubscribe. */
  onJournal: (fn) => {
    const listener = (_event, text) => fn(text);
    ipcRenderer.on('phase-sync:journal', listener);
    return () => ipcRenderer.removeListener('phase-sync:journal', listener);
  },
});

// The MAIN renderer's door to the local backup folder. Three fixed channels,
// none of which accepts a channel name or a path: the folder is resolved in
// main (backupStore.cjs) and the renderer never learns where it is, so this
// door can write one snapshot, list what is there, and read one back by the
// name the list gave it. backupIpc.test.ts reads this file to stop the two
// lists drifting, exactly as calendarIpc.test.ts does for the calendar door.
contextBridge.exposeInMainWorld('phaseBackups', {
  /** Newest first. Empty when the folder is missing or unreadable. */
  list: () => ipcRenderer.invoke('phase-backups:list'),
  /** Write one snapshot; resolves the entry written, or null when refused. */
  write: (text, reason) => ipcRenderer.invoke('phase-backups:write', { text, reason }),
  /** The JSON of one snapshot, by the name `list` gave. Null when refused. */
  read: (name) => ipcRenderer.invoke('phase-backups:read', name),
});

// The MAIN renderer's door to the release update check. One fixed channel,
// pull-only: the renderer asks once on mount, so no push can race page load.
// updateCheck.test.ts reads this file to stop the channel names drifting.
contextBridge.exposeInMainWorld('phaseUpdates', {
  /** Resolves { version, url } when a newer release exists, else null. */
  check: () => ipcRenderer.invoke('phase-updates:check'),
});
