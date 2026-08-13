import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, openAssistantForEnvironment } from './App';
import { actions } from './state/store';
import type { PhaseShellBridge } from './lib/shellBridge';

afterEach(() => {
  if (vi.isFakeTimers()) {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  }
});

describe('App toast announcements', () => {
  it('announces the normal toast once through a polite status region', () => {
    vi.useFakeTimers();
    actions.showToast('Task added');

    const html = renderToStaticMarkup(createElement(App));
    const taskAnnouncement = html.match(
      /<div role="status" aria-live="polite" class="[^"]*">Task added<\/div>/g,
    );

    expect(taskAnnouncement).toHaveLength(1);
  });

  it('visually marks Goals as active in both nav bars on the goal page', () => {
    vi.useFakeTimers();
    actions.openProject('g');
    try {
      const html = renderToStaticMarkup(createElement(App));

      expect(html.match(/aria-current="page"/g)).toHaveLength(2);
      expect(html).toMatch(/aria-current="page"[^>]*bg-ink text-paper font-semibold[^>]*>Goals<\/button>/);
      expect(html).toMatch(/aria-current="page"[^>]*text-ink font-semibold[^>]*>Goals/);
    } finally {
      actions.closeProject();
    }
  });
});

describe('the in-app assistant', () => {
  it('stays closed by default — no assistant surface in the initial markup', () => {
    vi.useFakeTimers();
    const html = renderToStaticMarkup(createElement(App));
    expect(html).not.toContain('Ask the assistant');
  });
});

describe('desktop entry-point routing', () => {
  function fixture(available: boolean): PhaseShellBridge {
    return {
      available,
      openAssistant: vi.fn(async () => true),
      onOpenSettings: () => () => {},
      getLaunchAtLogin: async () => (available ? false : null),
      setLaunchAtLogin: async () => (available ? true : null),
    };
  }

  it('opens the native shelf on desktop and never the embedded host', () => {
    const desktop = fixture(true);
    const openEmbedded = vi.fn();
    openAssistantForEnvironment(desktop, openEmbedded);
    expect(desktop.openAssistant).toHaveBeenCalledTimes(1);
    expect(openEmbedded).not.toHaveBeenCalled();
  });

  it('opens the embedded host once in the browser and never the shelf', () => {
    const browser = fixture(false);
    const openEmbedded = vi.fn();
    openAssistantForEnvironment(browser, openEmbedded);
    expect(browser.openAssistant).not.toHaveBeenCalled();
    expect(openEmbedded).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected shelf request on desktop and never opens the embedded host', async () => {
    // A plain rejected promise (not a vi.fn mock, which swallows the signal)
    // so an unhandled rejection is actually observable.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const desktop: PhaseShellBridge = {
        available: true,
        openAssistant: async () => {
          throw new Error('shell unavailable');
        },
        onOpenSettings: () => () => {},
        getLaunchAtLogin: async () => false,
        setLaunchAtLogin: async () => true,
      };
      const openEmbedded = vi.fn();
      openAssistantForEnvironment(desktop, openEmbedded);

      // Let the fire-and-forget chain settle: the rejection must be caught here
      // (never an unhandled-rejection), and desktop must not fall back to the
      // in-app panel — the shelf owns that surface.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toHaveLength(0);
      expect(openEmbedded).not.toHaveBeenCalled();
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });
});
