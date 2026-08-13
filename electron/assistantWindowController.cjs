// Owns the shelf BrowserWindow: fixed placement, readiness, show ordering,
// blur-hide, renderer recovery, and disposal. All Electron access flows
// through injected capabilities so every ordering rule is unit-testable.

const { assistantShelfBounds, assistantWindowOptions } = require('./assistantWindow.cjs')

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
  } = deps

  let assistantWindow = null
  let ready = false
  let pendingShow = false
  let disposed = false

  // Bounds are calculated immediately before every visible reveal, from the
  // pointer's current display, so a summoned shelf is never offscreen.
  function positionWindow(win) {
    const pointer = getCursorScreenPoint()
    const display = getDisplayNearestPoint(pointer)
    win.setBounds(assistantShelfBounds(display.workArea), false)
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
      // window from it.
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

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
      win.webContents.on('render-process-gone', () => {
        if (assistantWindow !== win) return
        clearWindow(win)
        if (!win.isDestroyed()) win.destroy()
      })

      if (entry.kind === 'url') win.loadURL(entry.target)
      else win.loadFile(entry.target)
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
