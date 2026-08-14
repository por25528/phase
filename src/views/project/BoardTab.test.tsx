// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  loadActiveFocusSession: vi.fn(async () => null),
  saveActiveFocusSession: vi.fn(async () => {}),
  loadAssistantAccelerator: vi.fn(async () => 'Command+Space'),
  saveAssistantAccelerator: vi.fn(async () => {}),
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
    // "Engineering" is a filter button and a breadcrumb, but never a task
    // button of its own.
    expect(screen.getAllByRole('button', { name: 'Engineering' })).toHaveLength(1);
  });

  it('filters to one area without changing what a column means', async () => {
    await mount(BIG);

    fireEvent.click(screen.getByRole('button', { name: 'Go-to-market' }));

    expect(screen.queryByText('Auth')).toBeNull();
    expect(screen.getByText('Launch post')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /In progress/ })).toBeTruthy();
  });

  it('uses the whole card surface for both dragging and opening', async () => {
    const { store } = await mount(BIG);
    const card = screen.getByText('Auth').closest('button')!;

    expect(card.getAttribute('aria-roledescription')).toBe('draggable');
    expect(card.tabIndex).toBe(0);
    expect(screen.queryByRole('button', { name: 'Drag "Auth"' })).toBeNull();

    fireEvent.click(card);
    expect(store.getState().openStepId).toBe('Auth');
  });

  it('starts dragging from the card title once pointer movement passes the threshold', async () => {
    await mount(BIG);
    const title = screen.getByText('Auth');

    fireEvent.pointerDown(title, { button: 0, clientX: 10, clientY: 10, pointerId: 1, isPrimary: true });
    fireEvent.pointerMove(document, { clientX: 15, clientY: 10, pointerId: 1, isPrimary: true });

    await waitFor(() => expect(screen.getAllByText('Auth')).toHaveLength(2));
    fireEvent.pointerUp(document, { clientX: 15, clientY: 10, pointerId: 1, isPrimary: true });
    // dnd-kit deliberately keeps its click-suppression listener for 50ms after
    // a pointer drag ends. Let it detach so this test cannot swallow the next
    // test's unrelated click.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  it('still opens the inspector with Enter', async () => {
    const { store } = await mount(BIG);
    const card = screen.getByText('Auth').closest('button')!;

    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });

    expect(store.getState().openStepId).toBe('Auth');
  });

  it('does not open the inspector when Enter is pressed during a keyboard drag', async () => {
    const { store } = await mount(BIG);
    const card = screen.getByText('Auth').closest('button')!;

    fireEvent.keyDown(card, { key: ' ', code: 'Space' });
    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'));
    // KeyboardSensor installs its document-level drag controls on the next
    // task after activation.
    await new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });

    expect(store.getState().openStepId).toBeNull();
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

    const inProgress = within(column('In progress'));
    expect(inProgress.getByText(/over 3/)).toBeTruthy();
    const cards = inProgress.getAllByRole('button');
    expect(cards).toHaveLength(4);
    expect(cards.every((card) => card.getAttribute('aria-roledescription') === 'draggable')).toBe(true);
  });
});
