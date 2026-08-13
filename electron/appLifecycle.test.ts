import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { createAppLifecycle, shouldShowMainAtLaunch } =
  nativeRequire('./appLifecycle.cjs') as typeof import('./appLifecycle.cjs');

type Controller = ReturnType<typeof createAppLifecycle>;
type Listener = (...args: unknown[]) => void;

interface FakeApp {
  on(event: string, listener: Listener): void;
  removeListener(event: string, listener: Listener): void;
  emit(event: string, ...args: unknown[]): void;
  recorded: Map<string, Listener[]>;
  removed: Array<{ event: string; listener: Listener }>;
}

function fakeApp(): FakeApp {
  const recorded = new Map<string, Listener[]>();
  const removed: Array<{ event: string; listener: Listener }> = [];
  return {
    on(event, listener) {
      const list = recorded.get(event) ?? [];
      list.push(listener);
      recorded.set(event, list);
    },
    removeListener(event, listener) {
      removed.push({ event, listener });
      const list = recorded.get(event) ?? [];
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    },
    emit(event, ...args) {
      for (const listener of [...(recorded.get(event) ?? [])]) listener(...args);
    },
    recorded,
    removed,
  };
}

interface FakeWindow {
  hide: ReturnType<typeof vi.fn>;
  on(event: string, listener: Listener): void;
  emit(event: string, ...args: unknown[]): void;
}

function fakeWindow(): FakeWindow {
  const recorded = new Map<string, Listener[]>();
  return {
    hide: vi.fn(),
    on(event, listener) {
      const list = recorded.get(event) ?? [];
      list.push(listener);
      recorded.set(event, list);
    },
    emit(event, ...args) {
      for (const listener of [...(recorded.get(event) ?? [])]) listener(...args);
    },
  };
}

function closeEvent() {
  return { preventDefault: vi.fn() };
}

interface Fixture {
  controller: Controller;
  app: FakeApp;
  main: FakeWindow;
  onActivate: ReturnType<typeof vi.fn>;
  onWillQuit: ReturnType<typeof vi.fn>;
}

function lifecycle(): Fixture {
  const app = fakeApp();
  const main = fakeWindow();
  const onActivate = vi.fn();
  const onWillQuit = vi.fn();
  const controller = createAppLifecycle({ app, onActivate, onWillQuit });
  return { controller, app, main, onActivate, onWillQuit };
}

describe('shouldShowMainAtLaunch', () => {
  it('keeps a login launch hidden and shows a normal launch', () => {
    expect(shouldShowMainAtLaunch({ wasOpenedAtLogin: true })).toBe(false);
    expect(shouldShowMainAtLaunch({ wasOpenedAtLogin: false })).toBe(true);
  });

  it('shows the Hub when the login setting is absent', () => {
    expect(shouldShowMainAtLaunch({})).toBe(true);
  });
});

describe('createAppLifecycle', () => {
  it('attaches exactly the three app listeners, once per register', () => {
    const { controller, app } = lifecycle();
    controller.register();
    controller.register();
    expect([...app.recorded.keys()].sort()).toEqual(['activate', 'before-quit', 'will-quit']);
    expect(app.recorded.get('before-quit')).toHaveLength(1);
    expect(app.recorded.get('activate')).toHaveLength(1);
    expect(app.recorded.get('will-quit')).toHaveLength(1);
  });

  it('prevents an ordinary Hub close and hides it once', () => {
    const { controller, main } = lifecycle();
    controller.register();
    controller.protectMainWindow(main);
    const event = closeEvent();
    main.emit('close', event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(main.hide).toHaveBeenCalledTimes(1);
  });

  it('hides on every ordinary close, once per event', () => {
    const { controller, main } = lifecycle();
    controller.register();
    controller.protectMainWindow(main);
    const first = closeEvent();
    const second = closeEvent();
    main.emit('close', first);
    main.emit('close', second);
    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    expect(second.preventDefault).toHaveBeenCalledTimes(1);
    expect(main.hide).toHaveBeenCalledTimes(2);
  });

  it('lets a close through after before-quit', () => {
    const { controller, app, main } = lifecycle();
    controller.register();
    controller.protectMainWindow(main);
    expect(controller.isQuitting()).toBe(false);
    app.emit('before-quit');
    expect(controller.isQuitting()).toBe(true);
    const event = closeEvent();
    main.emit('close', event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(main.hide).not.toHaveBeenCalled();
  });

  it('calls onActivate once per activation event', () => {
    const { controller, app, onActivate } = lifecycle();
    controller.register();
    app.emit('activate');
    app.emit('activate');
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('calls onWillQuit once per will-quit event', () => {
    const { controller, app, onWillQuit } = lifecycle();
    controller.register();
    app.emit('will-quit');
    app.emit('will-quit');
    expect(onWillQuit).toHaveBeenCalledTimes(2);
  });

  it('protects every window it is given, all hidden on close and all freed by quit', () => {
    const { controller, app } = lifecycle();
    const a = fakeWindow();
    const b = fakeWindow();
    controller.register();
    controller.protectMainWindow(a);
    controller.protectMainWindow(b);
    const beforeA = closeEvent();
    const beforeB = closeEvent();
    a.emit('close', beforeA);
    b.emit('close', beforeB);
    expect(beforeA.preventDefault).toHaveBeenCalledTimes(1);
    expect(beforeB.preventDefault).toHaveBeenCalledTimes(1);
    expect(a.hide).toHaveBeenCalledTimes(1);
    expect(b.hide).toHaveBeenCalledTimes(1);
    app.emit('before-quit');
    const afterA = closeEvent();
    const afterB = closeEvent();
    a.emit('close', afterA);
    b.emit('close', afterB);
    expect(afterA.preventDefault).not.toHaveBeenCalled();
    expect(afterB.preventDefault).not.toHaveBeenCalled();
  });

  it('dispose removes exactly the three registered listener functions', () => {
    const { controller, app } = lifecycle();
    controller.register();
    const beforeQuitListener = app.recorded.get('before-quit')![0];
    const activateListener = app.recorded.get('activate')![0];
    const willQuitListener = app.recorded.get('will-quit')![0];
    controller.dispose();
    expect(app.removed).toEqual([
      { event: 'before-quit', listener: beforeQuitListener },
      { event: 'activate', listener: activateListener },
      { event: 'will-quit', listener: willQuitListener },
    ]);
  });

  it('dispose stops the app callbacks from firing', () => {
    const { controller, app, onActivate, onWillQuit } = lifecycle();
    controller.register();
    controller.dispose();
    app.emit('activate');
    app.emit('will-quit');
    expect(onActivate).not.toHaveBeenCalled();
    expect(onWillQuit).not.toHaveBeenCalled();
  });

  it('dispose before register is a quiet no-op', () => {
    const { controller, app } = lifecycle();
    expect(() => controller.dispose()).not.toThrow();
    expect(app.removed).toHaveLength(0);
  });

  it('repeated dispose is idempotent', () => {
    const { controller, app } = lifecycle();
    controller.register();
    controller.dispose();
    controller.dispose();
    expect(app.removed).toHaveLength(3);
  });

  it('register works again after dispose', () => {
    const { controller, app, onActivate } = lifecycle();
    controller.register();
    controller.dispose();
    controller.register();
    expect(app.recorded.get('activate')).toHaveLength(1);
    app.emit('activate');
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
