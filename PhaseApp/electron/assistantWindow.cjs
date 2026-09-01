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
// The instrument treatment grew two states at once, and BOTH growths were
// deliberate, so this was re-measured rather than argued down:
//
//   - The primary title clamps to two lines again. The one-line rule that set
//     the previous 308 was adopted precisely to make the card's height
//     independent of its content, and its arithmetic was right — but its
//     premise ("one line carries the name at 433px") was measured against
//     short test titles, and against real ones the shelf's own primary was cut
//     at the moment it has to be read. A title is free text with no length cap
//     and its height depends on its length again; two lines is the ceiling.
//   - The eyebrow became a rule tag, which is a full-bleed row of its own
//     rather than a line inside the text column, and the alternatives band
//     gained a second one.
//
// Measured, with the same worst-case title as every pass before this one
// ("Draft the comparative literature review for the graduate seminar on
// nineteenth-century industrialization"):
//
//   confirming   378.48px
//   autoBreak    375.48px
//   pomodoro     370.98px
//   active       354.48px
//   sidecar      333.48px
//   beyondWindow 239.98px
//   beyondFocus  239.98px
//
// Re-measured 2026-08-23 when MAX_ALTERNATIVES went from two to three: the
// band's third row added 36px to every state that draws it (the previous
// figures were 342.48 / 318.48 / 297.48).
//
// Re-measured 2026-08-30 when the idle auto-break added its away notice.
// `autoBreak` is a NEW state in the list and not a taller `active`: it is the
// only break that draws that line, and a break the user pressed measures
// exactly `active`. It came within 3px of the budget and did not take it, so
// this number is unchanged — but the margin is now thin enough that the next
// line added to any running state will move it.
//
// Re-measured 2026-09-01 when a session gained an optional cycle. `pomodoro`
// is a NEW state and not a taller `active`, for the same reason `autoBreak` is
// one: it is the only running session whose subtitle carries a second line
// (the cycle position), and a calm session measures exactly `active`. It came
// in 7.5px under the budget, so this number is unchanged. `sidecar` did NOT
// move despite the idle panel gaining a second start button: three buttons
// still fit one row at 620.
//
// `confirming` is still the tallest, and still for the reason it always was:
// it is the only state whose body is a QUESTION under the title rather than a
// readout beside it, and the question wraps.
//
// The send-off is not in the list because it cannot be the tallest: it pins
// itself to the height of the card it is replacing (`onSendoffChange` in
// AssistantOverlay.tsx), so its footprint is one of the figures above by
// construction.
//
// HEIGHT is the tallest of those figures rounded UP to the next whole pixel
// (379, from confirming's 378.48) — never a margin. A window sized to the
// fraction would clip a pane whose measured height sits between two
// integers, so the round trip is always ceil(), the same rule every prior
// pass in this file has followed (263.2 became 264).
//
// If a state grows, measure it again.
const WIDTH = 620
const HEIGHT = 379
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
