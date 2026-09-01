import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const {
  createOverlayWindow, pillModel, clampToWorkArea, defaultPosition,
  normalizePillPrefs, PILL_SIZES,
  REPAINT_MS, OVERLAY_WIDTH, OVERLAY_HEIGHT,
} = nativeRequire('./overlayWindow.cjs') as typeof import('./overlayWindow.cjs');

type PillPrefs = ReturnType<typeof normalizePillPrefs>;

/** The row as it reaches main after `parsePillPrefs`; overridden per case. */
const prefs = (over: Partial<PillPrefs> = {}): PillPrefs =>
  normalizePillPrefs({ ...over });

type FocusStatus = Parameters<ReturnType<typeof createOverlayWindow>['setFocusStatus']>[0];

const MIN = 60_000;
const T0 = 1_700_000_000_000;

const active = (over: Partial<NonNullable<FocusStatus>> = {}): NonNullable<FocusStatus> => ({
  phase: 'active', activeSinceMs: T0, accumulatedMs: 0, title: 'Problem set 4', ...over,
});

describe('pillModel', () => {
  it('floors active minutes and carries the title', () => {
    expect(pillModel(active(), T0 + 90_000, prefs(), false)).toMatchObject({ glyph: '▶', text: '1m · Problem set 4' });
  });

  it('banks accumulated time on top of the live stretch', () => {
    expect(pillModel(active({ accumulatedMs: 10 * MIN }), T0 + MIN, prefs(), false))
      .toMatchObject({ glyph: '▶', text: '11m · Problem set 4' });
  });

  it('reads a backwards clock as zero extra', () => {
    expect(pillModel(active(), T0 - MIN, prefs(), false)).toMatchObject({ glyph: '▶', text: '0m · Problem set 4' });
  });

  it('says on break without a clock', () => {
    expect(pillModel(active({ phase: 'break', activeSinceMs: null }), T0, prefs(), false))
      .toMatchObject({ glyph: '⏸', text: 'on break' });
  });

  it('counts a cycle work interval down, rounding up, and keeps the title', () => {
    const cycle = { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4, completed: 0 };
    expect(pillModel(active({ cycle }), T0, prefs(), false))
      .toMatchObject({ glyph: '▶', text: '25m left · Problem set 4' });
    // 17m30s left is still a seventeenth minute somebody has: round it UP.
    expect(pillModel(active({ cycle }), T0 + 7 * MIN + 30_000, prefs(), false))
      .toMatchObject({ glyph: '▶', text: '18m left · Problem set 4' });
    expect(pillModel(active({ cycle: { ...cycle, completed: 2 }, accumulatedMs: 55 * MIN }), T0, prefs(), false))
      .toMatchObject({ glyph: '▶', text: '20m left · Problem set 4' });
  });

  it('counts a timed break down and falls back to the plain words when it runs out', () => {
    const cycle = { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4, completed: 1 };
    const onBreak = active({
      phase: 'break', activeSinceMs: null, accumulatedMs: 25 * MIN,
      cycle: { ...cycle, breakStartedMs: T0, breakKind: 'short' as const },
    });
    expect(pillModel(onBreak, T0 + 2 * MIN, prefs(), false)).toMatchObject({ glyph: '⏸', text: 'break · 3m' });
    expect(pillModel(onBreak, T0 + 5 * MIN, prefs(), false)).toMatchObject({ glyph: '⏸', text: 'on break' });
    // A manual break carries no start, so there is nothing to count.
    expect(pillModel(active({ phase: 'break', activeSinceMs: null, cycle }), T0, prefs(), false))
      .toMatchObject({ glyph: '⏸', text: 'on break' });
  });

  it('is null while confirming and null with no session', () => {
    expect(pillModel(active({ phase: 'confirming', activeSinceMs: null }), T0, prefs(), false)).toBeNull();
    expect(pillModel(null, T0, prefs(), false)).toBeNull();
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
    setBounds: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
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
  let systemIsDark = false;
  const deps = {
    createWindow,
    htmlPath: '/app/electron/assets/overlay.html',
    preloadPath: '/app/electron/overlayPreload.cjs',
    getPrimaryWorkArea: vi.fn(() => ({ x: 0, y: 25, width: 1440, height: 875 })),
    workAreaNearest: vi.fn(() => ({ x: 0, y: 25, width: 1440, height: 875 })),
    readPosition: vi.fn(() => over.storedPosition ?? null),
    writePosition: vi.fn(),
    now: () => nowMs,
    isSystemDark: () => systemIsDark,
    setTimer,
    logError: vi.fn(),
  };
  const overlay = createOverlayWindow(deps);
  return {
    overlay, win, deps, timers, listeners,
    advance(ms: number) { nowMs += ms; },
    systemDark(dark: boolean) { systemIsDark = dark; },
    /** Run every pending un-cancelled timer once, as time passing would. */
    fire() { for (const t of timers.splice(0)) if (!t.cancelled) t.fn(); },
    lastSent() { return win.webContents.send.mock.calls.at(-1); },
  };
}

/**
 * The structural mirror of `parsePillPrefs` in `src/lib/pillPrefs.ts`.
 * `electron/*` imports nothing from `src/`, so the two are hand-kept — and the
 * cases below are deliberately the same cases that file's own suite asserts.
 */
describe('normalizePillPrefs', () => {
  it('answers today\u2019s pill for anything unusable', () => {
    for (const bad of [undefined, null, 'a string', 42, []]) {
      expect(normalizePillPrefs(bad)).toEqual({
        show: true, content: 'countdown', showTitle: true, showGlyph: true,
        size: 'medium', opacity: 0.92, theme: 'dark', corner: 'top-right',
        clickThrough: false,
      });
    }
  });

  it('falls back per field, keeping every neighbour that parsed', () => {
    expect(normalizePillPrefs({ size: 'huge', theme: 'light', opacity: 'a lot' }))
      .toMatchObject({ size: 'medium', theme: 'light', opacity: 0.92 });
  });

  it('clamps opacity into the legible range', () => {
    expect(normalizePillPrefs({ opacity: 0 }).opacity).toBe(0.5);
    expect(normalizePillPrefs({ opacity: 9 }).opacity).toBe(1);
  });

  it('refuses to leave the pill with nothing to say', () => {
    expect(normalizePillPrefs({ showTitle: false, showGlyph: false }).showTitle).toBe(true);
    expect(normalizePillPrefs({ showTitle: false }).showTitle).toBe(false);
  });
});

describe('what the prefs do to the model', () => {
  const cycle = { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4, completed: 0 };

  /**
   * The one content choice, and it only means something on a pomodoro: a calm
   * session has no countdown to choose between. `elapsed` asks for the calm
   * reading of a cycle session — how long you have worked, not how long is
   * left — which is the whole point of offering it.
   */
  it('content: elapsed reads a pomodoro the calm way', () => {
    expect(pillModel(active({ cycle }), T0 + 10 * MIN, prefs({ content: 'elapsed' }), false))
      .toMatchObject({ text: '10m · Problem set 4' });
    // And changes nothing at all for a calm session.
    expect(pillModel(active(), T0 + 10 * MIN, prefs({ content: 'elapsed' }), false))
      .toMatchObject({ text: '10m · Problem set 4' });
  });

  it('drops the title on request, and the glyph', () => {
    expect(pillModel(active(), T0 + 10 * MIN, prefs({ showTitle: false }), false))
      .toMatchObject({ text: '10m' });
    const noGlyph = pillModel(active(), T0, prefs({ showGlyph: false }), false);
    expect(noGlyph).not.toHaveProperty('glyph');
  });

  it('carries the geometry of the size it was given', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      expect(pillModel(active(), T0, prefs({ size }), false)).toMatchObject({
        height: PILL_SIZES[size].height,
        font: PILL_SIZES[size].font,
        radius: PILL_SIZES[size].radius,
        padX: PILL_SIZES[size].padX,
      });
    }
  });

  it('paints the theme it is told, and asks the OS only for system', () => {
    const dark = pillModel(active(), T0, prefs({ theme: 'dark' }), false);
    const light = pillModel(active(), T0, prefs({ theme: 'light' }), true);
    expect(dark).toMatchObject({ bg: 'rgba(28,27,26,0.92)', ink: '#f5f2ec' });
    expect(light).toMatchObject({ bg: 'rgba(250,248,244,0.92)', ink: '#1c1b1a' });
    // `system` is the only one that reads the injected OS answer.
    expect(pillModel(active(), T0, prefs({ theme: 'system' }), true)).toMatchObject({ bg: dark!.bg });
    expect(pillModel(active(), T0, prefs({ theme: 'system' }), false)).toMatchObject({ bg: light!.bg });
  });

  it('spends the opacity on the background and never on the ink', () => {
    const faint = pillModel(active(), T0, prefs({ opacity: 0.5 }), false);
    expect(faint).toMatchObject({ bg: 'rgba(28,27,26,0.5)', ink: '#f5f2ec' });
  });
});

describe('defaultPosition', () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };
  const { width, height } = PILL_SIZES.medium;

  it('places the pill in each of the four corners, 16px in', () => {
    expect(defaultPosition(workArea, 'top-left', PILL_SIZES.medium)).toEqual({ x: 16, y: 41 });
    expect(defaultPosition(workArea, 'top-right', PILL_SIZES.medium))
      .toEqual({ x: 1440 - width - 16, y: 41 });
    expect(defaultPosition(workArea, 'bottom-left', PILL_SIZES.medium))
      .toEqual({ x: 16, y: 25 + 875 - height - 16 });
    expect(defaultPosition(workArea, 'bottom-right', PILL_SIZES.medium))
      .toEqual({ x: 1440 - width - 16, y: 25 + 875 - height - 16 });
  });

  it('respects a work area that does not start at the origin', () => {
    expect(defaultPosition({ x: -1440, y: 0, width: 1440, height: 900 }, 'top-left', PILL_SIZES.medium))
      .toEqual({ x: -1424, y: 16 });
  });
});

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
    expect(lastSent()).toMatchObject(['phase-overlay:model', { glyph: '▶', text: '0m · Problem set 4' }]);
    expect(win.showInactive).toHaveBeenCalled();
  });

  it('repaints a minute later with the next floor minute', () => {
    const { overlay, advance, fire, lastSent } = overlayWindow();
    overlay.create();
    overlay.setFocusStatus(active());
    advance(REPAINT_MS);
    fire();
    expect(lastSent()).toMatchObject(['phase-overlay:model', { glyph: '▶', text: '1m · Problem set 4' }]);
  });

  it('shows a static break and schedules no repaint for it', () => {
    const { overlay, timers, lastSent } = overlayWindow();
    overlay.create();
    overlay.setFocusStatus(active({ phase: 'break', activeSinceMs: null }));
    expect(lastSent()).toMatchObject(['phase-overlay:model', { glyph: '⏸', text: 'on break' }]);
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
    expect(lastSent()).toMatchObject(['phase-overlay:model', { glyph: '⏸', text: 'break · 5m' }]);
    expect(timers.filter((t) => !t.cancelled)).toHaveLength(1);

    advance(5 * MIN);
    fire();
    expect(lastSent()).toMatchObject(['phase-overlay:model', { glyph: '⏸', text: 'on break' }]);
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

  it('show:false hides a running pill; show:true re-shows from the remembered snapshot', () => {
    const { overlay, win } = overlayWindow();
    overlay.create();
    overlay.setFocusStatus(active());
    overlay.setPrefs({ show: false });
    expect(win.hide).toHaveBeenCalled();
    win.showInactive.mockClear();
    overlay.setPrefs({ show: true });
    expect(win.showInactive).toHaveBeenCalled();
  });

  /**
   * A size is a WINDOW fact as well as a text fact — the page cannot grow past
   * the frame it is painted in, so a new footprint has to reach `setBounds` or
   * a large pill would simply be a medium one with clipped text. The position
   * is the CURRENT one, clamped: a resize must not walk the pill back to its
   * default corner, which is only ever where it starts.
   */
  it('applies a new footprint to the live window at its current position', () => {
    const { overlay, win } = overlayWindow();
    overlay.create();
    overlay.setPrefs({ size: 'large' });
    expect(win.setBounds).toHaveBeenCalledWith({
      x: 300, y: 200, width: PILL_SIZES.large.width, height: PILL_SIZES.large.height,
    });
  });

  it('leaves the window alone when the size did not change', () => {
    const { overlay, win } = overlayWindow();
    overlay.create();
    overlay.setPrefs({ opacity: 0.7 });
    expect(win.setBounds).not.toHaveBeenCalled();
  });

  it('makes the pill transparent to the mouse on request, and solid again', () => {
    const { overlay, win } = overlayWindow();
    overlay.create();
    overlay.setPrefs({ clickThrough: true });
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
    overlay.setPrefs({ clickThrough: false });
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
  });

  it('starts in the corner the prefs name, when nothing is stored', () => {
    const { overlay, deps } = overlayWindow();
    overlay.setPrefs({ corner: 'bottom-left' });
    overlay.create();
    const options = (deps.createWindow.mock.calls[0] as unknown[])[0] as { x: number; y: number };
    expect(options.x).toBe(16);
    expect(options.y).toBe(25 + 875 - OVERLAY_HEIGHT - 16);
  });

  /**
   * `system` is the one theme that can change without anybody touching Phase,
   * so main subscribes to the OS and asks for a repaint. The model is computed
   * fresh, which is the whole of what a repaint has to do.
   */
  it('repaint recomputes the model against the OS palette it is handed', () => {
    const { overlay, lastSent, systemDark } = overlayWindow();
    overlay.create();
    overlay.setPrefs({ theme: 'system' });
    overlay.setFocusStatus(active());
    const light = (lastSent() as unknown as [string, { bg: string }])[1].bg;

    systemDark(true);
    overlay.repaint();
    const dark = (lastSent() as unknown as [string, { bg: string }])[1].bg;

    expect(dark).not.toBe(light);
  });

  it('repaints after did-finish-load so a snapshot never races the page', () => {
    const { overlay, listeners, win } = overlayWindow();
    overlay.create();
    overlay.setFocusStatus(active());
    win.webContents.send.mockClear();
    listeners['did-finish-load']();
    expect(win.webContents.send).toHaveBeenCalledWith(
      'phase-overlay:model', expect.objectContaining({ glyph: '▶', text: '0m · Problem set 4' }));
  });

  /**
   * The pill drags by HAND now. `-webkit-app-region: drag` swallows clicks,
   * and the whole pill has to be clickable for click-to-Today to exist at all,
   * so the page reports screen points and the controller does the arithmetic.
   *
   * It is arithmetic and not "follow the pointer": the window moves by the
   * DELTA from where the press began, against where the window was when it
   * began. Setting the window to the pointer would jump the pill's corner
   * under the cursor on the first millimetre of every drag.
   */
  it('moves the window by the pointer delta, from where the press began', () => {
    const { overlay, win } = overlayWindow();
    overlay.create();
    overlay.dragStart({ x: 500, y: 400 });
    overlay.dragTo({ x: 520, y: 430 });
    // getPosition is [300, 200] in the fixture.
    expect(win.setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ x: 320, y: 230 }));
    // A second move is measured from the same origin, never cumulatively.
    overlay.dragTo({ x: 510, y: 410 });
    expect(win.setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ x: 310, y: 210 }));
  });

  it('clamps a drag to the work area of the display it is over', () => {
    const { overlay, win } = overlayWindow();
    overlay.create();
    overlay.dragStart({ x: 500, y: 400 });
    overlay.dragTo({ x: 5000, y: -5000 });
    expect(win.setBounds).toHaveBeenLastCalledWith(expect.objectContaining({
      x: 1440 - OVERLAY_WIDTH, y: 25,
    }));
  });

  it('ignores a move that no press started', () => {
    const { overlay, win } = overlayWindow();
    overlay.create();
    overlay.dragTo({ x: 900, y: 900 });
    expect(win.setBounds).not.toHaveBeenCalled();
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
    expect(() => overlay.setPrefs({ show: false })).not.toThrow();
    expect(() => overlay.repaint()).not.toThrow();
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
