// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal } from '../db/types';

/**
 * The remastered task row, driven through the real DOM.
 *
 * The row used to render a grip, a status box, a title, a schedule cell, an
 * estimate and a time log at rest, then reveal rename, add-subtask,
 * cycle-status and delete on hover — ten controls to manipulate one task, and
 * sixty small glyphs to read past on a list of twenty. Everything below daily
 * frequency now lives in one `⋯`.
 *
 * What these assert is that nothing was LOST in the move: every verb the row
 * used to carry is still reachable, and the two it kept — the schedule cell and
 * the estimate — became the controls they were already displaying.
 */

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
vi.mock('../db/db', () => dbMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const PROJECT: Goal = {
  id: 'g', title: 'Systems', column: 0,
  nodes: [
    { id: 'first', title: 'First task' },
    { id: 'second', title: 'Second task' },
    { id: 'area', title: 'Mechanics', children: [{ id: 'kid', title: 'Read chapter' }] },
  ],
};

type Store = typeof import('../state/store');

async function mountTree(): Promise<{ store: Store; user: ReturnType<typeof userEvent.setup> }> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(PROJECT)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../state/store');
  await store.initStore();
  store.actions.openProject('g');
  const { GoalTree } = await import('./GoalTree');
  const TreeHost = () => {
    const { goals } = store.useAppStore();
    return createElement(GoalTree, { nodes: goals[0].nodes });
  };
  render(createElement(TreeHost));
  return { store, user: userEvent.setup() };
}

const row = (title: string): HTMLElement =>
  screen.getByText(title).closest('[data-row]') as HTMLElement;

const openMenu = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
  await user.click(within(row(title)).getByRole('button', { name: `Actions for "${title}"` }));
};

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('the row at rest', () => {
  it('no longer carries rename, add-subtask or delete as separate controls', async () => {
    await mountTree();
    const r = row('First task');

    expect(within(r).queryByRole('button', { name: /^Rename/ })).toBeNull();
    expect(within(r).queryByRole('button', { name: /^Add sub-item/ })).toBeNull();
    expect(within(r).queryByRole('button', { name: /^Delete/ })).toBeNull();
  });

  it('keeps the controls that are also readouts', async () => {
    await mountTree();
    const r = row('First task');

    // The checkbox says done or not done; the ◐ is the only thing that tells
    // "in progress" from "untouched"; the estimate and the schedule cell each
    // display the value they set.
    // Named, because the row now carries TWO checkboxes: the completion box
    // that reads out the work's state, and the pick circle that reads out
    // whether the row is in the selection. This assertion is about the former.
    expect(within(r).getByRole('checkbox', { name: /^Mark "First task" as done/ })).toBeTruthy();
    expect(within(r).getByRole('button', { name: /^Change status of/ })).toBeTruthy();
    expect(within(r).getByRole('button', { name: /^Set estimate for/ })).toBeTruthy();
    expect(within(r).getByRole('button', { name: /^Schedule "First task"/ })).toBeTruthy();
  });

  it('drops the time ledger from the row — it lives in the inspector', async () => {
    await mountTree();
    expect(within(row('First task')).queryByRole('button', { name: /^Log time/ })).toBeNull();
  });
});

describe('the ⋯ menu', () => {
  it('renames through the row\'s own title editor', async () => {
    const { user } = await mountTree();
    await openMenu(user, 'First task');

    await user.click(screen.getByRole('menuitem', { name: /Rename/ }));

    expect(screen.getByDisplayValue('First task')).toBeTruthy();
  });

  it('adds a task under the row', async () => {
    const { store, user } = await mountTree();
    await openMenu(user, 'First task');

    await user.click(screen.getByRole('menuitem', { name: /Add task/ }));

    const node = store.getState().goals[0].nodes.find((n) => n.id === 'first');
    expect(node?.children).toHaveLength(1);
  });

  it('deletes, and the delete is undoable', async () => {
    const { store, user } = await mountTree();
    await openMenu(user, 'Second task');

    await user.click(screen.getByRole('menuitem', { name: /Delete/ }));

    expect(store.getState().goals[0].nodes.find((n) => n.id === 'second')).toBeUndefined();
    expect(store.getState().pendingUndo).not.toBeNull();
  });

  it('makes a leaf a milestone, and says so the next time it opens', async () => {
    const { store, user } = await mountTree();
    await openMenu(user, 'First task');
    await user.click(screen.getByRole('menuitem', { name: 'Make a milestone' }));
    expect(store.getState().goals[0].nodes[0].checkpoint).toBe(true);

    await openMenu(user, 'First task');
    expect(screen.getByRole('menuitem', { name: 'Not a milestone' })).toBeTruthy();
  });

  it('offers Open on a container and never on a leaf', async () => {
    const { store, user } = await mountTree();
    await openMenu(user, 'Mechanics');
    await user.click(screen.getByRole('menuitem', { name: /^Open/ }));
    expect(store.getState().openAreaId).toBe('area');

    await openMenu(user, 'First task');
    expect(screen.queryByRole('menuitem', { name: /^Open/ })).toBeNull();
  });

  it('withholds Indent on the first row and Outdent at the root', async () => {
    const { user } = await mountTree();

    await openMenu(user, 'First task');
    expect(screen.queryByRole('menuitem', { name: /Indent/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Outdent/ })).toBeNull();

    // A second sibling has something above it to nest under.
    await openMenu(user, 'Second task');
    expect(screen.getByRole('menuitem', { name: /Indent/ })).toBeTruthy();
  });

  it('indents a row under the sibling above it', async () => {
    const { store, user } = await mountTree();
    await openMenu(user, 'Second task');

    await user.click(screen.getByRole('menuitem', { name: /Indent/ }));

    const first = store.getState().goals[0].nodes.find((n) => n.id === 'first');
    expect(first?.children?.map((c) => c.id)).toEqual(['second']);
  });

  it('teaches its own shortcuts', async () => {
    const { user } = await mountTree();
    await openMenu(user, 'Second task');

    // The reason `⌘]` needed the cheat sheet to be discovered at all.
    expect(screen.getByRole('menuitem', { name: /Indent/ }).textContent).toContain('⌘]');
    expect(screen.getByRole('menuitem', { name: /Estimate/ }).textContent).toContain('E');
    expect(screen.getByRole('menuitem', { name: /Schedule/ }).textContent).toContain('⇧S');
  });

  it('offers Focus needed on a leaf and on a container', async () => {
    const { user } = await mountTree();

    await openMenu(user, 'First task');
    expect(screen.getByRole('button', { name: 'Focus needed…' })).toBeTruthy();
    await user.keyboard('{Escape}');

    await openMenu(user, 'Mechanics');
    expect(screen.getByRole('button', { name: 'Focus needed…' })).toBeTruthy();
  });

  it('sets focus needed from the menu, on a leaf and on a container', async () => {
    const { store, user } = await mountTree();

    await openMenu(user, 'First task');
    await user.click(screen.getByRole('button', { name: 'Focus needed…' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Deep' }));
    expect(store.getState().goals[0].nodes[0].demand).toBe('deep');

    await openMenu(user, 'Mechanics');
    await user.click(screen.getByRole('button', { name: 'Focus needed…' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    expect(store.getState().goals[0].nodes.find((n) => n.id === 'area')?.demand).toBe('light');
  });
});

describe('the schedule cell', () => {
  it('schedules from the row rather than sending the user elsewhere', async () => {
    const { store, user } = await mountTree();

    await user.click(within(row('First task')).getByRole('button', { name: /^Schedule "First task"/ }));
    // Tomorrow, not Today, so the assertion does not depend on the wall clock:
    // `weekCapacity` reports what a current day has LEFT, so a suite run after
    // the mocked 09:00–18:00 window closes would see Today correctly refused.
    await user.click(screen.getByRole('menuitem', { name: 'Tomorrow' }));

    expect(store.getState().goals[0].nodes[0].blocks).toHaveLength(1);
  });

  it('offers a readout but no control on a container', async () => {
    await mountTree();
    // A group is scheduled through its tasks — the same rule the store keeps.
    expect(within(row('Mechanics')).queryByRole('button', { name: /^Schedule/ })).toBeNull();
  });
});

describe('row keyboard', () => {
  it('⇧S opens the schedule popover without cycling status', async () => {
    const { store, user } = await mountTree();
    row('First task').focus();

    await user.keyboard('{Shift>}s{/Shift}');

    expect(screen.getByRole('menu')).toBeTruthy();
    // Plain S still owns status; ⇧S must not have moved it.
    expect(store.getState().goals[0].nodes[0].status).toBeUndefined();
  });

  it('S still cycles status, unchanged', async () => {
    const { store, user } = await mountTree();
    row('First task').focus();

    await user.keyboard('s');

    expect(store.getState().goals[0].nodes[0].status).toBe('doing');
  });

  it('E opens the estimate editor', async () => {
    const { user } = await mountTree();
    row('First task').focus();

    await user.keyboard('e');

    expect(screen.getByRole('textbox', { name: /[Ee]stimate/ })).toBeTruthy();
  });

  it('O opens a container as a workspace and does nothing on a leaf', async () => {
    const { store, user } = await mountTree();
    row('Mechanics').focus();
    await user.keyboard('o');
    expect(store.getState().openAreaId).toBe('area');

    store.actions.closeArea();
    row('First task').focus();
    await user.keyboard('o');
    expect(store.getState().openAreaId).toBeNull();
  });

  it('Enter still renames rather than opening', async () => {
    // Enter has renamed here for as long as the tree has existed. Making it
    // mean "open" on a container and "rename" on a leaf would put back the
    // row-type-dependent primary action that was deliberately removed.
    const { store, user } = await mountTree();
    row('Mechanics').focus();

    await user.keyboard('{Enter}');

    expect(screen.getByDisplayValue('Mechanics')).toBeTruthy();
    expect(store.getState().openAreaId).toBeNull();
  });
});
