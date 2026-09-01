// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, GoalNode } from '../db/types';
import type { Demand } from '../lib/demand';

/**
 * The row chip — where demand is SET, not where it is true.
 *
 * `demandIndex` resolves a node's value from its nearest tagged ancestor, so a
 * `deep` goal paints `Deep` onto every leaf by inheritance. The tree row must
 * not repeat that word thirty times: the chip marks a CHANGE in demand, and its
 * condition is the RAW field (`n.demand !== undefined`), never the resolved
 * value — a deep goal with ten untagged leaves draws zero chips.
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

async function renderTree({ goalDemand, nodes }: { goalDemand?: Demand; nodes: GoalNode[] }): Promise<void> {
  vi.resetModules();
  const goal: Goal = {
    id: 'g', title: 'Systems', column: 0,
    ...(goalDemand === undefined ? {} : { demand: goalDemand }),
    nodes: structuredClone(nodes),
  };
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [goal], habits: [], tasks: [], sessions: [],
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
}

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('the demand chip', () => {
  it('draws a chip where the value is SET', async () => {
    await renderTree({ nodes: [{ id: 'a', title: 'a', demand: 'deep' }] });
    expect(screen.getByText('Deep')).toBeTruthy();
  });

  it('draws NOTHING where the value is inherited — a chip marks a change, not a repetition', async () => {
    await renderTree({ goalDemand: 'deep', nodes: [{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }] });
    expect(screen.queryByText('Deep')).toBeNull();
  });

  it('draws a chip on a leaf that OVERRIDES its inherited value', async () => {
    await renderTree({ goalDemand: 'deep', nodes: [{ id: 'a', title: 'a', demand: 'light' }] });
    expect(screen.getByText('Light')).toBeTruthy();
    expect(screen.queryByText('Deep')).toBeNull();
  });
});
