import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { navigationDecision, applyNavigationPolicy } =
  nativeRequire('./navigationPolicy.cjs') as typeof import('./navigationPolicy.cjs');

/**
 * The main window's preload is PRIVILEGED. It exposes `phaseAgent`,
 * `phaseBackups`, `phaseCalendar`, `phaseSync` and `phaseShell` — the store's
 * whole write surface, the backup folder and the calendar's tokens — and a
 * preload survives a top-level navigation. So a renderer that can be talked
 * into `location = 'https://…'` hands every one of those to a remote origin,
 * and contextIsolation does not help: the bridge is still there, still bound.
 *
 * Nothing in the app navigates the main frame. That is exactly why the policy
 * can be a whitelist of two entries and a refusal for everything else.
 */

const DEV = 'http://localhost:5173';
const ENTRY = '/Applications/Phase.app/Contents/Resources/app/dist/index.html';

describe('navigationDecision', () => {
  describe('in a packaged build', () => {
    const decide = (url: string) =>
      navigationDecision(url, { devServerUrl: null, appEntryFile: ENTRY });

    it('lets the app load its own entry file', () => {
      expect(decide(`file://${ENTRY}`)).toBe('internal');
    });

    it('lets the entry file reload with a hash or a query', () => {
      // A router or a reload legitimately carries these; they do not change
      // which document is loaded.
      expect(decide(`file://${ENTRY}?v=2`)).toBe('internal');
      expect(decide(`file://${ENTRY}#/today`)).toBe('internal');
    });

    it('refuses any OTHER file, which is the whole local disk', () => {
      expect(decide('file:///etc/passwd')).toBe('block');
      expect(decide('file:///Users/someone/evil.html')).toBe('block');
    });

    it('refuses a sibling file inside its own bundle', () => {
      // `assistant.html` is loaded by its own window, never navigated to here.
      const sibling = ENTRY.replace('index.html', 'assistant.html');
      expect(decide(`file://${sibling}`)).toBe('block');
    });

    it('refuses the dev server it was not built against', () => {
      expect(decide(`${DEV}/`)).toBe('external');
    });

    it('sends a real web link to the browser instead', () => {
      expect(decide('https://phase.app/help')).toBe('external');
      expect(decide('http://example.com')).toBe('external');
    });

    it('refuses every scheme that is not http, https or the entry file', () => {
      for (const url of [
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'blob:file:///abc',
        'about:blank',
        'chrome://settings',
        'devtools://devtools/bundled/inspector.html',
        'ftp://example.com/x',
        'phase://open',
        'vbscript:msgbox(1)',
      ]) {
        expect(decide(url), `${url} was not blocked`).toBe('block');
      }
    });

    it('blocks a scheme dressed up as a web address', () => {
      // `startsWith('http')` — the check this replaces — accepts these.
      expect(decide('httpx://example.com')).toBe('block');
      expect(decide('https-evil://example.com')).toBe('block');
    });

    it('blocks what it cannot parse, rather than guessing', () => {
      expect(decide('')).toBe('block');
      expect(decide('not a url')).toBe('block');
      expect(decide(':::')).toBe('block');
    });

    it('blocks a non-string, which a hostile sender can produce', () => {
      expect(decide(undefined as unknown as string)).toBe('block');
      expect(decide(null as unknown as string)).toBe('block');
      expect(decide({ toString: () => `file://${ENTRY}` } as unknown as string)).toBe('block');
    });
  });

  describe('against a dev server', () => {
    const decide = (url: string) =>
      navigationDecision(url, { devServerUrl: DEV, appEntryFile: ENTRY });

    it('lets the app navigate within the dev origin', () => {
      expect(decide(`${DEV}/`)).toBe('internal');
      expect(decide(`${DEV}/index.html`)).toBe('internal');
      expect(decide(`${DEV}/?x=1#/plan`)).toBe('internal');
    });

    it('holds the origin exactly — a different port is a different server', () => {
      expect(decide('http://localhost:5174/')).toBe('external');
      expect(decide('https://localhost:5173/')).toBe('external');
      expect(decide('http://127.0.0.1:5173/')).toBe('external');
    });

    it('is not fooled by a host that merely contains the dev host', () => {
      // Both would pass a `startsWith`/`includes` check on the origin.
      expect(decide('http://evil-localhost:5173/')).toBe('external');
      // This one cannot even parse — `5173.evil.com` is not a port — so it is
      // refused outright rather than sent to a browser. Stricter, not looser;
      // what matters is that neither is ever `internal`.
      expect(decide('http://localhost:5173.evil.com/')).toBe('block');
    });

    it('still refuses the packaged entry file it is not serving from', () => {
      // In dev the document is the dev server's; a file:// navigation here is
      // not a reload, it is a jump to another document.
      expect(decide(`file://${ENTRY}`)).toBe('block');
    });
  });
});

interface FakeContents {
  on(event: string, listener: (...args: unknown[]) => void): void;
  setWindowOpenHandler(handler: (details: { url: string }) => unknown): void;
  emit(event: string, ...args: unknown[]): unknown;
  openHandler: ((details: { url: string }) => unknown) | null;
}

function fakeContents(): FakeContents {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    openHandler: null,
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    setWindowOpenHandler(handler) {
      this.openHandler = handler;
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
}

describe('applyNavigationPolicy', () => {
  const install = (devServerUrl: string | null = null) => {
    const contents = fakeContents();
    const openExternal = vi.fn(async () => {});
    applyNavigationPolicy(contents as never, {
      devServerUrl,
      appEntryFile: ENTRY,
      openExternal,
    });
    return { contents, openExternal };
  };

  it('registers on both doors, not just the one that was already covered', () => {
    const { contents } = install();
    expect(contents.openHandler, 'window.open is unguarded').not.toBeNull();
    // `will-navigate` is the door that was missing entirely.
    const event = { preventDefault: vi.fn(), url: 'https://evil.example' };
    contents.emit('will-navigate', event, 'https://evil.example');
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('lets the entry file through without preventing it', () => {
    const { contents, openExternal } = install();
    const event = { preventDefault: vi.fn() };
    contents.emit('will-navigate', event, `file://${ENTRY}`);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('sends a web link to the browser and cancels the navigation', () => {
    const { contents, openExternal } = install();
    const event = { preventDefault: vi.fn() };
    contents.emit('will-navigate', event, 'https://phase.app/help');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('https://phase.app/help');
  });

  it('cancels a blocked scheme WITHOUT handing it to the shell', () => {
    // `shell.openExternal('javascript:…')` and friends are how a blocked
    // navigation turns into a worse one.
    const { contents, openExternal } = install();
    const event = { preventDefault: vi.fn() };
    contents.emit('will-navigate', event, 'javascript:alert(1)');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('also guards a navigation inside a subframe', () => {
    const { contents, openExternal } = install();
    const event = { preventDefault: vi.fn() };
    contents.emit('will-frame-navigate', event, 'https://evil.example');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('https://evil.example');
  });

  it('never opens a second in-app window, whatever the target', () => {
    const { contents, openExternal } = install();
    for (const url of [`file://${ENTRY}`, 'https://phase.app', 'javascript:alert(1)']) {
      expect((contents.openHandler as (d: { url: string }) => { action: string })({ url }).action)
        .toBe('deny');
    }
    // Only the real web link earned a browser.
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://phase.app');
  });

  it('survives a shell that refuses, rather than taking the window down', () => {
    const contents = fakeContents();
    const openExternal = vi.fn(() => Promise.reject(new Error('no handler')));
    applyNavigationPolicy(contents as never, {
      devServerUrl: null, appEntryFile: ENTRY, openExternal,
    });
    const event = { preventDefault: vi.fn() };
    expect(() => contents.emit('will-navigate', event, 'https://phase.app')).not.toThrow();
  });
});

/**
 * A policy nothing installs is a module with tests. `main.cjs` is not
 * unit-testable — it reaches for `app`, `BrowserWindow` and a live `shell` at
 * require time — so the REGISTRATION is pinned by reading it, the same way
 * `agentIpc.test.ts` reads the preload to keep its channel list honest.
 */
describe('main.cjs installs the policy', () => {
  const electronDir = path.dirname(fileURLToPath(import.meta.url));
  const main = readFileSync(path.join(electronDir, 'main.cjs'), 'utf8');
  const controller = readFileSync(path.join(electronDir, 'assistantWindowController.cjs'), 'utf8');

  it('requires the policy and applies it to the main window', () => {
    expect(main).toContain("require('./navigationPolicy.cjs')");
    expect(main).toMatch(/applyNavigationPolicy\(\s*win\.webContents/);
  });

  it('gives it the same entry the window actually loads', () => {
    // Two spellings of "the app's document" would drift, and the drift is
    // silent: the policy would block the real entry, or allow a stale one.
    expect(main).toMatch(/const appEntryFile = /);
    expect(main).toContain('win.loadFile(appEntryFile)');
    expect(main).toContain('appEntryFile,');
  });

  it('no longer decides a scheme with startsWith', () => {
    // The handler this replaced read `url.startsWith('http://')` and answered
    // `{ action: 'allow' }` for everything else — the default was inverted, so
    // file:, data: and every custom scheme got a window with the preload in it.
    expect(main).not.toContain("startsWith('http://')");
    expect(main).not.toMatch(/action:\s*'allow'/);
  });

  it('guards the assistant shelf with the same policy', () => {
    expect(main).toMatch(/guardNavigation:\s*\(contents\) => applyNavigationPolicy/);
    expect(controller).toContain('guardNavigation(win.webContents)');
  });

  it('leaves no window open handler that can answer allow', () => {
    for (const file of ['main.cjs', 'assistantWindowController.cjs']) {
      const source = readFileSync(path.join(electronDir, file), 'utf8');
      expect(source, `${file} can still allow a window`).not.toMatch(/action:\s*'allow'/);
    }
  });
});
