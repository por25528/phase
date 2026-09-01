// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, GoalNode } from '../db/types';

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

async function renderTree(nodes: GoalNode[]): Promise<void> {
  vi.resetModules();
  const goal: Goal = { id: 'g', title: 'Systems', column: 0, nodes: structuredClone(nodes) };
  dbMocks.loadState.mockResolvedValueOnce({ goals: [goal], habits: [], tasks: [], sessions: [] });
  const store = await import('../state/store');
  await store.initStore();
  store.actions.openProject('g');
  const { GoalTree } = await import('./GoalTree');
  const TreeHost = () => {
    const { goals } = store.useAppStore();
    return createElement(GoalTree, { nodes: goals[0].nodes });
  };
  render(createElement(TreeHost));
}

const row = (title: string) => screen.getByText(title).closest('[data-row]') as HTMLElement;

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const done = (id: string, title: string): GoalNode => ({ id, title, status: 'done', doneAt: '2026-08-16' });

/**
 * A container is a RULE, and its progress is a figure with a bar beside it.
 */
describe('a container as a rule', () => {
  it('keeps every treeitem contract the row had', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    const rule = row('Parent');

    expect(rule.getAttribute('role')).toBe('treeitem');
    expect(rule.getAttribute('aria-level')).toBe('1');
    expect(rule.getAttribute('aria-expanded')).toBe('true');
    expect(rule.getAttribute('aria-selected')).toBe('false');
    expect(rule.tabIndex).toBe(0);
    // The children are a `group` the rule owns, not a second tree.
    expect(document.getElementById(rule.getAttribute('aria-owns')!)!.getAttribute('role')).toBe('group');
  });

  it('still carries the drag handle, the twirl and the ⋯ menu', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    const rule = row('Parent');

    expect(within(rule).getByRole('button', { name: 'Drag to reorder' })).toBeTruthy();
    expect(within(rule).getByRole('button', { name: 'Collapse' })).toBeTruthy();
    expect(within(rule).getByRole('button', { name: 'Actions for "Parent"' })).toBeTruthy();
  });

  it('renames in place, in mixed case rather than in the cell\'s voice', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    const user = userEvent.setup();
    row('Parent').focus();
    await user.keyboard('{Enter}');

    const input = screen.getByDisplayValue('Parent');
    // The stored title is mixed case; an editor that shouted it back in the
    // tag cell's voice would be lying about the value it holds.
    expect(input.className).toContain('normal-case');
  });

  it('is not a heading, because it is already a treeitem', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    expect(screen.queryByRole('heading', { name: 'Parent' })).toBeNull();
  });
});

/**
 * The one thing on this surface that could break the app's meaning.
 *
 * `pct.ts` counts `'done'` and nothing else — a step's status moves attention,
 * never the roll-up — so a bar showing a second, lighter segment for work in
 * progress would put a number on screen the app does not compute.
 */
describe('the progress bar', () => {
  const withStatuses: GoalNode[] = [{
    id: 'p',
    title: 'Parent',
    children: [
      done('a', 'One'),
      { id: 'b', title: 'Two', status: 'doing' },
      { id: 'c', title: 'Three', status: 'blocked' },
      { id: 'd', title: 'Four' },
    ],
  }];

  const fill = (): HTMLElement =>
    within(row('Parent')).getByTestId('pct-bar').firstElementChild as HTMLElement;

  it('fills to exactly what the roll-up counts, and never past it', async () => {
    await renderTree(withStatuses);
    // One of four leaves is done. `doing` and `blocked` weigh what an unticked
    // box has always weighed, which is nothing.
    expect(within(row('Parent')).getByText('25%')).toBeTruthy();
    expect(fill().style.width).toBe('25%');
  });

  it('draws ONE segment — nothing on it can mean "started"', async () => {
    await renderTree(withStatuses);
    const track = fill().parentElement!;
    expect(track.children).toHaveLength(1);
  });

  it('says nothing a screen reader has to hear twice', async () => {
    await renderTree(withStatuses);
    expect(fill().parentElement!.getAttribute('aria-hidden')).toBe('true');
  });

  it('states a blocked container in words, where it is a state and not a quantity', async () => {
    await renderTree([{
      id: 'p', title: 'Parent',
      children: [done('a', 'One'), { id: 'b', title: 'Two', status: 'blocked' }],
    }]);
    expect(within(row('Parent')).getByText('blocked')).toBeTruthy();
    expect(fill().style.width).toBe('50%');
  });
});

/**
 * Finished work folds to one line. The rule is Today's: work that is done
 * cannot outrank work that is not.
 */
describe('folding finished work', () => {
  const two: GoalNode[] = [done('a', 'Problem 1'), done('b', 'Problem 2'), { id: 'c', title: 'Problem 3' }];

  it('replaces a run of finished rows with one line that names them', async () => {
    await renderTree(two);
    expect(screen.queryByText('Problem 1')).toBeNull();
    const line = screen.getByRole('button', { name: /2 done/ });
    expect(line.textContent).toContain('Problem 1, Problem 2');
    expect(line.getAttribute('aria-expanded')).toBe('false');
  });

  it('gives every row back on Show, checkbox and all', async () => {
    await renderTree(two);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /2 done/ }));

    expect(screen.getByText('Problem 1')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Mark "Problem 1" as done/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /2 done/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('never folds a container that still has open children', async () => {
    await renderTree([
      { id: 'g', title: 'Half done', children: [done('x', 'X'), { id: 'y', title: 'Y' }] },
      done('b', 'Finished'),
      { id: 'c', title: 'Open' },
    ]);
    expect(screen.getByText('Half done')).toBeTruthy();
    // And a lone finished sibling beside it is not a run, so it stays too.
    expect(screen.getByText('Finished')).toBeTruthy();
  });

  it('folds a finished container, whose own rows go with it', async () => {
    await renderTree([
      { id: 'g', title: 'All done', children: [done('x', 'X'), done('y', 'Y')] },
      done('b', 'Finished'),
      { id: 'c', title: 'Open' },
    ]);
    expect(screen.queryByText('All done')).toBeNull();
    expect(screen.queryByText('X')).toBeNull();
    expect(screen.getByRole('button', { name: /2 done/ })).toBeTruthy();
  });

  it('sits inside a group, because a tree may own only treeitems and groups', async () => {
    await renderTree(two);
    const line = screen.getByRole('button', { name: /2 done/ });
    expect(line.parentElement!.getAttribute('role')).toBe('group');
    expect(line.closest('[role="tree"]')).not.toBeNull();
  });

  it('leaves the tree alone when nothing is finished', async () => {
    await renderTree([{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }]);
    expect(screen.queryByRole('button', { name: /done$/ })).toBeNull();
    expect(screen.getByText('One')).toBeTruthy();
  });

  it('folds a run wherever it sits, without reordering anything', async () => {
    await renderTree([{ id: 'a', title: 'First' }, done('b', 'Mid one'), done('c', 'Mid two'), { id: 'd', title: 'Last' }]);
    const shown = Array.from(document.querySelectorAll('[data-row]')).map((r) => (r as HTMLElement).dataset.nodeId);
    expect(shown).toEqual(['a', 'd']);
    expect(screen.getByRole('button', { name: /2 done/ }).textContent).toContain('Mid one, Mid two');
  });
});
