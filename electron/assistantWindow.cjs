// Pure description of the assistant shelf window, kept out of main.cjs so
// its shape is unit-testable without an Electron runtime.

const path = require('node:path')

// Compact and fixed: the shelf is 620 wide and never grows, so a long list
// stays inside the pane instead of forming a tower under the shortcut.
//
// HEIGHT is a BUDGET, not the size of the pane. The card sizes to its own
// content (see `shelfSizing`), so a short state no longer paints the leftover
// space — on macOS the window behind it is transparent and a click there
// closes the shelf. What this number still has to guarantee is that the
// TALLEST state fits: a hugging card is clipped by the window edge rather than
// scrolled, so anything past this line is not merely awkward, it is invisible.
//
// The tallest state is `confirming` (a running session pending your
// confirmation) with a top-level notice, measured with a task title long
// enough to hit the `line-clamp-2` cap in AssistantSurface.tsx — the title
// "Draft the comparative literature review for the graduate seminar on
// nineteenth-century industrialization" — 247.6px at 620 wide. A title is a
// free-text field with no length limit, so two wrapped lines is not an
// exotic input, it is the maximum the component can ever render, and
// `confirming` carries more rows than any other state (an extra
// confirmation sentence and an "Other options" row) — with the SAME
// worst-case title the idle advice panel's Sidecar (two alternatives, no
// `beyondWindow`) reaches only 195.2px and `beyondWindow` alone (the
// "Nothing light left" line, zero alternatives — the one real shape
// `beyondWindow` can take, since `executionAdvisor.ts` always slices
// `visible` to one item when it fires) reaches 194.5px. The send-off's own
// content is 84.9px.
//
// A previous pass here measured `confirming` at 218.8px with a title that
// happened to fit on one line, and separately measured a FIFTH combination —
// the Sidecar's two alternatives together with `beyondWindow` — at 220.5px.
// That combination cannot occur: `beyondWindow` forces `visible` to a single
// item, so `alternatives` is always empty when it is set. Both numbers were
// real measurements of states that either understated the true worst case
// (a short title) or could never be reached (the fifth combination); this
// pass measured all four REACHABLE candidates against the same long title.
//
// MEASURED, never derived. Arithmetic against the type scale put this number
// 20px low once already. If a state grows, measure it again.
const WIDTH = 620
const HEIGHT = 248
const TOP_GAP = 18

/**
 * Where the shelf sits: horizontally centred on the pointer's display (which
 * may have a negative origin) and just under the menu bar, exactly as tall
 * and wide as the pane.
 */
function assistantShelfBounds(workArea) {
  return {
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: workArea.y + TOP_GAP,
    width: WIDTH,
    height: HEIGHT,
  }
}

// The native window title. Set at creation rather than left to
// assistant.html's <title>, because a tiling window manager matches its rules
// the instant the window appears — before the renderer has loaded a page to be
// titled by — and an untitled shelf is one it files as an ordinary window.
const TITLE = 'Phase Assistant'

function assistantWindowOptions(preloadPath, platform = process.platform, darkMode = false) {
  const transparent = platform === 'darwin'
  return {
    ...(platform === 'darwin' ? { type: 'panel' } : {}),
    title: TITLE,
    width: WIDTH,
    height: HEIGHT,
    minWidth: WIDTH,
    maxWidth: WIDTH,
    minHeight: HEIGHT,
    maxHeight: HEIGHT,
    useContentSize: true,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    // Summoned, never carried: the controller owns the placement, so the panel
    // itself is immovable and a drag on its frameless surface goes nowhere.
    movable: false,
    hasShadow: true,
    transparent,
    // macOS: transparent so the rounded CSS surface paints without square
    // corners; everywhere else a theme-matched first frame avoids a flash.
    backgroundColor: transparent ? '#00000000' : darkMode ? '#000000' : '#FAF9F7',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  }
}

/**
 * Where the shelf's page lives: the dev server's /assistant.html under
 * `npm run app:dev`, the built dist/assistant.html otherwise. Never
 * index.html — that page boots the store, and this window must not.
 */
function assistantEntry(devServerUrl) {
  if (devServerUrl) {
    return { kind: 'url', target: new URL('assistant.html', devServerUrl).toString() }
  }
  return { kind: 'file', target: path.join(__dirname, '..', 'dist', 'assistant.html') }
}

module.exports = { assistantWindowOptions, assistantShelfBounds, assistantEntry }
