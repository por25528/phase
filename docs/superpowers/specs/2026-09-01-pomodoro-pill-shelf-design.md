# Pomodoro cycles, pill customization, shelf customization — design

**Date:** 2026-09-01
**Status:** Approved (brainstormed with user)
**Scope:** `PhaseApp/` only.

## What the user asked for

1. The pomodoro timer back: classic countdown work/break cycles.
2. Settings that make the floating pill and the Cmd+Space shelf very
   customizable.
3. Clicking the floating pill brings the main window forward on the Today
   view.

Three sub-projects, one spec, implemented in order: pomodoro core first (it
defines what the pill and shelf display), then pill, then shelf.

## Background and constraints

- Focus sessions are deliberately "calm": no countdown, no ticking writes.
  `ActiveFocusSession` banks timestamps; "how long have I worked" is
  arithmetic at read time (`src/lib/focusSession.ts`). This philosophy
  SURVIVES the pomodoro: remaining time is arithmetic over the same banked
  numbers, and the only new timer is a single timeout armed at each
  transition for the next boundary — the same pattern the idle watcher uses.
- The pill (`electron/overlayWindow.cjs` + its page) is an observer: main
  pushes a rendered model, the page paints. It is a nicety — any failure is
  one log line and everything else carries on. That stance is kept.
- The shelf's global shortcut is ALREADY customizable
  (`AssistantShortcutSettings`). No work there.
- The focus-status fanout (renderer → main → menu bar, shelf, pill) already
  exists; it grows fields, it is not redesigned.

## Part 1 — Pomodoro cycles

### Mode choice at session start

Starting a session from the shelf offers two modes:

- **Calm** — exactly today's behavior. Default.
- **Pomodoro** — the session carries cycle structure.

Mode is chosen per session at start. No global mode switch; nothing about
calm sessions changes.

### Data model

`ActiveFocusSession` gains one optional field:

```ts
cycle?: {
  workMin: number;        // length of a work interval
  breakMin: number;       // length of a short break
  longBreakMin: number;   // length of a long break
  longEvery: number;      // every Nth break is long
  completed: number;      // work intervals finished so far
}
```

- Calm sessions never carry `cycle`; every stored draft (which predates the
  field) reads as calm — the safe, backwards-compatible reading.
- Durations are FROZEN into the draft at start from the settings defaults,
  so changing Settings mid-session does not retime a running interval.

### Transitions (all pure functions over injected `nowMs`)

- **Work interval end** (banked-active-time reaches `workMin` for the
  current interval): notification fires; the session flips to `break`
  automatically (one persisted transition); `completed` increments. Every
  `longEvery`-th break uses `longBreakMin`.
- **Break end** (break stretch reaches its length): notification fires; the
  session STAYS on break until the user resumes. Work never auto-starts.
- Manual controls (pause, resume, finish, discard) keep working exactly as
  in calm mode; a manual break mid-interval is allowed and does not count as
  a cycle break.
- The boundary check runs on a single armed timeout (renderer-side, where
  transitions live), re-armed at each transition. A missed timeout (sleep,
  suspend) is caught at the next wake/read: the transition applies
  retroactively using the banked timestamps, same as idle auto-break.

### Display

- Pomodoro sessions show a countdown ("18m left"); calm sessions keep
  showing elapsed. This rules the pill, the menu-bar title, and the shelf.
- The shelf shows cycle position (e.g. "interval 2 · break next: short").
- The fanout snapshot grows: `cycle` presence, remaining ms at snapshot
  time, and which break is next. Remaining time is still computed at read
  time in each surface from banked numbers, never streamed.

### Settings

A "Focus" section in Settings: work length, short break, long break, long
every N. Defaults 25 / 5 / 15 / 4. Stored in a settings row like the other
device preferences; validated with clamped sane ranges (work 5–120, breaks
1–60, longEvery 2–10).

### Notifications

macOS notifications via Electron's `Notification` in main, triggered off the
fanout transition. A notification is a nicety: creation failure is one log
line, the session is unaffected.

## Part 2 — Pill

### `pillPrefs` settings row

Edited in Settings (the existing "Show floating timer" row grows into a
group), fanned out to main over the existing settings IPC, consumed by
`overlayWindow.cjs`:

- `show: boolean` — exists today, absorbed into the row.
- `content`: for pomodoro sessions, `countdown | elapsed`; title on/off;
  glyph on/off. (At least one of time/title must remain on; the Settings UI
  enforces it.)
- `size`: `small | medium | large` — footprint and text scale together
  (three fixed geometries; the window resizes on change).
- `opacity`: 0.5–1.0 slider.
- `theme`: `system | dark | light`.
- `defaultCorner`: which work-area corner the pill starts in when it has no
  saved position (`top-right` today) — a dragged position still wins.
- `clickThrough: boolean` — when on, the pill ignores the mouse entirely
  (and click-to-Today is unavailable; the Settings copy says so).

Malformed or partial stored prefs fall back field-by-field to defaults.

### Click opens Today

- In the pill page: a press that moves less than 4px between mousedown and
  mouseup is a click; more is the existing drag. Drag behavior is unchanged.
- A click sends one IPC message; main shows/focuses the main window and
  forwards a "navigate to today" message; the renderer sets `view: 'today'`.
- If the main window is gone, main recreates or ignores per the app's
  existing lifecycle rules — the pill never errors.

## Part 3 — Shelf

### `shelfPrefs` settings row

- `width`: `narrow | default | wide` (three fixed pixel widths; the panel
  controller applies them, the page keeps its fluid layout).
- `density`: `compact | comfortable` — `AssistantSurface` spacing scale.
- `position`: `center | top-center` (panel placement on the active screen).
- `sections`: per-section show/hide toggles for the shelf's optional
  sections. The session controls section is NOT hideable — a shelf that
  cannot control a running session is broken, not customized.

Same storage, fanout, and fallback rules as `pillPrefs`.

## Error handling (all parts)

- Pill, notifications, and shelf cosmetics are niceties: any failure is
  caught, logged once, and the Hub/session state carries on.
- Prefs rows are validated on read; unknown fields ignored, missing fields
  defaulted, out-of-range values clamped.

## Testing

- Cycle transitions, remaining-time arithmetic, and boundary re-arm logic:
  pure-function unit tests (the `focusSession.ts` pattern).
- `pillModel` growth (countdown, title/glyph toggles, size): unit tests in
  `overlayWindow.test.ts` — the deps-injected controller needs no Electron.
- Click-vs-drag threshold: unit test on the page's pointer logic.
- Settings rows: load/save/validate tests per the existing settings-row
  pattern.
- `npm test` and `npx tsc -b` from `PhaseApp/` must pass; `npm run build`
  for the final check.

## Out of scope

- Sounds (user declined).
- Shelf shortcut customization (already exists).
- Any change to `PhaseWeb/` or `PhasePhone/`; the phone journals sessions it
  logs itself and is untouched by cycle structure.
