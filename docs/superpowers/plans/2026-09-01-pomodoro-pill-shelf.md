# Pomodoro Cycles, Pill Customization, Shelf Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pomodoro work/break cycles as a per-session choice on top of the calm focus model; a `pillPrefs` settings group that makes the floating pill customizable and click-to-Today; a `shelfPrefs` group for the Cmd+Space shelf's width, density, position, and sections.

**Architecture:** Three phases in strict order. Phase A adds an optional `cycle` field to `ActiveFocusSession` with all transitions as pure functions over injected `nowMs` (the `focusSession.ts` idiom) — the only new timer is one renderer-side timeout armed at each transition. Phase B grows the existing `overlayWindow.cjs` deep module: main computes a richer render model from injected prefs, the page stays dumb, and a sub-4px press becomes click-to-Today. Phase C threads `shelfPrefs` through the existing store→host→relay path (as `theme` already rides it) and window geometry through a new renderer→main push (as `overlay-enabled` already does).

**Tech Stack:** React 19 + TypeScript, Vitest, Dexie (`settings` key/value table), Electron main-process CJS modules with injected deps.

**Spec:** `docs/superpowers/specs/2026-09-01-pomodoro-pill-shelf-design.md` — read it first.

## Global Constraints

- All commands run from `PhaseApp/` (`npm test`, `npx tsc -b`, `npm run build`).
- `electron/*.cjs` imports NOTHING from `src/` — shared shapes are declared in `src/lib/` and mirrored structurally in `.d.cts` siblings (see `focusStatus.ts` ↔ `menuBar.d.cts`). Preloads may require `electron`; other `.cjs` modules get every Electron capability injected from `main.cjs`.
- Electron-module tests load the `.cjs` via `createRequire`, exactly as `overlayWindow.test.ts` does.
- The pill, notifications, and shelf cosmetics are niceties: every failure is caught, logged once with the `[phase-shell]` prefix, and session state carries on.
- Main observes, the renderer writes. No new write paths from main.
- Fixed IPC channels only, sender-validated in `shellIpc.cjs` / `main.cjs`.
- **No ticking writes.** Remaining time is arithmetic at read time over banked timestamps. Dexie writes happen on TRANSITIONS only, through `setFocusDraft`.
- Every stored draft/settings row must parse totally: malformed → defaults, never a throw. A pre-cycle draft reads as a calm session.
- Commit after each task, message in the repo's style (`git log --oneline -15` for the voice; single-line, feat(app)/fix(app) prefix).
- `src/state/store.ts` and `src/App.tsx` are large; edit surgically at the anchors given. Re-read the anchor before editing.

---

## Phase A — Pomodoro cycles

### Task 1: `focusCycle.ts` — config, arithmetic, transitions (pure)

**Files:**
- Create: `PhaseApp/src/lib/focusCycle.ts`
- Test: `PhaseApp/src/lib/focusCycle.test.ts`
- Modify: `PhaseApp/src/lib/focusSession.ts` (add `cycle` to `ActiveFocusSession`, parse/serialize, clear break-fields on resume)

**Interfaces:**
- Produces (consumed by Tasks 2–6):

```ts
export interface CycleConfig { workMin: number; breakMin: number; longBreakMin: number; longEvery: number }
export const DEFAULT_CYCLE_CONFIG: CycleConfig; // { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4 }
export function clampCycleConfig(raw: Partial<CycleConfig>): CycleConfig; // work 5–120, breaks 1–60, longEvery 2–10
export function parseCycleConfig(raw: unknown): CycleConfig;             // total; malformed field → default field
export function serializeCycleConfig(config: CycleConfig): string;

// On ActiveFocusSession (focusSession.ts):
cycle?: {
  workMin: number; breakMin: number; longBreakMin: number; longEvery: number;
  completed: number;            // work intervals finished
  breakStartedMs?: number;      // set by the cycle's own work-end flip; absent on manual breaks
  breakKind?: 'short' | 'long';
  breakNotified?: true;         // break-end notice already sent
};

export function cycleFor(config: CycleConfig): NonNullable<ActiveFocusSession['cycle']>; // completed: 0
export function workRemainingMs(session: ActiveFocusSession, nowMs: number): number | null; // null when no cycle / not active
export function breakRemainingMs(session: ActiveFocusSession, nowMs: number): number | null; // null when no cycle break running
export function nextBoundaryDelayMs(session: ActiveFocusSession, nowMs: number): number | null;
export function applyCycleBoundary(session: ActiveFocusSession, nowMs: number):
  { session: ActiveFocusSession; event: 'work-ended' | 'break-ended' } | null; // null = no boundary due
```

- [ ] **Step 1: Write the failing tests**

```ts
// PhaseApp/src/lib/focusCycle.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CYCLE_CONFIG, clampCycleConfig, parseCycleConfig, serializeCycleConfig,
  cycleFor, workRemainingMs, breakRemainingMs, nextBoundaryDelayMs, applyCycleBoundary,
} from './focusCycle';
import { startFocusSession, pauseFocusSession, resumeFocusSession, parseActiveFocusSession, serializeActiveFocusSession } from './focusSession';
import type { ActiveFocusSession } from './focusSession';

const MIN = 60_000;
const T0 = 1_700_000_000_000;

function pomodoro(over: Partial<ActiveFocusSession> = {}): ActiveFocusSession {
  const base = startFocusSession({
    ref: { kind: 'task', id: 't1', goalId: null },
    title: 'Problem set 4',
    expected: { kind: 'estimate', minutes: 60 },
    focusLevel: 'medium',
    nowMs: T0,
  });
  return { ...base, cycle: cycleFor(DEFAULT_CYCLE_CONFIG), ...over };
}

describe('config', () => {
  it('clamps every field into its range', () => {
    expect(clampCycleConfig({ workMin: 1, breakMin: 0, longBreakMin: 999, longEvery: 1 }))
      .toEqual({ workMin: 5, breakMin: 1, longBreakMin: 60, longEvery: 2 });
  });
  it('parses malformed input field-by-field to defaults', () => {
    expect(parseCycleConfig('garbage')).toEqual(DEFAULT_CYCLE_CONFIG);
    expect(parseCycleConfig(JSON.stringify({ workMin: 50 })))
      .toEqual({ ...DEFAULT_CYCLE_CONFIG, workMin: 50 });
    expect(parseCycleConfig(serializeCycleConfig({ workMin: 30, breakMin: 10, longBreakMin: 20, longEvery: 3 })))
      .toEqual({ workMin: 30, breakMin: 10, longBreakMin: 20, longEvery: 3 });
  });
});

describe('arithmetic', () => {
  it('counts down the work interval from banked active time', () => {
    expect(workRemainingMs(pomodoro(), T0 + 10 * MIN)).toBe(15 * MIN);
  });
  it('measures the current interval, not the whole session', () => {
    const s = pomodoro({ cycle: { ...cycleFor(DEFAULT_CYCLE_CONFIG), completed: 1 }, accumulatedMs: 25 * MIN, startedAtMs: T0 - 30 * MIN });
    expect(workRemainingMs(s, T0 + 10 * MIN)).toBe(15 * MIN);
  });
  it('is null for a calm session', () => {
    const calm = { ...pomodoro() };
    delete calm.cycle;
    expect(workRemainingMs(calm, T0)).toBeNull();
    expect(nextBoundaryDelayMs(calm, T0)).toBeNull();
  });
  it('a manual pause freezes the countdown and has no break countdown', () => {
    const paused = pauseFocusSession(pomodoro(), T0 + 10 * MIN);
    expect(workRemainingMs(paused, T0 + 60 * MIN)).toBeNull();
    expect(breakRemainingMs(paused, T0 + 60 * MIN)).toBeNull();
    expect(nextBoundaryDelayMs(paused, T0 + 60 * MIN)).toBeNull();
  });
});

describe('applyCycleBoundary', () => {
  it('flips to break AT the boundary, so overshoot is never banked as work', () => {
    const out = applyCycleBoundary(pomodoro(), T0 + 26 * MIN)!;
    expect(out.event).toBe('work-ended');
    expect(out.session.phase).toBe('break');
    expect(out.session.accumulatedMs).toBe(25 * MIN);
    expect(out.session.cycle).toMatchObject({ completed: 1, breakKind: 'short', breakStartedMs: T0 + 25 * MIN });
  });
  it('every longEvery-th break is long', () => {
    const s = pomodoro({ cycle: { ...cycleFor(DEFAULT_CYCLE_CONFIG), completed: 3 }, accumulatedMs: 75 * MIN, activeSinceMs: T0 });
    const out = applyCycleBoundary(s, T0 + 25 * MIN)!;
    expect(out.session.cycle!.breakKind).toBe('long');
    expect(out.session.cycle!.completed).toBe(4);
  });
  it('marks a finished break once, without changing phase', () => {
    const flipped = applyCycleBoundary(pomodoro(), T0 + 25 * MIN)!.session;
    const out = applyCycleBoundary(flipped, T0 + 31 * MIN)!;
    expect(out.event).toBe('break-ended');
    expect(out.session.phase).toBe('break');
    expect(out.session.cycle!.breakNotified).toBe(true);
    expect(applyCycleBoundary(out.session, T0 + 60 * MIN)).toBeNull();
  });
  it('is null before any boundary is due', () => {
    expect(applyCycleBoundary(pomodoro(), T0 + 10 * MIN)).toBeNull();
  });
});

describe('resume and persistence', () => {
  it('resume clears the cycle break bookkeeping', () => {
    const flipped = applyCycleBoundary(pomodoro(), T0 + 25 * MIN)!.session;
    const resumed = resumeFocusSession(flipped, T0 + 30 * MIN);
    expect(resumed.cycle).toMatchObject({ completed: 1 });
    expect(resumed.cycle!.breakStartedMs).toBeUndefined();
    expect(resumed.cycle!.breakKind).toBeUndefined();
    expect(resumed.cycle!.breakNotified).toBeUndefined();
  });
  it('a cycle survives the settings-row round trip', () => {
    const s = applyCycleBoundary(pomodoro(), T0 + 25 * MIN)!.session;
    expect(parseActiveFocusSession(serializeActiveFocusSession(s))).toEqual(s);
  });
  it('a malformed cycle reads as a calm session, never as no session', () => {
    const raw = JSON.parse(serializeActiveFocusSession(pomodoro()));
    raw.cycle = { workMin: 'lots' };
    const parsed = parseActiveFocusSession(JSON.stringify(raw))!;
    expect(parsed).not.toBeNull();
    expect(parsed.cycle).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd PhaseApp && npx vitest run src/lib/focusCycle.test.ts`
Expected: FAIL — cannot resolve `./focusCycle`.

- [ ] **Step 3: Implement**

`src/lib/focusCycle.ts` — the shape of the module:

```ts
import type { ActiveFocusSession } from './focusSession';

const MIN = 60_000;

export interface CycleConfig { workMin: number; breakMin: number; longBreakMin: number; longEvery: number }
export const DEFAULT_CYCLE_CONFIG: CycleConfig = { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4 };

const RANGES: Record<keyof CycleConfig, [number, number]> = {
  workMin: [5, 120], breakMin: [1, 60], longBreakMin: [1, 60], longEvery: [2, 10],
};

export function clampCycleConfig(raw: Partial<CycleConfig>): CycleConfig { /* per-field clamp+round, default on non-finite */ }
export function parseCycleConfig(raw: unknown): CycleConfig { /* JSON.parse in try; clampCycleConfig over whatever parsed */ }
export function serializeCycleConfig(config: CycleConfig): string { return JSON.stringify(config); }

export function cycleFor(config: CycleConfig): NonNullable<ActiveFocusSession['cycle']> {
  return { ...clampCycleConfig(config), completed: 0 };
}

function totalActiveMs(session: ActiveFocusSession, nowMs: number): number {
  const stretch = session.activeSinceMs === null ? 0 : Math.max(0, nowMs - session.activeSinceMs);
  return session.accumulatedMs + stretch;
}

export function workRemainingMs(session: ActiveFocusSession, nowMs: number): number | null {
  if (!session.cycle || session.phase !== 'active') return null;
  const progress = Math.max(0, totalActiveMs(session, nowMs) - session.cycle.completed * session.cycle.workMin * MIN);
  return Math.max(0, session.cycle.workMin * MIN - progress);
}

function breakLenMs(cycle: NonNullable<ActiveFocusSession['cycle']>): number {
  return (cycle.breakKind === 'long' ? cycle.longBreakMin : cycle.breakMin) * MIN;
}

export function breakRemainingMs(session: ActiveFocusSession, nowMs: number): number | null {
  const c = session.cycle;
  if (!c || session.phase !== 'break' || c.breakStartedMs === undefined || c.breakNotified) return null;
  return Math.max(0, c.breakStartedMs + breakLenMs(c) - nowMs);
}

export function nextBoundaryDelayMs(session: ActiveFocusSession, nowMs: number): number | null {
  return workRemainingMs(session, nowMs) ?? breakRemainingMs(session, nowMs);
}

export function applyCycleBoundary(session, nowMs) {
  const work = workRemainingMs(session, nowMs);
  if (work !== null && work <= 0) {
    const c = session.cycle!;
    const boundaryMs = nowMs - /* overshoot */ (totalActiveMs(session, nowMs) - (c.completed + 1) * c.workMin * MIN);
    const completed = c.completed + 1;
    // pauseFocusSession(session, boundaryMs) then attach:
    // cycle: { ...c, completed, breakStartedMs: boundaryMs, breakKind: completed % c.longEvery === 0 ? 'long' : 'short' }
  }
  const brk = breakRemainingMs(session, nowMs);
  if (brk !== null && brk <= 0) {
    // { session: { ...session, cycle: { ...session.cycle!, breakNotified: true } }, event: 'break-ended' }
  }
  return null;
}
```

Fill the elided bodies; import `pauseFocusSession` from `./focusSession`.

In `src/lib/focusSession.ts`:
- Add the `cycle?` field to `ActiveFocusSession` (shape above, doc-commented in the file's voice: a calm session never carries it; durations are frozen at start so Settings edits do not retime a running interval).
- In `resumeFocusSession`, when `session.cycle` exists, return it with `breakStartedMs`/`breakKind`/`breakNotified` stripped (same destructuring idiom the function already uses for `autoBreak`/`awayMs`).
- In `parseActiveFocusSession`, validate `s.cycle`: all four duration fields finite-positive, `completed` finite-non-negative, `breakStartedMs` finite-non-negative or absent, `breakKind` `'short'|'long'` or absent, `breakNotified` exactly `true` or absent. Malformed → omit `cycle`, keep the session (mirror the `autoBreak` comment: losing structure must never cost the user their session).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd PhaseApp && npx vitest run src/lib/focusCycle.test.ts src/lib/focusSession.test.ts`
Expected: PASS, including the untouched focusSession suite.

- [ ] **Step 5: Commit**

```bash
git add src/lib/focusCycle.ts src/lib/focusCycle.test.ts src/lib/focusSession.ts
git commit -m "feat(app): pomodoro cycle arithmetic, pure over banked timestamps"
```

---

### Task 2: cycle config settings row + store state

**Files:**
- Modify: `PhaseApp/src/db/db.ts` (beside `SHOW_OVERLAY_KEY`, ~line 217)
- Modify: `PhaseApp/src/state/store.ts` (UIState ~line 279, defaults ~line 339, hydrate ~line 852, actions)
- Test: `PhaseApp/src/db/db.test.ts`, `PhaseApp/src/state/store.test.ts`

**Interfaces:**
- Produces: `loadCycleConfig(): Promise<CycleConfig>`, `saveCycleConfig(config: CycleConfig): Promise<void>` in db.ts (key `'cycleConfig'`, value `serializeCycleConfig`); `cycleConfig: CycleConfig` on UIState; action `setCycleConfig(config: CycleConfig): void` (clamps, sets, `ifOwner`-saves).

- [ ] **Step 1: Write failing tests** — db round-trip + malformed-value test in the style of the existing `showOverlay` tests in `db.test.ts`; a store test that `setCycleConfig` clamps and updates state.
- [ ] **Step 2: Run** `npx vitest run src/db/db.test.ts src/state/store.test.ts` — expect the new cases FAIL.
- [ ] **Step 3: Implement.** db.ts follows the `showOverlay` pattern exactly (load returns `parseCycleConfig(row?.value)`). Store: add field, default `DEFAULT_CYCLE_CONFIG`, hydrate in `initStore` beside the `focusLevelFor` line (~852), action beside `setAssistantAccelerator` using the `ifOwner` idiom.
- [ ] **Step 4: Run the same tests** — PASS. Also `npx tsc -b`.
- [ ] **Step 5: Commit** — `feat(app): the pomodoro dial — four numbers in a settings row`

---

### Task 3: `startFocus` gains a mode; the boundary lands in the store

**Files:**
- Modify: `PhaseApp/src/state/store.ts` (`startFocus` ~line 2342; new action beside it)
- Test: `PhaseApp/src/state/store.test.ts`

**Interfaces:**
- `startFocus(ref, expected, nowMs = Date.now(), cycle?: CycleConfig): boolean` — when `cycle` given, the draft gets `cycle: cycleFor(cycle)`. Existing 2-arg callers (`AssistantHost.tsx:121`, `Today.tsx:250`) stay calm sessions untouched.
- New action: `applyCycleBoundary(nowMs = Date.now()): 'work-ended' | 'break-ended' | 'none'` — calls the lib's `applyCycleBoundary` on the current draft; on a result, `setFocusDraft(result.session)` and return the event; otherwise `'none'`. Total: no draft or calm draft → `'none'`.

- [ ] **Step 1: Failing tests** — starting with a config attaches a frozen cycle; `applyCycleBoundary` at T0+25min flips to break and returns `'work-ended'`; a second call at break end returns `'break-ended'` once, then `'none'`; a calm session always `'none'`.
- [ ] **Step 2: Run to fail.** `npx vitest run src/state/store.test.ts`
- [ ] **Step 3: Implement** in store.ts. `startFocus` body: after building via `startFocusSession`, `if (cycle) draft = { ...draft, cycle: cycleFor(cycle) }` before `setFocusDraft`.
- [ ] **Step 4: Run to pass**, then `npx tsc -b`.
- [ ] **Step 5: Commit** — `feat(app): a session may carry a cycle, and the store can land its boundary`

---

### Task 4: the boundary timeout and the notification seam

**Files:**
- Modify: `PhaseApp/src/App.tsx` (new effect beside the focus-status publisher, ~line 322)
- Modify: `PhaseApp/src/lib/shellBridge.ts` (add `notifyFocus`)
- Modify: `PhaseApp/electron/preload.cjs`, `PhaseApp/electron/shellIpc.cjs`, `PhaseApp/electron/main.cjs`
- Test: `PhaseApp/src/lib/shellBridge.test.ts`, `PhaseApp/electron/shellIpc.test.ts`

**Interfaces:**
- Bridge: `notifyFocus(notice: { title: string; body: string }): void` — no-op in browser, exactly as `publishFocusStatus`.
- Channel: `phase-shell:focus-notify` (renderer→main, `ipcRenderer.send`). `shellIpc.cjs` validates: main-sender, `title`/`body` non-empty strings ≤ 200 chars, then calls injected `onFocusNotify(notice)`. `main.cjs` injects `onFocusNotify: (n) => { try { new Notification({ title: n.title, body: n.body }).show() } catch (e) { console.error('[phase-shell] notification unavailable', e) } }` (import `Notification` from electron at the top).

- [ ] **Step 1: Failing tests** — shellBridge exposes and forwards `notifyFocus` (mirror the `publishFocusStatus` cases at `shellBridge.test.ts:87–97`); shellIpc refuses a non-main sender and malformed payloads, forwards a good one (mirror `onFocusStatusMessage` tests).
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement**, then the App effect:

```tsx
// App.tsx — beside the focus-status publisher. One timeout, re-armed on every
// draft transition; the fire lands a store transition, which replaces the
// draft reference, which re-runs this subscription — self-re-arming.
useEffect(() => {
  if (hydration !== 'ready') return;
  let stop: ReturnType<typeof setTimeout> | null = null;
  const arm = (draft: ActiveFocusSession | null) => {
    if (stop) { clearTimeout(stop); stop = null; }
    if (!draft) return;
    const delay = nextBoundaryDelayMs(draft, Date.now());
    if (delay === null) return;
    stop = setTimeout(() => {
      const event = actions.applyCycleBoundary();
      const current = getState().activeFocusSession;
      if (event === 'work-ended' && current?.cycle) {
        shell.notifyFocus({
          title: 'Time for a break',
          body: `${current.cycle.completed * current.cycle.workMin} focused minutes down · ${current.cycle.breakKind === 'long' ? 'long' : 'short'} break`,
        });
      } else if (event === 'break-ended' && current) {
        shell.notifyFocus({ title: "Break's over", body: `Ready to get back to “${current.title}”?` });
      }
    }, Math.max(0, delay));
  };
  let last = getState().activeFocusSession;
  arm(last);
  const unsub = subscribe(() => {
    const next = getState().activeFocusSession;
    if (next === last) return;
    last = next;
    arm(next);
  });
  return () => { unsub(); if (stop) clearTimeout(stop); };
}, [hydration, shell]);
```

A delay computed as ≤ 0 (wake after sleep, reload mid-overdue-interval) fires on the next tick and applies the boundary retroactively — `applyCycleBoundary` flips at the true boundary time, so away time is never banked as work.

- [ ] **Step 4: Run** `npx vitest run src/lib/shellBridge.test.ts electron/shellIpc.test.ts src/App.test.ts` — PASS; `npx tsc -b`.
- [ ] **Step 5: Commit** — `feat(app): one armed timeout lands the cycle boundary, and macOS says so`

---

### Task 5: the snapshot carries the cycle; menu bar and pill count down

**Files:**
- Modify: `PhaseApp/src/lib/focusStatus.ts` (snapshot + projection)
- Modify: `PhaseApp/electron/shellIpc.cjs` (`normalizeFocusStatus` passes the cycle through, validated)
- Modify: `PhaseApp/electron/menuBar.cjs` (`trayTitle`), `PhaseApp/electron/overlayWindow.cjs` (`pillModel`), their `.d.cts`
- Test: `PhaseApp/src/lib/focusStatus.test.ts`, `PhaseApp/electron/menuBar.test.ts`, `PhaseApp/electron/overlayWindow.test.ts`

**Interfaces:**
- `FocusStatusSnapshot` gains `cycle?: { workMin: number; breakMin: number; longBreakMin: number; longEvery: number; completed: number; breakStartedMs?: number; breakKind?: 'short' | 'long' }` (no `breakNotified` — main has no use for it). `focusStatusOf` projects it when present.
- Countdown rule, both surfaces: minutes remaining are **`Math.ceil`** (17:30 left reads 18m — a countdown that reads 17m is claiming a minute that is already gone), floored at 0.
  - `trayTitle`: active+cycle → `▶ ${ceil}m left`; break+cycle+breakStartedMs → `⏸ break ${ceil}m`; break past its length or manual → existing `⏸ on break`. Calm sessions unchanged.
  - `pillModel`: active+cycle → `{ glyph: '▶', text: '${ceil}m left · ${title}' }`; timed break → `{ glyph: '⏸', text: 'break · ${ceil}m' }`. Calm unchanged.
- Repaint: both modules re-arm their 60s repaint whenever the model is a countdown (active, or a timed break) — today they re-arm only on `active`.

- [ ] **Step 1: Failing tests** — snapshot projection with/without cycle; trayTitle and pillModel countdown cases incl. ceil at the half-minute, the timed break, and the untouched calm cases.
- [ ] **Step 2: Run to fail.** `npx vitest run src/lib/focusStatus.test.ts electron/menuBar.test.ts electron/overlayWindow.test.ts`
- [ ] **Step 3: Implement.** In `shellIpc.cjs` `normalizeFocusStatus`, accept the optional cycle with per-field checks (finite numbers, valid kind); a malformed cycle drops the field, never the snapshot.
- [ ] **Step 4: Run to pass**; `npx tsc -b`.
- [ ] **Step 5: Commit** — `feat(app): the fanout learns the cycle; tray and pill count down`

---

### Task 6: mode choice on the shelf; durations in Settings

**Files:**
- Modify: `PhaseApp/src/components/assistant/AssistantSurface.tsx` (start actions), `PhaseApp/src/components/assistant/AssistantHost.tsx` (~line 117 `onAction`)
- Create: `PhaseApp/src/components/FocusSettings.tsx`
- Modify: `PhaseApp/src/components/SettingsModal.tsx` (new section after "Assistant shortcut")
- Test: `PhaseApp/src/components/assistant/AssistantSurface.test.tsx`, `PhaseApp/src/components/FocusSettings.test.tsx`

**Interfaces:**
- `AssistantAction`'s `start-focus` variant gains `mode?: 'pomodoro'`. The surface renders TWO start affordances where it renders one today: the existing primary **Start** (calm) and a secondary **Start pomodoro** beside it, same disabled rules. Cycle position line while a pomodoro runs: under the work band's subtitle, `interval ${completed + 1} · ${breakKind ?? 'short'} break next` (derive next-break kind from `completed + 1` vs `longEvery`).
- `AssistantHost.onAction` case `'start-focus'`: pass `action.mode === 'pomodoro' ? getState-something` — concretely: `actions.startFocus(action.ref, expectedTimeFor(...), Date.now(), action.mode === 'pomodoro' ? cycleConfig : undefined)` where `cycleConfig` comes off the store hook already destructured in the component.
- `FocusSettings.tsx`: four numeric steppers (work / short break / long break / long break every N) bound to `cycleConfig` + `actions.setCycleConfig` (clamping lives in the action). Copy: "Applies to sessions you start as pomodoro. A running session keeps the lengths it started with." Use the existing field styling of `EstimateControl`/`SegmentedControl` neighbors, not new CSS.
- SettingsModal section heading `Focus`, one intro sentence in the modal's existing voice.

- [ ] **Step 1: Failing tests** — surface: pomodoro start button dispatches `{ type: 'start-focus', mode: 'pomodoro' }`; host wires it through to `startFocus` with the config; FocusSettings renders the four fields and dispatches `setCycleConfig`.
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement.** Match the surface's `shelf`/`embedded` two-presentation idiom — both presentations get both buttons.
- [ ] **Step 4: Run** the three component suites + `npx vitest run src/views/views.smoke.test.ts`; `npx tsc -b`.
- [ ] **Step 5: Commit** — `feat(app): start it calm or start it pomodoro, and set the dial in Settings`

**Phase A gate:** `npm test` and `npx tsc -b` fully green before Phase B.

---

## Phase B — Pill

### Task 7: `pillPrefs` — the row and its parser

**Files:**
- Create: `PhaseApp/src/lib/pillPrefs.ts`
- Modify: `PhaseApp/src/db/db.ts`
- Test: `PhaseApp/src/lib/pillPrefs.test.ts`, `PhaseApp/src/db/db.test.ts`

**Interfaces:**

```ts
export interface PillPrefs {
  show: boolean;                                  // default true
  content: 'countdown' | 'elapsed';               // pomodoro sessions only; default 'countdown'
  showTitle: boolean;                             // default true
  showGlyph: boolean;                             // default true
  size: 'small' | 'medium' | 'large';             // default 'medium'
  opacity: number;                                // 0.5–1.0, default 0.92 (today's alpha)
  theme: 'system' | 'dark' | 'light';             // default 'dark' (today's look)
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; // default 'top-right'
  clickThrough: boolean;                          // default false
}
export const DEFAULT_PILL_PREFS: PillPrefs;
export function parsePillPrefs(raw: unknown): PillPrefs;   // total, field-by-field fallback
export function serializePillPrefs(prefs: PillPrefs): string;
```

- db.ts: `loadPillPrefs(): Promise<PillPrefs>` / `savePillPrefs(prefs)` on key `'pillPrefs'`. **Migration:** when the row is absent but legacy `'showOverlay'` exists, seed `show` from it (leave the legacy row in place; it is one boolean, not worth a delete-write). `showTitle`/`showGlyph` may not both be false — `parsePillPrefs` forces `showTitle` back on in that case.

- [ ] **Step 1: Failing tests** — defaults, round trip, per-field fallback, the both-off guard, the legacy `showOverlay: 'false'` migration.
- [ ] **Step 2: Run to fail.** `npx vitest run src/lib/pillPrefs.test.ts src/db/db.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `feat(app): pillPrefs — one row, total parse, legacy toggle absorbed`

---

### Task 8: prefs cross the seam; the pill obeys them

**Files:**
- Modify: `PhaseApp/src/lib/shellBridge.ts` (`setPillPrefs(prefs)` replaces `setOverlayEnabled`), `PhaseApp/electron/preload.cjs`, `PhaseApp/electron/shellIpc.cjs` (channel `phase-shell:pill-prefs` replaces `phase-shell:overlay-enabled`), `PhaseApp/electron/main.cjs`, `PhaseApp/src/App.tsx` (~line 337: the startup push loads `loadPillPrefs` and calls `setPillPrefs`)
- Modify: `PhaseApp/electron/overlayWindow.cjs` + `.d.cts`
- Test: `PhaseApp/electron/overlayWindow.test.ts`, `PhaseApp/electron/shellIpc.test.ts`, `PhaseApp/src/lib/shellBridge.test.ts`

**Interfaces:**
- `overlayWindow.cjs` exports `normalizePillPrefs(raw)` — the structural mirror of `parsePillPrefs` (same defaults; `.cjs` cannot import `src/`), tested in its own suite. Controller method `setPrefs(raw)` replaces `setEnabled`; it normalizes, stores, applies geometry, and repaints.
- Geometry per size (module constants, exported for tests):

```js
const SIZES = {
  small:  { width: 200, height: 28, font: 11, radius: 14, padX: 10 },
  medium: { width: 240, height: 36, font: 13, radius: 18, padX: 14 },
  large:  { width: 300, height: 44, font: 15, radius: 22, padX: 18 },
};
```

- `pillModel(status, nowMs, prefs, isSystemDark)` grows: honors `content` ('elapsed' shows the calm elapsed text even for a cycle session), `showTitle`, `showGlyph`, and returns style fields main computes — `{ glyph?, text, font, height, radius, padX, bg, ink }` where dark = `rgba(28,27,26,${opacity})`/`#f5f2ec`, light = `rgba(250,248,244,${opacity})`/`#1c1b1a`, `system` picks by `isSystemDark` (injected from `nativeTheme.shouldUseDarkColors` in main.cjs; subscribe to `nativeTheme.on('updated')` → repaint).
- `defaultPosition(workArea, corner)` generalizes the current top-right math to four corners, 16px margin.
- Size change on a live window: `win.setBounds` to the new footprint at the clamped current position. `clickThrough` → `win.setIgnoreMouseEvents(prefs.clickThrough)`.
- `show: false` behaves exactly as `setEnabled(false)` did.

- [ ] **Step 1: Failing tests** — normalizePillPrefs mirror cases; pillModel content/title/glyph/theme/opacity matrix; four-corner defaultPosition; controller applies bounds + ignore-mouse (extend the existing fake-window harness in `overlayWindow.test.ts`).
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement**, including the rename sweep: `OVERLAY_ENABLED_CHANNEL` → `PILL_PREFS_CHANNEL`, preload method, bridge method, App startup push, `main.cjs` wiring (`onOverlayEnabled` → `onPillPrefs: (p) => overlay?.setPrefs(p)`).
- [ ] **Step 4: Run** the three suites + `npx tsc -b`.
- [ ] **Step 5: Commit** — `feat(app): the pill takes orders — size, skin, corner, content`

---

### Task 9: the page — sizes, theme, manual drag, click means Today

**Files:**
- Modify: `PhaseApp/electron/assets/overlay.html`, `PhaseApp/electron/overlayPreload.cjs`
- Modify: `PhaseApp/electron/overlayWindow.cjs` (drag IPC), `PhaseApp/electron/main.cjs`, `PhaseApp/electron/shellIpc.cjs` (`openToday()` beside `openSettings()`), `PhaseApp/electron/preload.cjs` + `PhaseApp/src/lib/shellBridge.ts` (`onOpenToday`), `PhaseApp/src/App.tsx` (one line beside the `onOpenSettings` effect at ~301: `useEffect(() => shell.onOpenToday(() => actions.setView('today')), [shell]);`)
- Test: `PhaseApp/electron/overlayWindow.test.ts`, `PhaseApp/electron/shellIpc.test.ts`

**Interfaces:**
- The model push now carries the style fields; the page sets CSS custom properties from them (`--h`, `--font`, `--radius`, `--pad`, `--bg`, `--ink`) — still dumb, still no decisions.
- **Manual drag replaces `-webkit-app-region: drag`** (a drag region swallows clicks, and the whole pill must now be clickable):
  - Page: on `mousedown` record `(screenX, screenY)`; on `mousemove` while down, `phaseOverlay.dragTo(e.screenX, e.screenY)`; on `mouseup`, if the pointer never strayed ≥ 4px from the down point, `phaseOverlay.openToday()`.
  - Preload adds `dragStart()`, `dragTo(screenX, screenY)`, `openToday()` on fixed channels `phase-overlay:drag-start` / `phase-overlay:drag-to` / `phase-overlay:open-today`; `openPhase` is retired with the glyph button (the glyph is a plain `<span>` now).
  - Controller: `drag-start` records the window's position and the first drag point; each `drag-to` sets position to `windowStart + (point − pointStart)`, clamped to the work area of the nearest display; the existing `moved` debounce keeps saving the resting spot.
- `main.cjs`: `phase-overlay:open-today` (sender-validated via `overlay.isSender`, exactly as `open-phase` at ~line 603) → `openPhase()` then `shellIpc.openToday()`. `openToday()` mirrors `openSettings()` including the `isLoadingMainFrame` wait.

- [ ] **Step 1: Failing tests** — controller drag math (start/move/clamp) with the fake window; shellIpc `openToday` mirrors the `openSettings` cases; a click-threshold unit test for the page's decision function if extracted, else covered by the controller tests.
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement.** Keep the page's CSP; keep `title="Drag to move · click to open Today"`.
- [ ] **Step 4: Run** suites + `npx tsc -b`. Then `npm run build` once — the page and preload ship from `electron/assets`, and a packaged-path regression here is invisible to vitest.
- [ ] **Step 5: Commit** — `feat(app): drag by hand, click for Today`

---

### Task 10: Settings UI — the pill group

**Files:**
- Rewrite: `PhaseApp/src/components/assistant/OverlaySettings.tsx` (grows from one switch into the group; keep the filename — git history reads better than a rename plus edit)
- Modify: `PhaseApp/src/components/SettingsModal.tsx` (heading `Floating timer` above it)
- Test: `PhaseApp/src/components/assistant/OverlaySettings.test.tsx` (create if absent)

**Interfaces:**
- Loads `loadPillPrefs` once (skeleton while loading, as today), local state, every change: `savePillPrefs` + `bridge.setPillPrefs` fire-and-forget (the row is OURS — same comment as today).
- Controls, in order: the existing show switch; `SegmentedControl`s for size, theme, content (labeled "While a pomodoro runs: time left / time worked"); switches for title, glyph, click-through (helper text: "The pill ignores the mouse — clicking through to Today is off while this is on"); a corner `SegmentedControl`; an opacity slider (`<input type="range" min="50" max="100">`, shown as %). Desktop-only (`bridge.available` guard), as today.
- The title/glyph pair enforces the not-both-off rule in the UI (disable the last-on switch).

- [ ] **Step 1: Failing tests** — renders all controls from a loaded row; a change saves and pushes; both-off is unreachable.
- [ ] **Step 2: Run to fail.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run + `npx tsc -b`.**
- [ ] **Step 5: Commit** — `feat(app): the floating timer earns a settings group`

**Phase B gate:** `npm test`, `npx tsc -b`, `npm run build` all green.

---

## Phase C — Shelf

### Task 11: `shelfPrefs` — row, parser, store

**Files:**
- Create: `PhaseApp/src/lib/shelfPrefs.ts`; Modify: `PhaseApp/src/db/db.ts`, `PhaseApp/src/state/store.ts`
- Test: `PhaseApp/src/lib/shelfPrefs.test.ts`, `PhaseApp/src/db/db.test.ts`, `PhaseApp/src/state/store.test.ts`

**Interfaces:**

```ts
export interface ShelfPrefs {
  width: 'narrow' | 'default' | 'wide';        // 520 / 620 / 760 px — mapping lives with the window, not here
  density: 'compact' | 'comfortable';          // default 'comfortable' (today's spacing)
  position: 'center' | 'top-center';           // default 'center' (today's placement)
  sections: { alternatives: boolean; dials: boolean }; // both default true; the work band is NOT here — a shelf that cannot control a session is broken, not customized
}
export const DEFAULT_SHELF_PREFS: ShelfPrefs;
export function parseShelfPrefs(raw: unknown): ShelfPrefs;  // total, field-by-field
export function serializeShelfPrefs(prefs: ShelfPrefs): string;
```

- db.ts `loadShelfPrefs`/`saveShelfPrefs`, key `'shelfPrefs'`. Store: `shelfPrefs` on UIState (default `DEFAULT_SHELF_PREFS`), hydrated in `initStore`, action `setShelfPrefs` (`ifOwner` save). It lives in the store — unlike `pillPrefs` — because the shelf renderer receives it over the assistant relay, and the relay's model is built from store state in `AssistantHost`.

- [ ] **Steps 1–5:** same TDD rhythm as Task 7 (parser matrix, db round trip, store action), commit — `feat(app): shelfPrefs — a row the relay can carry`

---

### Task 12: shelf geometry — width and position

**Files:**
- Modify: `PhaseApp/electron/assistantWindow.cjs` (WIDTH at ~line 72 becomes per-pref; placement math ~line 83), `PhaseApp/electron/assistantWindowController.cjs` + `.d.cts`, `PhaseApp/electron/main.cjs`, `PhaseApp/electron/shellIpc.cjs` (channel `phase-shell:shelf-prefs`), `PhaseApp/electron/preload.cjs`, `PhaseApp/src/lib/shellBridge.ts` (`setShelfPrefs`), `PhaseApp/src/App.tsx` (startup push beside the pill's; also push on store change of `shelfPrefs` — the by-reference subscribe idiom)
- Test: `PhaseApp/electron/assistantWindowController.test.ts`, `PhaseApp/electron/shellIpc.test.ts`

**Interfaces:**
- Widths: `{ narrow: 520, default: 620, wide: 760 }` as an exported constant in `assistantWindow.cjs`. The controller gains `setShelfGeometry({ width, position })` (normalized in `.cjs`, mirror-style); a change applies on the NEXT show — never mid-display, a panel that jumps while open reads as a glitch. `position: 'center'` keeps today's math untouched; `'top-center'` sets y to `workArea.y + 24`.
- The 620px measurement rule: `scripts/measure-shelf.cjs` runs at 620 — note in the task that narrow/wide must keep the card's two-line height ceiling (the `WIDTH` comment at the top of `assistantWindow.cjs` explains why); verify by running that script at 520 and 760 if it accepts a width, otherwise eyeball via the harness and say so in the commit body.

- [ ] **Steps 1–5:** TDD on the controller's geometry application and shellIpc validation; commit — `feat(app): the shelf takes a width and a place`

---

### Task 13: shelf content — density and sections

**Files:**
- Modify: `PhaseApp/src/components/assistant/AssistantHost.tsx` (model gains `shelfPrefs`, as `theme` already rides it), `PhaseApp/src/components/assistant/AssistantSurface.tsx`, `PhaseApp/src/assistant/embeddedHarness.tsx` if the model type lives there
- Create: `PhaseApp/src/components/ShelfSettings.tsx`; Modify: `PhaseApp/src/components/SettingsModal.tsx` (heading `Shelf`)
- Test: `PhaseApp/src/components/assistant/AssistantSurface.test.tsx`, `PhaseApp/src/components/ShelfSettings.test.tsx`

**Interfaces:**
- `AssistantSurface` props gain `density?: 'compact' | 'comfortable'` (default comfortable) and `sections?: ShelfPrefs['sections']`. Density compresses the band paddings one step in the existing cls helpers (`aboveBandCls`, `altBandCls`, `bandCls`, `dialStripClass`) — compact variants live IN those helpers, not scattered ternaries. `sections.alternatives: false` skips the `AlternativesBand`; `sections.dials: false` skips the `DialStrip`. The work band always renders.
- `ShelfSettings.tsx`: `SegmentedControl`s for width / density / position, switches for the two sections; reads `shelfPrefs` from the store, dispatches `actions.setShelfPrefs` (geometry reaches main via the App push from Task 12).
- After the surface change, run the shelf measurement memory-rule: the surface's height budget comments (two-line ceiling) still hold in compact.

- [ ] **Steps 1–5:** TDD (surface renders/hides bands per prefs; density switches the cls outputs; settings component dispatches), commit — `feat(app): the shelf, tuned — density, and only the bands you use`

---

### Task 14: full verification

- [ ] `cd PhaseApp && npm test` — everything green.
- [ ] `npx tsc -b` — clean.
- [ ] `npm run build` — clean.
- [ ] Smoke the real flows if a display is available (`npm run app:dev`): start a pomodoro from the shelf, watch the pill count down, click the pill → Today, flip every new Settings control once. If no display, say so in the final report rather than claiming it.
- [ ] Commit anything outstanding; do NOT push.

## Failure-mode notes for the implementer

- **Two renderers, one store owner.** The shelf window renderer does not own the store. Anything the shelf must KNOW rides the relay model from `AssistantHost`; anything the shelf must DO goes back as an `AssistantAction`. Do not import store state into `src/assistant/` pages directly.
- **`main.cjs` composition only.** New Electron capabilities (`Notification`, `nativeTheme`) are imported in `main.cjs` and injected as functions — never required inside the deep modules.
- **Renames sweep tests.** Retiring `setOverlayEnabled`/`OVERLAY_ENABLED_CHANNEL` and the glyph button touches `shellBridge.test.ts:74`, `shellIpc.test.ts`, `App.test.ts` — update them in the same task, never delete assertions to get green.
- **`normalizeFocusStatus` is the gate.** A cycle that fails validation there must drop the FIELD, not the snapshot — a running session must never vanish from the tray because one number was odd.
