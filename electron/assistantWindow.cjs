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
// The tallest state is still `confirming` (a running session pending your
// confirmation) with a top-level notice, measured with a task title long
// enough to hit the `line-clamp-2` cap in AssistantSurface.tsx — the title
// "Draft the comparative literature review for the graduate seminar on
// nineteenth-century industrialization" — 263.2px at 620 wide. A title is a
// free-text field with no length limit, so two wrapped lines is not an
// exotic input, it is the maximum the component can ever render, and
// `confirming` carries more rows than any other state (an extra
// confirmation sentence and an "Other options" row). With the SAME
// worst-case title the running `active` state reaches 260.2px, the idle
// advice panel's Sidecar (two alternatives, no `beyondWindow`) 238.4px, and
// `beyondWindow` alone (the "Nothing that short left" line, zero
// alternatives — the one real shape `beyondWindow` can take, since
// `executionAdvisor.ts` always slices `visible` to one item when it fires)
// 235.2px. `beyondFocus` — the other dial's refusal, and a state of its own,
// since the two are mutually exclusive — measures 235.2px as well; that it
// reads as the same one-line paragraph in the same slot is why it was
// measured, not a reason to have skipped it. The send-off is not in the list
// because it cannot be the tallest: it pins itself to the height of the card
// it is replacing (`onSendoffChange` in AssistantOverlay.tsx), so its
// footprint is one of the figures above by construction.
//
// The `complete-work` checkbox added NOTHING. It was measured both ways —
// the same states against the build before it and the build after — and
// every figure came back identical to the tenth of a pixel, because the
// checkbox sits in a flex row already taller than it is. What moved this
// number from 248 to 264 was already on screen before it: the previous pass
// measured `confirming` at 247.6px and the idle panel at 195.2/194.5px, and
// the two focus dials landed between that pass and this one without one.
// A budget carried forward on "the change that just landed cannot have
// grown it" is the arithmetic this comment exists to refuse — every state of
// a running session was already past the window, `active` by 12px and
// `confirming` by 15px, and past the window means invisible rather than
// awkward for exactly as long as nobody measured.
//
// A pass before those measured `confirming` at 218.8px with a title that
// happened to fit on one line, and separately measured a FIFTH combination —
// the Sidecar's two alternatives together with `beyondWindow` — at 220.5px.
// That combination cannot occur: `beyondWindow` forces `visible` to a single
// item, so `alternatives` is always empty when it is set.
//
// MEASURED, never derived — `scripts/measure-shelf.cjs` is the measurement,
// so the next one is a command rather than a fresh piece of scaffolding.
// Run `npm run build` first; the tallest state it prints IS this number.
// Arithmetic against the type scale put it 20px low once already. If a state
// grows, measure it again.
const WIDTH = 620
const HEIGHT = 264
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
