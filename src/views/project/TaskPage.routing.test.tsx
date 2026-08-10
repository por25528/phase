// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, Session } from '../../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: Session[] }> => ({
    goals: [], habits: [], tasks: [], sessions: [],
  })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async (): Promise<AvailabilityWindow[]> => []),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  saveSidebarPanels: vi.fn(async () => {}),
  loadPlanMode: vi.fn(async () => 'week' as const),
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
}));
vi.mock('../../db/db', () => dbMocks);
vi.mock('../../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => cleanup());

const seed: Goal = {
  id: 'g1', title: 'Fitness', column: 0,
  nodes: [
    { id: 'n1', title: 'Run 5k', estimateMin: 45 },
    {
      id: 'n2', title: 'Chapter 2',
      children: [{ id: 'n3', title: 'Read the notes' }],
    },
  ],
};

type Store = typeof import('../../state/store');

/** Boot a store holding `seed`, open its goal page, and render it. */
async function mountGoal(): Promise<Store> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(seed)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../../state/store');
  await store.initStore();
  store.actions.openProject('g1');
  const { Project } = await import('../Project');
  const Host = () => { store.useAppStore(); return createElement(Project); };
  render(createElement(Host));
  return store;
}

describe('a leaf opens as a page', () => {
  it('renders the page, not the docked inspector', async () => {
    const store = await mountGoal();

    await act(async () => { store.actions.openStep('n1'); });

    expect(screen.getByRole('heading', { name: 'Run 5k' })).toBeTruthy();
    // The Close button is the inspector's; the page replaces it with a
    // breadcrumb, because Back on a page is navigation, not dismissal.
    expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull();
  });

  it('keeps the docked inspector for a container', async () => {
    const store = await mountGoal();

    await act(async () => { store.actions.openStep('n2'); });

    expect(screen.getByRole('button', { name: 'Close task details' })).toBeTruthy();
    // `level: 1` scopes this to TaskPage's own heading — StepPanel legitimately
    // renders an `h2` with the same accessible name for the docked inspector.
    expect(screen.queryByRole('heading', { level: 1, name: 'Chapter 2' })).toBeNull();
  });

  it('closeStep leaves the page and returns to the tree', async () => {
    const store = await mountGoal();
    await act(async () => { store.actions.openStep('n1'); });

    await act(async () => { store.actions.closeStep(); });

    expect(screen.queryByRole('heading', { name: 'Run 5k' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Tasks' })).toBeTruthy();
  });

  it('names the milestone in the breadcrumb for a task inside one', async () => {
    const store = await mountGoal();
    await act(async () => { store.actions.openArea('n2'); });

    await act(async () => { store.actions.openStep('n3'); });

    expect(screen.getByRole('heading', { name: 'Read the notes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Chapter 2/ })).toBeTruthy();
  });
});
