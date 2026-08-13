import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { assistantShelfBounds, assistantWindowOptions } =
  nativeRequire('./assistantWindow.cjs') as typeof import('./assistantWindow.cjs');
const { createAssistantWindowController } =
  nativeRequire('./assistantWindowController.cjs') as typeof import('./assistantWindowController.cjs');

type Deps = Parameters<typeof createAssistantWindowController>[0];
type Controller = ReturnType<typeof createAssistantWindowController>;
type Fn = ReturnType<typeof vi.fn>;

interface FakeWindow {
  setBounds: Fn;
  setAlwaysOnTop: Fn;
  setVisibleOnAllWorkspaces: Fn;
  show: Fn;
  focus: Fn;
  hide: Fn;
  destroy: Fn;
  isVisible: Fn;
  isDestroyed: Fn;
  loadURL: Fn;
  loadFile: Fn;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  webContents: {
    focus: Fn;
    setWindowOpenHandler: Fn;
    on(event: string, listener: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
  };
}

interface FakeWindowOptions {
  /** Plain loader returning a controlled value; never a vi.fn, because a mock
   *  attaches its own handler to a returned promise and masks the unhandled
   *  rejection these reject-tests exist to catch. */
  loadFileResult?: (path: string) => unknown;
  loadURLResult?: (path: string) => unknown;
}

function fakeWindow(calls: string[] = [], opts: FakeWindowOptions = {}): FakeWindow {
  let visible = false;
  let destroyed = false;
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const webListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const add = (map: Map<string, Array<(...args: unknown[]) => void>>) =>
    (event: string, listener: (...args: unknown[]) => void) => {
      const list = map.get(event) ?? [];
      list.push(listener);
      map.set(event, list);
    };
  const emit = (map: Map<string, Array<(...args: unknown[]) => void>>) =>
    (event: string, ...args: unknown[]) => {
      for (const listener of [...(map.get(event) ?? [])]) listener(...args);
    };
  const loadURL = opts.loadURLResult
    ? ((path: string) => opts.loadURLResult!(path)) as unknown as Fn
    : vi.fn(async () => {});
  const loadFile = opts.loadFileResult
    ? ((path: string) => opts.loadFileResult!(path)) as unknown as Fn
    : vi.fn(async () => {});
  return {
    setBounds: vi.fn(() => { calls.push('bounds'); }),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    show: vi.fn(() => { visible = true; calls.push('show'); }),
    focus: vi.fn(() => { calls.push('focus'); }),
    hide: vi.fn(() => { visible = false; }),
    destroy: vi.fn(() => { destroyed = true; }),
    isVisible: vi.fn(() => visible),
    isDestroyed: vi.fn(() => destroyed),
    loadURL,
    loadFile,
    on: add(listeners),
    once(event, listener) {
      const wrapped = (...args: unknown[]) => {
        const list = listeners.get(event) ?? [];
        const index = list.indexOf(wrapped);
        if (index !== -1) list.splice(index, 1);
        listener(...args);
      };
      const list = listeners.get(event) ?? [];
      list.push(wrapped);
      listeners.set(event, list);
    },
    emit: emit(listeners),
    webContents: {
      focus: vi.fn(() => { calls.push('web-focus'); }),
      setWindowOpenHandler: vi.fn(),
      on: add(webListeners),
      emit: emit(webListeners),
    },
  };
}

function controllerWith(
  win: FakeWindow,
  over: Partial<Deps> = {},
  calls: string[] = [],
): Controller {
  return createAssistantWindowController({
    createWindow: () => win,
    preloadPath: '/x/preload.cjs',
    entry: { kind: 'file', target: '/x/assistant.html' },
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({
      workArea: { x: 0, y: 0, width: 1512, height: 957 },
    }),
    beforeShow: () => calls.push('snapshot'),
    platform: 'darwin',
    ...over,
  });
}

describe('assistantWindowOptions', () => {
  it('uses a fixed macOS panel with the dedicated preload', () => {
    const options = assistantWindowOptions('/x/assistantPreload.cjs', 'darwin', false);
    expect(options).toMatchObject({
      type: 'panel',
      width: 620,
      height: 192,
      minWidth: 620,
      maxWidth: 620,
      minHeight: 192,
      maxHeight: 192,
      useContentSize: true,
      frame: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: true,
    });
    expect(options.webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      preload: '/x/assistantPreload.cjs',
    });
  });

  it('omits the macOS-only type on fallback platforms', () => {
    expect(assistantWindowOptions('/x/preload.cjs', 'linux').type).toBeUndefined();
  });

  // The shelf is summoned, never carried: it is fixed where the controller
  // puts it, so nothing — a drag on the transparent surface, or a tiling
  // window manager reaching in — relocates it. The title is set at creation
  // rather than left to assistant.html's <title>, because a window manager
  // matches its rules the moment the window appears, which is before the
  // renderer has loaded a page to be titled by.
  it('is fixed in place and titled from birth, so a window manager can single it out', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(assistantWindowOptions('/x/preload.cjs', platform)).toMatchObject({
        movable: false,
        title: 'Phase Assistant',
      });
    }
  });

  it('uses transparent macOS corners and a theme-matched fallback first frame', () => {
    expect(assistantWindowOptions('/x/preload.cjs', 'darwin', false)).toMatchObject({
      transparent: true,
      backgroundColor: '#00000000',
    });
    expect(assistantWindowOptions('/x/preload.cjs', 'linux', true)).toMatchObject({
      transparent: false,
      backgroundColor: '#000000',
    });
    expect(assistantWindowOptions('/x/preload.cjs', 'linux', false)).toMatchObject({
      transparent: false,
      backgroundColor: '#FAF9F7',
    });
  });
});

describe('assistantShelfBounds', () => {
  it('centres inside a positive-origin work area', () => {
    expect(assistantShelfBounds({ x: 0, y: 25, width: 1512, height: 957 })).toEqual({
      x: 446, y: 43, width: 620, height: 192,
    });
  });

  it('centres inside a negative-origin secondary display', () => {
    expect(assistantShelfBounds({ x: -1440, y: 0, width: 1440, height: 900 })).toEqual({
      x: -1030, y: 18, width: 620, height: 192,
    });
  });
});

describe('assistantWindowController', () => {
  it('positions on the pointer display before showing and focuses the renderer', () => {
    const calls: string[] = [];
    const win = fakeWindow(calls);
    const getCursorScreenPoint = vi.fn(() => ({ x: -100, y: 200 }));
    const getDisplayNearestPoint = vi.fn(() => ({
      workArea: { x: -1440, y: 0, width: 1440, height: 900 },
    }));
    const controller = createAssistantWindowController({
      createWindow: () => win,
      preloadPath: '/x/preload.cjs',
      entry: { kind: 'file', target: '/x/assistant.html' },
      getCursorScreenPoint,
      getDisplayNearestPoint,
      beforeShow: () => calls.push('snapshot'),
      platform: 'darwin',
    });

    controller.create();
    win.emit('ready-to-show');
    controller.showAndFocus();

    expect(getCursorScreenPoint).toHaveBeenCalled();
    expect(getDisplayNearestPoint).toHaveBeenCalledWith({ x: -100, y: 200 });
    expect(win.setBounds).toHaveBeenCalledWith(
      { x: -1030, y: 18, width: 620, height: 192 },
      false,
    );
    expect(calls).toEqual(['bounds', 'snapshot', 'show', 'focus', 'web-focus']);
  });

  // Fixed placement is not the same as placed once. Something outside Phase
  // may have moved the panel between summons, so every reveal re-derives the
  // bounds rather than trusting where the window was left.
  it('re-centres on every reveal, not only the first', () => {
    const calls: string[] = [];
    const win = fakeWindow(calls);
    const controller = controllerWith(win, {}, calls);
    controller.create();
    win.emit('ready-to-show');

    controller.showAndFocus();
    controller.hide();
    controller.showAndFocus();

    expect(win.setBounds).toHaveBeenCalledTimes(2);
    expect(win.setBounds).toHaveBeenLastCalledWith(
      { x: 446, y: 18, width: 620, height: 192 },
      false,
    );
  });

  it('prewarms hidden at startup and reveals only after ready-to-show', () => {
    const calls: string[] = [];
    const win = fakeWindow(calls);
    const controller = controllerWith(win, {}, calls);
    controller.create();
    expect(win.show).not.toHaveBeenCalled();
    controller.showAndFocus();
    expect(win.show).not.toHaveBeenCalled();
    win.emit('ready-to-show');
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['bounds', 'snapshot', 'show', 'focus', 'web-focus']);
  });

  it('waits for ready-to-show before a lazy first reveal', () => {
    const calls: string[] = [];
    const win = fakeWindow(calls);
    const controller = controllerWith(win, {}, calls);
    controller.showAndFocus();
    expect(win.show).not.toHaveBeenCalled();
    win.emit('ready-to-show');
    expect(calls).toEqual(['bounds', 'snapshot', 'show', 'focus', 'web-focus']);
  });

  it('hides on blur and a second invocation can be represented by isShowing', () => {
    const win = fakeWindow([]);
    const controller = controllerWith(win);
    controller.create();
    win.emit('ready-to-show');
    controller.showAndFocus();
    expect(controller.isShowing()).toBe(true);
    win.emit('blur');
    expect(win.hide).toHaveBeenCalledTimes(1);
    expect(controller.isShowing()).toBe(false);
  });

  it('configures a floating panel and denies every window open', () => {
    const win = fakeWindow([]);
    const createWindow = vi.fn(() => win);
    const controller = controllerWith(win, { createWindow });
    controller.create();
    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      type: 'panel', width: 620, height: 192,
    }));
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    expect(win.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1);
    const handler = win.webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(handler({})).toEqual({ action: 'deny' });
  });

  it('loads only the injected file or url entry', () => {
    const file = fakeWindow([]);
    const fileController = controllerWith(file);
    fileController.create();
    expect(file.loadFile).toHaveBeenCalledWith('/x/assistant.html');
    expect(file.loadURL).not.toHaveBeenCalled();

    const url = fakeWindow([]);
    const urlController = controllerWith(url, {
      entry: { kind: 'url', target: 'http://localhost:5173/assistant.html' },
    });
    urlController.create();
    expect(url.loadURL).toHaveBeenCalledWith('http://localhost:5173/assistant.html');
    expect(url.loadFile).not.toHaveBeenCalled();
  });

  it('clears its handle on closed and recreates on the next show', () => {
    const first = fakeWindow([]);
    const second = fakeWindow([]);
    const createWindow = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const controller = controllerWith(first, { createWindow });
    controller.create();
    first.emit('closed');
    expect(controller.current()).toBeNull();
    controller.showAndFocus();
    expect(createWindow).toHaveBeenCalledTimes(2);
    expect(controller.current()).toBe(second);
  });

  it('recreates only when invoked after the renderer exits', () => {
    const first = fakeWindow([]);
    const second = fakeWindow([]);
    const createWindow = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const controller = controllerWith(first, { createWindow });
    controller.create();
    first.webContents.emit('render-process-gone');
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(controller.current()).toBeNull();
    controller.showAndFocus();
    expect(createWindow).toHaveBeenCalledTimes(2);
  });

  it('recovers a pending main-frame load failure and recreates on the next show', () => {
    const first = fakeWindow([]);
    const second = fakeWindow([]);
    const createWindow = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const logError = vi.fn();
    const controller = controllerWith(first, { createWindow, logError });
    controller.showAndFocus();
    first.webContents.emit(
      'did-fail-load',
      {},
      -3,
      'ERR_ABORTED',
      'file:///x/assistant.html',
      true,
      1,
      1,
    );
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(controller.current()).toBeNull();
    expect(controller.isShowing()).toBe(false);
    controller.showAndFocus();
    expect(createWindow).toHaveBeenCalledTimes(2);
    expect(controller.current()).toBe(second);
    expect(logError).toHaveBeenCalledWith(
      '[phase-assistant] shelf window unavailable',
      expect.objectContaining({
        message: expect.stringContaining('ERR_ABORTED'),
      }),
    );
  });

  it('swallows a rejected file load and recovers exactly once via did-fail-load', async () => {
    let rejectLoad: (reason: unknown) => void = () => {};
    const loadFailure = new Promise<unknown>((_resolve, reject) => {
      rejectLoad = reject;
    });
    const loadPaths: string[] = [];
    const first = fakeWindow([], {
      loadFileResult: (path) => {
        loadPaths.push(path);
        return loadFailure;
      },
    });
    const second = fakeWindow([]);
    const createWindow = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const logError = vi.fn();
    const controller = controllerWith(first, { createWindow, logError });

    controller.showAndFocus();
    expect(loadPaths).toEqual(['/x/assistant.html']);

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      rejectLoad(new Error('file load failed'));
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(first.destroy).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
    expect(controller.current()).toBe(first);

    first.webContents.emit(
      'did-fail-load',
      {},
      -3,
      'ERR_ABORTED',
      'file:///x/assistant.html',
      true,
      1,
      1,
    );
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(controller.current()).toBeNull();
    controller.showAndFocus();
    expect(createWindow).toHaveBeenCalledTimes(2);
    expect(controller.current()).toBe(second);
  });

  it('swallows a rejected url load and recovers exactly once via did-fail-load', async () => {
    let rejectLoad: (reason: unknown) => void = () => {};
    const loadFailure = new Promise<unknown>((_resolve, reject) => {
      rejectLoad = reject;
    });
    const loadPaths: string[] = [];
    const first = fakeWindow([], {
      loadURLResult: (path) => {
        loadPaths.push(path);
        return loadFailure;
      },
    });
    const second = fakeWindow([]);
    const createWindow = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const logError = vi.fn();
    const controller = controllerWith(first, {
      createWindow,
      logError,
      entry: { kind: 'url', target: 'http://localhost:5173/assistant.html' },
    });

    controller.showAndFocus();
    expect(loadPaths).toEqual(['http://localhost:5173/assistant.html']);

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      rejectLoad(new Error('url load failed'));
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(first.destroy).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
    expect(controller.current()).toBe(first);

    first.webContents.emit(
      'did-fail-load',
      {},
      -3,
      'ERR_ABORTED',
      'http://localhost:5173/assistant.html',
      true,
      1,
      1,
    );
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(controller.current()).toBeNull();
    controller.showAndFocus();
    expect(createWindow).toHaveBeenCalledTimes(2);
    expect(controller.current()).toBe(second);
  });

  it('supports a void loader', () => {
    const loadPaths: string[] = [];
    const win = fakeWindow([], {
      loadFileResult: (path) => {
        loadPaths.push(path);
      },
    });
    const controller = controllerWith(win);
    controller.showAndFocus();
    expect(loadPaths).toEqual(['/x/assistant.html']);
    win.emit('ready-to-show');
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(controller.current()).toBe(win);
  });

  it('ignores did-fail-load for subframes', () => {
    const win = fakeWindow([]);
    const controller = controllerWith(win);
    controller.showAndFocus();
    win.webContents.emit(
      'did-fail-load',
      {},
      -3,
      'ERR_ABORTED',
      'file:///x/assistant.html',
      false,
      1,
      1,
    );
    expect(win.destroy).not.toHaveBeenCalled();
    expect(controller.current()).toBe(win);
    expect(controller.isShowing()).toBe(false);
  });

  it('destroys exactly once when terminal events pile up', () => {
    const win = fakeWindow([]);
    const controller = controllerWith(win);
    controller.showAndFocus();
    win.webContents.emit(
      'did-fail-load',
      {},
      -3,
      'ERR_ABORTED',
      'file:///x/assistant.html',
      true,
      1,
      1,
    );
    win.webContents.emit('render-process-gone', {}, 'crashed');
    win.webContents.emit(
      'did-fail-load',
      {},
      -106,
      'ERR_INTERNET_DISCONNECTED',
      'file:///x/assistant.html',
      true,
      1,
      1,
    );
    expect(win.destroy).toHaveBeenCalledTimes(1);
    expect(controller.current()).toBeNull();
  });

  it('destroys exactly once for repeated main-frame load failures', () => {
    const win = fakeWindow([]);
    const controller = controllerWith(win);
    controller.showAndFocus();
    win.webContents.emit(
      'did-fail-load',
      {},
      -3,
      'ERR_ABORTED',
      'file:///x/assistant.html',
      true,
      1,
      1,
    );
    win.webContents.emit(
      'did-fail-load',
      {},
      -106,
      'ERR_INTERNET_DISCONNECTED',
      'file:///x/assistant.html',
      true,
      1,
      1,
    );
    expect(win.destroy).toHaveBeenCalledTimes(1);
    expect(controller.current()).toBeNull();
  });

  it('ignores a stale did-fail-load after dispose', () => {
    const win = fakeWindow([]);
    const controller = controllerWith(win);
    controller.showAndFocus();
    controller.dispose();
    win.webContents.emit(
      'did-fail-load',
      {},
      -3,
      'ERR_ABORTED',
      'file:///x/assistant.html',
      true,
      1,
      1,
    );
    expect(win.destroy).toHaveBeenCalledTimes(1);
    expect(controller.current()).toBeNull();
  });

  it('cancels a pending show and destroys exactly once on dispose', () => {
    const win = fakeWindow([]);
    const controller = controllerWith(win);
    controller.showAndFocus();
    controller.hide();
    win.emit('ready-to-show');
    expect(win.show).not.toHaveBeenCalled();
    controller.dispose();
    controller.dispose();
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });

  it('hides idempotently and never destroys on hide', () => {
    const win = fakeWindow([]);
    const controller = controllerWith(win);
    controller.create();
    win.emit('ready-to-show');
    controller.showAndFocus();
    controller.hide();
    controller.hide();
    expect(win.hide).toHaveBeenCalledTimes(2);
    expect(win.destroy).not.toHaveBeenCalled();
    expect(controller.isShowing()).toBe(false);
  });

  it('positions without revealing the window', () => {
    const win = fakeWindow([]);
    const controller = controllerWith(win);
    controller.create();
    win.emit('ready-to-show');
    controller.position();
    expect(win.setBounds).toHaveBeenCalledTimes(1);
    expect(win.show).not.toHaveBeenCalled();
  });

  it('logs a window failure and keeps every public verb safe', () => {
    const logError = vi.fn();
    const controller = createAssistantWindowController({
      createWindow: () => { throw new Error('boom'); },
      preloadPath: '/x/preload.cjs',
      entry: { kind: 'file', target: '/x/assistant.html' },
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({
        workArea: { x: 0, y: 0, width: 1512, height: 957 },
      }),
      beforeShow: () => {},
      platform: 'darwin',
      logError,
    });
    expect(() => controller.create()).not.toThrow();
    expect(() => controller.showAndFocus()).not.toThrow();
    expect(() => controller.hide()).not.toThrow();
    expect(() => controller.dispose()).not.toThrow();
    expect(controller.current()).toBeNull();
    expect(controller.isShowing()).toBe(false);
    expect(logError).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith('[phase-assistant] shelf window unavailable', expect.any(Error));
  });
});
