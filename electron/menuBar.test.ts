import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { createMenuBar } = nativeRequire('./menuBar.cjs') as typeof import('./menuBar.cjs');

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
} = {}) {
  const image = {
    isEmpty: vi.fn(() => over.imageEmpty === true),
    setTemplateImage: vi.fn(),
  };
  const tray = {
    destroy: vi.fn(),
    setToolTip: vi.fn(),
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
  const logError = vi.fn();
  const loadImage = vi.fn(() => image);
  const controller = createMenuBar({
    createTray,
    buildMenu: buildFromTemplate,
    loadImage,
    iconPath: '/x/phaseTemplate.png',
    onOpenPhase,
    onOpenAssistant,
    onOpenSettings,
    onQuit,
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
    logError,
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
      for (let y = 0; y < png.height; y += 1) {
        for (let x = 0; x < png.width; x += 1) {
          const px = pixelAt(png.rgba, png.width * 4, x, y);
          // RGB is neutral black: the shape lives entirely in the alpha channel.
          expect([px.r, px.g, px.b]).toEqual([0, 0, 0]);
          if (px.a === 0) {
            transparent += 1;
          } else {
            visible += 1;
            if (px.a < 255) antialiased += 1;
          }
        }
      }

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
    });
  }
});
