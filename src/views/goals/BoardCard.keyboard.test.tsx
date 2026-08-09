// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal } from '../../db/types';

/**
 * Moving a project from the keyboard.
 *
 * Both axes were pointer-only. The ⋯ menu offers horizons but no ordering, so
 * rank was drag-exclusive — and dnd-kit's own keyboard activator never fires on
 * a card, because the explicit `onKeyDown` is spread after `{...listeners}` and
 * simply wins. This file drives the real handler rather than trusting that.
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[] }> =>
    ({ goals: [], habits: [], tasks: [], sessions: [] })),
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
  // jsdom implements neither of these. Both are pure view effects — the board
  // scrolls a moved card into view and highlights it — so stubbing them tests
  // the same code path a browser runs.
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = ((query: string) => ({
    // `matches: true` puts the board in its wide four-column layout, which is
    // the one where all four horizons are on screen at once.
    matches: true,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const project = (id: string, title: string, column: number): Goal =>
  ({ id, title, column, nodes: [{ id: `${id}-n`, title: 'Step' }], datesConfirmed: true });

// Three in Now, one in Next — enough to move in every direction and to hit both
// ends of a column.
const BOARD: Goal[] = [
  project('a', 'Alpha', 0),
  project('b', 'Bravo', 0),
  project('c', 'Charlie', 0),
  project('d', 'Delta', 1),
];

async function mountBoard() {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(BOARD), habits: [], tasks: [], sessions: [],
  });
  const store = await import('../../state/store');
  await store.initStore();
  const { Goals } = await import('../Goals');
  render(createElement(Goals));
  return { store, user: userEvent.setup() };
}

/** Live projects in board order, as `column:title`. */
const layout = (store: typeof import('../../state/store')): string[] =>
  store.getState().goals.filter((g) => !g.completedAt).map((g) => `${g.column ?? 0}:${g.title}`);

const card = (title: string): HTMLElement =>
  screen.getByRole('group', { name: new RegExp(`^${title} —`) });

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('moving a card across horizons', () => {
  it('Alt+Right sends it to the next horizon, undoably', async () => {
    const { store, user } = await mountBoard();
    card('Bravo').focus();

    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');

    expect(store.getState().goals.find((g) => g.id === 'b')?.column).toBe(1);
    expect(store.getState().pendingUndo?.label).toBe('Moved "Bravo" to Next');

    store.actions.undoLastDelete();
    expect(store.getState().goals.find((g) => g.id === 'b')?.column).toBe(0);
  });

  it('Alt+Left brings it back', async () => {
    const { store, user } = await mountBoard();
    card('Delta').focus();

    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');

    expect(store.getState().goals.find((g) => g.id === 'd')?.column).toBe(0);
  });

  /**
   * Asking for one past either end must be silent. Holding the chord down at
   * the edge otherwise sprays toasts and arms undo entries for writes that
   * changed nothing — and each one displaces whatever real offer was there.
   */
  it('does nothing at the edges', async () => {
    const { store, user } = await mountBoard();
    card('Alpha').focus();

    await user.keyboard('{Alt>}{ArrowLeft}{ArrowLeft}{/Alt}');

    expect(store.getState().goals.find((g) => g.id === 'a')?.column).toBe(0);
    expect(store.getState().pendingUndo).toBeNull();
  });
});

describe('re-ranking within a horizon', () => {
  it('Alt+Up swaps with the project above', async () => {
    const { store, user } = await mountBoard();
    expect(layout(store)).toEqual(['0:Alpha', '0:Bravo', '0:Charlie', '1:Delta']);
    card('Charlie').focus();

    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');

    expect(layout(store)).toEqual(['0:Alpha', '0:Charlie', '0:Bravo', '1:Delta']);
    expect(store.getState().pendingUndo?.label).toBe('Moved "Charlie" up in Now');
  });

  it('Alt+Down swaps with the one below, and undo puts it back', async () => {
    const { store, user } = await mountBoard();
    card('Alpha').focus();

    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(layout(store)).toEqual(['0:Bravo', '0:Alpha', '0:Charlie', '1:Delta']);

    store.actions.undoLastDelete();
    expect(layout(store)).toEqual(['0:Alpha', '0:Bravo', '0:Charlie', '1:Delta']);
  });

  it('is silent at the top and bottom of a column', async () => {
    const { store, user } = await mountBoard();
    card('Alpha').focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(store.getState().pendingUndo).toBeNull();

    card('Delta').focus(); // alone in Next
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(store.getState().pendingUndo).toBeNull();
    expect(layout(store)).toEqual(['0:Alpha', '0:Bravo', '0:Charlie', '1:Delta']);
  });
});

describe('what the keyboard must NOT change', () => {
  it('leaves a bare arrow key alone, so normal navigation still works', async () => {
    const { store, user } = await mountBoard();
    card('Bravo').focus();

    await user.keyboard('{ArrowRight}{ArrowDown}');

    expect(layout(store)).toEqual(['0:Alpha', '0:Bravo', '0:Charlie', '1:Delta']);
  });

  it('still opens the project on Enter', async () => {
    const { store, user } = await mountBoard();
    card('Bravo').focus();

    await user.keyboard('{Enter}');

    expect(store.getState().openGoalId).toBe('b');
  });

  it('names the card so the move keys are discoverable from the label', async () => {
    await mountBoard();
    expect(card('Bravo').getAttribute('aria-label')).toContain('Alt with arrow keys to move');
  });
});
