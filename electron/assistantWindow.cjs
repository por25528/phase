// Pure description of the assistant overlay window, kept out of main.cjs so
// its shape is unit-testable without an Electron runtime.

const path = require('node:path')

// Compact and fixed: the overlay is one answer and a small input, not a
// second app window. The height cap keeps a long proposal list scrolling
// inside the pane instead of growing a tower under the shortcut.
const WIDTH = 400
const HEIGHT = 480
const MAX_HEIGHT = 640

function assistantWindowOptions(preloadPath) {
  return {
    width: WIDTH,
    height: HEIGHT,
    maxHeight: MAX_HEIGHT,
    minWidth: WIDTH,
    maxWidth: WIDTH,
    frame: false,
    show: false,
    skipTaskbar: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    // Matches the app canvas so the first paint is never a white flash.
    backgroundColor: '#FAF9F7',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  }
}

/**
 * Where the overlay's page lives: the dev server's /assistant.html under
 * `npm run app:dev`, the built dist/assistant.html otherwise. Never
 * index.html — that page boots the store, and this window must not.
 */
function assistantEntry(devServerUrl) {
  if (devServerUrl) {
    return { kind: 'url', target: new URL('assistant.html', devServerUrl).toString() }
  }
  return { kind: 'file', target: path.join(__dirname, '..', 'dist', 'assistant.html') }
}

module.exports = { assistantWindowOptions, assistantEntry }
