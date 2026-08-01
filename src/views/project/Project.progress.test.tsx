// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
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
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
  isSlotMigrationDone: vi.fn(async () => true),
  saveSlotMigrationSnapshot: vi.fn(async () => {}),
  loadSlotMigrationSnapshot: vi.fn(async () => null),
  markSlotMigrationDone: vi.fn(async () => {}),
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
  id: 'g1', title: 'Studying Roblox', column: 0,
  start: '2026-01-01', deadline: '2026-12-31',
  nodes: [
    { id: 'n1', title: 'Define the topics', done: false },
    { id: 'n2', title: 'Order the topics', done: false },
  ],
  notes: 'Existing note text',
};

type Store = typeof import('../../state/store');

/** Boot a store holding `seed`, open its page, and render it. */
async function mountPage(nodeId?: string): Promise<Store> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(seed)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../../state/store');
  await store.initStore();
  store.actions.setView('goals');
  store.actions.openProject('g1', nodeId);
  const { Project } = await import('../Project');
  const Host = () => {
    store.useAppStore(); // subscribe so tab switches re-render
    return createElement(Project);
  };
  render(createElement(Host));
  return store;
}

async function mountGoal(goal: Goal, sessions: Session[] = []): Promise<Store> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(goal)], habits: [], tasks: [], sessions,
  });
  const store = await import('../../state/store');
  await store.initStore();
  store.actions.openProject(goal.id);
  const { Project } = await import('../Project');
  const Host = () => { store.useAppStore(); return createElement(Project); };
  render(createElement(Host));
  return store;
}

describe('Project page', () => {
  it('renders the project title and its progress', async () => {
    await mountPage();
    expect(screen.getByRole('button', { name: /Rename project "Studying Roblox"/ })).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('exposes the project title as the page heading', async () => {
    await mountPage();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('Studying Roblox');
  });

  it('opens on the steps tab and lists the steps', async () => {
    await mountPage();
    expect(screen.getByRole('tab', { name: 'Steps' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Define the topics')).toBeTruthy();
  });

  it('keeps the navigated step selected after the pulse pointer clears', async () => {
    vi.useFakeTimers();
    try {
      HTMLElement.prototype.scrollIntoView = vi.fn();
      const store = await mountPage('n2');

      act(() => { vi.advanceTimersByTime(70); });
      expect(store.getState().focusNodeId).toBeNull();
      expect(store.getState().openStepId).toBe('n2');

      fireEvent.click(screen.getByRole('button', { name: '✦ Break a step into subtasks…' }));
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('n2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches to the notes tab and back', async () => {
    const store = await mountPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(store.getState().projectTab).toBe('notes');
    expect(screen.queryByText('Define the topics')).toBeNull();
    expect(screen.getByLabelText('Project notes')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Steps' }));
    expect(screen.getByText('Define the topics')).toBeTruthy();
  });

  it('associates the active tab with the project panel', async () => {
    const store = await mountPage();
    const steps = screen.getByRole('tab', { name: 'Steps' });
    const notes = screen.getByRole('tab', { name: 'Notes' });
    const panel = screen.getByRole('tabpanel');

    expect(panel.id).toBe('projectBody');
    expect(panel.getAttribute('aria-labelledby')).toBe(steps.id);
    expect(panel.getAttribute('tabindex')).toBeNull();
    expect(steps.getAttribute('aria-controls')).toBe(panel.id);

    fireEvent.click(notes);
    expect(store.getState().projectTab).toBe('notes');
    expect(panel.getAttribute('aria-labelledby')).toBe(notes.id);
    expect(notes.getAttribute('aria-controls')).toBe(panel.id);
  });

  it('roves the tab stop with the selected tab', async () => {
    const store = await mountPage();
    const steps = screen.getByRole('tab', { name: 'Steps' });
    const notes = screen.getByRole('tab', { name: 'Notes' });

    expect(steps.getAttribute('tabindex')).toBe('0');
    expect(notes.getAttribute('tabindex')).toBe('-1');

    fireEvent.click(notes);
    expect(store.getState().projectTab).toBe('notes');
    expect(steps.getAttribute('tabindex')).toBe('-1');
    expect(notes.getAttribute('tabindex')).toBe('0');
  });

  it('moves right between tabs and wraps', async () => {
    const store = await mountPage();
    const steps = screen.getByRole('tab', { name: 'Steps' });
    const notes = screen.getByRole('tab', { name: 'Notes' });

    steps.focus();
    fireEvent.keyDown(steps, { key: 'ArrowRight' });
    expect(store.getState().projectTab).toBe('notes');
    expect(document.activeElement).toBe(notes);

    fireEvent.keyDown(notes, { key: 'ArrowRight' });
    expect(store.getState().projectTab).toBe('steps');
    expect(document.activeElement).toBe(steps);
  });

  it('moves left from the first tab to the last tab', async () => {
    const store = await mountPage();
    const steps = screen.getByRole('tab', { name: 'Steps' });
    const notes = screen.getByRole('tab', { name: 'Notes' });

    steps.focus();
    fireEvent.keyDown(steps, { key: 'ArrowLeft' });
    expect(store.getState().projectTab).toBe('notes');
    expect(document.activeElement).toBe(notes);
  });

  it('selects the first and last tabs with Home and End', async () => {
    const store = await mountPage();
    const steps = screen.getByRole('tab', { name: 'Steps' });
    const notes = screen.getByRole('tab', { name: 'Notes' });

    steps.focus();
    fireEvent.keyDown(steps, { key: 'End' });
    expect(store.getState().projectTab).toBe('notes');
    expect(document.activeElement).toBe(notes);

    fireEvent.keyDown(notes, { key: 'Home' });
    expect(store.getState().projectTab).toBe('steps');
    expect(document.activeElement).toBe(steps);
  });

  it('the breadcrumb returns to the board', async () => {
    const store = await mountPage();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Projects' }));
    expect(store.getState().view).toBe('goals');
    expect(store.getState().openGoalId).toBeNull();
  });

  it('renders nothing once the project is closed', async () => {
    const store = await mountPage();
    expect(screen.queryByRole('tab', { name: 'Steps' })).toBeTruthy();
    store.actions.closeProject();
    cleanup();
    const { Project } = await import('../Project');
    const Host = () => { store.useAppStore(); return createElement(Project); };
    const { container } = render(createElement(Host));
    expect(container.firstChild).toBeNull();
  });
});

/**
 * What the project's progress strip says, driven through the real DOM.
 *
 * Three things converge on this one line and each of them used to be silent or
 * misleading:
 *   - a project with no deadline rendered the literal "No project schedule",
 *   - the percentage never disclosed whether it was weighted by estimate,
 *   - logged time had no producer, so no calibration could ever be shown.
 */

const openLeaf = (id: string, estimateMin?: number): GoalNode => ({
  id, title: id, done: false, ...(estimateMin ? { estimateMin } : {}),
});

beforeEach(() => vi.clearAllMocks());

/** Days before today, as a local 'YYYY-MM-DD' — the shape `doneAt` carries. */
async function daysAgo(n: number): Promise<string> {
  const { todayStr, addDays } = await import('../../lib/dates');
  return addDays(todayStr(), -n);
}

describe('a project with no schedule', () => {
  it('reports velocity instead of "No project schedule"', async () => {
    const recent = await daysAgo(3);
    await mountGoal({
      id: 'g', title: 'Open-ended', nodes: [
        { id: 'a', title: 'a', done: true, doneAt: recent },
        { id: 'b', title: 'b', done: true, doneAt: recent },
        { id: 'c', title: 'c', done: true, doneAt: recent },
        openLeaf('d'), openLeaf('e'), openLeaf('f'),
      ],
    });

    expect(screen.queryByText(/No project schedule/)).toBeNull();
    expect(screen.getByText(/3 done in 14 days · 3 left/)).toBeTruthy();
  });

  it('names a stall, which a deadline-based pace line cannot see', async () => {
    const old = await daysAgo(60);
    await mountGoal({
      id: 'g', title: 'Stalled', nodes: [
        { id: 'a', title: 'a', done: true, doneAt: old },
        openLeaf('b'), openLeaf('c'),
      ],
    });
    expect(screen.getByText(/nothing finished in 14 days · 2 steps open/)).toBeTruthy();
  });

  it('adds remaining effort when every open step is estimated', async () => {
    const recent = await daysAgo(2);
    await mountGoal({
      id: 'g', title: 'Estimated', nodes: [
        { id: 'a', title: 'a', done: true, doneAt: recent, estimateMin: 60 },
        { id: 'b', title: 'b', done: true, doneAt: recent, estimateMin: 60 },
        { id: 'c', title: 'c', done: true, doneAt: recent, estimateMin: 60 },
        openLeaf('d', 120), openLeaf('e', 90),
      ],
    });
    expect(screen.getByText(/~3\.5h of work/)).toBeTruthy();
  });

  it('falls back to a useful message when the project has no steps at all', async () => {
    await mountGoal({ id: 'g', title: 'Empty', nodes: [] });
    expect(screen.queryByText(/No project schedule/)).toBeNull();
    expect(screen.getByText(/no steps yet/)).toBeTruthy();
  });
});

describe('disclosing how the percentage was computed', () => {
  it('says the roll-up is weighted when every step is estimated', async () => {
    await mountGoal({
      id: 'g', title: 'W', nodes: [
        { id: 'a', title: 'a', done: true, estimateMin: 20 },
        openLeaf('b', 360),
      ],
    });
    expect(screen.getByText(/1\/2 steps, weighted by estimate/)).toBeTruthy();
    // 20 of 380 minutes, not the 50% an equal-weight mean would report.
    expect(screen.getByText('5%')).toBeTruthy();
  });

  it('shows a bare step count when the roll-up fell back to equal weight', async () => {
    await mountGoal({
      id: 'g', title: 'E', nodes: [
        { id: 'a', title: 'a', done: true, estimateMin: 20 },
        openLeaf('b'),
      ],
    });
    const counter = screen.getByText(/1\/2 steps/);
    expect(counter.textContent).not.toMatch(/weighted/);
    expect(screen.getByText('50%')).toBeTruthy();
  });
});

describe('estimate calibration', () => {
  const calibrated: Goal = {
    id: 'g', title: 'C',
    nodes: Array.from({ length: 5 }, (_, i) => ({
      id: `n${i}`, title: `n${i}`, done: true, estimateMin: 60,
    })),
  };
  const sessionsFor = (minutes: number): Session[] =>
    Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`, goalId: 'g', nodeId: `n${i}`, date: '2026-07-28', minutes, note: '',
    }));

  it('reports how estimates have compared to logged time', async () => {
    await mountGoal(calibrated, sessionsFor(90));
    expect(screen.getByText(/estimates run about 1\.5× short/)).toBeTruthy();
  });

  it('stays silent without enough history', async () => {
    await mountGoal(calibrated, sessionsFor(90).slice(0, 2));
    expect(screen.queryByText(/estimates run about/)).toBeNull();
  });

  it('never rewrites the estimate it comments on', async () => {
    const store = await mountGoal(calibrated, sessionsFor(90));
    // Advisory only. The whole point is that the user's number stands and the
    // observation sits beside it.
    for (const node of store.getState().goals[0].nodes) {
      expect(node.estimateMin).toBe(60);
    }
  });
});
