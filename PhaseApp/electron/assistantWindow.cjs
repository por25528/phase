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
// Re-measured 2026-09-01 at all THREE widths, when the shelf gained one. The
// budget is shared, so narrow and wide each had to be checked against it
// rather than assumed from 620:
//
//   520  identical to 620 at every state (TALLEST 378.48) — the primary title
//        already clamps at two lines by 620, and the `confirming` question
//        already wraps to its final line count, so nothing gains a line
//   760  `confirming` falls to 357.48 (the question fits in fewer lines) and
//        `autoBreak` becomes the tallest at 375.48
//
// So 379 holds at every width, and the ceiling that makes that true is the
// title's two-line clamp. `scripts/measure-shelf.cjs` takes PHASE_SHELF_WIDTH.
//
// The shelf also gained a DENSITY, and that one needs no argument: compact
// only ever removes padding — 20px off every state, TALLEST 358.48 — so
// comfortable is the state the budget has to cover, and it is the one measured
// above. `PHASE_SHELF_DENSITY=compact` runs the other.
//
// `confirming` was the tallest at the default width for every pass above,
// and for the reason it always was: it is the only state whose body is a
// QUESTION under the title rather than a readout beside it, and the
// question wraps.
//
// The send-off is not in the list because it cannot be the tallest: it pins
// itself to the height of the card it is replacing (`onSendoffChange` in
// AssistantOverlay.tsx), so its footprint is one of the figures above by
// construction.
//
// Re-measured 2026-09-03 when the idle panel gained "Do first…" — a row
// between the work and the `Or` band that reveals a one-line title input and
// dispatches `insert-before`. It is idle-only (`AdvicePanel`, never
// `FocusPanel`), so it added a flat 59px to every state built on
// `advice.kind === 'work'` and left every running state untouched:
//
//   sidecar      392.48px  (was 333.48)
//   beyondWindow 298.98px  (was 239.98)
//   beyondFocus  298.98px  (was 239.98)
//   confirming   378.48px  (unchanged — a running state)
//
// `sidecar` — the ordinary idle card — is the new tallest, displacing
// `confirming` for the first time. Checked at all three widths and at
// `compact`, the same sweep the previous pass ran: 392.48 holds at 520 and
// 760 exactly as at 620 (the row's height does not depend on wrap width),
// and compact's tallest fell to 364.48, so comfortable is still the state
// the budget has to cover.
//
// HEIGHT is the tallest of those figures rounded UP to the next whole pixel
// (393, from sidecar's 392.48) — never a margin. A window sized to the
// fraction would clip a pane whose measured height sits between two
// integers, so the round trip is always ceil(), the same rule every prior
// pass in this file has followed (263.2 became 264).
//
// If a state grows, measure it again.
const WIDTH = 620
const HEIGHT = 393
const TOP_GAP = 18
// The `top-center` placement's own offset. A different number from TOP_GAP on
// purpose: that one is the gap this shelf has always used, and this is a
// second, deliberate one — collapsing them would make a preference into a
// no-op the day either moves.
const TOP_CENTER_GAP = 24

/**
 * The three widths, and they live HERE rather than with the settings row.
 *
 * `WIDTH` is not just a number the window is given: the whole HEIGHT budget
 * above is MEASURED at it, and `scripts/measure-shelf.cjs` runs at it. A width
 * named in `src/lib/shelfPrefs.ts` and a pixel count decided in this file are
 * one fact, and the fact belongs where the measurement is.
 *
 * Narrow and wide inherit the same budget, which is the constraint on choosing
 * them: the card's height must not exceed HEIGHT at any of the three, and the
 * primary title's two-line ceiling is what that turns on.
 */
const SHELF_WIDTHS = { narrow: 520, default: WIDTH, wide: 760 }

const SHELF_POSITIONS = ['center', 'top-center']

/**
 * The geometry half of `shelfPrefs`, validated. Structurally the two fields of
 * `ShelfPrefs` this side of the process seam has any use for — mirrored, never
 * imported (`electron/*` imports nothing from `src/`).
 *
 * Total: an absent or malformed geometry is today's shelf, because a shelf
 * that failed to come up in the right place must still come up.
 */
function normalizeShelfGeometry(raw) {
  const g = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    width: Object.prototype.hasOwnProperty.call(SHELF_WIDTHS, g.width) ? g.width : 'default',
    position: SHELF_POSITIONS.includes(g.position) ? g.position : 'center',
  }
}

/**
 * Where the shelf sits: horizontally centred on the pointer's display (which
 * may have a negative origin), at the width it was asked for, and as tall as
 * the one budget every width shares.
 */
function assistantShelfBounds(workArea, geometry) {
  const { width: name, position } = normalizeShelfGeometry(geometry)
  const width = SHELF_WIDTHS[name]
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + (position === 'top-center' ? TOP_CENTER_GAP : TOP_GAP),
    width,
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

module.exports = {
  SHELF_WIDTHS, normalizeShelfGeometry, assistantWindowOptions, assistantShelfBounds, assistantEntry }
