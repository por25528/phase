// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal } from '../../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[] }> => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async (): Promise<AvailabilityWindow[]> => [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, startMin: 540, endMin: 1080 }))),
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
  const { goalHealth } = await import('../../lib/health');
  const onClose = vi.fn();
  const effort = goalEffort(goal);
  const Host = () => {
    const { goals } = store.useAppStore();
    const g = goals[0];
    return createElement(GoalMetaPopover, {
      goal: g,
      actions: store.actions,
      effort,
      verdict: goalHealth({ goal: g, effort, today: '2026-08-16', windows: [], blocks: [], allDayBlocks: true }),
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

  // The regression the inline control exists to prevent. A nested Popover
  // would register a SECOND capture-phase Escape listener on window, behind
  // this dialog's own, and a single press bubbling from inside it would fire
  // onClose twice — once per listener — rather than once for the one dialog
  // that exists.
  it('does not close the popover when Escape is pressed inside the Focus control', async () => {
    const { onClose } = await renderPopover(OPEN);
    const radio = screen.getByRole('radio', { name: 'Deep' });
    radio.focus();
    fireEvent.keyDown(radio, { key: 'Escape' });
    // One Escape, one dismissal — never two surfaces for one press.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('withholds the control on a completed goal, like every other editor', async () => {
    await renderPopover({ ...OPEN, completedAt: '2026-08-01' });
    expect(screen.queryByRole('radiogroup', { name: 'Focus needed' })).toBeNull();
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
