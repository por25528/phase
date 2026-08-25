import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';

/**
 * The advisor's cap, read from its source the way `declaredVerbs` reads the
 * action union — this seam's tests check hand-kept copies against the original,
 * and an import would need the nodenext extension dance for one number.
 */
function advisorMaxAlternatives(): number {
  const source = readFileSync(
    new URL('../src/lib/executionAdvisor.ts', import.meta.url), 'utf8',
  );
  const match = source.match(/export const MAX_ALTERNATIVES = (\d+);/);
  expect(match, 'MAX_ALTERNATIVES not found in executionAdvisor.ts').not.toBeNull();
  return Number(match![1]);
}

const nativeRequire = createRequire(import.meta.url);
const { createAssistantIpc, ASSISTANT_CHANNEL_PREFIX } =
  nativeRequire('./assistantIpc.cjs') as typeof import('./assistantIpc.cjs');

type Listener = (event: { sender: { id: number } }, payload?: unknown) => unknown;

/** A fake ipcMain that records registrations and lets tests invoke them. */
function fakeIpcMain() {
  const on = new Map<string, Listener>();
  const handles = new Map<string, Listener>();
  return {
    on: vi.fn((channel: string, listener: Listener) => on.set(channel, listener)),
    handle: vi.fn((channel: string, listener: Listener) => handles.set(channel, listener)),
    removeAllListeners: vi.fn((channel: string) => on.delete(channel)),
    removeHandler: vi.fn((channel: string) => handles.delete(channel)),
    emit: (channel: string, senderId: number, payload?: unknown) =>
      on.get(channel)?.({ sender: { id: senderId } }, payload),
    invoke: (channel: string, senderId: number, payload?: unknown) =>
      handles.get(channel)?.({ sender: { id: senderId } }, payload),
    channels: () => [...on.keys(), ...handles.keys()],
  };
}

function fakeWindow(id: number) {
  return {
    isDestroyed: () => false,
    webContents: { id, send: vi.fn() },
  };
}

const MAIN_ID = 1;
const OVERLAY_ID = 2;
const STRANGER_ID = 9;

function relay() {
  const main = fakeWindow(MAIN_ID);
  const overlay = fakeWindow(OVERLAY_ID);
  const hideAssistant = vi.fn();
  const ipcMain = fakeIpcMain();
  const ipc = createAssistantIpc({
    getMainWindow: () => main,
    getAssistantWindow: () => overlay,
    hideAssistant,
  });
  ipc.register(ipcMain);
  return { main, overlay, hideAssistant, ipcMain, ipc };
}

const SNAPSHOT = {
  status: 'ready',
  advice: {
    kind: 'work',
    primary: {
      key: 'step:n1',
      ref: { kind: 'step', id: 'n1', goalId: 'g1' },
      title: 'Problem set 4',
      goalTitle: 'Algorithms',
      reason: 'scheduled-now',
      expected: { kind: 'estimate', minutes: 45 },
    },
    alternatives: [],
  },
  activeFocus: null,
  timeLevel: 'medium',
  focusLevel: 'medium',
  theme: 'dark',
};

const FOCUSED_SNAPSHOT = {
  ...SNAPSHOT,
  activeFocus: {
    ref: { kind: 'step', id: 'n1', goalId: 'g1' },
    title: 'Problem set 4',
    goalTitle: 'Algorithms',
    phase: 'active',
    elapsedMin: 0,
    expected: { kind: 'estimate', minutes: 45 },
  },
};

describe('publish', () => {
  it('accepts a snapshot only from the main window sender', () => {
    const { ipcMain, overlay, ipc } = relay();
    ipcMain.emit('phase-assistant:publish', STRANGER_ID, SNAPSHOT);
    expect(ipc.latest()).toBeNull();
    expect(overlay.webContents.send).not.toHaveBeenCalled();

    ipcMain.emit('phase-assistant:publish', MAIN_ID, SNAPSHOT);
    expect(ipc.latest()).toEqual(SNAPSHOT);
    expect(overlay.webContents.send).toHaveBeenCalledWith('phase-assistant:snapshot', SNAPSHOT);
  });

  it('rejects a snapshot from the overlay itself', () => {
    const { ipcMain, ipc } = relay();
    ipcMain.emit('phase-assistant:publish', OVERLAY_ID, SNAPSHOT);
    expect(ipc.latest()).toBeNull();
  });

  it('rejects malformed, oversized, and unknown union members', () => {
    const { ipcMain, ipc } = relay();
    const bad = [
      null,
      'text',
      { status: 'happy' },
      { status: 'ready' }, // missing advice
      { ...SNAPSHOT, advice: { kind: 'panic' } },
      {
        ...SNAPSHOT,
        advice: {
          ...SNAPSHOT.advice,
          primary: { ...SNAPSHOT.advice.primary, title: 'x'.repeat(10_000) },
        },
      },
      {
        ...SNAPSHOT,
        advice: {
          ...SNAPSHOT.advice,
          alternatives: Array.from({ length: 10 }, () => SNAPSHOT.advice.primary),
        },
      },
      { ...SNAPSHOT, notice: { tone: 'alarm', text: 'boom' } },
      { ...SNAPSHOT, timeLevel: 'sideways' },
    ];
    for (const snapshot of bad) {
      ipcMain.emit('phase-assistant:publish', MAIN_ID, snapshot);
      expect(ipc.latest(), JSON.stringify(snapshot)?.slice(0, 60)).toBeNull();
    }
  });

  /**
   * The snapshot-side twin of the verb-list hazard below: the relay's
   * alternatives cap is a hand-kept copy of `MAX_ALTERNATIVES`, and when the
   * advisor's moved 2 → 3 the copy stayed. Every snapshot holding a third
   * alternative was then silently dropped, so the ⌘Space overlay froze on its
   * cached one — every control on it looked live and did nothing, while the
   * embedded panel, which never crosses this seam, worked.
   */
  it('accepts a snapshot carrying every alternative the advisor may send', () => {
    const { ipcMain, ipc } = relay();
    const full = {
      ...SNAPSHOT,
      advice: {
        ...SNAPSHOT.advice,
        alternatives: Array.from({ length: advisorMaxAlternatives() }, () => SNAPSHOT.advice.primary),
      },
    };
    ipcMain.emit('phase-assistant:publish', MAIN_ID, full);
    expect(ipc.latest()).toEqual(full);
  });

  it('requires a valid work reference on an active focus projection', () => {
    const { ipcMain, ipc } = relay();

    ipcMain.emit('phase-assistant:publish', MAIN_ID, FOCUSED_SNAPSHOT);
    expect(ipc.latest()).toEqual(FOCUSED_SNAPSHOT);

    const missing = {
      ...FOCUSED_SNAPSHOT,
      activeFocus: { ...FOCUSED_SNAPSHOT.activeFocus, ref: undefined },
    };
    ipcMain.emit('phase-assistant:publish', MAIN_ID, missing);
    expect(ipc.latest()).toEqual(FOCUSED_SNAPSHOT);

    const malformed = {
      ...FOCUSED_SNAPSHOT,
      activeFocus: {
        ...FOCUSED_SNAPSHOT.activeFocus,
        ref: { kind: 'step', id: 'n1' },
      },
    };
    ipcMain.emit('phase-assistant:publish', MAIN_ID, malformed);
    expect(ipc.latest()).toEqual(FOCUSED_SNAPSHOT);
  });

  /*
   * The overlay is a second renderer and cannot see the app's `.dark` class, so
   * the palette has to cross this relay like everything else it knows. It must
   * be the RESOLVED one: `'system'` is a preference, and a preference resolved
   * on the far side is how two windows come to disagree.
   *
   * Required rather than optional, because the failure is silent — an absent
   * theme renders as light, which is exactly the bug this closed.
   */
  it('requires the resolved palette, and refuses the unresolved preference', () => {
    const { ipcMain, ipc } = relay();
    const bad = [
      { ...SNAPSHOT, theme: undefined },
      { ...SNAPSHOT, theme: 'system' },
      { ...SNAPSHOT, theme: 'Dark' },
      { ...SNAPSHOT, theme: true },
    ];
    for (const snapshot of bad) {
      ipcMain.emit('phase-assistant:publish', MAIN_ID, snapshot);
      expect(ipc.latest(), JSON.stringify(snapshot)?.slice(0, 60)).toBeNull();
    }

    ipcMain.emit('phase-assistant:publish', MAIN_ID, { ...SNAPSHOT, theme: 'light' });
    expect(ipc.latest()).toEqual({ ...SNAPSHOT, theme: 'light' });
  });

  it('rejects a snapshot missing or malformed in either level', () => {
    const { ipcMain, ipc } = relay();
    const bad = [
      { ...SNAPSHOT, focusLevel: undefined },
      { ...SNAPSHOT, focusLevel: 'LOW' },
      { ...SNAPSHOT, timeLevel: undefined },
      { ...SNAPSHOT, timeLevel: 'sideways' },
    ];
    for (const snapshot of bad) {
      ipcMain.emit('phase-assistant:publish', MAIN_ID, snapshot);
      expect(ipc.latest(), JSON.stringify(snapshot)?.slice(0, 60)).toBeNull();
    }

    ipcMain.emit('phase-assistant:publish', MAIN_ID, SNAPSHOT);
    expect(ipc.latest()).toEqual(SNAPSHOT);
  });
});

describe('ready', () => {
  it('returns the cached sanitized snapshot to the overlay and asks main for a fresh one', () => {
    const { ipcMain, main } = relay();
    ipcMain.emit('phase-assistant:publish', MAIN_ID, SNAPSHOT);
    const result = ipcMain.invoke('phase-assistant:ready', OVERLAY_ID);
    expect(result).toEqual(SNAPSHOT);
    expect(main.webContents.send).toHaveBeenCalledWith('phase-assistant:request-snapshot');
  });

  it('returns loading before anything was published', () => {
    const { ipcMain } = relay();
    expect(ipcMain.invoke('phase-assistant:ready', OVERLAY_ID)).toEqual({ status: 'loading' });
  });

  it('gives a stranger nothing but loading', () => {
    const { ipcMain, main } = relay();
    ipcMain.emit('phase-assistant:publish', MAIN_ID, SNAPSHOT);
    expect(ipcMain.invoke('phase-assistant:ready', STRANGER_ID)).toEqual({ status: 'loading' });
    expect(main.webContents.send).not.toHaveBeenCalled();
  });
});

describe('act', () => {
  it('forwards a validated action from the overlay to the main renderer', () => {
    const { ipcMain, main } = relay();
    const action = { type: 'complete-focus' };
    ipcMain.emit('phase-assistant:act', OVERLAY_ID, action);
    expect(main.webContents.send).toHaveBeenCalledWith('phase-assistant:action', action);
  });

  it('rejects an action from the main window or a stranger', () => {
    const { ipcMain, main } = relay();
    ipcMain.emit('phase-assistant:act', MAIN_ID, { type: 'complete-focus' });
    ipcMain.emit('phase-assistant:act', STRANGER_ID, { type: 'complete-focus' });
    expect(main.webContents.send).not.toHaveBeenCalled();
  });

  it('rejects malformed, oversized, and unknown actions', () => {
    const { ipcMain, main } = relay();
    const bad = [
      null,
      { type: 'drop-tables' },
      { type: 'start-focus', ref: { kind: 'wormhole', id: 'n1' } },
      { type: 'confirm-focus', minutes: Infinity },
      // The retired typed vocabulary, WELL FORMED: the verb itself is gone, so
      // an old overlay build cannot smuggle one past a shape check.
      { type: 'submit-input', text: 'Add lab report Friday' },
      { type: 'confirm-proposal', id: 'p1' },
      { type: 'choose-subject', proposalId: 'p1', subjectId: 'n1' },
      { type: 'cancel-proposal' },
    ];
    for (const action of bad) {
      ipcMain.emit('phase-assistant:act', OVERLAY_ID, action);
    }
    expect(main.webContents.send).not.toHaveBeenCalled();

    ipcMain.emit('phase-assistant:act', OVERLAY_ID, { type: 'confirm-focus', minutes: null });
    expect(main.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('forwards both level verbs and rejects the retired one', () => {
    const { ipcMain, main } = relay();
    ipcMain.emit('phase-assistant:act', OVERLAY_ID, { type: 'set-focus-level', level: 'high' });
    ipcMain.emit('phase-assistant:act', OVERLAY_ID, { type: 'set-time-level', level: 'low' });
    expect(main.webContents.send).toHaveBeenCalledTimes(2);

    main.webContents.send.mockClear();
    const bad = [
      { type: 'set-focus-level', level: 'huge' },
      { type: 'set-time-level', level: 'HIGH' },
      // The old verb, WELL FORMED: renaming it is the point, so an overlay
      // build from before this change must not still be able to set the dial.
      { type: 'set-detail-level', level: 'high' },
    ];
    for (const action of bad) {
      ipcMain.emit('phase-assistant:act', OVERLAY_ID, action);
    }
    expect(main.webContents.send).not.toHaveBeenCalled();
  });
});

describe('close', () => {
  it('hides the overlay only when the overlay asks', () => {
    const { ipcMain, hideAssistant } = relay();
    ipcMain.emit('phase-assistant:close', MAIN_ID);
    ipcMain.emit('phase-assistant:close', STRANGER_ID);
    expect(hideAssistant).not.toHaveBeenCalled();
    ipcMain.emit('phase-assistant:close', OVERLAY_ID);
    expect(hideAssistant).toHaveBeenCalledTimes(1);
  });
});

describe('dispose', () => {
  it('unregisters every channel and drops the cached snapshot', () => {
    const { ipcMain, ipc } = relay();
    ipcMain.emit('phase-assistant:publish', MAIN_ID, SNAPSHOT);
    ipc.dispose(ipcMain);
    expect(ipc.latest()).toBeNull();
    expect(ipcMain.removeAllListeners).toHaveBeenCalled();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('phase-assistant:ready');
  });
});

/**
 * The sandboxed preloads write channel names out by hand — these checks are
 * the only thing stopping the two lists drifting from the main process.
 */
describe('preload surfaces', () => {
  const mainPreload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
  const overlayPreload = readFileSync(new URL('./assistantPreload.cjs', import.meta.url), 'utf8');

  it('both preloads use the phase-assistant channel prefix', () => {
    expect(ASSISTANT_CHANNEL_PREFIX).toBe('phase-assistant');
    expect(mainPreload).toContain('phase-assistant:');
    expect(overlayPreload).toContain('phase-assistant:');
  });

  it('the main preload speaks publish/request/action and never the overlay verbs', () => {
    expect(mainPreload).toContain('phase-assistant:publish');
    expect(mainPreload).toContain('phase-assistant:request-snapshot');
    expect(mainPreload).toContain('phase-assistant:action');
    expect(mainPreload).not.toContain('phase-assistant:ready');
    expect(mainPreload).not.toContain('phase-assistant:act\'');
    expect(mainPreload).not.toContain('phase-assistant:close');
  });

  it('the overlay preload speaks ready/snapshot/act/close and cannot publish', () => {
    expect(overlayPreload).toContain('phase-assistant:ready');
    expect(overlayPreload).toContain('phase-assistant:snapshot');
    expect(overlayPreload).toContain('phase-assistant:act');
    expect(overlayPreload).toContain('phase-assistant:close');
    expect(overlayPreload).not.toContain('phase-assistant:publish');
  });

  it('the overlay preload exposes no phaseCalendar API', () => {
    expect(overlayPreload).not.toContain('phaseCalendar');
    expect(overlayPreload).not.toContain('phase-calendar');
  });

  it('neither preload exposes a generic send/invoke escape hatch', () => {
    // Every ipcRenderer call names a literal 'phase-…' channel; a parameterised
    // channel would let the renderer reach any registered handler.
    for (const source of [mainPreload, overlayPreload]) {
      for (const match of source.matchAll(/ipcRenderer\.(?:send|invoke|on|removeListener)\(\s*([^,)]+)/g)) {
        expect(match[1].trim().startsWith("'phase-")).toBe(true);
      }
    }
  });

  it('the main preload exposes a narrow phaseShell speaking the phase-shell prefix', () => {
    expect(mainPreload).toContain('phaseShell');
    expect(mainPreload).toContain('phase-shell:open-assistant');
    expect(mainPreload).toContain('phase-shell:open-settings');
    expect(mainPreload).toContain('phase-shell:get-launch-at-login');
    expect(mainPreload).toContain('phase-shell:set-launch-at-login');
  });

  it('phaseShell subscriptions are fixed-channel and return an unsubscribe', () => {
    expect(mainPreload).toContain("ipcRenderer.on('phase-shell:open-settings'");
    expect(mainPreload).toContain("ipcRenderer.removeListener('phase-shell:open-settings'");
  });

  it('the overlay preload requires nothing but electron', () => {
    for (const match of overlayPreload.matchAll(/require\(([^)]+)\)/g)) {
      expect(match[1].trim()).toBe("'electron'");
    }
  });
});

describe('set-shortcut', () => {
  function shortcutRelay() {
    const main = fakeWindow(MAIN_ID);
    const overlay = fakeWindow(OVERLAY_ID);
    const setShortcut = vi.fn((requested: string) => ({
      requested, active: requested, registered: true, conflict: false,
    }));
    const ipcMain = fakeIpcMain();
    const ipc = createAssistantIpc({
      getMainWindow: () => main,
      getAssistantWindow: () => overlay,
      hideAssistant: vi.fn(),
      setShortcut,
    });
    ipc.register(ipcMain);
    return { ipcMain, setShortcut };
  }

  it('lets only the main window configure the accelerator', () => {
    const { ipcMain, setShortcut } = shortcutRelay();
    expect(ipcMain.invoke('phase-assistant:set-shortcut', OVERLAY_ID, 'Command+Space')).toBeNull();
    expect(ipcMain.invoke('phase-assistant:set-shortcut', STRANGER_ID, 'Command+Space')).toBeNull();
    expect(setShortcut).not.toHaveBeenCalled();

    const status = ipcMain.invoke('phase-assistant:set-shortcut', MAIN_ID, 'Command+Space');
    expect(status).toEqual({
      requested: 'Command+Space', active: 'Command+Space', registered: true, conflict: false,
    });
  });

  it('rejects malformed accelerators before the adapter sees them', () => {
    const { ipcMain, setShortcut } = shortcutRelay();
    for (const bad of [null, 42, '', 'x'.repeat(200), { chord: 'Command+Space' }]) {
      expect(ipcMain.invoke('phase-assistant:set-shortcut', MAIN_ID, bad)).toBeNull();
    }
    expect(setShortcut).not.toHaveBeenCalled();
  });
});

/**
 * Shelf window options, pinned through the pure module. Window lifecycle
 * behavior now lives behind the controller interface in
 * assistantWindowController.test.ts instead of main.cjs source regexes.
 */
describe('shelf window options', () => {
  const windowModule = nativeRequire('./assistantWindow.cjs') as typeof import('./assistantWindow.cjs');

  it('builds a hidden, frameless, taskbar-free window on the dedicated preload', () => {
    const options = windowModule.assistantWindowOptions('/x/assistantPreload.cjs', 'darwin', false);
    expect(options.frame).toBe(false);
    expect(options.show).toBe(false);
    expect(options.skipTaskbar).toBe(true);
    expect(options.webPreferences.contextIsolation).toBe(true);
    expect(options.webPreferences.nodeIntegration).toBe(false);
    expect(options.webPreferences.preload).toBe('/x/assistantPreload.cjs');
    expect(options.maxHeight).toBeGreaterThanOrEqual(options.height);
  });

  it('loads assistant.html in both dev and production, never index.html', () => {
    expect(windowModule.assistantEntry('http://localhost:5173/')).toEqual({
      kind: 'url', target: 'http://localhost:5173/assistant.html',
    });
    const prod = windowModule.assistantEntry(undefined);
    expect(prod.kind).toBe('file');
    expect(prod.target.endsWith('assistant.html')).toBe(true);
    expect(prod.target).not.toContain('index.html');
  });
});

/**
 * main.cjs is the composition root: it alone may know BrowserWindow, screen,
 * Tray, Menu, and nativeImage, and it composes the deep shelf modules behind
 * their interfaces. These source contracts pin which modules it composes, how
 * a login launch stays hidden, and how an explicit quit releases every global
 * resource — the same source-reading technique the preload checks use.
 */
describe('main composition', () => {
  const main = readFileSync(new URL('./main.cjs', import.meta.url), 'utf8');

  it('composes the background Hub and shelf modules', () => {
    expect(main).toContain('createAssistantWindowController');
    expect(main).toContain('createAppLifecycle');
    expect(main).toContain('createShellIpc');
    expect(main).toContain('createMenuBar');
    expect(main).not.toMatch(/window-all-closed[\s\S]{0,100}app\.quit/);
  });

  it('prewarms the shelf without showing the Hub on a login launch', () => {
    expect(main).toMatch(/shouldShowMainAtLaunch\(app\.getLoginItemSettings\(\)\)/);
    expect(main).toMatch(/assistantController\.create\(\)/);
  });

  it('reads Electron nativeTheme dark mode as a boolean property', () => {
    expect(main).toContain('shouldUseDarkColors: () => nativeTheme.shouldUseDarkColors,');
    expect(main).not.toContain('nativeTheme.shouldUseDarkColors()');
  });

  it('releases every global resource on explicit quit', () => {
    expect(main).toContain('assistantShortcut.dispose()');
    expect(main).toContain('globalShortcut.unregisterAll()');
    expect(main).toContain('assistantController?.dispose()');
    expect(main).toContain('menuBar.dispose()');
    expect(main).toContain('assistantIpc.dispose(ipcMain)');
    expect(main).toContain('shellIpc.dispose(ipcMain)');
  });
});

/**
 * The seam's standing hazard: `AssistantAction` is declared in TypeScript and
 * `validAction` is hand-written CommonJS that imports nothing from `src/` by
 * design. They are two lists that must agree, and a verb present in one and
 * missing from the other does not fail to compile, does not throw and does not
 * log — the relay drops it at `default` and the control in the OVERLAY silently
 * does nothing while the identical control in the embedded panel, which never
 * crosses this seam, works perfectly.
 *
 * That is exactly how `complete-work` shipped: the checkbox on the shelf card
 * looked live, did nothing under ⌘Space, and worked in the app window.
 */
describe('the relay accepts every verb the protocol declares', () => {
  const protocol = readFileSync(
    new URL('../src/lib/assistantProtocol.ts', import.meta.url), 'utf8',
  );

  /** The `AssistantAction` union's `type` literals, read from the source. */
  function declaredVerbs(): string[] {
    const start = protocol.indexOf('export type AssistantAction');
    expect(start).toBeGreaterThan(-1);
    // `};` and not `;`: each member ends `{ type: 'x'; ref: WorkRef }`, so the
    // first bare semicolon is a MEMBER separator and slicing there finds one
    // verb. Only the union's last member is followed by `};`.
    const body = protocol.slice(start, protocol.indexOf('};', start));
    return [...body.matchAll(/type:\s*'([a-z-]+)'/g)].map((m) => m[1]);
  }

  /** One well-formed example per verb. Adding a verb means adding a row. */
  const SAMPLES: Record<string, unknown> = {
    'start-focus': { type: 'start-focus', ref: { kind: 'task', id: 't1', goalId: null } },
    'switch-focus': { type: 'switch-focus', ref: { kind: 'step', id: 'n1', goalId: 'g1' } },
    'complete-work': { type: 'complete-work', ref: { kind: 'step', id: 'n1', goalId: 'g1' } },
    'set-time-level': { type: 'set-time-level', level: 'low' },
    'set-focus-level': { type: 'set-focus-level', level: 'high' },
    'pause-focus': { type: 'pause-focus' },
    'resume-focus': { type: 'resume-focus' },
    'complete-focus': { type: 'complete-focus' },
    'confirm-focus': { type: 'confirm-focus', minutes: null },
    close: { type: 'close' },
  };

  it('has a sample for every declared verb, and no stale ones', () => {
    // This half is what makes the next verb impossible to forget: add one to
    // the union and this fails until you write its sample below, at which
    // point the forwarding test fails until you add it to `validAction`.
    expect([...declaredVerbs()].sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  it('forwards each one to the main window', () => {
    for (const verb of declaredVerbs()) {
      const { ipcMain, main } = relay();
      ipcMain.emit('phase-assistant:act', OVERLAY_ID, SAMPLES[verb]);
      // `close` is handled by the relay itself and is deliberately not
      // forwarded — every other verb is the main renderer's to run.
      if (verb === 'close') continue;
      expect(main.webContents.send, `"${verb}" was dropped by validAction`)
        .toHaveBeenCalledWith('phase-assistant:action', SAMPLES[verb]);
    }
  });
});
