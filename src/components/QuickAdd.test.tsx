// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal } from '../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[] }> => ({
    goals: [], habits: [], tasks: [], sessions: [],
  })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async () => []),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  saveSidebarPanels: vi.fn(async () => {}),
  loadPlanMode: vi.fn(async (): Promise<'week' | 'month'> => 'week'),
  savePlanMode: vi.fn(async () => {}),
  loadGoalsMode: vi.fn(async (): Promise<'board' | 'timeline'> => 'board'),
  saveGoalsMode: vi.fn(async () => {}),
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
}));
vi.mock('../db/db', () => dbMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const GOALS: Goal[] = [
  { id: 'g1', title: 'Physics Final', nodes: [] },
  { id: 'g2', title: 'Launch SaaS MVP', nodes: [] },
];

async function mount() {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(GOALS), habits: [], tasks: [], sessions: [],
  });
  const store = await import('../state/store');
  await store.initStore();
  const { QuickAdd } = await import('./QuickAdd');
  const closed = vi.fn();
  const Host = () => {
    store.useAppStore();
    return createElement(QuickAdd, { open: true, enabled: true, onClose: closed });
  };
  render(createElement(Host));
  return { store, closed, user: userEvent.setup() };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

const field = () => screen.getByRole('textbox', { name: 'Add a task' });

describe('Quick add', () => {
  it('captures a bare line unscheduled and unattached', async () => {
    const { store, user, closed } = await mount();

    await user.type(field(), 'Email the TA{Enter}');

    const task = store.getState().tasks[0];
    expect(task.title).toBe('Email the TA');
    expect(task.date).toBeUndefined();
    expect(task.goalId).toBeNull();
    expect(closed).toHaveBeenCalled();
  });

  it('reads a goal, a date and an estimate out of the sentence', async () => {
    const { store, user } = await mount();

    await user.type(field(), 'Problems 1–15 #launch ~90m{Enter}');

    expect(store.getState().tasks[0]).toMatchObject({
      title: 'Problems 1–15',
      goalId: 'g2',
      estimateMin: 90,
    });
  });

  /**
   * The default is unscheduled, and a default nobody can see is a default
   * nobody trusts — so the composer says it while you type.
   */
  it('shows what it understood before anything is committed', async () => {
    const { user } = await mount();

    await user.type(field(), 'Draft #physics');

    expect(screen.getByText('Physics Final')).toBeTruthy();
    expect(screen.getByText('Unscheduled')).toBeTruthy();
  });

  it('says so when a token means nothing, instead of eating it', async () => {
    const { store, user } = await mount();

    await user.type(field(), 'Read chapter 4 #quantum{Enter}');

    expect(store.getState().tasks[0].title).toBe('Read chapter 4 #quantum');
  });

  it('warns about the unrecognised token while it is still on screen', async () => {
    const { user } = await mount();

    await user.type(field(), 'Read chapter 4 #quantum');

    expect(screen.getByText(/Didn’t recognise #quantum/)).toBeTruthy();
  });

  /**
   * The difference between writing down five things and opening a dialog five
   * times.
   */
  it('stays open and clears on Cmd+Enter, for a run of captures', async () => {
    const { store, user, closed } = await mount();

    await user.type(field(), 'One');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await user.type(field(), 'Two');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(store.getState().tasks.map((t) => t.title)).toEqual(['One', 'Two']);
    expect(closed).not.toHaveBeenCalled();
    expect((field() as HTMLInputElement).value).toBe('');
  });

  it('refuses to commit an empty line', async () => {
    const { store, user, closed } = await mount();

    await user.type(field(), '   {Enter}');

    expect(store.getState().tasks).toHaveLength(0);
    expect(closed).not.toHaveBeenCalled();
  });
});
