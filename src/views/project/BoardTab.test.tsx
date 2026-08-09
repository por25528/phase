// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, GoalNode, Session } from '../../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: Session[] }> => ({
    goals: [], habits: [], tasks: [], sessions: [],
  })),
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
  loadPlanMode: vi.fn(async (): Promise<'week' | 'month'> => 'week'),
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

const leaf = (id: string, over: Partial<GoalNode> = {}): GoalNode => ({ id, title: id, ...over });

async function mount(goal: Goal) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(goal)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../../state/store');
  await store.initStore();
  const { BoardTab } = await import('./BoardTab');
  const onUseWork = vi.fn();
  const Host = () => {
    const { goals, actions } = store.useAppStore();
    return createElement(BoardTab, { goal: goals[0], actions, onUseWork });
  };
  render(createElement(Host));
  return { store, onUseWork };
}

const BIG: Goal = {
  id: 'g',
  title: 'Launch SaaS MVP',
  nodes: [
    { id: 'eng', title: 'Engineering', children: [
      leaf('Auth', { status: 'doing', estimateMin: 90 }),
      leaf('Webhooks', { status: 'blocked', blockedOn: 'waiting on Stripe' }),
      leaf('Rate limits'),
    ] },
    { id: 'gtm', title: 'Go-to-market', children: [leaf('Launch post'), leaf('Pricing page')] },
    leaf('Pick a name', { status: 'done' }),
  ],
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

const column = (name: string) =>
  screen.getByRole('heading', { name: new RegExp(name) }).closest('div')!.parentElement!;

describe('the goal board', () => {
  it('sorts every task into the column its status names', async () => {
    await mount(BIG);

    expect(within(column('In progress')).getByText('Auth')).toBeTruthy();
    expect(within(column('Blocked')).getByText('Webhooks')).toBeTruthy();
    expect(within(column('Done')).getByText('Pick a name')).toBeTruthy();
  });

  it('shows a card its area, estimate and blocker, and nothing else', async () => {
    await mount(BIG);
    const card = screen.getByText('Webhooks').closest('button')!;

    expect(card.textContent).toContain('Engineering');
    expect(card.textContent).toContain('waiting on Stripe');
    // No percentage, no progress bar, no action footer — the failure mode the
    // global goal cards already have.
    expect(card.textContent).not.toMatch(/%/);
  });

  it('never renders an area as a card among the tasks', async () => {
    await mount(BIG);
    // "Engineering" appears only as a breadcrumb and a filter chip.
    expect(screen.queryByRole('button', { name: /^Drag "Engineering"$/ })).toBeNull();
  });

  it('filters to one area without changing what a column means', async () => {
    await mount(BIG);

    fireEvent.click(screen.getByRole('button', { name: 'Go-to-market' }));

    expect(screen.queryByText('Auth')).toBeNull();
    expect(screen.getByText('Launch post')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /In progress/ })).toBeTruthy();
  });

  it('opens the inspector when a card is clicked', async () => {
    const { store } = await mount(BIG);

    fireEvent.click(screen.getByText('Auth').closest('button')!);

    expect(store.getState().openStepId).toBe('Auth');
  });

  /**
   * Four large empty drop zones teach a user the feature is broken. Below a
   * handful of open tasks the tree wins — it shows ORDER, which is what a
   * reading list or a problem set is actually organised by.
   */
  it('points a thin goal back at Work instead of showing empty columns', async () => {
    const { onUseWork } = await mount({ id: 'g', title: 'Small', nodes: [leaf('One'), leaf('Two')] });

    fireEvent.click(screen.getByRole('button', { name: 'Work' }));

    expect(onUseWork).toHaveBeenCalled();
  });

  it('says so plainly when there is nothing to arrange at all', async () => {
    await mount({ id: 'g', title: 'Empty', nodes: [] });

    expect(screen.getByText(/Nothing to arrange yet/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /To do/ })).toBeNull();
  });

  /**
   * Warn, never refuse. A hard limit would be the board deciding it knows
   * better than the person about a Tuesday, and the only way past it would be
   * to lie about a status.
   */
  it('warns above the WIP limit rather than refusing the fourth card', async () => {
    await mount({
      id: 'g',
      title: 'Busy',
      nodes: Array.from({ length: 4 }, (_, i) => leaf(`n${i}`, { status: 'doing' })),
    });

    expect(within(column('In progress')).getByText(/over 3/)).toBeTruthy();
    expect(within(column('In progress')).getAllByRole('button', { name: /^Drag/ })).toHaveLength(4);
  });
});
