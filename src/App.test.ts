import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { actions } from './state/store';

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
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
