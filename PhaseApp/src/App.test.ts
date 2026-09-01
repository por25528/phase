import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, openAssistantForEnvironment, ingestToast } from './App';
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
      // The header tab is a raised segment over the `bg-chip` track, the one
      // answer `SegmentedControl.tsx` settled on — NOT the solid inverted
      // segment that file lists among the four treatments it retired.
      expect(html).toMatch(/aria-current="page"[^>]*bg-raised text-ink shadow-card[^>]*>Goals<\/button>/);
      expect(html).not.toMatch(/aria-current="page"[^>]*bg-ink text-paper/);
      expect(html).toMatch(/aria-current="page"[^>]*text-ink font-semibold[^>]*>Goals/);
    } finally {
      actions.closeProject();
    }
  });

  /**
   * The desktop tabs are content-sized, so a weight that changes with selection
   * re-measures the label and shoves its neighbours sideways on every
   * navigation — the trap `SegmentedControl.tsx` documents ("Bolding the
   * selected one would resize its text"). The bottom bar is exempt and is not
   * covered here: its tabs are `flex-1` thirds, which absorb it.
   *
   * Selection may move colour and surface. It may not move weight.
   */
  it('keeps every desktop nav tab at one font weight, so selecting one cannot resize it', () => {
    const html = renderToStaticMarkup(createElement(App));
    // `title` is what distinguishes the header tabs: only they carry the
    // number-key hint, so this cannot accidentally match the bottom bar.
    const tabs = html.match(/<button[^>]*title="(?:Today|Plan|Goals) \(\d\)"[^>]*>/g);

    expect(tabs).toHaveLength(3);
    for (const tab of tabs!) {
      expect(tab).toContain('font-medium');
      expect(tab).not.toContain('font-semibold');
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
      insetTitleBar: false,
      openAssistant: vi.fn(async () => true),
      onOpenSettings: () => () => {},
      getLaunchAtLogin: async () => (available ? false : null),
      setLaunchAtLogin: async () => (available ? true : null),
      publishFocusStatus: () => {},
      onFocusRequest: () => () => {},
      setPillPrefs: () => {},
      notifyFocus: () => {},
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
        insetTitleBar: false,
        openAssistant: async () => {
          throw new Error('shell unavailable');
        },
        onOpenSettings: () => () => {},
        getLaunchAtLogin: async () => false,
        setLaunchAtLogin: async () => true,
        publishFocusStatus: () => {},
        onFocusRequest: () => () => {},
        notifyFocus: () => {},
        setPillPrefs: () => {},
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

describe('ingestToast', () => {
  it('says nothing when the round did nothing', () => {
    expect(ingestToast(0, 0)).toBeNull();
  });

  it('leads with what applied', () => {
    expect(ingestToast(1, 0)).toBe('Phone: 1 change applied');
    expect(ingestToast(3, 0)).toBe('Phone: 3 changes applied');
  });

  it('appends the shortfall rather than hiding it', () => {
    expect(ingestToast(2, 1)).toBe('Phone: 2 changes applied, 1 couldn\u2019t');
  });

  it('states the failure alone when nothing applied — never "0 changes applied"', () => {
    expect(ingestToast(0, 2)).toBe('2 phone changes couldn\u2019t apply');
    expect(ingestToast(0, 1)).toBe('1 phone change couldn\u2019t apply');
  });
});
