// Owns the shelf BrowserWindow: fixed placement, readiness, show ordering,
// blur-hide, renderer recovery, and disposal. All Electron access flows
// through injected capabilities so every ordering rule is unit-testable.

const {
  assistantShelfBounds, assistantWindowOptions, normalizeShelfGeometry,
} = require('./assistantWindow.cjs')

// The only live-window helper: a destroyed handle is no handle at all, so
// every public verb talks to a window only while it can still answer.
function live(win) {
  return win && !win.isDestroyed() ? win : null
}

function createAssistantWindowController(deps) {
  const {
    createWindow,
    preloadPath,
    entry,
    getCursorScreenPoint,
    getDisplayNearestPoint,
    beforeShow,
    platform = process.platform,
    shouldUseDarkColors = () => false,
    logError = () => {},
    guardNavigation = () => {},
  } = deps

  let assistantWindow = null
  let ready = false
  let pendingShow = false
  let disposed = false
  /**
   * The width and placement the NEXT show will use.
   *
   * Held rather than applied, and that is the whole rule: a panel that resized
   * under the cursor while it was open reads as a glitch, not as a preference
   * taking effect. `positionWindow` already runs immediately before every
   * reveal, so holding it costs nothing and buys the guarantee.
   */
  let geometry = normalizeShelfGeometry(undefined)

  // Bounds are calculated immediately before every visible reveal, from the
  // pointer's current display, so a summoned shelf is never offscreen.
  function positionWindow(win) {
    const pointer = getCursorScreenPoint()
    const display = getDisplayNearestPoint(pointer)
    const bounds = assistantShelfBounds(display.workArea, geometry)
    // The window is born with min and max width pinned to ONE number — that is
    // what makes it unresizable — so the limits have to move with the width or
    // the bounds below are silently clamped back to the width it was created
    // at, and the preference looks like it did nothing.
    win.setMinimumSize(bounds.width, bounds.height)
    win.setMaximumSize(bounds.width, bounds.height)
    win.setBounds(bounds, false)
  }

  function reveal(win) {
    if (assistantWindow !== win || !ready || !pendingShow || !live(win)) return
    pendingShow = false
    positionWindow(win)
    beforeShow()
    win.show()
    win.focus()
    win.webContents.focus()
  }

  function clearWindow(win) {
    if (assistantWindow !== win) return
    assistantWindow = null
    ready = false
    pendingShow = false
  }

  function buildWindow() {
    if (disposed) return null
    const current = live(assistantWindow)
    if (current) return current
    if (assistantWindow) clearWindow(assistantWindow)

    try {
      const win = createWindow(assistantWindowOptions(
        preloadPath,
        platform,
        shouldUseDarkColors(),
      ))
      assistantWindow = win
      ready = false

      // A floating panel that outranks ordinary windows and survives Space
      // switches and fullscreen apps — the "always above the top" of a shelf.
      win.setAlwaysOnTop(true, 'floating')
      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      })
      // The shelf renders trusted snapshot data only; nothing may open a
      // window from it, and nothing may navigate it away from its own
      // document either — its preload outlives a navigation exactly as the
      // main window's does. `guardNavigation` is injected so this module keeps
      // owning the window's LIFECYCLE and nothing else; `main.cjs` supplies
      // the policy, which is the same one the main frame runs.
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      guardNavigation(win.webContents)

      win.once('ready-to-show', () => {
        if (assistantWindow !== win) return
        ready = true
        reveal(win)
      })
      // A helper that lost focus is a helper the user is done with.
      win.on('blur', () => {
        if (assistantWindow === win) {
          pendingShow = false
          if (live(win)) win.hide()
        }
      })
      win.on('closed', () => clearWindow(win))
      // A renderer that stops answering is an unusable shelf: clear the handle
      // so the next verb rebuilds, and destroy the hidden window exactly once.
      // Both terminal paths share the stale-event guard and the destroy gate.
      const failRenderer = (context) => {
        if (assistantWindow !== win) return
        clearWindow(win)
        if (!win.isDestroyed()) win.destroy()
        logError('[phase-assistant] shelf window unavailable', new Error(context))
      }
      win.webContents.on('render-process-gone', () => failRenderer('renderer process gone'))
      win.webContents.on(
        'did-fail-load',
        (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
          // Only the top frame's failure makes the window unusable; a failed
          // subframe leaves the main page intact.
          if (isMainFrame === false) return
          failRenderer(`${errorDescription} (${validatedURL})`)
        },
      )

      // loadURL/loadFile reject alongside did-fail-load; that event is the
      // authoritative state/log/destroy path, so this catch only swallows —
      // an unhandled rejection must not reach the main process, but neither
      // may it double-log, double-destroy, or clear a window the event (or a
      // newer window) already owns. The guard keeps an injected loader that
      // returns void from tripping over a missing .then.
      const load = entry.kind === 'url' ? win.loadURL(entry.target) : win.loadFile(entry.target)
      if (load && typeof load.then === 'function') load.then(undefined, () => {})
      return win
    } catch (error) {
      assistantWindow = null
      ready = false
      pendingShow = false
      logError('[phase-assistant] shelf window unavailable', error)
      return null
    }
  }

  return {
    create() {
      buildWindow()
    },
    position() {
      const win = buildWindow()
      if (win) positionWindow(win)
    },
    /**
     * Adopt a new width and placement, applied on the NEXT show. Total: a
     * malformed geometry is today's shelf, because a shelf that could not be
     * placed must still come up.
     */
    setShelfGeometry(raw) {
      geometry = normalizeShelfGeometry(raw)
    },
    showAndFocus() {
      const win = buildWindow()
      if (!win) return
      pendingShow = true
      reveal(win)
    },
    hide() {
      pendingShow = false
      const win = live(assistantWindow)
      if (win) win.hide()
    },
    isShowing() {
      return live(assistantWindow)?.isVisible() === true
    },
    current() {
      return live(assistantWindow)
    },
    dispose() {
      if (disposed) return
      disposed = true
      pendingShow = false
      const win = live(assistantWindow)
      assistantWindow = null
      ready = false
      if (win) win.destroy()
    },
  }
}

module.exports = { createAssistantWindowController }
