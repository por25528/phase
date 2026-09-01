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

  it('counts a cycle work interval down, rounding up, and keeps the title', () => {
    const cycle = { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4, completed: 0 };
    expect(pillModel(active({ cycle }), T0))
      .toEqual({ glyph: '▶', text: '25m left · Problem set 4' });
    // 17m30s left is still a seventeenth minute somebody has: round it UP.
    expect(pillModel(active({ cycle }), T0 + 7 * MIN + 30_000))
      .toEqual({ glyph: '▶', text: '18m left · Problem set 4' });
    expect(pillModel(active({ cycle: { ...cycle, completed: 2 }, accumulatedMs: 55 * MIN }), T0))
      .toEqual({ glyph: '▶', text: '20m left · Problem set 4' });
  });

  it('counts a timed break down and falls back to the plain words when it runs out', () => {
    const cycle = { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4, completed: 1 };
    const onBreak = active({
      phase: 'break', activeSinceMs: null, accumulatedMs: 25 * MIN,
      cycle: { ...cycle, breakStartedMs: T0, breakKind: 'short' as const },
    });
    expect(pillModel(onBreak, T0 + 2 * MIN)).toEqual({ glyph: '⏸', text: 'break · 3m' });
    expect(pillModel(onBreak, T0 + 5 * MIN)).toEqual({ glyph: '⏸', text: 'on break' });
    // A manual break carries no start, so there is nothing to count.
    expect(pillModel(active({ phase: 'break', activeSinceMs: null, cycle }), T0))
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

  /**
   * A timed break has a figure that changes, so it keeps the clock the calm
   * break has no use for; once the break runs out the readout is words again,
   * and words need no timer.
   */
  it('repaints through a timed break and stops once it has run out', () => {
    const { overlay, advance, fire, lastSent, timers } = overlayWindow();
    const cycle = { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4, completed: 1 };
    overlay.create();
    overlay.setFocusStatus(active({
      phase: 'break', activeSinceMs: null,
      cycle: { ...cycle, breakStartedMs: T0, breakKind: 'short' },
    }));
    expect(lastSent()).toEqual(['phase-overlay:model', { glyph: '⏸', text: 'break · 5m' }]);
    expect(timers.filter((t) => !t.cancelled)).toHaveLength(1);

    advance(5 * MIN);
    fire();
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
