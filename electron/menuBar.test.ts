import { createRequire } from 'node:module';
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
