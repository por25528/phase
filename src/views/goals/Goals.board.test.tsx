// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Goal, Life } from '../../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[]; lives: Life[] }> => ({
    goals: [], habits: [], tasks: [], sessions: [], lives: [],
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
  loadActiveFocusSession: vi.fn(async () => null),
  saveActiveFocusSession: vi.fn(async () => {}),
  loadAssistantAccelerator: vi.fn(async () => 'Command+Space'),
  saveAssistantAccelerator: vi.fn(async () => {}),
  loadStoredTimeLevel: vi.fn(async () => null),
  saveStoredTimeLevel: vi.fn(async () => {}),
  loadStoredFocusLevel: vi.fn(async () => null),
  saveStoredFocusLevel: vi.fn(async () => {}),
}));
vi.mock('../../db/db', () => dbMocks);
vi.mock('../../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  // jsdom implements neither. `Goals.tsx` calls matchMedia UNGUARDED at render
  // for prefers-reduced-motion, so without this the component throws; `matches:
  // true` also selects the wide four-column board, which is the one under test.
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => cleanup());

type Store = typeof import('../../state/store');

/**
 * Boot a fresh store holding `goals` and `lives`, and render the board.
 *
 * Lives are seeded through `loadState` rather than `addLife` so their ids are
 * predictable — the tests below name them 'uni' and 'startup'.
 */
async function mountBoard(goals: Goal[], lives: Life[] = []): Promise<Store> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(goals), habits: [], tasks: [], sessions: [], lives: structuredClone(lives),
  });
  const store = await import('../../state/store');
  // The store only boots against the database when `initStore` runs (App.tsx
  // calls it; nothing else does). Without this the mocked `loadState` is never
  // consumed, the store stays empty and the board renders onboarding instead
  // of `goals` — the pattern `Project.progress.test.tsx` already follows.
  await store.initStore();
  const { Goals } = await import('../Goals');
  const Host = () => { store.useAppStore(); return createElement(Goals); };
  await act(async () => { render(createElement(Host)); });
  return store;
}

const UNI: Life = { id: 'uni', title: 'University', order: 0 };
const STARTUP: Life = { id: 'startup', title: 'Startup', order: 1 };

const TWO_LIVES: Goal[] = [
  { id: 'u1', title: 'Pset 6', nodes: [], column: 0, lifeId: 'uni' },
  { id: 's1', title: 'Raise seed', nodes: [], column: 0, lifeId: 'startup' },
  { id: 'x1', title: 'Renew passport', nodes: [], column: 0 },
];

describe('Goals scoping', () => {
  it('shows every life under All, and one life once scoped', async () => {
    const store = await mountBoard(TWO_LIVES, [UNI, STARTUP]);
    expect(screen.getByText('Pset 6')).toBeTruthy();
    expect(screen.getByText('Raise seed')).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: 'Startup' }));
    expect(screen.queryByText('Pset 6')).toBeNull();
    expect(screen.getByText('Raise seed')).toBeTruthy();
    expect(store.getState().activeLifeId).toBe('startup');
  });

  it('offers Unassigned only while a loose goal is live', async () => {
    await mountBoard(TWO_LIVES, [UNI, STARTUP]);
    await userEvent.click(screen.getByRole('tab', { name: 'Unassigned' }));
    expect(screen.getByText('Renew passport')).toBeTruthy();
    expect(screen.queryByText('Pset 6')).toBeNull();
  });

  it('drops the Unassigned tab when nothing is loose', async () => {
    await mountBoard(TWO_LIVES.slice(0, 2), [UNI, STARTUP]);
    expect(screen.queryByRole('tab', { name: 'Unassigned' })).toBeNull();
  });

  it('renders no strip at all when no life has been named', async () => {
    await mountBoard([{ id: 'a', title: 'A', nodes: [], column: 0 }]);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('prints the summed cap on All and three on a life', async () => {
    await mountBoard(TWO_LIVES, [UNI, STARTUP]);
    // All: three tabs beside it (University, Startup, Unassigned) → 9.
    expect(screen.getByText('3 / 9')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'University' }));
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('says the scope is empty rather than offering onboarding', async () => {
    await mountBoard([{ id: 'u1', title: 'Pset 6', nodes: [], column: 0, lifeId: 'uni' }], [UNI, STARTUP]);
    await userEvent.click(screen.getByRole('tab', { name: 'Startup' }));
    expect(screen.getByText(/No goals in Startup yet/)).toBeTruthy();
    expect(screen.queryByText('Load example')).toBeNull();
  });
});

describe('board geometry', () => {
  it('gives the loaded column the width and slims the empty ones', async () => {
    await mountBoard([
      { id: 'a', title: 'A', nodes: [], column: 3 },
      { id: 'b', title: 'B', nodes: [], column: 3 },
    ]);
    const board = document.getElementById('goalsBoard') as HTMLElement;
    expect(board.style.gridTemplateColumns).toBe('88px 88px 88px minmax(200px, 2fr)');
  });

  it('weights two loaded columns against each other', async () => {
    await mountBoard([
      { id: 'a', title: 'A', nodes: [], column: 0 },
      { id: 'b', title: 'B', nodes: [], column: 3 },
      { id: 'c', title: 'C', nodes: [], column: 3 },
    ]);
    const board = document.getElementById('goalsBoard') as HTMLElement;
    expect(board.style.gridTemplateColumns)
      .toBe('minmax(200px, 1fr) 88px 88px minmax(200px, 2fr)');
  });

  it('draws no dashed border on an empty column', async () => {
    await mountBoard([{ id: 'a', title: 'A', nodes: [], column: 0 }]);
    expect(document.querySelector('.border-dashed')).toBeNull();
  });

  it('says nothing in a slim column — the label and the count are the whole story', async () => {
    await mountBoard([{ id: 'a', title: 'A', nodes: [], column: 0 }]);
    // Now holds the card; the other three are slim and must not each repeat it.
    expect(screen.queryAllByText('Nothing here')).toHaveLength(0);
  });
});

describe('Goals header', () => {
  const ONE: Goal[] = [{ id: 'a', title: 'A', nodes: [], column: 0 }];

  it('offers no New goal button in the page header', async () => {
    await mountBoard(ONE);
    // The top command shelf owns ⌘N; the page header must not duplicate it.
    // (The onboarding empty state keeps its own — nothing competes with it there.)
    expect(screen.queryAllByRole('button', { name: /New goal/ })).toHaveLength(0);
  });

  it('keeps the view toggle named even though it is icon-only', async () => {
    await mountBoard(ONE);
    expect(screen.getByRole('button', { name: 'Board' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Timeline' })).toBeTruthy();
  });

  it('puts Import goal and Manage lives in the overflow', async () => {
    await mountBoard(ONE);
    expect(screen.queryByText('Import goal')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Goals actions' }));
    expect(screen.getByRole('menuitem', { name: 'Import goal' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Manage lives' })).toBeTruthy();
  });

  it('opens Settings from Manage lives', async () => {
    const store = await mountBoard(ONE);
    await userEvent.click(screen.getByRole('button', { name: 'Goals actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Manage lives' }));
    expect(store.getState().settingsOpen).toBe(true);
  });
});
