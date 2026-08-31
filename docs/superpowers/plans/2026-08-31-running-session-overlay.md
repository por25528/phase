# Running-Session Overlay Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tiny always-on-top floating pill that shows `▶ 23m · <task>` while a Phase session runs, for users who hide the macOS menu bar.

**Architecture:** A new deep module `electron/overlayWindow.cjs` shaped exactly like `electron/menuBar.cjs` — every Electron capability injected from the `main.cjs` composition root, observes-and-never-writes, failure is a nicety. It becomes the third consumer of the existing `publishFocusStatus` fanout. The pill page is a dumb static HTML file: main computes the pill text (arithmetic over the snapshot, floor minutes, one repaint a minute) and pushes a render model; the page only paints it.

**Tech Stack:** Electron (main-process CJS modules), Vitest, React 19 + TypeScript (renderer settings toggle), Dexie (`settings` table).

**Spec:** `docs/superpowers/specs/2026-08-31-running-session-overlay-design.md` — read it first.

## Global Constraints

- All commands run from `PhaseApp/` (`npm test`, `npx tsc -b`, `npm run build`).
- `electron/*.cjs` modules import NOTHING from `src/` and nothing from `electron` itself except in `main.cjs`, `preload.cjs`, and `overlayPreload.cjs` (preloads may require `electron`). Types live in a sibling `.d.cts` that mirrors shapes structurally (see `menuBar.d.cts`).
- Tests for electron modules load the `.cjs` via `createRequire` exactly as `menuBar.test.ts` does.
- The overlay is a nicety, never a requirement: any creation failure is caught, logged once with prefix `[phase-shell] overlay unavailable`, and everything else keeps working.
- Main observes; the renderer is the only writer. No new write paths.
- Fixed IPC channels only, sender-validated. New channels: `phase-overlay:model` (main→overlay page), `phase-overlay:open-phase` (overlay page→main), `phase-shell:overlay-enabled` (renderer→main).
- Whole minutes, FLOOR not round, matching `trayTitle`.
- Commit after each task with a message in the repo's style (see `git log`).

---

### Task 1: `overlayWindow.cjs` pure helpers — pill model and position math

**Files:**
- Create: `PhaseApp/electron/overlayWindow.cjs`
- Create: `PhaseApp/electron/overlayWindow.d.cts`
- Test: `PhaseApp/electron/overlayWindow.test.ts`

**Interfaces:**
- Produces: `pillModel(status, nowMs)` → `{ glyph: '▶'|'⏸', text: string } | null`; `clampToWorkArea(point, workArea)`; `defaultPosition(workArea)`; constants `REPAINT_MS`, `OVERLAY_WIDTH` (240), `OVERLAY_HEIGHT` (36). Task 2 builds `createOverlayWindow` in this same file.

- [ ] **Step 1: Write the failing tests**

```ts
// PhaseApp/electron/overlayWindow.test.ts
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const {
  createOverlayWindow, pillModel, clampToWorkArea, defaultPosition,
  REPAINT_MS, OVERLAY_WIDTH, OVERLAY_HEIGHT,
} = nativeRequire('./overlayWindow.cjs') as typeof import('./overlayWindow.cjs');

type FocusStatus = Parameters<ReturnType<typeof createOverlayWindow>['setFocusStatus']>[0];

const MIN = 60_000;
const T0 = 1_700_000_000_000;

const active = (over: Partial<NonNullable<FocusStatus>> = {}): NonNullable<FocusStatus> => ({
  phase: 'active', activeSinceMs: T0, accumulatedMs: 0, title: 'Problem set 4', ...over,
});

describe('pillModel', () => {
  it('floors active minutes and carries the title', () => {
    expect(pillModel(active(), T0 + 90_000)).toEqual({ glyph: '▶', text: '1m · Problem set 4' });
  });

  it('banks accumulated time on top of the live stretch', () => {
    expect(pillModel(active({ accumulatedMs: 10 * MIN }), T0 + MIN))
      .toEqual({ glyph: '▶', text: '11m · Problem set 4' });
  });

  it('reads a backwards clock as zero extra', () => {
    expect(pillModel(active(), T0 - MIN)).toEqual({ glyph: '▶', text: '0m · Problem set 4' });
  });

  it('says on break without a clock', () => {
    expect(pillModel(active({ phase: 'break', activeSinceMs: null }), T0))
      .toEqual({ glyph: '⏸', text: 'on break' });
  });

  it('is null while confirming and null with no session', () => {
    expect(pillModel(active({ phase: 'confirming', activeSinceMs: null }), T0)).toBeNull();
    expect(pillModel(null, T0)).toBeNull();
  });
});

describe('position math', () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };

  it('defaults to the top-right corner with a 16px margin', () => {
    expect(defaultPosition(workArea)).toEqual({ x: 1440 - OVERLAY_WIDTH - 16, y: 25 + 16 });
  });

  it('clamps a stored point back inside the work area', () => {
    expect(clampToWorkArea({ x: 5000, y: -50 }, workArea))
      .toEqual({ x: 1440 - OVERLAY_WIDTH, y: 25 });
    expect(clampToWorkArea({ x: -300, y: 9000 }, workArea))
      .toEqual({ x: 0, y: 25 + 875 - OVERLAY_HEIGHT });
  });

  it('passes an in-bounds point through untouched', () => {
    expect(clampToWorkArea({ x: 100, y: 100 }, workArea)).toEqual({ x: 100, y: 100 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd PhaseApp && npx vitest run electron/overlayWindow.test.ts`
Expected: FAIL — cannot find module `./overlayWindow.cjs`.

- [ ] **Step 3: Write the helpers**

```js
// PhaseApp/electron/overlayWindow.cjs
// The floating running-session pill, as a deep module — the menu-bar timer's
// sibling for people who hide the menu bar. Every Electron capability is
// injected from the main.cjs composition root, so show/hide policy, the text,
// the repaint, and the position rules are unit-testable without Electron.
//
// It observes and never writes: the snapshot arrives on a transition, the
// text is arithmetic at read time, and the page is dumb — main pushes a
// rendered model, the page paints it. An overlay is a nicety, never a
// requirement: any failure in creation is caught, the partial window
// destroyed, one log line emitted, and the Hub, shelf, and menu bar carry on.

// Same floor rule as trayTitle in menuBar.cjs: a timer that reads 1m after
// thirty seconds is claiming a minute that has not happened.
const MS_PER_MIN = 60_000;
const REPAINT_MS = 60_000;

// Fixed footprint: the title truncates with an ellipsis inside the page
// rather than resizing the window.
const OVERLAY_WIDTH = 240;
const OVERLAY_HEIGHT = 36;
const MARGIN = 16;

// A drag emits a stream of `moved` events; one write after the hand lifts.
const SAVE_DEBOUNCE_MS = 500;

/** Elapsed active milliseconds, clamped so a backwards clock reports nothing extra. */
function elapsedMs(status, nowMs) {
  const stretch = status.activeSinceMs === null
    ? 0
    : Math.max(0, nowMs - status.activeSinceMs);
  return status.accumulatedMs + stretch;
}

/**
 * What the pill shows, and when it shows nothing. Null means HIDDEN — outside
 * a session the pill's absence is the whole signal, and `confirming` belongs
 * to the shelf, exactly as trayTitle rules for the menu bar.
 */
function pillModel(status, nowMs) {
  if (!status) return null;
  if (status.phase === 'active') {
    return { glyph: '▶', text: `${Math.floor(elapsedMs(status, nowMs) / MS_PER_MIN)}m · ${status.title}` };
  }
  if (status.phase === 'break') return { glyph: '⏸', text: 'on break' };
  return null;
}

/** A stored point pulled back inside the given work area, so an unplugged monitor can never strand the pill. */
function clampToWorkArea(point, workArea) {
  return {
    x: Math.min(Math.max(point.x, workArea.x), workArea.x + workArea.width - OVERLAY_WIDTH),
    y: Math.min(Math.max(point.y, workArea.y), workArea.y + workArea.height - OVERLAY_HEIGHT),
  };
}

/** Top-right of the work area — nearest to where the hidden menu bar's clock would be. */
function defaultPosition(workArea) {
  return { x: workArea.x + workArea.width - OVERLAY_WIDTH - MARGIN, y: workArea.y + MARGIN };
}

function createOverlayWindow(deps) {
  // Task 2 fills this in.
  throw new Error('not implemented');
}

module.exports = {
  createOverlayWindow, pillModel, clampToWorkArea, defaultPosition,
  REPAINT_MS, OVERLAY_WIDTH, OVERLAY_HEIGHT,
};
```

```ts
// PhaseApp/electron/overlayWindow.d.cts
// Deliberately imports nothing from `electron`: main.cjs stays the only
// composition root that may know BrowserWindow and screen. The controller
// sees window handles only through injected capabilities, whose types are
// the narrowest truth this module needs.

/** Structurally FocusStatusSnapshot from src/lib/focusStatus.ts — mirrored, never imported (see menuBar.d.cts). */
export interface OverlayFocusStatus {
  phase: 'active' | 'break' | 'confirming';
  activeSinceMs: number | null;
  accumulatedMs: number;
  title: string;
}

export interface OverlayPillModel {
  glyph: '▶' | '⏸';
  text: string;
}

export interface OverlayPoint { x: number; y: number }
export interface OverlayWorkArea { x: number; y: number; width: number; height: number }

export interface OverlayWebContents {
  readonly id: number;
  send(channel: string, model: OverlayPillModel): void;
  on(event: 'did-finish-load', fn: () => void): void;
}

/** Minimal BrowserWindow shape; never BrowserWindow itself. */
export interface OverlayNativeWindow {
  isDestroyed(): boolean;
  showInactive(): void;
  hide(): void;
  destroy(): void;
  setAlwaysOnTop(flag: boolean, level: 'status'): void;
  setVisibleOnAllWorkspaces(visible: boolean, options: { visibleOnFullScreen: boolean }): void;
  getPosition(): number[];
  on(event: 'moved', fn: () => void): void;
  loadFile(htmlPath: string): Promise<void>;
  webContents: OverlayWebContents;
}

export interface OverlayWindowOptions {
  x: number; y: number; width: number; height: number;
  frame: false; transparent: true; resizable: false; hasShadow: false;
  focusable: false; skipTaskbar: true; alwaysOnTop: true; show: false;
  webPreferences: { preload: string; contextIsolation: true; sandbox: true };
}

export interface OverlayWindowDeps {
  createWindow(options: OverlayWindowOptions): OverlayNativeWindow;
  htmlPath: string;
  preloadPath: string;
  getPrimaryWorkArea(): OverlayWorkArea;
  /** Work area of the display nearest the given point. */
  workAreaNearest(point: OverlayPoint): OverlayWorkArea;
  /** Last saved position, or null when none or unreadable. */
  readPosition(): OverlayPoint | null;
  writePosition(point: OverlayPoint): void;
  now(): number;
  /** One-shot; returns the cancel. Re-armed by the repaint itself. */
  setTimer(fn: () => void, ms: number): () => void;
  logError(message: string, error?: unknown): void;
}

export interface OverlayWindow {
  create(): void;
  dispose(): void;
  /** Adopt the renderer's latest snapshot. Dropped when no window came up. */
  setFocusStatus(status: OverlayFocusStatus | null): void;
  /** Settings toggle; false hides regardless of snapshot, true re-evaluates it. */
  setEnabled(enabled: boolean): void;
  /** Whether the given webContents id is this overlay's page. */
  isSender(webContentsId: number): boolean;
}

export declare function createOverlayWindow(deps: OverlayWindowDeps): OverlayWindow;
export declare function pillModel(status: OverlayFocusStatus | null, nowMs: number): OverlayPillModel | null;
export declare function clampToWorkArea(point: OverlayPoint, workArea: OverlayWorkArea): OverlayPoint;
export declare function defaultPosition(workArea: OverlayWorkArea): OverlayPoint;
export declare const REPAINT_MS: number;
export declare const OVERLAY_WIDTH: number;
export declare const OVERLAY_HEIGHT: number;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd PhaseApp && npx vitest run electron/overlayWindow.test.ts`
Expected: PASS (all `pillModel` and position tests).

- [ ] **Step 5: Commit**

```bash
git add PhaseApp/electron/overlayWindow.cjs PhaseApp/electron/overlayWindow.d.cts PhaseApp/electron/overlayWindow.test.ts
git commit -m "feat(app): what the overlay pill says, and where it sits"
```

---

### Task 2: `createOverlayWindow` controller — show/hide, repaint, drag, failure isolation

**Files:**
- Modify: `PhaseApp/electron/overlayWindow.cjs` (replace the `createOverlayWindow` stub)
- Test: `PhaseApp/electron/overlayWindow.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's helpers.
- Produces: `createOverlayWindow(deps)` per `overlayWindow.d.cts` above — Task 4 wires it in `main.cjs`.

- [ ] **Step 1: Write the failing tests** (append to `overlayWindow.test.ts`)

```ts
function overlayWindow(over: {
  createWindowThrows?: boolean;
  loadFileRejects?: boolean;
  storedPosition?: { x: number; y: number } | null;
} = {}) {
  const listeners: Record<string, () => void> = {};
  const win = {
    isDestroyed: vi.fn(() => false),
    showInactive: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    getPosition: vi.fn(() => [300, 200]),
    on: vi.fn((event: string, fn: () => void) => { listeners[event] = fn; }),
    loadFile: vi.fn(() =>
      over.loadFileRejects ? Promise.reject(new Error('load failed')) : Promise.resolve()),
    webContents: {
      id: 77,
      send: vi.fn(),
      on: vi.fn((event: string, fn: () => void) => { listeners[event] = fn; }),
    },
  };
  const createWindow = vi.fn(() => {
    if (over.createWindowThrows) throw new Error('window creation failed');
    return win;
  });
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const setTimer = vi.fn((fn: () => void, ms: number) => {
    const entry = { fn, ms, cancelled: false };
    timers.push(entry);
    return () => { entry.cancelled = true; };
  });
  let nowMs = T0;
  const deps = {
    createWindow,
    htmlPath: '/app/electron/assets/overlay.html',
    preloadPath: '/app/electron/overlayPreload.cjs',
    getPrimaryWorkArea: vi.fn(() => ({ x: 0, y: 25, width: 1440, height: 875 })),
    workAreaNearest: vi.fn(() => ({ x: 0, y: 25, width: 1440, height: 875 })),
    readPosition: vi.fn(() => over.storedPosition ?? null),
    writePosition: vi.fn(),
    now: () => nowMs,
    setTimer,
    logError: vi.fn(),
  };
  const overlay = createOverlayWindow(deps);
  return {
    overlay, win, deps, timers, listeners,
    advance(ms: number) { nowMs += ms; },
    /** Run every pending un-cancelled timer once, as time passing would. */
    fire() { for (const t of timers.splice(0)) if (!t.cancelled) t.fn(); },
    lastSent() { return win.webContents.send.mock.calls.at(-1); },
  };
}

describe('createOverlayWindow', () => {
  it('creates hidden at the default corner when nothing is stored', () => {
    const { overlay, deps } = overlayWindow();
    overlay.create();
    const options = (deps.createWindow.mock.calls[0] as unknown[])[0] as { x: number; y: number; show: boolean };
    expect(options.x).toBe(1440 - OVERLAY_WIDTH - 16);
    expect(options.y).toBe(25 + 16);
    expect(options.show).toBe(false);
  });

  it('creates at the stored position, clamped to its nearest display', () => {
    const { overlay, deps } = overlayWindow({ storedPosition: { x: 5000, y: 100 } });
    overlay.create();
    const options = (deps.createWindow.mock.calls[0] as unknown[])[0] as { x: number; y: number };
    expect(options.x).toBe(1440 - OVERLAY_WIDTH);
    expect(options.y).toBe(100);
  });

  it('pins the window above everything, on every Space', () => {
    const { overlay, win } = overlayWindow();
    overlay.create();
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'status');
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true });
  });

  it('shows without focus and sends the model on an active snapshot', () => {
    const { overlay, win, lastSent } = overlayWindow();
    overlay.create();
    overlay.setFocusStatus(active());
    expect(lastSent()).toEqual(['phase-overlay:model', { glyph: '▶', text: '0m · Problem set 4' }]);
    expect(win.showInactive).toHaveBeenCalled();
  });

  it('repaints a minute later with the next floor minute', () => {
    const { overlay, advance, fire, lastSent } = overlayWindow();
    overlay.create();
    overlay.setFocusStatus(active());
    advance(REPAINT_MS);
    fire();
    expect(lastSent()).toEqual(['phase-overlay:model', { glyph: '▶', text: '1m · Problem set 4' }]);
  });

  it('shows a static break and schedules no repaint for it', () => {
    const { overlay, timers, lastSent } = overlayWindow();
    overlay.create();
    overlay.setFocusStatus(active({ phase: 'break', activeSinceMs: null }));
    expect(lastSent()).toEqual(['phase-overlay:model', { glyph: '⏸', text: 'on break' }]);
    expect(timers.filter((t) => !t.cancelled)).toHaveLength(0);
  });

  it('hides while confirming and when the session ends', () => {
    const { overlay, win } = overlayWindow();
    overlay.create();
    overlay.setFocusStatus(active());
    overlay.setFocusStatus(active({ phase: 'confirming', activeSinceMs: null }));
    expect(win.hide).toHaveBeenCalledTimes(1);
    overlay.setFocusStatus(null);
    expect(win.hide).toHaveBeenCalledTimes(2);
  });

  it('setEnabled(false) hides a running pill; setEnabled(true) re-shows from the remembered snapshot', () => {
    const { overlay, win } = overlayWindow();
    overlay.create();
    overlay.setFocusStatus(active());
    overlay.setEnabled(false);
    expect(win.hide).toHaveBeenCalled();
    win.showInactive.mockClear();
    overlay.setEnabled(true);
    expect(win.showInactive).toHaveBeenCalled();
  });

  it('repaints after did-finish-load so a snapshot never races the page', () => {
    const { overlay, listeners, win } = overlayWindow();
    overlay.create();
    overlay.setFocusStatus(active());
    win.webContents.send.mockClear();
    listeners['did-finish-load']();
    expect(win.webContents.send).toHaveBeenCalledWith(
      'phase-overlay:model', { glyph: '▶', text: '0m · Problem set 4' });
  });

  it('debounces the drag into one position write', () => {
    const { overlay, deps, listeners, fire } = overlayWindow();
    overlay.create();
    listeners['moved']();
    listeners['moved']();
    expect(deps.writePosition).not.toHaveBeenCalled();
    fire();
    expect(deps.writePosition).toHaveBeenCalledTimes(1);
    expect(deps.writePosition).toHaveBeenCalledWith({ x: 300, y: 200 });
  });

  it('a failed creation logs once and every later call is a no-op', () => {
    const { overlay, deps } = overlayWindow({ createWindowThrows: true });
    overlay.create();
    expect(deps.logError).toHaveBeenCalledTimes(1);
    expect(() => overlay.setFocusStatus(active())).not.toThrow();
    expect(() => overlay.setEnabled(false)).not.toThrow();
    expect(overlay.isSender(77)).toBe(false);
  });

  it('a failed page load tears the window down rather than floating an empty rect', async () => {
    const { overlay, win, deps } = overlayWindow({ loadFileRejects: true });
    overlay.create();
    await Promise.resolve();
    await Promise.resolve();
    expect(win.destroy).toHaveBeenCalled();
    expect(deps.logError).toHaveBeenCalledTimes(1);
    expect(() => overlay.setFocusStatus(active())).not.toThrow();
  });

  it('knows its own page and nobody else', () => {
    const { overlay } = overlayWindow();
    overlay.create();
    expect(overlay.isSender(77)).toBe(true);
    expect(overlay.isSender(78)).toBe(false);
  });

  it('dispose cancels the repaint and destroys the window', () => {
    const { overlay, win, timers } = overlayWindow();
    overlay.create();
    overlay.setFocusStatus(active());
    overlay.dispose();
    expect(win.destroy).toHaveBeenCalled();
    expect(timers.every((t) => t.cancelled)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd PhaseApp && npx vitest run electron/overlayWindow.test.ts`
Expected: Task 1 tests PASS; every `createOverlayWindow` test FAILS with "not implemented".

- [ ] **Step 3: Implement the controller** (replace the stub in `overlayWindow.cjs`)

```js
function createOverlayWindow(deps) {
  const {
    createWindow, htmlPath, preloadPath,
    getPrimaryWorkArea, workAreaNearest,
    readPosition, writePosition,
    now, setTimer, logError,
  } = deps;

  let win = null;
  /** The last snapshot the renderer published, or null for "no session". */
  let status = null;
  /** The Settings toggle; hidden-regardless when false. */
  let enabled = true;
  let stopRepaint = null;
  let stopSaveDebounce = null;

  function cancel(stop) {
    if (!stop) return null;
    try { stop(); } catch { /* timer already gone */ }
    return null;
  }

  function live() {
    return win && !win.isDestroyed() ? win : null;
  }

  /** Tear down after a failure; the overlay is a nicety, never a requirement. */
  function teardown(error) {
    if (win) {
      try { win.destroy(); } catch { /* already gone */ }
      win = null;
    }
    stopRepaint = cancel(stopRepaint);
    stopSaveDebounce = cancel(stopSaveDebounce);
    logError('[phase-shell] overlay unavailable', error);
  }

  /**
   * One place decides visibility and text. Hidden is a real answer: outside a
   * session, and while the shelf asks its question, the pill's absence is the
   * signal — same rule as trayTitle.
   */
  function paint() {
    const w = live();
    if (!w) return;
    const model = enabled ? pillModel(status, now()) : null;
    stopRepaint = cancel(stopRepaint);
    if (!model) {
      w.hide();
      return;
    }
    w.webContents.send('phase-overlay:model', model);
    w.showInactive();
    if (status && status.phase === 'active') {
      stopRepaint = setTimer(() => {
        stopRepaint = null;
        paint();
      }, REPAINT_MS);
    }
  }

  function scheduleSave() {
    stopSaveDebounce = cancel(stopSaveDebounce);
    stopSaveDebounce = setTimer(() => {
      stopSaveDebounce = null;
      const w = live();
      if (!w) return;
      const [x, y] = w.getPosition();
      writePosition({ x, y });
    }, SAVE_DEBOUNCE_MS);
  }

  function create() {
    if (win) return;
    try {
      const stored = readPosition();
      const position = stored
        ? clampToWorkArea(stored, workAreaNearest(stored))
        : defaultPosition(getPrimaryWorkArea());
      const w = createWindow({
        x: position.x, y: position.y,
        width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT,
        frame: false, transparent: true, resizable: false, hasShadow: false,
        focusable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
        webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true },
      });
      win = w;
      w.setAlwaysOnTop(true, 'status');
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      w.on('moved', scheduleSave);
      // A snapshot can arrive while the page still loads; repaint on load so
      // the first thing the page hears is the current truth.
      w.webContents.on('did-finish-load', paint);
      w.loadFile(htmlPath).catch((error) => teardown(error));
    } catch (error) {
      teardown(error);
    }
  }

  function setFocusStatus(next) {
    if (!live()) return;
    status = next ?? null;
    paint();
  }

  function setEnabled(next) {
    enabled = next === true;
    if (live()) paint();
  }

  function isSender(webContentsId) {
    const w = live();
    return !!w && w.webContents.id === webContentsId;
  }

  function dispose() {
    stopRepaint = cancel(stopRepaint);
    stopSaveDebounce = cancel(stopSaveDebounce);
    if (win) {
      try { win.destroy(); } catch { /* already gone */ }
      win = null;
    }
  }

  return { create, dispose, setFocusStatus, setEnabled, isSender };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd PhaseApp && npx vitest run electron/overlayWindow.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add PhaseApp/electron/overlayWindow.cjs PhaseApp/electron/overlayWindow.test.ts
git commit -m "feat(app): the overlay pill's controller — show, repaint, drag, fail quietly"
```

---

### Task 3: The pill page and its preload

**Files:**
- Create: `PhaseApp/electron/assets/overlay.html`
- Create: `PhaseApp/electron/overlayPreload.cjs`

**Interfaces:**
- Consumes: `phase-overlay:model` pushes from Task 2.
- Produces: `phase-overlay:open-phase` sends, handled in Task 4. Page exposes nothing else.

No unit tests: the page is deliberately dumb (paint what arrives), and the repo's electron tests do not run a DOM for main-process pages. Verification is manual in Task 6.

- [ ] **Step 1: Write the preload**

```js
// PhaseApp/electron/overlayPreload.cjs
// The pill page's ONLY door, and the narrowest preload in the app: hear the
// rendered model, ask for Phase. Fixed channels, no channel names accepted,
// nothing else crosses — the page cannot see the snapshot, only the string
// main already decided to show.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('phaseOverlay', {
  /** Fires with { glyph, text } to paint. Returns unsubscribe. */
  onModel: (fn) => {
    const listener = (_event, model) => fn(model);
    ipcRenderer.on('phase-overlay:model', listener);
    return () => ipcRenderer.removeListener('phase-overlay:model', listener);
  },
  /** Ask the shell to raise the Hub. Fire-and-forget. */
  openPhase: () => ipcRenderer.send('phase-overlay:open-phase'),
});
```

- [ ] **Step 2: Write the page**

```html
<!-- PhaseApp/electron/assets/overlay.html -->
<!-- The running-session pill. Deliberately dumb: main computes the text and
     pushes { glyph, text }; this page paints it and nothing else. Colors are
     hardcoded because a static file cannot import theme tokens — the pill
     mirrors the app's dark panel (bg-panel dark) and ink. -->
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html, body { margin: 0; background: transparent; overflow: hidden; user-select: none; }
  /* The whole pill drags; the glyph opts back out below to stay clickable. */
  #pill {
    display: none; align-items: center; gap: 8px;
    height: 36px; box-sizing: border-box; padding: 0 14px 0 8px;
    border-radius: 18px;
    background: rgba(28, 27, 26, 0.92);
    color: #f5f2ec;
    font: 500 13px -apple-system, BlinkMacSystemFont, sans-serif;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
    -webkit-app-region: drag;
  }
  #pill.shown { display: flex; }
  #glyph {
    -webkit-app-region: no-drag; cursor: pointer;
    border: none; background: none; color: inherit;
    font-size: 12px; line-height: 1; padding: 6px;
  }
  #text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
</head>
<body>
  <div id="pill" title="Drag to move · click the glyph to open Phase">
    <button id="glyph" aria-label="Open Phase"></button>
    <span id="text"></span>
  </div>
  <script>
    const pill = document.getElementById('pill');
    const glyph = document.getElementById('glyph');
    const text = document.getElementById('text');
    glyph.addEventListener('click', () => window.phaseOverlay.openPhase());
    window.phaseOverlay.onModel((model) => {
      glyph.textContent = model.glyph;
      text.textContent = model.text;
      pill.classList.add('shown');
    });
  </script>
</body>
</html>
```

- [ ] **Step 3: Confirm packaging picks both up**

`scripts/releaseConfig.cjs` already ships `files: ['dist/**/*', 'electron/**/*']`, which covers `electron/assets/overlay.html` and `electron/overlayPreload.cjs`. Nothing to change — just confirm that line still reads so.

- [ ] **Step 4: Commit**

```bash
git add PhaseApp/electron/assets/overlay.html PhaseApp/electron/overlayPreload.cjs
git commit -m "feat(app): the pill page — a dumb surface main paints"
```

---

### Task 4: Wire the overlay into `main.cjs` and `shellIpc.cjs`

**Files:**
- Modify: `PhaseApp/electron/main.cjs`
- Modify: `PhaseApp/electron/shellIpc.cjs`
- Modify: `PhaseApp/electron/shellIpc.d.cts`
- Test: `PhaseApp/electron/shellIpc.test.ts` (append)

**Interfaces:**
- Consumes: `createOverlayWindow` (Task 2), `overlay.html` + `overlayPreload.cjs` (Task 3).
- Produces: `phase-shell:overlay-enabled` listener with dep `onOverlayEnabled(enabled: boolean)`; the renderer half lands in Task 5.

- [ ] **Step 1: Write the failing shellIpc tests**

Open `PhaseApp/electron/shellIpc.test.ts`, copy the existing pattern for `phase-shell:focus-status` (fake ipcMain, sender-id checks), and append a describe block:

```ts
describe('overlay-enabled', () => {
  it('forwards a boolean from the main window to onOverlayEnabled', () => {
    // Build the harness exactly as the focus-status tests do, with an
    // onOverlayEnabled: vi.fn() dep, then emit on 'phase-shell:overlay-enabled'
    // with the main sender and payload false.
    // Expect onOverlayEnabled to be called once with false.
  });

  it('refuses a non-boolean and a foreign sender', () => {
    // Emit with the main sender and payload 'yes' → not called.
    // Emit with a non-main sender id and payload true → not called.
  });

  it('registers and disposes the channel symmetrically', () => {
    // After register(): the fake ipcMain saw an `on` for
    // 'phase-shell:overlay-enabled'. After dispose(): removeAllListeners was
    // called for it — same assertions the focus-status channel makes.
  });
});
```

Write these as REAL tests against the file's existing fakes (the harness already exists in that file — reuse it; the comments above describe intent, the assertions must be executable).

- [ ] **Step 2: Run to verify they fail**

Run: `cd PhaseApp && npx vitest run electron/shellIpc.test.ts`
Expected: new tests FAIL (`onOverlayEnabled` dep unknown / channel not registered).

- [ ] **Step 3: Implement in `shellIpc.cjs`**

Add beside the other channel constants:

```js
const OVERLAY_ENABLED_CHANNEL = `${SHELL_CHANNEL_PREFIX}:overlay-enabled`;
```

Add `onOverlayEnabled` to the destructured deps in `createShellIpc`. Add the handler beside `onFocusStatusMessage`:

```js
function onOverlayEnabledMessage(event, enabled) {
  if (!isMainSender(event)) return;
  if (typeof enabled !== 'boolean') return;
  onOverlayEnabled(enabled);
}
```

In `register`: `ipcMain.on(OVERLAY_ENABLED_CHANNEL, onOverlayEnabledMessage);`
In `dispose`: `ipcMain.removeAllListeners(OVERLAY_ENABLED_CHANNEL);`

In `shellIpc.d.cts`, add to the deps interface:

```ts
/** The Settings toggle for the floating pill, forwarded to the overlay window. */
onOverlayEnabled(enabled: boolean): void;
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd PhaseApp && npx vitest run electron/shellIpc.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `main.cjs`**

All edits follow the menuBar wiring, in the same places:

1. Top of file, beside the other module requires: `const { createOverlayWindow } = require('./overlayWindow.cjs')`. Add `const fs = require('node:fs')` if not already required.
2. Beside `let menuBar = null`: `let overlay = null`.
3. `publishFocusStatus` gains the third consumer:

```js
function publishFocusStatus(status) {
  menuBar?.setFocusStatus(status)
  idleWatch.setFocusStatus(status)
  overlay?.setFocusStatus(status)
}
```

4. Position persistence, near the other small helpers:

```js
// Where the pill last sat. userData, not the store: a window position is a
// device fact, exactly as the assistant accelerator is.
function overlayPositionFile() {
  return path.join(app.getPath('userData'), 'overlay-position.json')
}

function readOverlayPosition() {
  try {
    const parsed = JSON.parse(fs.readFileSync(overlayPositionFile(), 'utf8'))
    if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y }
    }
  } catch { /* absent or malformed reads as "never saved" */ }
  return null
}

function writeOverlayPosition(point) {
  try {
    fs.writeFileSync(overlayPositionFile(), JSON.stringify(point))
  } catch (error) {
    console.error('[phase-shell] overlay position not saved', error)
  }
}
```

5. In the `createShellIpc({...})` deps, add:

```js
onOverlayEnabled: (enabled) => overlay?.setEnabled(enabled),
```

6. After `menuBar.create()` (around line 549), create the overlay:

```js
  // The overlay pill is the menu-bar timer's sibling for hidden menu bars,
  // and the same rule holds: a nicety, never a requirement — createOverlayWindow
  // catches its own failures and everything else keeps working.
  overlay = createOverlayWindow({
    createWindow: (options) => new BrowserWindow(options),
    htmlPath: path.join(__dirname, 'assets', 'overlay.html'),
    preloadPath: path.join(__dirname, 'overlayPreload.cjs'),
    getPrimaryWorkArea: () => screen.getPrimaryDisplay().workArea,
    workAreaNearest: (point) => screen.getDisplayNearestPoint(point).workArea,
    readPosition: readOverlayPosition,
    writePosition: writeOverlayPosition,
    now: () => Date.now(),
    setTimer: (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id) },
    logError: (...args) => console.error(...args),
  })
  overlay.create()

  // The pill's one verb. Sender-validated against the overlay's own page —
  // the same exact-id discipline shellIpc applies to the main window.
  ipcMain.on('phase-overlay:open-phase', (event) => {
    if (overlay?.isSender(event.sender.id)) openPhase()
  })
```

7. In the shutdown path where `menuBar.dispose()` runs (~line 133) add `overlay?.dispose()`; where `menuBar = null` (~line 152) add `overlay = null`. Also `ipcMain.removeAllListeners('phase-overlay:open-phase')` beside the other channel cleanup there.

- [ ] **Step 6: Run the whole electron suite and the typecheck**

Run: `cd PhaseApp && npx vitest run electron/ && npx tsc -b`
Expected: PASS / clean. If a test pins the full channel list or preload surface (e.g. `assistantIpc.test.ts` reads `preload.cjs`), it should still pass — the renderer preload changes land in Task 5.

- [ ] **Step 7: Commit**

```bash
git add PhaseApp/electron/main.cjs PhaseApp/electron/shellIpc.cjs PhaseApp/electron/shellIpc.d.cts PhaseApp/electron/shellIpc.test.ts
git commit -m "feat(app): the overlay joins the focus-status fanout"
```

---

### Task 5: Renderer — the Settings toggle and the startup push

**Files:**
- Modify: `PhaseApp/src/db/db.ts` (two helpers beside `loadAssistantAccelerator`)
- Modify: `PhaseApp/src/lib/shellBridge.ts` (one verb)
- Modify: `PhaseApp/electron/preload.cjs` (`phaseShell` gains `setOverlayEnabled`)
- Create: `PhaseApp/src/components/assistant/OverlaySettings.tsx`
- Modify: `PhaseApp/src/components/SettingsModal.tsx` (render the row under `<LaunchAtLoginSettings />`)
- Modify: `PhaseApp/src/App.tsx` (startup push)
- Test: `PhaseApp/src/lib/shellBridge.test.ts` (append), plus whichever test pins the `phaseShell` preload surface (`assistantIpc.test.ts` — update its expected verb list)

**Interfaces:**
- Consumes: `phase-shell:overlay-enabled` (Task 4).
- Produces: `PhaseShellBridge.setOverlayEnabled(enabled: boolean): void`; db helpers `loadShowOverlay(): Promise<boolean>` / `saveShowOverlay(value: boolean): Promise<void>`.

- [ ] **Step 1: Write the failing bridge test** (append to `src/lib/shellBridge.test.ts`, following its existing stub/available cases)

```ts
it('setOverlayEnabled is a guarded no-op in the browser and forwards on desktop', () => {
  // Browser: shellBridge() with no window.phaseShell → calling
  // bridge.setOverlayEnabled(true) does not throw.
  // Desktop: install a fake window.phaseShell WITHOUT setOverlayEnabled
  // (an older preload) → still does not throw.
  // Desktop with the verb: a vi.fn() → called once with false.
});
```

Write it as real executable assertions in that file's existing style (it already fakes `window.phaseShell`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd PhaseApp && npx vitest run src/lib/shellBridge.test.ts`
Expected: FAIL — `setOverlayEnabled` is not a function.

- [ ] **Step 3: Implement bridge + preload + db helpers**

`src/lib/shellBridge.ts` — add to `PhaseShellBridge`:

```ts
/**
 * Tell the shell whether the floating pill may show. Fire-and-forget and a
 * no-op in the browser, for the same reason publishFocusStatus is.
 */
setOverlayEnabled(enabled: boolean): void;
```

Add to `ShellPreload`:

```ts
/** Absent on any preload built before the overlay pill existed. */
setOverlayEnabled?(enabled: boolean): void;
```

Stub branch: `setOverlayEnabled: noop,`. Live branch: `setOverlayEnabled: (enabled) => preload.setOverlayEnabled?.(enabled),`.

`electron/preload.cjs` — inside `phaseShell`, beside `publishFocusStatus`:

```js
  /**
   * Whether the floating pill may show. A send, like publishFocusStatus, and
   * for the same reason: the renderer must never block on a nicety.
   */
  setOverlayEnabled: (enabled) => ipcRenderer.send('phase-shell:overlay-enabled', enabled),
```

`src/db/db.ts` — beside the assistant accelerator helpers:

```ts
/**
 * Whether the floating running-session pill may show. A device preference,
 * not user work, so it lives in `settings` beside the accelerator and stays
 * out of backup export/import. Absent reads as ON — the pill is the default,
 * and only an explicit 'false' turns it off.
 */
const SHOW_OVERLAY_KEY = 'showOverlay';

export async function loadShowOverlay(): Promise<boolean> {
  const row = await db.settings.get(SHOW_OVERLAY_KEY);
  return row?.value !== 'false';
}

export async function saveShowOverlay(value: boolean): Promise<void> {
  await db.settings.put({ key: SHOW_OVERLAY_KEY, value: String(value) });
}
```

- [ ] **Step 4: Run the bridge test to verify it passes; fix the surface-pinning test**

Run: `cd PhaseApp && npx vitest run src/lib/shellBridge.test.ts electron/assistantIpc.test.ts`
`assistantIpc.test.ts` pins the `phaseShell` preload surface by reading `preload.cjs`; add `setOverlayEnabled` to its expected list. Expected: both PASS.

- [ ] **Step 5: The Settings row**

```tsx
// PhaseApp/src/components/assistant/OverlaySettings.tsx
import { useEffect, useMemo, useState } from 'react';
import { shellBridge } from '../../lib/shellBridge';
import { loadShowOverlay, saveShowOverlay } from '../../db/db';

/**
 * The "Show floating timer" row in Settings.
 *
 * Desktop-only, exactly as LaunchAtLoginSettings is: the browser has no
 * always-on-top window, so in the web build the row simply is not there.
 * Unlike the login item, the value is OURS (Dexie), so the switch flips
 * immediately and the write is fire-and-forget — there is no OS to refuse.
 */
export function OverlaySettings() {
  const bridge = useMemo(() => shellBridge(), []);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void loadShowOverlay().then((value) => {
      if (cancelled) return;
      setEnabled(value);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (!bridge.available) return null;

  if (loading) {
    return (
      <div aria-hidden="true" data-testid="overlay-skeleton" className="h-[42px] rounded-field bg-fill" />
    );
  }

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    void saveShowOverlay(next);
    bridge.setOverlayEnabled(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Show floating timer"
      onClick={toggle}
      className="flex w-full items-center justify-between rounded-field px-2 py-2 text-left text-ui hover:bg-hover"
    >
      <span>
        <span className="block text-ink">Show floating timer</span>
        <span className="block text-meta text-muted">A small pill over other apps while a session runs.</span>
      </span>
      <span
        aria-hidden="true"
        className={
          'h-[18px] w-[32px] rounded-field border p-[2px] '
          + (enabled ? 'border-ink bg-ink' : 'border-check bg-panel')
        }
      >
        <span
          className={
            'block h-[12px] w-[12px] rounded-field bg-panel transition-transform duration-150 '
            + (enabled ? 'translate-x-[12px]' : 'translate-x-0')
          }
        />
      </span>
    </button>
  );
}
```

In `SettingsModal.tsx`: import it and render `<OverlaySettings />` directly under `<LaunchAtLoginSettings />` (line ~71).

- [ ] **Step 6: The startup push in `App.tsx`**

Beside the existing shell effects (the `shell` memo is at line ~201):

```tsx
  // Electron cannot read Dexie, so the hydrated pill preference is pushed
  // once at startup — the same reason the assistant shortcut is.
  useEffect(() => {
    if (!shell.available) return;
    let cancelled = false;
    void loadShowOverlay().then((value) => {
      if (!cancelled) shell.setOverlayEnabled(value);
    });
    return () => { cancelled = true; };
  }, [shell]);
```

Add `loadShowOverlay` to the existing `db` imports in `App.tsx`.

- [ ] **Step 7: Full suite + typecheck**

Run: `cd PhaseApp && npm test && npx tsc -b`
Expected: PASS / clean. Fix any surface-pinning or smoke test that legitimately noticed the new row (update expectations, never delete assertions).

- [ ] **Step 8: Commit**

```bash
git add PhaseApp/src/db/db.ts PhaseApp/src/lib/shellBridge.ts PhaseApp/src/lib/shellBridge.test.ts PhaseApp/electron/preload.cjs PhaseApp/electron/assistantIpc.test.ts PhaseApp/src/components/assistant/OverlaySettings.tsx PhaseApp/src/components/SettingsModal.tsx PhaseApp/src/App.tsx
git commit -m "feat(app): a Settings switch for the floating timer"
```

---

### Task 6: Verify in the real app

**Files:** none (verification only).

- [ ] **Step 1: Build and typecheck everything**

Run: `cd PhaseApp && npm test && npx tsc -b && npm run build`
Expected: all green.

- [ ] **Step 2: Manual check under Electron**

Run: `cd PhaseApp && npm run app:dev` (needs the Vite dev server; `npm run dev` in another terminal — note `app:dev` hardcodes port 5173, so make sure no sibling worktree's dev server is already squatting on it).

Verify, and note results in the final report:
- Start a focus session → pill appears top-right: `▶ 0m · <task>`.
- Wait past a minute boundary (or temporarily set `REPAINT_MS` lower — revert after) → text advances.
- Take a break → `⏸ on break`. Finish → pill gone. While the finish-confirm question is on the shelf → pill hidden.
- Drag the pill; quit; relaunch mid-session → pill returns where you left it.
- Toggle "Show floating timer" off in Settings → pill hides immediately; on → returns.
- Pill visible over a full-screen app and on a second Space.
- Clicking the glyph raises the Phase window; clicking the pill body does not (it drags).

- [ ] **Step 3: Commit anything the manual check forced you to fix** (each fix with its own test where the harness can express it).

