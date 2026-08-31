# Running-session overlay pill

2026-08-31 · PhaseApp

## Why

The live menu-bar timer (2026-08-30 spec) is the app's "something is
running" signal — but the user hides the macOS menu bar, so from across
the room the signal does not exist. The overlay restates that signal as
a small floating pill that no menu-bar setting can hide.

## What

A tiny frameless always-on-top window showing, during an active
session, `▶ 23m · <task title>`, and during a break, `⏸ on break`.
Outside a session — and while the finish confirmation is on the shelf —
it is hidden entirely: the PRESENCE of the pill is the whole signal,
the same rule `trayTitle` already states for the menu bar.

- Visible over all apps, on every Space, including full-screen apps.
- Never focusable; it can indicate but never steal the keyboard.
- Click anywhere on it → open Phase (the existing `openPhase` path).
- Draggable; the position persists across sessions and restarts.
- Defaults to the top-right corner of the primary display.
- A Settings toggle (default ON) turns it off for people who keep
  their menu bar.

## Architecture

New deep module `PhaseApp/electron/overlayWindow.cjs` (+ `.d.cts`,
`.test.ts`), shaped exactly like `menuBar.cjs`:

- Every Electron capability is injected from the `main.cjs`
  composition root: `createWindow`, `getPrimaryDisplay`,
  `getDisplayNearestPoint`, `now`, `setTimer`, `readPosition`,
  `writePosition`, `onOpenPhase`, `logError`.
- Exposes `create()`, `setFocusStatus(snapshot)`, `setEnabled(bool)`,
  `dispose()`.
- The overlay is a nicety, never a requirement: any failure in
  creation is caught, the partial window destroyed, the handle
  cleared, one log line emitted — the Hub, shelf, and menu bar keep
  working.
- It observes and never writes. The one snapshot it was last handed is
  the whole of its memory.

### Window properties

Frameless, transparent, non-resizable, no Electron shadow (the pill
draws its own CSS shadow), `focusable: false`,
`skipTaskbar: true`, excluded from the app switcher,
`setAlwaysOnTop(true, 'status')`,
`setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`.
Fixed size (height ~36px, width ~240px); the title truncates with an
ellipsis rather than resizing the window.

Hidden vs shown is `show()`/`hide()`, never create/destroy — the
window is built once at `create()` and reused.

### Content

One static, self-contained HTML file at
`electron/assets/overlay.html` — no Vite, no React, no imports. Dark
pill using the app's accent color, hardcoded (the file cannot import
theme tokens; a comment names the token it mirrors). The pill body is
`-webkit-app-region: drag` — grab anywhere to move it. The leading
`▶`/`⏸` glyph sits in a small `no-drag` region and is the click
target that opens Phase; the pill's tooltip says so.

### Data flow

Renderer → `phase-shell:focus-status` (existing channel, unchanged) →
`publishFocusStatus` in `main.cjs` fans out to a THIRD consumer:
`overlay?.setFocusStatus(status)`.

`overlayWindow.cjs` forwards the snapshot into the page via
`webContents.send('overlay:status', snapshot)`; a tiny dedicated
preload (`electron/overlayPreload.cjs`) exposes exactly two things:
`onStatus(cb)` and `openPhase()`. The page computes elapsed minutes
itself from `activeSinceMs` + `accumulatedMs` — timestamps, never a
duration — repainting on a 60s interval that runs only while a session
is active (cleared on break/hide). Floor, not round, matching
`trayTitle`.

### Position persistence

- Saved on the window's `moved` event to
  `overlay-position.json` in `userData` (via injected
  `writePosition`), debounced.
- Restored at `create()`; the stored point is clamped to the work area
  of `getDisplayNearestPoint(point)` so an unplugged monitor can never
  strand the pill off-screen.
- No stored position → top-right of the primary display's work area
  with a 16px margin.

### Settings toggle

A `showOverlay` boolean (default true) in the renderer's existing
settings storage, surfaced in the Settings view next to the shelf
options. The renderer pushes it to main over a new one-way channel
`phase-shell:overlay-enabled` (preload: `setOverlayEnabled(bool)`);
main calls `overlay?.setEnabled(bool)`. Disabled means hidden
regardless of snapshot; re-enabling re-evaluates the last snapshot.
The renderer sends the current value once at startup, alongside its
first focus-status publish.

## Error handling

- `create()` failure: caught, logged once, module inert thereafter
  (every later call is a no-op) — copied from `createMenuBar`.
- Malformed/absent stored position: fall back to the default corner.
- `writePosition` failure: logged, non-fatal.

## Testing

`overlayWindow.test.ts`, Electron fully faked, mirrors
`menuBar.test.ts`:

- show/hide per phase: active → shown, break → shown, confirming →
  hidden, null → hidden.
- text: floor minutes, `▶ Nm · title`, `⏸ on break`, truncation
  length.
- position: clamp math against a fake display; default corner when no
  stored position; `moved` → `writePosition` called with new bounds.
- `setEnabled(false)` hides even with an active snapshot;
  `setEnabled(true)` re-shows from the remembered snapshot.
- failure isolation: `createWindow` throws → one `logError`, later
  `setFocusStatus` calls do not throw.
- `dispose()` clears the repaint timer and destroys the window.

Renderer side: settings toggle read/write and the startup push, in the
existing settings tests' style.

## Out of scope

Hover controls (break/finish buttons), multi-display per-screen
choice, showing anything while idle, Windows/Linux behavior.
