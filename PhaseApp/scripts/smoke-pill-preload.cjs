// Stands in for overlayPreload.cjs for scripts/smoke-pill.cjs: records what the
// page asks for and hands the recording back, so the harness can assert on the
// page's own behaviour without a main process behind it.
//
// It mirrors the real preload's SURFACE exactly — the same five verbs on the
// same global — which is what makes the page under test the real page.
const { contextBridge } = require('electron')
const calls = []
contextBridge.exposeInMainWorld('phaseOverlay', {
  onModel: (fn) => { globalThis.__paint = fn; return () => {} },
  dragStart: (x, y) => calls.push(['dragStart', x, y]),
  dragTo: (x, y) => calls.push(['dragTo', x, y]),
  dragEnd: () => calls.push(['dragEnd']),
  openToday: () => calls.push(['openToday']),
})
contextBridge.exposeInMainWorld('__probe', {
  calls: () => calls.slice(),
  reset: () => { calls.length = 0 },
  paint: (model) => globalThis.__paint(model),
})
