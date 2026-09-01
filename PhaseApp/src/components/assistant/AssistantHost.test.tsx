// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Task } from '../../db/types';

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
  render(createElement(AssistantHost, {
    open: true,
    onClose: over.onClose ?? (() => {}),
    theme: 'light' as const,
  }));
  return store;
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
});

