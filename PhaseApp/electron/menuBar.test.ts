import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { createMenuBar, trayTitle, REPAINT_MS } =
  nativeRequire('./menuBar.cjs') as typeof import('./menuBar.cjs');

type FocusStatus = Parameters<ReturnType<typeof createMenuBar>['setFocusStatus']>[0];

const MIN = 60_000;
const T0 = 1_700_000_000_000;

const active = (over: Partial<NonNullable<FocusStatus>> = {}): NonNullable<FocusStatus> => ({
  phase: 'active', activeSinceMs: T0, accumulatedMs: 0, title: 'Problem set 4', ...over,
});

interface TemplateItem {
  label?: string;
  type?: string;
  role?: string;
  click?: () => void;
}

function menuBar(over: {
  imageEmpty?: boolean;
  createTrayThrows?: boolean;
  buildMenuThrows?: boolean;
  setContextMenuThrows?: boolean;
  setTitleThrows?: boolean;
} = {}) {
  const image = {
    isEmpty: vi.fn(() => over.imageEmpty === true),
    setTemplateImage: vi.fn(),
  };
  const tray = {
    destroy: vi.fn(),
    setToolTip: vi.fn(),
    setTitle: vi.fn(() => {
      if (over.setTitleThrows) throw new Error('set title failed');
    }),
    setContextMenu: vi.fn(() => {
      if (over.setContextMenuThrows) throw new Error('set context menu failed');
    }),
  };
  const createTray = vi.fn(() => {
    if (over.createTrayThrows) throw new Error('tray creation failed');
    return tray;
  });
  const buildFromTemplate = vi.fn((_template: TemplateItem[]) => {
    if (over.buildMenuThrows) throw new Error('menu build failed');
    return { template: [] as TemplateItem[] };
  });
  const onOpenPhase = vi.fn();
  const onOpenAssistant = vi.fn();
  const onOpenSettings = vi.fn();
  const onQuit = vi.fn();
  const onTakeBreak = vi.fn();
  const onResume = vi.fn();
  const onFinishSession = vi.fn();
  const logError = vi.fn();
  const loadImage = vi.fn(() => image);
  // A hand-driven one-shot timer: the module re-arms it itself, so `fire()`
  // is exactly one repaint and `pending()` says whether a clock is running.
  let scheduled: (() => void) | null = null;
  const cancel = vi.fn(() => { scheduled = null; });
  const setTimer = vi.fn((fn: () => void, _ms: number) => {
    scheduled = fn;
    return cancel;
  });
  let clock = T0;
  const now = vi.fn(() => clock);
  const controller = createMenuBar({
    createTray,
    buildMenu: buildFromTemplate,
    loadImage,
    iconPath: '/x/phaseTemplate.png',
    onOpenPhase,
    onOpenAssistant,
    onOpenSettings,
    onQuit,
    onTakeBreak,
    onResume,
    onFinishSession,
    now,
    setTimer,
    logError,
  });
  return {
    controller,
    image,
    tray,
    createTray,
    buildFromTemplate,
    loadImage,
    onOpenPhase,
    onOpenAssistant,
    onOpenSettings,
    onQuit,
    onTakeBreak,
    onResume,
    onFinishSession,
    setTimer,
    cancel,
    logError,
    pending: () => scheduled !== null,
    fire: () => {
      const fn = scheduled;
      scheduled = null;
      fn?.();
    },
    advance: (ms: number) => { clock += ms; },
    labels: () => {
      const calls = buildFromTemplate.mock.calls;
      const template = calls[calls.length - 1][0];
      return template.map((item) => (item.type === 'separator' ? 'separator' : item.label));
    },
    lastTemplate: () => {
      const calls = buildFromTemplate.mock.calls;
      return calls[calls.length - 1][0];
    },
  };
}

describe('createMenuBar', () => {
  it('builds one neutral menu in the approved order', () => {
    const { controller, buildFromTemplate } = menuBar();
    controller.create();
    const template = buildFromTemplate.mock.calls[0][0];
    expect(template.map((item) => (item.type === 'separator' ? 'separator' : item.label))).toEqual([
      'Open Phase',
      'Open assistant',
      'Settings',
      'separator',
      'Quit Phase',
    ]);
  });

  it('loads the PNG, marks it as a template image, and attaches the built menu', () => {
    const { controller, image, tray, loadImage, createTray, buildFromTemplate } = menuBar();
    controller.create();
    expect(loadImage).toHaveBeenCalledWith('/x/phaseTemplate.png');
    expect(image.isEmpty).toHaveBeenCalled();
    expect(image.setTemplateImage).toHaveBeenCalledWith(true);
    expect(createTray).toHaveBeenCalledWith(image);
    expect(tray.setToolTip).toHaveBeenCalledWith('Phase');
    expect(tray.setContextMenu).toHaveBeenCalledWith(buildFromTemplate.mock.results[0].value);
  });

  it('routes each item once and disposes the native tray exactly once', () => {
    const fixture = menuBar();
    fixture.controller.create();
    const template = fixture.buildFromTemplate.mock.calls[0][0];
    template[0].click?.();
    template[1].click?.();
    template[2].click?.();
    template[4].click?.();
    expect(fixture.onOpenPhase).toHaveBeenCalledTimes(1);
    expect(fixture.onOpenAssistant).toHaveBeenCalledTimes(1);
    expect(fixture.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(fixture.onQuit).toHaveBeenCalledTimes(1);
    fixture.controller.dispose();
    fixture.controller.dispose();
    expect(fixture.tray.destroy).toHaveBeenCalledTimes(1);
  });

  it('quits through the injected callback, never the native quit role', () => {
    const { controller, buildFromTemplate } = menuBar();
    controller.create();
    const template = buildFromTemplate.mock.calls[0][0];
    const quit = template[4];
    expect(quit.role).toBeUndefined();
    expect(quit.click).toBeDefined();
  });

  it('rejects an empty image without creating a tray and logs the exact failure', () => {
    const fixture = menuBar({ imageEmpty: true });
    expect(() => fixture.controller.create()).not.toThrow();
    expect(fixture.image.setTemplateImage).not.toHaveBeenCalled();
    expect(fixture.createTray).not.toHaveBeenCalled();
    expect(fixture.logError).toHaveBeenCalledWith(
      '[phase-shell] menu bar unavailable',
      expect.any(Error),
    );
  });

  it('logs a tray creation failure and leaves the app usable', () => {
    const fixture = menuBar({ createTrayThrows: true });
    expect(() => fixture.controller.create()).not.toThrow();
    expect(fixture.logError).toHaveBeenCalledWith(
      '[phase-shell] menu bar unavailable',
      expect.any(Error),
    );
  });

  it('destroys a partially created tray when the menu build fails', () => {
    const fixture = menuBar({ buildMenuThrows: true });
    expect(() => fixture.controller.create()).not.toThrow();
    expect(fixture.tray.setToolTip).toHaveBeenCalledWith('Phase');
    expect(fixture.tray.destroy).toHaveBeenCalledTimes(1);
    expect(fixture.logError).toHaveBeenCalledWith(
      '[phase-shell] menu bar unavailable',
      expect.any(Error),
    );
  });

  it('destroys a partially created tray when attaching the menu fails', () => {
    const fixture = menuBar({ setContextMenuThrows: true });
    expect(() => fixture.controller.create()).not.toThrow();
    expect(fixture.tray.setToolTip).toHaveBeenCalledWith('Phase');
    expect(fixture.tray.destroy).toHaveBeenCalledTimes(1);
    expect(fixture.logError).toHaveBeenCalledWith(
      '[phase-shell] menu bar unavailable',
      expect.any(Error),
    );
  });

  it('is idempotent after success and retries after a failure', () => {
    const stable = menuBar();
    stable.controller.create();
    stable.controller.create();
    expect(stable.createTray).toHaveBeenCalledTimes(1);

    const flaky = menuBar({ createTrayThrows: true });
    flaky.controller.create();
    expect(flaky.createTray).toHaveBeenCalledTimes(1);
    expect(flaky.tray.destroy).not.toHaveBeenCalled();
    flaky.createTray.mockImplementation(() => flaky.tray);
    flaky.controller.create();
    expect(flaky.createTray).toHaveBeenCalledTimes(2);
    expect(flaky.tray.setToolTip).toHaveBeenCalledWith('Phase');
    expect(flaky.logError).toHaveBeenCalledTimes(1);
  });

  it('dispose with no live tray is a quiet no-op', () => {
    const fixture = menuBar();
    expect(() => fixture.controller.dispose()).not.toThrow();
    expect(fixture.tray.destroy).not.toHaveBeenCalled();
  });
});


describe('trayTitle', () => {
  it('states elapsed whole minutes while active, and floors rather than rounds', () => {
    expect(trayTitle(active({ accumulatedMs: 0 }), T0)).toBe('▶ 0m');
    // 41m30s is not 42 minutes of work, and a clock may not claim one.
    expect(trayTitle(active({ accumulatedMs: 0 }), T0 + 41 * MIN + 30_000)).toBe('▶ 41m');
    expect(trayTitle(active({ accumulatedMs: 42 * MIN }), T0)).toBe('▶ 42m');
  });

  it('adds banked stretches to the running one and never counts a break', () => {
    const resumed = active({ accumulatedMs: 20 * MIN, activeSinceMs: T0 + 50 * MIN });
    expect(trayTitle(resumed, T0 + 60 * MIN)).toBe('▶ 30m');
  });

  it('never runs backwards when the clock does', () => {
    expect(trayTitle(active({ accumulatedMs: 5 * MIN }), T0 - 10 * MIN)).toBe('▶ 5m');
  });

  it('says on a break in words, and says nothing at all otherwise', () => {
    expect(trayTitle({ ...active(), phase: 'break', activeSinceMs: null }, T0)).toBe('⏸ on break');
    // The shelf owns the confirming question, and the icon alone is the
    // whole signal when nothing is running.
    expect(trayTitle({ ...active(), phase: 'confirming', activeSinceMs: null }, T0)).toBe('');
    expect(trayTitle(null, T0)).toBe('');
  });
});

describe('trayTitle with a cycle', () => {
  const cycle = { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4, completed: 0 };

  /**
   * CEIL, where the calm figure floors — and the two are the right way round.
   * A stopwatch that reads 42m before 42 minutes have passed is claiming time
   * nobody worked; a countdown that reads 17m with 17m30s left is throwing
   * away a minute that is still there.
   */
  it('counts the work interval down, rounding up', () => {
    expect(trayTitle(active({ cycle }), T0)).toBe('▶ 25m left');
    expect(trayTitle(active({ cycle }), T0 + 7 * MIN + 30_000)).toBe('▶ 18m left');
    expect(trayTitle(active({ cycle }), T0 + 25 * MIN)).toBe('▶ 0m left');
  });

  it('measures the current interval, not the whole session', () => {
    expect(trayTitle(active({ cycle: { ...cycle, completed: 2 }, accumulatedMs: 55 * MIN }), T0))
      .toBe('▶ 20m left');
  });

  it('counts a timed break down, and says which length it is counting', () => {
    const onBreak = active({
      phase: 'break', activeSinceMs: null, accumulatedMs: 25 * MIN,
      cycle: { ...cycle, completed: 1, breakStartedMs: T0, breakKind: 'short' },
    });
    expect(trayTitle(onBreak, T0 + 2 * MIN)).toBe('⏸ break 3m');

    const longBreak = { ...onBreak, cycle: { ...cycle, completed: 4, breakStartedMs: T0, breakKind: 'long' as const } };
    expect(trayTitle(longBreak, T0 + 2 * MIN)).toBe('⏸ break 13m');
  });

  /**
   * Work never auto-starts, so a break that has run out sits there until the
   * user resumes. A countdown pinned at `0m` would read as a stuck clock; the
   * words the app has always used for an untimed break are the honest answer.
   */
  it('falls back to the plain words once the break has run out, and on a manual break', () => {
    const spent = active({
      phase: 'break', activeSinceMs: null,
      cycle: { ...cycle, completed: 1, breakStartedMs: T0, breakKind: 'short' },
    });
    expect(trayTitle(spent, T0 + 5 * MIN)).toBe('⏸ on break');
    // A break the user pressed for themselves carries no start: nothing to count.
    expect(trayTitle(active({ phase: 'break', activeSinceMs: null, cycle }), T0)).toBe('⏸ on break');
  });

  it('leaves confirming and no-session exactly as they were', () => {
    expect(trayTitle(active({ phase: 'confirming', activeSinceMs: null, cycle }), T0)).toBe('');
  });
});

describe('the menu-bar timer', () => {
  it('paints the elapsed title and repaints once a minute while active', () => {
    const fixture = menuBar();
    fixture.controller.create();
    fixture.controller.setFocusStatus(active());
    expect(fixture.tray.setTitle).toHaveBeenLastCalledWith('▶ 0m');
    expect(fixture.setTimer).toHaveBeenCalledWith(expect.any(Function), REPAINT_MS);

    fixture.advance(MIN);
    fixture.fire();
    expect(fixture.tray.setTitle).toHaveBeenLastCalledWith('▶ 1m');
    // And it re-armed itself: one repaint is not a clock.
    expect(fixture.pending()).toBe(true);
  });

  /**
   * A timed break is a COUNTDOWN, so it keeps the clock the calm break has no
   * use for — the difference is not the phase, it is whether there is a figure
   * that changes.
   */
  it('keeps repainting through a timed break, and stops when it runs out', () => {
    const fixture = menuBar();
    const cycle = { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4, completed: 1 };
    fixture.controller.create();
    fixture.controller.setFocusStatus({
      ...active(), phase: 'break', activeSinceMs: null,
      cycle: { ...cycle, breakStartedMs: T0, breakKind: 'short' },
    });
    expect(fixture.tray.setTitle).toHaveBeenLastCalledWith('⏸ break 5m');
    expect(fixture.pending()).toBe(true);

    fixture.advance(5 * MIN);
    fixture.fire();
    expect(fixture.tray.setTitle).toHaveBeenLastCalledWith('⏸ on break');
    expect(fixture.pending()).toBe(false);
  });

  it('stops the clock on a break — static text needs no timer', () => {
    const fixture = menuBar();
    fixture.controller.create();
    fixture.controller.setFocusStatus(active());
    expect(fixture.pending()).toBe(true);

    fixture.controller.setFocusStatus({ ...active(), phase: 'break', activeSinceMs: null });
    expect(fixture.tray.setTitle).toHaveBeenLastCalledWith('⏸ on break');
    expect(fixture.pending()).toBe(false);
    expect(fixture.cancel).toHaveBeenCalled();
  });

  it('clears the title and the clock when the session ends', () => {
    const fixture = menuBar();
    fixture.controller.create();
    fixture.controller.setFocusStatus(active());
    fixture.controller.setFocusStatus(null);
    expect(fixture.tray.setTitle).toHaveBeenLastCalledWith('');
    expect(fixture.pending()).toBe(false);
  });

  it('disposes the repaint with the tray, so nothing paints a destroyed handle', () => {
    const fixture = menuBar();
    fixture.controller.create();
    fixture.controller.setFocusStatus(active());
    expect(fixture.pending()).toBe(true);

    fixture.controller.dispose();
    expect(fixture.pending()).toBe(false);
    expect(fixture.cancel).toHaveBeenCalled();
    expect(fixture.tray.destroy).toHaveBeenCalledTimes(1);
  });

  it('a title the tray refuses stops the clock and leaves the menu alone', () => {
    const fixture = menuBar({ setTitleThrows: true });
    fixture.controller.create();
    expect(() => fixture.controller.setFocusStatus(active())).not.toThrow();
    expect(fixture.pending()).toBe(false);
    expect(fixture.logError).toHaveBeenCalledWith(
      '[phase-shell] menu bar timer unavailable',
      expect.any(Error),
    );
    // The menu still went up: a tray without a title is still a tray.
    expect(fixture.labels()).toContain('Take break');
  });

  it('drops a snapshot that arrives with no tray, without throwing', () => {
    const fixture = menuBar({ createTrayThrows: true });
    fixture.controller.create();
    expect(() => fixture.controller.setFocusStatus(active())).not.toThrow();
    expect(fixture.tray.setTitle).not.toHaveBeenCalled();
    expect(fixture.pending()).toBe(false);
  });
});

describe('the session menu items', () => {
  it('offers Take break and Finish session above the standing four while active', () => {
    const fixture = menuBar();
    fixture.controller.create();
    fixture.controller.setFocusStatus(active());
    expect(fixture.labels()).toEqual([
      'Take break',
      'Finish session',
      'separator',
      'Open Phase',
      'Open assistant',
      'Settings',
      'separator',
      'Quit Phase',
    ]);
  });

  it('offers Resume instead of Take break on a break', () => {
    const fixture = menuBar();
    fixture.controller.create();
    fixture.controller.setFocusStatus({ ...active(), phase: 'break', activeSinceMs: null });
    expect(fixture.labels().slice(0, 3)).toEqual(['Resume', 'Finish session', 'separator']);
  });

  it('offers nothing while confirming — the shelf owns that question', () => {
    const fixture = menuBar();
    fixture.controller.create();
    fixture.controller.setFocusStatus({ ...active(), phase: 'confirming', activeSinceMs: null });
    expect(fixture.labels()).toEqual([
      'Open Phase',
      'Open assistant',
      'Settings',
      'separator',
      'Quit Phase',
    ]);
  });

  it('takes the items away again when the session ends', () => {
    const fixture = menuBar();
    fixture.controller.create();
    fixture.controller.setFocusStatus(active());
    fixture.controller.setFocusStatus(null);
    expect(fixture.labels()).not.toContain('Take break');
    expect(fixture.labels()).not.toContain('Finish session');
  });

  it('routes each session click to its injected callback and writes nothing itself', () => {
    const fixture = menuBar();
    fixture.controller.create();

    fixture.controller.setFocusStatus(active());
    const running = fixture.lastTemplate();
    running[0].click?.();
    running[1].click?.();
    expect(fixture.onTakeBreak).toHaveBeenCalledTimes(1);
    expect(fixture.onFinishSession).toHaveBeenCalledTimes(1);

    fixture.controller.setFocusStatus({ ...active(), phase: 'break', activeSinceMs: null });
    const paused = fixture.lastTemplate();
    paused[0].click?.();
    expect(fixture.onResume).toHaveBeenCalledTimes(1);
    expect(fixture.onTakeBreak).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous menu when the rebuild fails, rather than tearing the tray down', () => {
    const fixture = menuBar();
    fixture.controller.create();
    fixture.buildFromTemplate.mockImplementationOnce(() => { throw new Error('menu build failed'); });
    expect(() => fixture.controller.setFocusStatus(active())).not.toThrow();
    expect(fixture.tray.destroy).not.toHaveBeenCalled();
    expect(fixture.logError).toHaveBeenCalledWith(
      '[phase-shell] menu bar unavailable',
      expect.any(Error),
    );
    // The clock still started: the title and the menu fail independently.
    expect(fixture.tray.setTitle).toHaveBeenLastCalledWith('▶ 0m');
  });
});

// The menu-bar icon is loaded as a nativeImage with setTemplateImage(true), so
// macOS reads the SHAPE out of the alpha channel: an opaque white SVG page
// renders a filled square in the menu bar. These tests decode the actual
// committed PNG pixels (zlib + PNG unfiltering — not the color type, not sips
// hasAlpha) and prove the masks are real: transparent background, visible
// glyph, no opaque canvas, neutral black RGB, and preserved antialiasing.

const ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'assets');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface DecodedPng {
  width: number;
  height: number;
  rgba: Buffer;
}

function decodePng(file: string): DecodedPng {
  const bytes = readFileSync(file);
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${file}: not a PNG`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[data[9]] ?? 0;
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    }
    offset += length + 12;
  }

  if (width === 0 || height === 0 || bitDepth !== 8 || channels !== 4) {
    throw new Error(`${file}: expected an 8-bit RGBA PNG`);
  }

  const bytesPerPixel = channels;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== height * (stride + 1)) {
    throw new Error(`${file}: corrupt IDAT (${raw.length} bytes for ${height}x${stride + 1})`);
  }

  const rgba = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const current = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bytesPerPixel ? current[x - bytesPerPixel] : 0;
      const b = previous[x];
      const c = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      let value = 0;
      switch (filter) {
        case 0:
          value = current[x];
          break;
        case 1:
          value = current[x] + a;
          break;
        case 2:
          value = current[x] + b;
          break;
        case 3:
          value = current[x] + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = current[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`${file}: unknown PNG filter byte ${filter}`);
      }
      current[x] = value & 0xff;
    }
    current.copy(rgba, y * stride);
    previous = current;
  }
  return { width, height, rgba };
}

interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

function pixelAt(rgba: Buffer, stride: number, x: number, y: number): Pixel {
  const o = y * stride + x * 4;
  return { r: rgba[o], g: rgba[o + 1], b: rgba[o + 2], a: rgba[o + 3] };
}

const trayIconAssets = [
  { file: 'phaseTemplate.png', width: 18, height: 18 },
  { file: 'phaseTemplate@2x.png', width: 36, height: 36 },
];

describe('tray icon template mask pixels', () => {
  for (const { file, width, height } of trayIconAssets) {
    it(`${file} is a ${width}x${height} template mask over a transparent background`, () => {
      const png = decodePng(resolve(ASSETS_DIR, file));
      expect(png.width).toBe(width);
      expect(png.height).toBe(height);

      let transparent = 0;
      let visible = 0;
      let antialiased = 0;
      let minX = png.width;
      let minY = png.height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < png.height; y += 1) {
        for (let x = 0; x < png.width; x += 1) {
          const px = pixelAt(png.rgba, png.width * 4, x, y);
          // RGB is neutral black: the shape lives entirely in the alpha channel.
          expect([px.r, px.g, px.b]).toEqual([0, 0, 0]);
          if (px.a === 0) {
            transparent += 1;
          } else {
            visible += 1;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (px.a < 255) antialiased += 1;
          }
        }
      }
      const bboxW = maxX - minX + 1;
      const bboxH = maxY - minY + 1;

      // Background pixels carry alpha 0...
      expect(transparent).toBeGreaterThan(0);
      // ...and glyph pixels carry alpha > 0.
      expect(visible).toBeGreaterThan(0);
      // A glyph does not fill the canvas: the background is the majority.
      expect(transparent).toBeGreaterThan(visible);
      // No opaque canvas: the mask is not a filled square.
      expect(visible).toBeLessThan(png.width * png.height);
      // Antialiasing survived the raster round-trip (partial alpha exists).
      expect(antialiased).toBeGreaterThan(0);
      // The glyph is large enough to be seen: its alpha bbox uses a useful
      // majority of the canvas in both dimensions. qlmanage's degenerate
      // render crops this to a handful of corner pixels, so this fails on the
      // tiny raw thumbnail unless the postprocessor crops and scales it up.
      expect(bboxW).toBeGreaterThanOrEqual(Math.ceil(width * 0.6));
      expect(bboxH).toBeGreaterThanOrEqual(Math.ceil(height * 0.6));
      // The glyph is centered with quiet even padding: it is not pinned to
      // the top or left edge, and it clears the right and bottom edges too.
      expect(minX).toBeGreaterThan(0);
      expect(minY).toBeGreaterThan(0);
      expect(maxX).toBeLessThan(width - 1);
      expect(maxY).toBeLessThan(height - 1);
      // A visible-pixel count meaningfully above a few stray pixels: a real
      // glyph fills at least a tenth of the canvas, where qlmanage's raw
      // render left single-digit counts.
      expect(visible).toBeGreaterThan((width * height) / 10);
    });
  }
});
