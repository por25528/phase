// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal } from '../../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[] }> => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
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
  loadCycleConfig: vi.fn(async () => ({ workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4 })),
  saveCycleConfig: vi.fn(async () => {}),
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

async function renderPopover(goal: Goal) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({ goals: [goal], habits: [], tasks: [], sessions: [] });
  const store = await import('../../state/store');
  await store.initStore();
  const { GoalMetaPopover } = await import('./GoalMetaPopover');
  const { goalEffort } = await import('../../lib/effort');
  const onClose = vi.fn();
  const effort = goalEffort(goal);
  const Host = () => {
    const { goals } = store.useAppStore();
    const g = goals[0];
    return createElement(GoalMetaPopover, {
      goal: g,
      actions: store.actions,
      effort,
      draftStart: '', draftDeadline: '',
      onDraftChange: () => {}, onClose,
    });
  };
  render(createElement(Host));
  return { store, onClose };
}

const OPEN: Goal = { id: 'g', title: 'Systems', column: 0, nodes: [] };

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('Focus, inside the status popover', () => {
  it('sets the goal demand', async () => {
    const { store } = await renderPopover(OPEN);
    fireEvent.click(screen.getByRole('radio', { name: 'Deep' }));
    expect(store.getState().goals[0].demand).toBe('deep');
  });

  it('offers Not set, and clearing writes null', async () => {
    const { store } = await renderPopover({ ...OPEN, demand: 'deep' });
    fireEvent.click(screen.getByRole('radio', { name: 'Not set' }));
    expect(store.getState().goals[0].demand).toBeUndefined();
  });

  // The Focus control must be inline, never a nested Popover: a Popover
  // registers its OWN capture-phase Escape listener on window, and that
  // listener would sit behind this dialog's own, so one Escape press would
  // dismiss both surfaces. That failure is not observable behaviourally —
  // Popover's Escape handler calls its own internal setOpen(false) and never
  // touches this dialog's onClose, so onClose fires exactly once either way,
  // whether the control is inline or a nested Popover. So the guard has to be
  // structural: a nested Popover's trigger carries aria-haspopup, and nothing
  // else in this dialog does, so the dialog must contain none.
  it('renders the Focus control inline, with no nested disclosure', async () => {
    await renderPopover(OPEN);
    expect(
      screen.getByRole('dialog', { name: 'Goal status' }).querySelector('[aria-haspopup]'),
    ).toBeNull();
  });

  it('withholds the control on a completed goal, like every other editor', async () => {
    await renderPopover({ ...OPEN, completedAt: '2026-08-01' });
    expect(screen.queryByRole('radiogroup', { name: 'Focus needed' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Deep' })).toBeNull();
  });

  // The Task 4 coverage debt's reflection half: selecting a value must not
  // only write it to the store, the control must report it back via
  // aria-checked — the accessible-state half `ProjectHeader`'s deleted test
  // also asserted, alongside the write.
  it('reflects the current demand in aria-checked, and moves it on click', async () => {
    await renderPopover({ ...OPEN, demand: 'moderate' });
    const light = screen.getByRole('radio', { name: 'Light' });
    const moderate = screen.getByRole('radio', { name: 'Moderate' });
    const deep = screen.getByRole('radio', { name: 'Deep' });
    const notSet = screen.getByRole('radio', { name: 'Not set' });
    expect(moderate.getAttribute('aria-checked')).toBe('true');
    expect(light.getAttribute('aria-checked')).toBe('false');
    expect(deep.getAttribute('aria-checked')).toBe('false');
    expect(notSet.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(deep);

    expect(deep.getAttribute('aria-checked')).toBe('true');
    expect(moderate.getAttribute('aria-checked')).toBe('false');
  });
});
