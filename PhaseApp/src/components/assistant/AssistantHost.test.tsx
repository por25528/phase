// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Task } from '../../db/types';
import type { AssistantAction, AssistantSnapshot } from '../../lib/assistantProtocol';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: Task[]; sessions: never[] }> =>
    ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  loadPlanMode: vi.fn(async () => 'week' as const),
  savePlanMode: vi.fn(async () => {}),
  loadGoalsMode: vi.fn(async (): Promise<'board' | 'timeline'> => 'board'),
  saveGoalsMode: vi.fn(async () => {}),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  saveSidebarPanels: vi.fn(async () => {}),
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
  isSlotMigrationDone: vi.fn(async () => true),
  saveSlotMigrationSnapshot: vi.fn(async () => {}),
  loadSlotMigrationSnapshot: vi.fn(async () => null),
  markSlotMigrationDone: vi.fn(async () => {}),
  isCheckpointMigrationDone: vi.fn(async () => true),
  saveCheckpointMigrationSnapshot: vi.fn(async () => {}),
  loadCheckpointMigrationSnapshot: vi.fn(async () => null),
  markCheckpointMigrationDone: vi.fn(async () => {}),
  loadActiveFocusSession: vi.fn(async () => null),
  saveActiveFocusSession: vi.fn(async () => {}),
  loadAssistantAccelerator: vi.fn(async () => 'Command+Space'),
  saveAssistantAccelerator: vi.fn(async () => {}),
  loadStoredTimeLevel: vi.fn(async () => null),
  saveStoredTimeLevel: vi.fn(async () => {}),
  loadStoredFocusLevel: vi.fn(async () => null),
  saveStoredFocusLevel: vi.fn(async () => {}),
  loadCycleConfig: vi.fn(async () => ({ workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4 })),
  saveCycleConfig: vi.fn(async () => {}),
  loadShelfPrefs: vi.fn(async () => ({ width: 'default', density: 'comfortable', position: 'center', sections: { alternatives: true, dials: true } })),
  saveShelfPrefs: vi.fn(async () => {}),
}));
vi.mock('../../db/db', () => dbMocks);
vi.mock('../../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

/** Wednesday 10:00 — same anchor the Today tests use. */
const TODAY = '2026-07-15';

async function mountHost(over: {
  goals?: Goal[];
  tasks?: Task[];
  onClose?: () => void;
} = {}) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(over.goals ?? []),
    habits: [],
    tasks: structuredClone(over.tasks ?? []),
    sessions: [],
  });
  const store = await import('../../state/store');
  await store.initStore();
  const { AssistantHost } = await import('./AssistantHost');
  const view = render(createElement(AssistantHost, {
    open: true,
    onClose: over.onClose ?? (() => {}),
    theme: 'light' as const,
  }));
  return {
    ...store,
    // Flips `open` via rerender — the same transition Escape drives (it
    // reaches `onClose` directly, never `case 'close'`), without going
    // through a dispatched action.
    rerender: (open: boolean) => view.rerender(createElement(AssistantHost, {
      open,
      onClose: over.onClose ?? (() => {}),
      theme: 'light' as const,
    })),
  };
}

/**
 * Installs a mock `window.phaseAssistant` and captures the callback the host
 * registers via `bridge.onAction` — the same relay the desktop overlay uses
 * to deliver a verb, and the only route to `insert-before` in this file since
 * no button dispatches it. `lastSnapshot` reads the most recent `publish`
 * call, which is how a test observes what the NEXT snapshot says without
 * reaching into the host's internals.
 */
function installBridge() {
  const publish = vi.fn();
  let dispatch: ((action: AssistantAction) => void) | null = null;
  (window as unknown as Record<string, unknown>).phaseAssistant = {
    publish,
    onRequestSnapshot: vi.fn(() => () => {}),
    onAction: vi.fn((fn: (action: AssistantAction) => void) => {
      dispatch = fn;
      return () => {};
    }),
    configureShortcut: vi.fn(async () => ({
      requested: 'Command+Space',
      active: 'Command+Space',
      registered: true,
      conflict: false,
    })),
  };
  return {
    dispatchAction: (action: AssistantAction) => dispatch?.(action),
    lastSnapshot: (): Extract<AssistantSnapshot, { status: 'ready' }> => {
      const call = publish.mock.calls.at(-1);
      if (!call) throw new Error('no snapshot published yet');
      return call[0] as Extract<AssistantSnapshot, { status: 'ready' }>;
    },
    teardown: () => {
      delete (window as unknown as Record<string, unknown>).phaseAssistant;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The embedded surface reads Reduce Motion, so a stable matchMedia is required.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 15, 10, 0, 0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AssistantHost', () => {
  it('opens in the browser even when no Electron bridge exists', async () => {
    expect('phaseAssistant' in window).toBe(false);
    await mountHost({
      tasks: [{ id: 't1', title: 'Draft essay', done: false, goalId: null, date: TODAY }],
    });
    expect(screen.getByRole('dialog', { name: 'Assistant' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start session' })).toBeTruthy();
    // The shelf starts work; it does not parse sentences.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('switching tasks logs the current non-stale session and POINTS at the alternative without starting it', async () => {
    const tasks: Task[] = [
      { id: 't1', title: 'Draft essay', done: false, goalId: null, date: TODAY },
      { id: 't2', title: 'Revise notes', done: false, goalId: null, date: TODAY },
      { id: 't3', title: 'Email advisor', done: false, goalId: null, date: TODAY },
    ];
    const store = await mountHost({ tasks });

    await act(async () => {
      store.actions.startFocus(
        { kind: 'task', id: 't1', goalId: null },
        { kind: 'starter', minutes: 30 },
        Date.now() - 25 * 60_000,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Revise notes/ }));
    });

    // One session logged for the first task; NO draft — the shelf is idle on
    // the chosen row, and Start session is what would start it.
    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().sessions[0]).toMatchObject({ taskId: 't1', minutes: 25 });
    expect(store.getState().activeFocusSession).toBeNull();
    expect(screen.getByRole('heading', { name: 'Revise notes' })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    });
    expect(store.getState().activeFocusSession?.ref.id).toBe('t2');
  });

  it('publishes the reference of the work that actually started', async () => {
    const publish = vi.fn();
    (window as unknown as Record<string, unknown>).phaseAssistant = {
      publish,
      onRequestSnapshot: vi.fn(() => () => {}),
      onAction: vi.fn(() => () => {}),
      configureShortcut: vi.fn(async () => ({
        requested: 'Command+Space',
        active: 'Command+Space',
        registered: true,
        conflict: false,
      })),
    };

    try {
      const store = await mountHost({
        tasks: [{
          id: 't1',
          title: 'Draft essay',
          done: false,
          goalId: null,
          date: TODAY,
        }],
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
      });

      expect(store.getState().activeFocusSession?.ref).toEqual({
        kind: 'task',
        id: 't1',
        goalId: null,
      });
      expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
        activeFocus: expect.objectContaining({
          ref: { kind: 'task', id: 't1', goalId: null },
        }),
      }));
    } finally {
      delete (window as unknown as Record<string, unknown>).phaseAssistant;
    }
  });

  it('keeps completion and scheduling separate: completing a session checks nothing', async () => {
    const store = await mountHost({
      tasks: [{ id: 't1', title: 'Draft essay', done: false, goalId: null, date: TODAY }],
    });
    await act(async () => {
      store.actions.startFocus(
        { kind: 'task', id: 't1', goalId: null },
        { kind: 'starter', minutes: 30 },
        Date.now() - 20 * 60_000,
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Complete session' }));
    });

    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().tasks[0].done).toBe(false);
  });

  it('ticks the offered work done and reports the label the write armed', async () => {
    const store = await mountHost({
      tasks: [{ id: 't1', title: 'Draft essay', done: false, goalId: null, date: TODAY }],
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Complete "Draft essay"' }));
    });

    expect(store.getState().tasks[0].done).toBe(true);
    expect(screen.getByText('Completed "Draft essay"')).toBeTruthy();
  });

  it('parks the offered step, sets notice, and advances to the next recommendation', async () => {
    const goals: Goal[] = [{
      id: 'g1',
      title: 'Course',
      nodes: [
        { id: 's1', title: 'Problem set 1', status: 'todo' },
        { id: 's2', title: 'Problem set 2', status: 'todo' },
      ],
    }];
    const store = await mountHost({ goals });

    expect(screen.getByRole('heading', { name: 'Problem set 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Park' })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Park' }));
    });

    expect(store.getState().goals[0].nodes[0].status).toBe('parked');
    expect(screen.getByText('Parked "Problem set 1"')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Problem set 2' })).toBeTruthy();
  });

  it('rate-focus rates the topic through the store and notices the undo label; Skip notices nothing', async () => {
    const bridge = installBridge();
    try {
      const goals: Goal[] = [{
        id: 'g1', title: 'Algorithms', type: 'study',
        nodes: [{ id: 'area', title: 'Topics', topics: true, children: [{ id: 'n1', title: 'Graphs' }] }],
      }];
      const store = await mountHost({ goals });
      // The offered topic carries its mark and its reason across the seam.
      expect(bridge.lastSnapshot().advice).toMatchObject({ primary: { topic: true, reason: 'review' } });

      await act(async () => {
        store.actions.startFocus({ kind: 'step', id: 'n1', goalId: 'g1' }, { kind: 'starter', minutes: 30 }, Date.now() - 25 * 60_000);
      });
      expect(bridge.lastSnapshot().activeFocus).toMatchObject({ phase: 'active', topic: true });
      await act(async () => {
        store.actions.completeFocus();
      });
      expect(bridge.lastSnapshot().activeFocus?.phase).toBe('rating');

      // Skip first: the draft is spent, nothing is written, no notice claims
      // a write.
      await act(async () => {
        bridge.dispatchAction({ type: 'rate-focus', confidence: null });
      });
      expect(store.getState().activeFocusSession).toBeNull();
      expect(store.getState().goals[0].nodes[0].children![0].confidence).toBeUndefined();
      expect(bridge.lastSnapshot().notice).toBeUndefined();

      await act(async () => {
        store.actions.startFocus({ kind: 'step', id: 'n1', goalId: 'g1' }, { kind: 'starter', minutes: 30 }, Date.now() - 25 * 60_000);
        store.actions.completeFocus();
      });
      await act(async () => {
        bridge.dispatchAction({ type: 'rate-focus', confidence: 'okay' });
      });
      expect(store.getState().goals[0].nodes[0].children![0].confidence).toBe('okay');
      expect(store.getState().activeFocusSession).toBeNull();
      expect(screen.getByText('Rated "Graphs" okay')).toBeTruthy();
      expect(bridge.lastSnapshot().advice).toMatchObject({ primary: { topic: true, confidence: 'okay' } });
    } finally {
      bridge.teardown();
    }
  });

  it('insert-before creates the work, pins it as primary, and notices the undo label', async () => {
    const bridge = installBridge();
    try {
      const goals: Goal[] = [{
        id: 'g1',
        title: 'Course',
        nodes: [
          { id: 'a', title: 'Step A', status: 'todo' },
          { id: 'b', title: 'Step B', status: 'todo' },
        ],
      }];
      await mountHost({ goals });

      expect(bridge.lastSnapshot().advice.kind).toBe('work');
      const primaryRef = { kind: 'step' as const, id: 'a', goalId: 'g1' };

      await act(async () => {
        bridge.dispatchAction({ type: 'insert-before', ref: primaryRef, title: 'Review ch 3' });
      });

      const snapshot = bridge.lastSnapshot();
      expect(snapshot.advice.kind).toBe('work');
      if (snapshot.advice.kind !== 'work') throw new Error('unreachable');
      expect(snapshot.advice.primary.title).toBe('Review ch 3');
      expect(snapshot.notice?.text).toBe('Added "Review ch 3" first');
    } finally {
      bridge.teardown();
    }
  });

  it('insert-before on a gone anchor warns and pins nothing', async () => {
    const bridge = installBridge();
    try {
      const goals: Goal[] = [{
        id: 'g1',
        title: 'Course',
        nodes: [
          { id: 'a', title: 'Step A', status: 'todo' },
        ],
      }];
      await mountHost({ goals });

      await act(async () => {
        bridge.dispatchAction({
          type: 'insert-before',
          ref: { kind: 'step', id: 'gone', goalId: 'g1' },
          title: 'X',
        });
      });

      const snapshot = bridge.lastSnapshot();
      expect(snapshot.notice?.tone).toBe('warning');
      expect(snapshot.advice.kind).toBe('work');
      if (snapshot.advice.kind !== 'work') throw new Error('unreachable');
      expect(snapshot.advice.primary.title).toBe('Step A');
    } finally {
      bridge.teardown();
    }
  });

  it('insert-before on a picked row pins the new work, not the picked anchor', async () => {
    const bridge = installBridge();
    try {
      const tasks: Task[] = [
        { id: 't1', title: 'Draft essay', done: false, goalId: null, date: TODAY },
        { id: 't2', title: 'Revise notes', done: false, goalId: null, date: TODAY },
      ];
      await mountHost({ tasks });

      // Pick the second row — the Or band's `switch-focus` — so `chosen`
      // holds it before the insert ever happens.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Revise notes/ }));
      });
      expect(screen.getByRole('heading', { name: 'Revise notes' })).toBeTruthy();

      // "Do first…" on the very row just picked. The pin makes a fresh step
      // primary; without clearing `chosen`, `promoteWork` finds the anchor
      // (now demoted into alternatives) and promotes it right back over the
      // pin — the shelf would still lead with "Revise notes".
      const anchorRef = { kind: 'task' as const, id: 't2', goalId: null };
      await act(async () => {
        bridge.dispatchAction({ type: 'insert-before', ref: anchorRef, title: 'Outline first' });
      });

      const snapshot = bridge.lastSnapshot();
      expect(snapshot.advice.kind).toBe('work');
      if (snapshot.advice.kind !== 'work') throw new Error('unreachable');
      expect(snapshot.advice.primary.title).toBe('Outline first');
    } finally {
      bridge.teardown();
    }
  });

  it('a close via open=false — not the close action — still forgets the pin', async () => {
    const bridge = installBridge();
    try {
      // Two projects, so the advisor's own head is g1's leaf and g2's leaf is
      // a genuine second entry — the pin then has to OUTRANK a real
      // alternative, not just coincide with whatever the insert replaced.
      const goals: Goal[] = [
        { id: 'g1', title: 'Course A', nodes: [{ id: 'a', title: 'Step A', status: 'todo' }] },
        { id: 'g2', title: 'Course B', nodes: [{ id: 'b', title: 'Step B', status: 'todo' }] },
      ];
      const store = await mountHost({ goals });
      const anchorRef = { kind: 'step' as const, id: 'b', goalId: 'g2' };

      let snapshot = bridge.lastSnapshot();
      expect(snapshot.advice.kind).toBe('work');
      if (snapshot.advice.kind !== 'work') throw new Error('unreachable');
      expect(snapshot.advice.primary.title).toBe('Step A');

      await act(async () => {
        bridge.dispatchAction({ type: 'insert-before', ref: anchorRef, title: 'Do first' });
      });

      snapshot = bridge.lastSnapshot();
      expect(snapshot.advice.kind).toBe('work');
      if (snapshot.advice.kind !== 'work') throw new Error('unreachable');
      expect(snapshot.advice.primary.title).toBe('Do first');

      // Dismiss by flipping `open` — the transition Escape drives, since it
      // calls `onClose` directly and never `case 'close'` — then reopen.
      await act(async () => {
        store.rerender(false);
      });
      await act(async () => {
        store.rerender(true);
      });

      snapshot = bridge.lastSnapshot();
      expect(snapshot.advice.kind).toBe('work');
      if (snapshot.advice.kind !== 'work') throw new Error('unreachable');
      expect(snapshot.advice.primary.title).toBe('Step A');
    } finally {
      bridge.teardown();
    }
  });

  it('Escape stands aside for the Do-first input, but closes the shelf everywhere else', async () => {
    const onClose = vi.fn();
    await mountHost({
      tasks: [{ id: 't1', title: 'Draft essay', done: false, goalId: null, date: TODAY }],
      onClose,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Do first…' }));
    });
    const input = screen.getByLabelText('Do this first');

    // The event's target sits inside `[data-insert-first]` — the host's
    // capture-phase listener must stand aside and let the input's own
    // Escape (which just closes the field) have it.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    // A plain Escape, target outside the input, still closes the shelf.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

