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
// MEASURED at 620 wide by `scripts/measure-shelf.cjs`, never derived. Run
// `npm run build` first; the tallest state it prints IS this number.
// Arithmetic against the type scale put it 20px low once already.
//
// The three-band layout (2026-08-16-shelf-bands-design.md) changed what the
// worst case IS, which is why this was re-measured rather than carried
// forward. The primary title is `truncate` now, not `line-clamp-2`, so the
// two-wrapped-line title that set the previous 264 cannot occur — a title is
// still free text with no length cap, but its height no longer depends on its
// length. Against that, the running states gained a row: the alternatives
// moved out of the `Other options` disclosure and into band 2, so `active`,
// `break` and `confirming` now render them in the open.
//
// Measured, with the same worst-case title as every pass before this one
// ("Draft the comparative literature review for the graduate seminar on
// nineteenth-century industrialization"):
//
//   confirming   307.99px
//   active       283.99px
//   sidecar      262.99px
//   beyondWindow 192.49px
//   beyondFocus  192.49px
//
// The send-off is not in the list because it cannot be the tallest: it pins
// itself to the height of the card it is replacing (`onSendoffChange` in
// AssistantOverlay.tsx), so its footprint is one of the figures above by
// construction.
//
// HEIGHT is the tallest of those figures rounded UP to the next whole pixel
// (308, from confirming's 307.99) — never a margin. A window sized to the
// fraction would clip a pane whose measured height sits between two
// integers, so the round trip is always ceil(), the same rule every prior
// pass in this file has followed (263.2 became 264).
//
// If a state grows, measure it again.
const WIDTH = 620
const HEIGHT = 308
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
