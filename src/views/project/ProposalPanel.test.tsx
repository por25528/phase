// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, GoalNode, Session } from '../../db/types';
import { addDays, todayStr } from '../../lib/dates';
import { fmtMinutes } from '../../lib/effort';
import { dayLabel } from '../../lib/todayPlan';

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

const NODE: GoalNode = { id: 'n1', title: 'Implement parser' };
const GOAL: Goal = { id: 'g', title: '6.1200', nodes: [NODE] };

async function mount(freeDay?: { date: string; freeMin: number }) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(GOAL)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../../state/store');
  await store.initStore();
  const { ProposalPanel } = await import('./ProposalPanel');
  const onClose = vi.fn();
  const Host = () => {
    const { goals, actions } = store.useAppStore();
    return createElement(ProposalPanel, {
      goal: goals[0], node: goals[0].nodes[0], actions, onClose,
      ...(freeDay ? { freeDay } : {}),
    });
  };
  render(createElement(Host));
  return { store, onClose };
}

/** Paste, the way the panel is meant to be driven. */
function paste(text: string) {
  const box = screen.getByRole('textbox', { name: 'Paste the reply' });
  fireEvent.paste(box, { clipboardData: { getData: () => text } });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('the breakdown proposal', () => {
  /**
   * The dialog this replaced asked which task you meant, in a dropdown, about a
   * task you had usually just clicked on.
   */
  it('names its subject rather than asking for it', async () => {
    await mount();
    expect(screen.getByRole('heading', { name: /Implement parser/ })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('reads a pasted list without a second button press', async () => {
    await mount();

    paste('Read the spec — 45m\nWrite the lexer — 1h\nWrite the parser');

    expect(screen.getAllByRole('textbox', { name: 'Proposed task' })).toHaveLength(3);
  });

  it('quotes priced work and the next free day separately', async () => {
    const today = todayStr();
    const tomorrow = addDays(today, 1);
    await mount({ date: tomorrow, freeMin: 85 });

    paste('Read chapter 7 — 45m\nProblems 1–15 — 1h\nMock quiz');

    const estimate = fmtMinutes(45 + 60);
    const day = dayLabel(tomorrow, today);
    const free = fmtMinutes(85);
    const line = screen.getByText(new RegExp(`${day} has`));
    expect(line.textContent).toBe(`${estimate} · 1 unestimated · ${day} has ${free} free`);
    expect(line.textContent).not.toBe(`${estimate} · ${day} has ${free} free`);
  });

  it('omits the free-day half when no free day is supplied', async () => {
    const today = todayStr();
    const day = dayLabel(addDays(today, 1), today);
    await mount();

    paste('Read chapter 7 — 45m\nProblems 1–15 — 1h\nMock quiz');

    const estimate = fmtMinutes(45 + 60);
    expect(screen.getByText(estimate).textContent).toBe(estimate);
    expect(screen.queryByText(new RegExp(`${day} has`))).toBeNull();
  });

  it('brings the durations through priced', async () => {
    const { store } = await mount();

    paste('Read the spec — 45m\nWrite the lexer — 1h');
    fireEvent.click(screen.getByRole('button', { name: /^Add 2 subtasks$/ }));

    expect(store.getState().goals[0].nodes[0].children?.map((c) => c.estimateMin))
      .toEqual([45, 60]);
  });

  /**
   * A proposal you cannot correct is one you either accept wholesale or throw
   * away, and both of those are worse than typing it yourself.
   */
  it('lets a row be edited before it becomes work', async () => {
    const { store } = await mount();

    paste('Reed the spec');
    fireEvent.change(screen.getByRole('textbox', { name: 'Proposed task' }), {
      target: { value: 'Read the spec' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Add 1 subtask$/ }));

    expect(store.getState().goals[0].nodes[0].children?.[0].title).toBe('Read the spec');
  });

  it('lets a row be dropped without dropping the rest', async () => {
    const { store } = await mount();

    paste('Keep me\nDrop me');
    fireEvent.click(screen.getByRole('checkbox', { name: /Drop me/ }));
    expect(screen.getByRole('button', { name: /^Add 1 subtask$/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Add 1 subtask$/ }));
    expect(store.getState().goals[0].nodes[0].children?.map((c) => c.title)).toEqual(['Keep me']);
  });

  it('creates nothing when every row has been dropped', async () => {
    const { store } = await mount();

    paste('Only one');
    fireEvent.click(screen.getByRole('checkbox', { name: /Only one/ }));

    expect(screen.getByRole('button', { name: /^Add 0 subtasks$/ })).toHaveProperty('disabled', true);
    expect(store.getState().goals[0].nodes[0].children).toBeUndefined();
  });

  it('accepts in one write, so one undo takes the whole breakdown back', async () => {
    const { store } = await mount();

    paste('One\nTwo\nThree');
    fireEvent.click(screen.getByRole('button', { name: /^Add 3 subtasks$/ }));
    expect(store.getState().goals[0].nodes[0].children).toHaveLength(3);
  });

  it('says what it could not read instead of pretending it worked', async () => {
    await mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste the reply' }), {
      target: { value: '{"not": "a list"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }));

    expect(screen.getByRole('alert').textContent).toMatch(/didn't look like a list/);
  });
});
