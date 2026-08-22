// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, GoalNode } from '../db/types';
import { cssBlock } from '../lib/contrast';

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
  it('does not let the title absorb the row\'s slack', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    expect(screen.getByText('Parent').className).not.toMatch(/\bflex-1\b/);
  });

  it('takes the slack AFTER the figures, so nothing readable sits at the edge', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    const line = screen.getByText('Parent').parentElement!;
    const kids = Array.from(line.children);
    const spacer = kids.findIndex((el) => el.className.includes('flex-1'));
    const pct = kids.indexOf(within(line).getByText('0%'));

    expect(spacer).toBeGreaterThan(-1);
    expect(spacer).toBeGreaterThan(pct);
  });

  it('leaves a LEAF title taking the slack, because its metadata is on line 2', async () => {
    await renderTree([{ id: 'a', title: 'Ship it', estimateMin: 45 }]);
    expect(within(row('Ship it')).getByText('Ship it').className).toMatch(/\bflex-1\b/);
  });
});
