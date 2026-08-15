// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantOverlay } from './AssistantOverlay';
import type { AssistantSnapshot } from '../lib/assistantProtocol';
import { sendoffFor } from '../lib/sendoff';

/**
 * jsdom does no layout, so `offsetHeight` is 0 for everything. Standing a
 * number in its place is what lets these tests prove the MECHANISM — that the
 * card's own measurement is what gets pinned, and that it is let go again —
 * rather than a pixel value, which only a real browser can produce.
 */
const SHELF_HEIGHT = 219;

type Ready = Extract<AssistantSnapshot, { status: 'ready' }>;

const WORK: Ready = {
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
  detailLevel: 'medium',
};

const RUNNING: Ready = {
  ...WORK,
  activeFocus: {
    ref: { kind: 'step', id: 'n1', goalId: 'g1' },
    title: 'Problem set 4',
    goalTitle: 'Algorithms',
    phase: 'active',
    elapsedMin: 0,
    expected: { kind: 'estimate', minutes: 45 },
  },
};

let listeners: Array<(snapshot: AssistantSnapshot) => void> = [];
let originalOffsetHeight: PropertyDescriptor | undefined;

beforeEach(() => {
  listeners = [];
  vi.useFakeTimers();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => SHELF_HEIGHT,
  });
  // The overlay reaches the relay through `window.phaseAssistantOverlay`; with
  // no preload it gets an inert stub that can never deliver a snapshot.
  Object.defineProperty(window, 'phaseAssistantOverlay', {
    configurable: true,
    value: {
      ready: async (): Promise<AssistantSnapshot> => ({ status: 'loading' }),
      onSnapshot: (fn: (snapshot: AssistantSnapshot) => void) => {
        listeners.push(fn);
        return () => {};
      },
      act: () => {},
      close: () => {},
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'phaseAssistantOverlay');
  if (originalOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
  }
});

async function mount(): Promise<void> {
  render(<AssistantOverlay />);
  // `ready()` resolves to the relay's cached snapshot; let it land before any
  // pushed snapshot, or it would arrive late and overwrite one.
  await act(async () => { await Promise.resolve(); });
}

function deliver(snapshot: AssistantSnapshot): void {
  act(() => { for (const fn of listeners) fn(snapshot); });
}

function card(): HTMLElement {
  const found = document.querySelector('[data-shelf]');
  if (!(found instanceof HTMLElement)) throw new Error('the shelf card is not rendered');
  return found;
}

describe('AssistantOverlay', () => {
  it('holds the shelf\'s own height through the farewell, and lets go when it returns', async () => {
    await mount();
    deliver(WORK);
    expect(card().style.minHeight).toBe('');

    vi.setSystemTime(new Date('2026-08-15T09:00:00Z'));
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    deliver(RUNNING);

    // The card hugs its content and the farewell is a full quote: unpinned,
    // the shelf would drop to a sliver and fade the sliver.
    const quote = sendoffFor(Date.now());
    const status = screen.getByRole('status').textContent ?? '';
    expect(status).toContain(quote.text);
    expect(status).toContain(quote.source);
    expect(card().style.minHeight).toBe(`${SHELF_HEIGHT}px`);

    // Re-summoned. The card is keyed by `openCycle`, so it remounts — and the
    // pin has to go in that same render, not one frame later in an effect.
    fireEvent.focus(window);
    expect(card().style.minHeight).toBe('');
    // Back to a shelf — the session it just started, not a farewell.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Complete session' })).toBeTruthy();
  });

  it('pins nothing while the shelf is still the shelf', async () => {
    await mount();
    deliver(WORK);
    expect(card().style.minHeight).toBe('');

    // Pending — the owner has not acknowledged the start yet, and the body is
    // still on screen with its button disabled. Nothing to hold up.
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    expect(card().style.minHeight).toBe('');

    // Refused: the send-off is abandoned and the shelf never left.
    deliver({ ...WORK, notice: { tone: 'warning', text: 'A session is already running.' } });
    expect(card().style.minHeight).toBe('');
    expect(screen.getByRole('heading', { name: 'Problem set 4' })).toBeTruthy();
  });
});
