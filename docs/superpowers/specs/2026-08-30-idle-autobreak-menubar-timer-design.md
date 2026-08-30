# Idle auto-break + live menu-bar timer

**Date:** 2026-08-30
**Status:** approved by user (brainstormed in session)
**Scope:** `PhaseApp/` only. `PhaseApp/CLAUDE.md` is the authority for all conventions referenced below — read it before writing code.

## Problem

A focus session's break must be pressed by hand. When the user walks away
without pressing **Take break**, `elapsedFocusMinutes` keeps banking the
absence as work, so logged sessions overstate real time. Two causes, two
fixes shipped together:

1. **Accuracy** — the app cannot notice you left. → Idle auto-break.
2. **Visibility** — nothing outside the app says a session is running. →
   Live menu-bar timer.

Out of scope, explicitly: a floating always-on-top window, periodic nudge
notifications, any change to the `Session` history shape, any change to the
sync export.

## Existing machinery this builds on (do not rebuild)

- `src/lib/focusSession.ts` — calm session model. Pure transitions over
  injected `nowMs`; phases `active | break | confirming`. `pauseFocusSession`
  already accepts an arbitrary `nowMs`, which is exactly what a retroactive
  idle pause needs.
- `src/state/store.ts` — `actions.pauseFocus(nowMs?)`, `actions.resumeFocus(nowMs?)`,
  `actions.completeFocus(nowMs?)` exist. `setFocusDraft` (store.ts:457) is the
  single chokepoint every draft transition passes through.
- `electron/menuBar.cjs` — deep-module Tray with every Electron capability
  injected from `main.cjs`; failure-isolated; unit-tested without Electron
  (`menuBar.test.ts`). Menu currently: Open Phase / Open assistant /
  Settings / Quit Phase.
- `electron/preload.cjs` — `phaseShell` bridge, fixed literal channels only
  (`phase-shell:…`); `shellIpc.test.ts` pins the main side, and the preload
  surface is pinned by reading the file in tests (see `agentIpc.test.ts`
  pattern).
- `electron/assistantWindowController.cjs` — owns raising the assistant shelf
  (the Cmd+Space NSPanel). The shelf (`AssistantSurface.tsx`) already renders
  the `break` state with **Continue** as the filled primary.
- The agent relay pattern (`agentIpc.cjs` → renderer dispatches through
  `actions`) — the renderer is the ONLY writer. Main never mutates session
  state; it only observes snapshots and sends requests back.

## Design

### 1. Focus status seam (renderer → main)

A new one-way status channel. In `setFocusDraft`, after the draft is set,
push a snapshot to main over a new `phaseShell` method (fixed channel,
e.g. `phase-shell:focus-status`):

```ts
type FocusStatusSnapshot = {
  phase: 'active' | 'break' | 'confirming';
  activeSinceMs: number | null;
  accumulatedMs: number;
  title: string;
} | null;   // null = no session
```

- Sent on transitions only — never on a tick. This matches the calm-session
  rule: "how long" stays arithmetic over timestamps at read time.
- The bridge is fire-and-forget (`ipcRenderer.send`), and absence of the
  preload (plain browser dev) is a silent no-op — same guard style as the
  other bridges (`hydration === 'ready'`, preload exists).
- Also push the current snapshot once at hydrate, so a reloaded window
  re-arms the tray/idle watcher for a draft restored from the settings row.

### 2. Menu-bar timer (`electron/menuBar.cjs` grows)

Main derives the tray title from the last snapshot with its own repaint
timer — arithmetic, no renderer involvement:

- `phase === 'active'` → `▶ 42m` (elapsed = `accumulatedMs + (now − activeSinceMs)`,
  whole minutes). Repaint every 60s, aligned is not required.
- `phase === 'break'` → `⏸ on break` (static; stop the repaint timer).
- `phase === 'confirming'` or `null` → empty title (icon only; the presence
  of text IS the signal). Stop the repaint timer.

Menu grows session items ABOVE the existing four, present only while a
snapshot is non-null:

- active: **Take break**, **Finish session**
- break: **Resume**, **Finish session**
- confirming: none (the shelf owns that question)

Clicks send requests to the renderer over new fixed channels (relay
pattern); the renderer dispatches `actions.pauseFocus()` /
`actions.resumeFocus()` / `actions.completeFocus()`. If `completeFocus`
answers `needs-confirmation`, the renderer asks the shell to raise the
assistant overlay (existing `phaseShell.openAssistant`) so the question is
visible.

Constraints carried over from the existing module:

- All new capabilities (timer create/clear, title setter) are INJECTED;
  `menuBar.cjs` keeps importing nothing from Electron or `src/`.
- Tray failure stays a nicety: if the tray never came up, snapshots are
  ignored without error.
- The repaint timer must be disposed with the tray.

### 3. Idle watcher (new `electron/idleWatch.cjs`)

A deep module, deps injected (`getIdleSeconds`, `onSuspend`, `onLockScreen`,
timer create/clear, `notifyRenderer`), composed in `main.cjs` with
`powerMonitor`.

- Polls `getIdleSeconds()` every 30s, ONLY while the last snapshot's phase
  is `active`. No session, on break, confirming → no polling at all.
- **Trigger:** idle ≥ 300s (constant `IDLE_BREAK_SEC = 300`, no setting —
  YAGNI). Compute `idleStartMs = now − idleSeconds*1000` and send
  `auto-break { idleStartMs }` to the renderer. The renderer calls
  `actions.pauseFocus(idleStartMs)` — retroactive, so the idle minutes are
  never banked. Clamp: if `idleStartMs` precedes `activeSinceMs`, use
  `activeSinceMs` (a stretch cannot bank negative time; `stretchMs` already
  clamps at 0, but the clamp keeps the report honest).
- **Suspend / lock-screen:** same path, `idleStartMs = now`, immediately —
  a closed lid must not wait 5 minutes.
- **Return:** after an auto-break, keep polling; when `getIdleSeconds()`
  drops below a small threshold (user is back), send
  `returned { awayMs }` once and stop watching until the next `active`
  snapshot.
- Renderer marks the pause it performed for an auto-break so the surface
  can distinguish it (see §4): add an optional `autoBreak?: true` field to
  `ActiveFocusSession` — set by the auto-break path only, cleared by
  `resumeFocusSession`. `deserializeActiveFocusSession` must tolerate its
  absence (older drafts). It never reaches `Session` history.
- Double-fire safety: the renderer's `pauseFocus` already refuses when the
  phase is not `active`; a race between a manual pause and the idle message
  resolves to whichever landed first, harmlessly.

### 4. Return prompt (assistant shelf)

When the renderer receives `returned` and the draft is `phase: 'break'`
with `autoBreak`, it asks the shell to raise the assistant overlay
(existing `openAssistant`). `AssistantSurface`'s break state, when
`autoBreak` is set, adds a notice line — *"Away 12m — break not counted"*
(minutes from `awayMs`, rounded) — above the existing buttons. Button
hierarchy per the shelf's own rule (one filled primary per state):
**Resume/Continue stays the filled primary**, Finish and the dismissive
answers keep their existing weights. A manually-taken break never shows
the notice and never summons the shelf.

If the user returns and the draft has meanwhile become `confirming` (e.g.
`reconcileFocusDraft` fired) or `null`, the `returned` message is dropped
silently.

The shelf is height-budgeted (`HEIGHT` in `electron/assistantWindow.cjs` is
a MEASUREMENT, per PhaseApp/CLAUDE.md): if the notice line makes the break
state the new tallest state, re-measure at 620px and update the constant —
never derive it.

### 5. What main knows, and does not

Main holds only the latest `FocusStatusSnapshot` — no history, no writes,
no Dexie. Every state change round-trips through the renderer's `actions`.
`menuBar.cjs` and `idleWatch.cjs` import nothing from `src/` (established
electron-module rule). The snapshot type is declared in the `.d.cts`
files beside the modules, mirroring the existing pattern.

## Error handling

- Preload absent (web dev): all of this silently absent; app unaffected.
- Tray creation failed: timer text lost, idle watcher still works (it does
  not depend on the tray).
- Renderer gone (window closed) when main sends a request: `send` is
  fire-and-forget; the hydrate-time re-push (§1) re-arms state on reload.
- Clock jumps backwards: `stretchMs` clamps at 0 already; idle math clamps
  per §3.

## Testing

Follow the repo's existing test idioms (pure modules, injected deps, pinned
channel lists):

1. `electron/menuBar.test.ts` — grows: title text per phase, repaint timer
   started/stopped on the right transitions, timer disposed with tray,
   session menu items appear/disappear, clicks reach the injected callbacks,
   snapshot before tray exists is ignored.
2. `electron/idleWatch.test.ts` (new) — polls only while active; fires at
   the threshold with the computed `idleStartMs`; suspend/lock fire
   immediately; `returned` fires once; no polling after session ends;
   timers disposed.
3. `src/state/store.test.ts` — retroactive pause: `pauseFocus(idleStartMs)`
   banks only up to idle start; `autoBreak` set by the auto path, cleared
   by resume; serialization round-trip tolerates missing `autoBreak`.
4. `shellIpc.test.ts` / preload pinning — new channels pinned on both sides,
   same discipline as the existing fixed-channel tests.
5. `AssistantSurface` test — away notice renders for `autoBreak` break
   state with the rounded minutes; absent for a manual break.

`npm test` and `npx tsc -b` from `PhaseApp/` must pass.

## Acceptance

- Start a session, walk away 12 min, come back: shelf appears saying
  "Away 12m — break not counted"; elapsed time excludes the whole absence —
  banked time stops at the moment input stopped (idle start), not at the
  moment the 5-min threshold fired.
- Menu bar shows `▶ Nm` ticking by the minute while active, `⏸ on break`
  on break, icon-only otherwise; its menu can pause/resume/finish.
- Close the lid mid-session: reopening shows the session on break, lid
  time not banked.
- Manual break: no prompt, no notice, tray shows `⏸ on break`.
