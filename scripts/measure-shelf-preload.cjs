// Feeds one fixed snapshot to the overlay so its card can be measured. The
// real preload relays from the app; this one answers from PHASE_SHELF_SNAPSHOT
// and never sends anything back.
const { contextBridge } = require('electron')

const snapshot = JSON.parse(process.env.PHASE_SHELF_SNAPSHOT || '{"status":"loading"}')

contextBridge.exposeInMainWorld('phaseAssistantOverlay', {
  ready: async () => snapshot,
  onSnapshot: () => () => {},
  act: () => {},
  close: () => {},
})
