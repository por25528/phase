// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  loadActiveFocusSession: vi.fn(async () => null),
  saveActiveFocusSession: vi.fn(async () => {}),
  loadAssistantAccelerator: vi.fn(async () => 'Command+Space'),
  saveAssistantAccelerator: vi.fn(async () => {}),
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
    {
      id: 'n1', title: 'Chapter 2',
      children: [{ id: 'n2', title: 'Read the notes' }],
    },
  ],
};

type Store = typeof import('../../state/store');

/** Boot a store holding `seed`, open the milestone workspace on its Notes tab. */
async function mountAreaNotes(): Promise<Store> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(seed)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../../state/store');
  await store.initStore();
  store.actions.openProject('g1');
  store.actions.openArea('n1');
  store.actions.setAreaTab('notes');
  const { Project } = await import('../Project');
  const Host = () => { store.useAppStore(); return createElement(Project); };
  render(createElement(Host));
  return store;
}

describe('AreaPage notes tab', () => {
  // The milestone's Notes tab is the fourth surface `useNoteDraft` guards
  // (CLAUDE.md: "Note autosave is held while pendingUndo is live"). Before this
  // fix it wired `onChange` straight to `actions.setNodeNotes`, writing on
  // every keystroke with no debounce and no undo guard.
  it('does not write on every keystroke, and saves on blur as an explicit departure', async () => {
    const store = await mountAreaNotes();
    const setNodeNotes = vi.spyOn(store.actions, 'setNodeNotes');
    const editor = screen.getByLabelText('Milestone notes');

    editor.innerHTML = '<p>typed notes</p>';
    fireEvent.input(editor);
    // TipTap's onUpdate (which feeds useNoteDraft's onChange) lands a
    // microtask after the input event, not synchronously with it.
    await act(async () => { await Promise.resolve(); });

    expect(setNodeNotes).not.toHaveBeenCalled();

    // React's onBlur is wired through the bubbling `focusout` event, not the
    // non-bubbling `blur` — `fireEvent.blur` alone never reaches the wrapping
    // div's handler, only `fireEvent.focusOut` (or a real focus change) does.
    await act(async () => { fireEvent.focusOut(editor); });

    expect(setNodeNotes).toHaveBeenCalledWith('n1', 'typed notes');
    expect(store.getState().goals[0].nodes[0].notes).toBe('typed notes');
  });
});
