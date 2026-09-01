// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, GoalNode } from '../db/types';
import { cssBlock } from '../lib/contrast';

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
  loadShelfPrefs: vi.fn(async () => ({ width: 'default', density: 'comfortable', position: 'center', sections: { alternatives: true, dials: true } })),
  saveShelfPrefs: vi.fn(async () => {}),
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

/**
 * The invisible "+ Add task" input inside every expanded container.
 *
 * `opacity: 0` is right for a `.quiet-control` — an invisible ROW CONTROL
 * costs nothing. This is a full-width BLOCK, so an invisible one cost its
 * whole height in the middle of the tree, once per expanded container.
 *
 * Asserted against the stylesheet rather than the DOM for the reason
 * `GoalTree.meta.test.tsx` already gives: jsdom has no layout and no computed
 * cascade to measure, so the rule itself is the only thing there is to check.
 */
describe('the hidden add-task input', () => {
  const css = () => readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

  it('collapses its height while hidden, so it leaves no gap', () => {
    const hidden = cssBlock(css(), '.subtree:not(:hover) .subtree-reveal:not(:focus-within)');
    expect(hidden).toMatch(/\bmax-height\s*:\s*0\b/);
  });

  it('still takes its height back at rest, so revealing it shows something', () => {
    const base = cssBlock(css(), '.subtree-reveal');
    // An upper bound, not a measurement — the root font size is a user
    // setting, so a px height here would be wrong at every scale but one.
    expect(base).toMatch(/\bmax-height\s*:\s*(?!0\b)[\d.]+\w/);
    expect(base).toMatch(/\boverflow\s*:\s*hidden\b/);
  });

  // The reason opacity was chosen in the first place, and the reason the
  // height collapse had to be `max-height` rather than the obvious fix.
  it('never reaches for display or visibility, which would strand it', () => {
    for (const block of [
      cssBlock(css(), '.subtree-reveal'),
      cssBlock(css(), '.subtree:not(:hover) .subtree-reveal:not(:focus-within)'),
    ]) {
      expect(block).not.toMatch(/\bdisplay\s*:\s*none\b/);
      expect(block).not.toMatch(/\bvisibility\s*:\s*hidden\b/);
    }
  });
});

/**
 * A container's figures used to drift to the far edge.
 *
 * `ROW_CLS` claimed the two-column grid deleted the ~700px gutter, and it did
 * — for a LEAF, whose metadata moved to line 2. A container has no line 2, so
 * its `%`, its `blocked` flag and its WHEN readout stayed on line 1 behind a
 * `flex-1` title that absorbed every pixel of slack.
 *
 * jsdom cannot measure the gap, so what is asserted is the STRUCTURE that
 * produces it: which element takes the slack.
 */
describe('a container states its figures beside its name', () => {
  /*
   * A container is a RULE now, and this is the assertion that says the defect
   * cannot come back by arrangement: the name and the figure are not two
   * elements in one flex line that some future `flex-1` could drive apart —
   * they are the two CELLS of a rule, with the hairline between them, and a
   * rule has nowhere else to put either of them.
   */
  it('draws the name in the tag cell and the figure in the cell on the far end', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    const rule = row('Parent').firstElementChild!;

    expect(rule.className).toContain('border-b'); // the hairline IS the row
    const [tag, spacer, fact] = Array.from(rule.children);
    expect(tag.textContent).toContain('Parent');
    expect(tag.className).toContain('border-r');
    expect(spacer.className).toContain('flex-1');
    expect(fact.textContent).toContain('0%');
    expect(fact.className).toContain('border-l');
  });

  it('never puts a container back on the grid a leaf uses', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    // The grid is where the gutter lived: a `flex-1` title on line 1 with
    // `flex-shrink-0` figures after it.
    expect(row('Parent').className).not.toContain('grid-cols-');
  });

  it('leaves a LEAF title taking the slack, because its metadata is on line 2', async () => {
    await renderTree([{ id: 'a', title: 'Ship it', demand: 'deep' }]);
    expect(within(row('Ship it')).getByText('Ship it').className).toMatch(/\bflex-1\b/);
  });
});
