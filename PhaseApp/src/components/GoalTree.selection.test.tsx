// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal } from '../db/types';

/**
 * The multi-select interaction, driven through the real DOM.
 *
 * Everything underneath is already covered without a DOM — `lib/selection.ts`
 * for the set arithmetic and `store.test.ts` for the batch writes — but neither
 * can see the part that actually breaks: whether a modifier click reaches the
 * right handler, whether Shift+Arrow moves focus AND grows the range, whether
 * Escape is swallowed before the drawer sees it, and whether the row exposes
 * the ARIA a screen reader needs. Those are wiring, and wiring is what this
 * file tests.
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
}));
vi.mock('../db/db', () => dbMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

// jsdom implements no media queries; `usePrefersReducedMotion` reads one from a
// useState initialiser, so it runs before any effect could guard it.
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const PROJECT: Goal = {
  id: 'g',
  title: '6.1200',
  column: 0,
  nodes: [
    { id: 'a', title: 'Pset 6' },
    { id: 'b', title: 'Pset 7' },
    {
      id: 'grp',
      title: 'Pset 8',
      children: [
        { id: 'c1', title: 'Problems 1-3' },
        { id: 'c2', title: 'Problems 4-6' },
      ],
    },
    { id: 'd', title: 'Pset 9' },
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
  const { GoalTree } = await import('./GoalTree');
  // Subscribed, exactly as the `Project` page does — it reads `goal.nodes` from the
  // store on every render. Passing a captured snapshot instead would freeze the
  // tree, and the selection's pruning is precisely the behaviour that depends
  // on `nodes` changing identity when the data does.
  const TreeHost = () => {
    const { goals } = store.useAppStore();
    return createElement(GoalTree, { nodes: goals[0].nodes });
  };
  // `expanded` is seeded by initStore's container auto-expand, so `grp` is open
  // and all six rows are on screen.
  render(createElement(TreeHost));
  return { store, user: userEvent.setup() };
}

const row = (title: string): HTMLElement => screen.getByText(title).closest('[data-row]') as HTMLElement;
/** Selected rows by node id, in render order — a row's text also carries the
 *  drag glyph, the twirl, the percentage and every hover control. */
const selectedIds = (): string[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-row][aria-selected="true"]'))
    .map((el) => el.dataset.nodeId ?? '');

beforeEach(() => vi.clearAllMocks());
// RTL's automatic cleanup only registers under `globals: true`; without this,
// every render stays in the document and `getByRole` sees the previous tests'.
afterEach(() => cleanup());

describe('building a selection', () => {
  it('exposes the tree as multi-selectable before anything is picked', async () => {
    await mountTree();
    const tree = screen.getByRole('tree');
    expect(tree.getAttribute('aria-multiselectable')).toBe('true');
    // Every row carries aria-selected from the start; a multiselectable
    // container whose children only expose it once chosen reads as a cursor.
    expect(row('Pset 6').getAttribute('aria-selected')).toBe('false');
  });

  it('adds and removes one row on Cmd-click, without running the row action', async () => {
    const { store, user } = await mountTree();

    await user.keyboard('{Meta>}');
    await user.click(row('Pset 7'));
    await user.keyboard('{/Meta}');

    expect(selectedIds()).toEqual(['b']);
    // The click selected — it did NOT tick the box.
    const { findInAll } = await import('../lib/tree');
    expect(findInAll(store.getState().goals, 'b')?.status).toBeUndefined();

    await user.keyboard('{Meta>}');
    await user.click(row('Pset 7'));
    await user.keyboard('{/Meta}');
    expect(selectedIds()).toEqual([]);
  });

  /**
   * Clicks land on CHILDREN, not on the row.
   *
   * Nearly every pixel of a row is covered by an element that deliberately
   * stops propagation — the title span, the drag handle, the checkbox, the
   * three hover controls. A browser click therefore never reaches the row's
   * own bubble handler, so Cmd-click selected nothing anywhere on the row.
   * Every other test in this file dispatches straight at the row element,
   * where `e.target` IS the row, and is structurally blind to it. This one
   * clicks the title, which is what a person hits.
   */
  it('selects when the click lands on the title, not the row', async () => {
    const { user } = await mountTree();

    await user.keyboard('{Meta>}');
    await user.click(screen.getByText('Pset 7'));
    await user.keyboard('{/Meta}');

    expect(selectedIds()).toEqual(['b']);
  });

  it('selects when the click lands on a hover control, rather than firing it', async () => {
    const { user } = await mountTree();

    // The `⋯` menu IS the row's hover control now — rename, add-subtask and
    // delete all moved inside it. A modifier-click on it must still be caught
    // in the capture phase and read as "select this row", exactly as it was
    // when the same click could have deleted the row outright.
    await user.keyboard('{Meta>}');
    await user.click(within(row('Pset 7')).getByRole('button', { name: 'Actions for "Pset 7"' }));
    await user.keyboard('{/Meta}');

    expect(selectedIds()).toEqual(['b']);
    expect(screen.queryByRole('menu')).toBeNull(); // and the menu never opened
  });

  it('selects an on-screen run on Shift-click, including nested rows', async () => {
    const { user } = await mountTree();

    await user.click(row('Pset 7')); // plain click: no selection yet, toggles done
    await user.keyboard('{Meta>}');
    await user.click(row('Pset 7'));
    await user.keyboard('{/Meta}');

    await user.keyboard('{Shift>}');
    await user.click(row('Problems 4-6'));
    await user.keyboard('{/Shift}');

    expect(selectedIds()).toEqual(['b', 'grp', 'c1', 'c2']);
  });

  it('grows the range with Shift+Arrow and keeps focus moving', async () => {
    const { user } = await mountTree();
    row('Pset 6').focus();

    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');

    expect(selectedIds()).toEqual(['a', 'b', 'grp']);
    expect(document.activeElement).toBe(row('Pset 8'));
  });

  it('takes every visible row on Cmd+A', async () => {
    const { user } = await mountTree();
    row('Pset 6').focus();

    await user.keyboard('{Meta>}a{/Meta}');

    expect(selectedIds()).toEqual(['a', 'b', 'grp', 'c1', 'c2', 'd']);
  });

  it('announces the count in a live region', async () => {
    const { user } = await mountTree();
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');

    const status = screen.getByRole('status', { name: 'Selection' });
    expect(status.textContent).toBe('2 tasks selected');
  });
});

describe('acting on a selection', () => {
  it('completes every open leaf under it, in one undo', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');
    row('Pset 8').focus(); // the container
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}'); // Pset 8 + Problems 1-3

    await user.click(screen.getByRole('button', { name: 'Complete' }));

    expect(findInAll(store.getState().goals, 'c1')?.status).toBe('done');
    expect(findInAll(store.getState().goals, 'c2')?.status).toBe('done');
    expect(store.getState().pendingUndo?.label).toBe('Completed 2 tasks');
    expect(selectedIds()).toEqual([]); // the bar retires with the selection
  });

  it('deletes the selection under one undo, naming the subtree count', async () => {
    const { store, user } = await mountTree();
    row('Pset 8').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(store.getState().goals[0].nodes.map((n) => n.id)).toEqual(['a', 'b', 'd']);
    // Pset 8 + its two children + Problems 1-3 is covered by the container.
    expect(store.getState().pendingUndo?.label).toBe('Deleted 3 tasks');

    store.actions.undoLastDelete();
    expect(store.getState().goals[0].nodes.map((n) => n.id)).toEqual(['a', 'b', 'grp', 'd']);
  });

  it('deletes from the keyboard too', async () => {
    const { store, user } = await mountTree();
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');

    await user.keyboard('{Backspace}');

    expect(store.getState().goals[0].nodes.map((n) => n.id)).toEqual(['grp', 'd']);
    expect(store.getState().pendingUndo?.label).toBe('Deleted 2 tasks');
  });

  /**
   * Space selects, per the ARIA treeview pattern. It used to complete a leaf
   * and collapse a container — the keyboard twin of the old row click, bound
   * to the key most likely to be pressed by someone who thought they were
   * scrolling.
   */
  it('adds the focused row to the selection with Space, and leaves it alone otherwise', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');
    expect(store.getState().expanded.has('grp')).toBe(true);

    row('Pset 8').focus();
    await user.keyboard(' ');

    expect(screen.getByRole('status', { name: 'Selection' }).textContent).toBe('1 task selected');
    expect(store.getState().expanded.has('grp')).toBe(true);
    expect(findInAll(store.getState().goals, 'grp')?.status).toBeUndefined();
  });

  it('completes from the keyboard with X', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');

    await user.keyboard('x');

    expect(findInAll(store.getState().goals, 'a')?.status).toBe('done');
    expect(findInAll(store.getState().goals, 'b')?.status).toBe('done');
  });

  it('sets a whole selection to blocked in one undoable write', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}'); // a, b

    await user.selectOptions(screen.getByRole('combobox', { name: 'Set status' }), 'blocked');

    expect(findInAll(store.getState().goals, 'a')?.status).toBe('blocked');
    expect(findInAll(store.getState().goals, 'b')?.status).toBe('blocked');
    expect(store.getState().pendingUndo?.label).toBe('Blocked 2 tasks');
    expect(selectedIds()).toEqual([]); // the bar retires with the selection, like Complete/Delete
  });

  /*
   * The bulk bar is one of the two surfaces that may reach a status DIRECTLY
   * (the other is the task page's popover) — `S` and the row's `◐` cycle and
   * cannot reach 'done' or 'parked'. It offered four of the five, so the one
   * status with no keyboard route was also the one missing from the only
   * control that sets a status on N rows at once.
   */
  it('offers all five statuses, parked among them', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}'); // a, b

    // The bar exists only while something is selected.
    const select = screen.getByRole('combobox', { name: 'Set status' });
    expect(
      [...select.querySelectorAll('option')].map((o) => (o as HTMLOptionElement).value),
    ).toEqual(['', 'todo', 'doing', 'blocked', 'parked', 'done']);

    await user.selectOptions(select, 'parked');

    expect(findInAll(store.getState().goals, 'a')?.status).toBe('parked');
    expect(store.getState().pendingUndo?.label).toBe('Parked 2 tasks');
  });

  it('sets focus needed on a selection in ONE undoable write', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}'); // a, b

    await user.selectOptions(screen.getByLabelText('Set focus needed'), 'deep');

    expect(findInAll(store.getState().goals, 'a')?.demand).toBe('deep');
    expect(findInAll(store.getState().goals, 'b')?.demand).toBe('deep');
    expect(store.getState().pendingUndo?.label).toBe('Set 2 tasks to Deep');
    expect(selectedIds()).toEqual([]); // the bar retires with the selection, like Complete/Delete
  });
});

describe('getting out of a selection', () => {
  it('clears on Escape and stops it reaching the drawer', async () => {
    const { user } = await mountTree();
    const onEscape = vi.fn();
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') onEscape(); });
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');

    await user.keyboard('{Escape}');

    expect(selectedIds()).toEqual([]);
    // `stopPropagation` keeps App's global handler — which reads Escape as
    // "close the drawer" — from ever seeing it.
    expect(onEscape).not.toHaveBeenCalled();
  });

  /**
   * The click that ends a selection is the click people use to get out. Having
   * it also tick a box off is precisely the accidental destructive action a
   * selection UI exists to avoid.
   */
  it('clears on a plain click WITHOUT also completing that row', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');

    await user.click(row('Pset 9'));

    expect(selectedIds()).toEqual([]);
    expect(findInAll(store.getState().goals, 'd')?.status).toBeUndefined();
  });

  it('opens a row on an ordinary click, and completes nothing', async () => {
    const { store, user } = await mountTree();
    const { findInAll } = await import('../lib/tree');

    await user.click(row('Pset 9'));

    expect(store.getState().openStepId).toBe('d');
    expect(findInAll(store.getState().goals, 'd')?.status).toBeUndefined();
  });

  it('drops ids that stop existing, so the bar cannot count ghosts', async () => {
    const { store, user } = await mountTree();
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(screen.getByRole('status', { name: 'Selection' }).textContent).toBe('2 tasks selected');

    // Something else removes one of them out from under the selection.
    store.actions.removeNode('b');

    expect(await screen.findByText('1 task selected')).toBeTruthy();
  });
});

describe('a refused bulk action', () => {
  /**
   * Both actions refuse silently — a frozen (completed) project, or a selection
   * whose leaves are all done already. Dropping the bar and the highlights
   * anyway reads as "done" when nothing happened.
   */
  it('keeps the selection when the project is frozen', async () => {
    const { store, user } = await mountTree();
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(selectedIds()).toEqual(['a', 'b']);

    store.actions.completeGoal('g'); // freezes every structural edit
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(store.getState().goals[0].nodes.map((n) => n.id)).toEqual(['a', 'b', 'grp', 'd']);
    expect(selectedIds()).toEqual(['a', 'b']);
  });

  it('keeps the selection when every selected leaf is already done', async () => {
    const { store, user } = await mountTree();
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    expect(selectedIds()).toEqual([]);

    // The two finished rows are now an adjacent run, so they fold to one line.
    // `Show` is how you get back to them — the record is never removed, and
    // this is what proves a folded row is still reachable and still selectable.
    await user.click(screen.getByRole('button', { name: /2 done/ }));

    // Select the same two again — now both are done, so there is nothing to do.
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await user.click(screen.getByRole('button', { name: 'Complete' }));

    expect(selectedIds()).toEqual(['a', 'b']);
    expect(store.getState().pendingUndo?.label).toBe('Completed 2 tasks');
  });

  it('keeps the selection when Set status is reapplied to an unchanged status', async () => {
    const { store, user } = await mountTree();
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Set status' }), 'blocked');
    expect(selectedIds()).toEqual([]);
    const before = store.getState().pendingUndo?.label;

    // Select the same two again — both are already blocked, so setNodesStatus
    // refuses and the bar must not report success on a no-op.
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Set status' }), 'blocked');

    expect(selectedIds()).toEqual(['a', 'b']);
    expect(store.getState().pendingUndo?.label).toBe(before); // unchanged — no new write happened
  });
});

describe('the selection bar itself', () => {
  /**
   * `max-h-0 opacity-0` clips the bar visually and hides it from nobody — a
   * screen reader in browse mode would find three permanent buttons, and
   * `tabIndex={-1}` only keeps them out of the TAB order.
   */
  it('offers no buttons at all while nothing is selected', async () => {
    await mountTree();
    const bar = screen.getByRole('status', { name: 'Selection' }).parentElement as HTMLElement;
    expect(within(bar).queryAllByRole('button')).toEqual([]);
  });

  it('offers them once rows are selected, and takes them away again', async () => {
    const { user } = await mountTree();
    row('Pset 6').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');

    const bar = () => screen.getByRole('status', { name: 'Selection' }).parentElement as HTMLElement;
    expect(within(bar()).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Complete', 'Delete', 'Clear']);

    await user.click(within(bar()).getByRole('button', { name: 'Clear' }));
    expect(within(bar()).queryAllByRole('button')).toEqual([]);
  });
});
