// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, Task } from '../../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: Task[]; sessions: never[] }> =>
    ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async (): Promise<AvailabilityWindow[]> => []),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  loadPlanMode: vi.fn(async () => 'week' as const),
  savePlanMode: vi.fn(async () => {}),
  loadGoalsMode: vi.fn(async (): Promise<'board' | 'timeline'> => 'board'),
  saveGoalsMode: vi.fn(async () => {}),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
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
}));
vi.mock('../../db/db', () => dbMocks);
vi.mock('../../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

/** Wednesday 10:00 — same anchor the Today tests use. */
const TODAY = '2026-07-15';
const WORKDAY: AvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
  dow, startMin: 9 * 60, endMin: 17 * 60,
}));

async function mountHost(over: {
  goals?: Goal[];
  tasks?: Task[];
  availability?: AvailabilityWindow[];
  onClose?: () => void;
} = {}) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(over.goals ?? []),
    habits: [],
    tasks: structuredClone(over.tasks ?? []),
    sessions: [],
  });
  dbMocks.loadAvailability.mockResolvedValueOnce(over.availability ?? WORKDAY);
  const store = await import('../../state/store');
  await store.initStore();
  const { AssistantHost } = await import('./AssistantHost');
  render(createElement(AssistantHost, { open: true, onClose: over.onClose ?? (() => {}) }));
  return store;
}

async function submit(text: string) {
  const input = screen.getByRole('textbox', { name: 'Ask the assistant' });
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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
    await mountHost();
    expect(screen.getByRole('textbox', { name: 'Ask the assistant' })).toBeTruthy();
  });

  it('a confirmed capture calls exactly one approved store action', async () => {
    const store = await mountHost();
    await submit('Add lab report Friday');

    // Preview first — nothing has been written yet.
    expect(store.getState().tasks).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    });

    expect(store.getState().tasks).toHaveLength(1);
    expect(store.getState().tasks[0]).toMatchObject({ title: 'lab report', date: '2026-07-17' });
    // The proposal is spent: no second Confirm to double-write with.
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('a schedule failure stays a failure notice, never optimistic success', async () => {
    const store = await mountHost({
      tasks: [{ id: 't1', title: 'Buy milk', done: false, goalId: null }],
      availability: [], // no working hours: no slot can resolve
    });
    await submit('Move buy milk to Friday');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    });

    expect(screen.getByText(/No room for "Buy milk"/)).toBeTruthy();
    expect(store.getState().tasks[0].blocks).toBeUndefined();
    expect(screen.queryByText(/Scheduled "Buy milk"/)).toBeNull();
  });

  it('switching tasks logs the current non-stale session before starting the alternative', async () => {
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

    // One session logged for the first task, and the draft now points at the second.
    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().sessions[0]).toMatchObject({ taskId: 't1', minutes: 25 });
    expect(store.getState().activeFocusSession?.ref.id).toBe('t2');
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
});
