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
    { id: 'n1', title: 'Define the topics' },
    { id: 'n2', title: 'Order the topics' },
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
  it('renders the goal title and a compact progress read', async () => {
    await mountPage();
    expect(screen.getByRole('button', { name: /Rename goal "Studying Roblox"/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Goal status and dates' }).textContent).toMatch(/0%/);
  });

  it('exposes the project title as the page heading', async () => {
    await mountPage();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('Studying Roblox');
  });

  it('opens on the steps tab and lists the steps', async () => {
    await mountPage();
    expect(screen.getByRole('tab', { name: 'Tasks' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Define the topics')).toBeTruthy();
  });

  it('opens a leaf step as its own page, replacing the tree', async () => {
    const store = await mountPage();
    store.actions.openStep('n1');

    // A leaf routes to `TaskPage` now (`Project.tsx`'s render-time branch),
    // not the docked panel beside the tree — so the tree, and its other rows,
    // are off-screen while the page is open.
    expect(await screen.findByRole('heading', { name: 'Define the topics' })).toBeTruthy();
    expect(screen.queryByText('Order the topics')).toBeNull();
  });

  it('hides the panel when the step is closed', async () => {
    const store = await mountPage();
    store.actions.openStep('n1');
    store.actions.closeStep();

    expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull();
  });

  it('drops the panel when its step is deleted', async () => {
    const store = await mountPage();
    store.actions.openStep('n1');
    store.actions.removeNode('n1');

    expect(store.getState().openStepId).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull();
  });

  it('keeps the navigated step selected, and holds the pulse pointer while its page is open', async () => {
    vi.useFakeTimers();
    try {
      HTMLElement.prototype.scrollIntoView = vi.fn();
      const store = await mountPage('n2');

      // `n2` is a leaf, so `TaskPage` renders instead of `#projectBody` — the
      // pulse effect has nowhere to scroll to and must not fire, or it would
      // consume `focusNodeId` for a highlight nobody sees (final-review fix
      // #1). The pointer stays live so Back can still pulse the row.
      act(() => { vi.advanceTimersByTime(70); });
      expect(store.getState().focusNodeId).toBe('n2');
      expect(store.getState().openStepId).toBe('n2');

      /*
       * The breakdown control names its subject rather than asking for it.
       * It used to open a dialog whose first field was a dropdown asking which
       * task you meant — about a task you had just clicked on.
       *
       * `n2` is a leaf, so it opens as `TaskPage` — and the verb now lives in
       * that page's `⋯` rather than standing under the note, which on an
       * untouched task left it alone below 220px of blank document. The
       * accessible name is still the words alone: it was once a bare text node
       * beside a `✦`, and screen readers read the decoration out.
       */
      fireEvent.click(screen.getByRole('button', { name: /^Actions for / }));
      const breakdown = screen.getByRole('menuitem', { name: 'Break into smaller steps' });
      expect(breakdown.textContent).toBe('Break into smaller steps');
      fireEvent.click(breakdown);
      expect(screen.getByRole('heading', { name: /Break down/ })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches to the notes tab and back', async () => {
    const store = await mountPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(store.getState().projectTab).toBe('notes');
    expect(screen.queryByText('Define the topics')).toBeNull();
    expect(screen.getByLabelText('Goal notes')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }));
    expect(screen.getByText('Define the topics')).toBeTruthy();
  });

  it('seeds project notes and routes edits through the store', async () => {
    vi.useFakeTimers();
    try {
      const store = await mountPage();
      fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
      const editor = screen.getByLabelText('Goal notes');

      expect(editor.textContent).toContain('Existing note text');

      const setGoalNotes = vi.spyOn(store.actions, 'setGoalNotes');
      editor.innerHTML = '<p>Updated project note</p>';
      fireEvent.input(editor);
      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(801);
      });

      expect(setGoalNotes).toHaveBeenCalledWith('g1', 'Updated project note');
      expect(store.getState().goals[0].notes).toBe('Updated project note');
    } finally {
      vi.useRealTimers();
    }
  });

  it('associates the active tab with the project panel', async () => {
    const store = await mountPage();
    const steps = screen.getByRole('tab', { name: 'Tasks' });
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
    const steps = screen.getByRole('tab', { name: 'Tasks' });
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
    const overview = screen.getByRole('tab', { name: 'Overview' });
    const steps = screen.getByRole('tab', { name: 'Tasks' });
    const board = screen.getByRole('tab', { name: 'Board' });
    const notes = screen.getByRole('tab', { name: 'Notes' });

    steps.focus();
    fireEvent.keyDown(steps, { key: 'ArrowRight' });
    expect(store.getState().projectTab).toBe('board');
    expect(document.activeElement).toBe(board);

    fireEvent.keyDown(board, { key: 'ArrowRight' });
    expect(store.getState().projectTab).toBe('calendar');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Calendar' }), { key: 'ArrowRight' });
    expect(store.getState().projectTab).toBe('notes');

    // Wraps to Overview, which leads the strip now.
    fireEvent.keyDown(notes, { key: 'ArrowRight' });
    expect(store.getState().projectTab).toBe('overview');
    expect(document.activeElement).toBe(overview);
  });

  it('moves left from the first tab to the last tab', async () => {
    const store = await mountPage();
    const overview = screen.getByRole('tab', { name: 'Overview' });
    const notes = screen.getByRole('tab', { name: 'Notes' });

    // Selection, not focus, is what the strip navigates from — the roving
    // tabindex pattern moves the two together, so the test has to as well.
    fireEvent.click(overview);
    expect(store.getState().projectTab).toBe('overview');

    fireEvent.keyDown(overview, { key: 'ArrowLeft' });
    expect(store.getState().projectTab).toBe('notes');
    expect(document.activeElement).toBe(notes);
  });

  it('moves left from Tasks to Overview', async () => {
    const store = await mountPage();
    const overview = screen.getByRole('tab', { name: 'Overview' });
    const steps = screen.getByRole('tab', { name: 'Tasks' });

    steps.focus();
    fireEvent.keyDown(steps, { key: 'ArrowLeft' });
    expect(store.getState().projectTab).toBe('overview');
    expect(document.activeElement).toBe(overview);
  });

  it('selects the first and last tabs with Home and End', async () => {
    const store = await mountPage();
    const overview = screen.getByRole('tab', { name: 'Overview' });
    const steps = screen.getByRole('tab', { name: 'Tasks' });
    const notes = screen.getByRole('tab', { name: 'Notes' });

    steps.focus();
    fireEvent.keyDown(steps, { key: 'End' });
    expect(store.getState().projectTab).toBe('notes');
    expect(document.activeElement).toBe(notes);

    fireEvent.keyDown(notes, { key: 'Home' });
    expect(store.getState().projectTab).toBe('overview');
    expect(document.activeElement).toBe(overview);
  });

  it('the breadcrumb returns to the board', async () => {
    const store = await mountPage();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Goals' }));
    expect(store.getState().view).toBe('goals');
    expect(store.getState().openGoalId).toBeNull();
  });

  it('renders nothing once the project is closed', async () => {
    const store = await mountPage();
    expect(screen.queryByRole('tab', { name: 'Tasks' })).toBeTruthy();
    store.actions.closeProject();
    cleanup();
    const { Project } = await import('../Project');
    const Host = () => { store.useAppStore(); return createElement(Project); };
    const { container } = render(createElement(Host));
    expect(container.firstChild).toBeNull();
  });
});

/**
 * What the goal's status says, driven through the real DOM.
 *
 * All of it used to sit in the header, at the same weight as everything else,
 * on every visit. It is one click away now — so each of these opens the status
 * popover first, and that click is part of what is being asserted: a detail
 * that is unreachable is worse than a detail that is loud.
 */

/** Open the header's status cluster, where the arithmetic lives. */
function openStatus(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Goal status and dates' }));
}

const openLeaf = (id: string, estimateMin?: number): GoalNode => ({
  id, title: id, ...(estimateMin ? { estimateMin } : {}),
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
        { id: 'a', title: 'a', status: 'done', doneAt: recent },
        { id: 'b', title: 'b', status: 'done', doneAt: recent },
        { id: 'c', title: 'c', status: 'done', doneAt: recent },
        openLeaf('d'), openLeaf('e'), openLeaf('f'),
      ],
    });

    openStatus();
    expect(screen.queryByText(/No project schedule/)).toBeNull();
    expect(screen.getByText(/3 done in 14 days · 3 left/)).toBeTruthy();
  });

  it('names a stall, which a deadline-based pace line cannot see', async () => {
    const old = await daysAgo(60);
    await mountGoal({
      id: 'g', title: 'Stalled', nodes: [
        { id: 'a', title: 'a', status: 'done', doneAt: old },
        openLeaf('b'), openLeaf('c'),
      ],
    });
    openStatus();
    expect(screen.getByText(/nothing finished in 14 days · 2 tasks open/)).toBeTruthy();
  });

  it('adds remaining effort when every open step is estimated', async () => {
    const recent = await daysAgo(2);
    await mountGoal({
      id: 'g', title: 'Estimated', nodes: [
        { id: 'a', title: 'a', status: 'done', doneAt: recent, estimateMin: 60 },
        { id: 'b', title: 'b', status: 'done', doneAt: recent, estimateMin: 60 },
        { id: 'c', title: 'c', status: 'done', doneAt: recent, estimateMin: 60 },
        openLeaf('d', 120), openLeaf('e', 90),
      ],
    });
    openStatus();
    expect(screen.getByText(/~3\.5h of work/)).toBeTruthy();
  });

  /*
   * The cluster used to lead with a verdict word, and an empty goal got
   * "No forecast" plus a sentence explaining it. Both came from `goalHealth`.
   * What an empty goal states now is nothing at all — no deadline, no effort,
   * no percentage — which is the honest reading of a goal nobody has broken
   * down yet, and the Tasks tab's own offer is what points at the next move.
   */
  it('states nothing about a goal with no tasks at all', async () => {
    await mountGoal({ id: 'g', title: 'Empty', nodes: [] });
    expect(screen.getByRole('button', { name: 'Goal status and dates' }).textContent)
      .not.toContain('No forecast');
    openStatus();
    expect(screen.queryByText(/No tasks yet — break the goal into actions/)).toBeNull();
  });
});

describe('disclosing how the percentage was computed', () => {
  it('says the roll-up is weighted when every step is estimated', async () => {
    await mountGoal({
      id: 'g', title: 'W', nodes: [
        { id: 'a', title: 'a', status: 'done', estimateMin: 20 },
        openLeaf('b', 360),
      ],
    });
    expect(screen.getByRole('button', { name: 'Goal status and dates' }).textContent).toMatch(/5%/);
    openStatus();
    expect(screen.getByText(/1\/2 tasks, weighted by estimate/)).toBeTruthy();
  });

  it('shows a bare step count when the roll-up fell back to equal weight', async () => {
    await mountGoal({
      id: 'g', title: 'E', nodes: [
        { id: 'a', title: 'a', status: 'done', estimateMin: 20 },
        openLeaf('b'),
      ],
    });
    expect(screen.getByRole('button', { name: 'Goal status and dates' }).textContent).toMatch(/50%/);
    openStatus();
    const counter = screen.getByText(/1\/2 tasks/);
    expect(counter.textContent).not.toMatch(/weighted/);
    expect(counter.textContent).toMatch(/each counting equally/);
  });
});

describe('estimate calibration', () => {
  const calibrated: Goal = {
    id: 'g', title: 'C',
    nodes: Array.from({ length: 5 }, (_, i) => ({
      id: `n${i}`, title: `n${i}`, status: 'done', estimateMin: 60,
    })),
  };
  const sessionsFor = (minutes: number): Session[] =>
    Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`, goalId: 'g', nodeId: `n${i}`, date: '2026-07-28', minutes, note: '',
    }));

  it('reports how estimates have compared to logged time', async () => {
    await mountGoal(calibrated, sessionsFor(90));
    openStatus();
    expect(screen.getByText(/estimates run about 1\.5× short/)).toBeTruthy();
  });

  it('stays silent without enough history', async () => {
    await mountGoal(calibrated, sessionsFor(90).slice(0, 2));
    openStatus();
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

/**
 * The header's whole job is to stop being the page.
 *
 * The old one put two date fields, Confirm, Clear dates, a page-wide bar and
 * five sentences of prose above the tree, so a 13-inch laptop showed status
 * where it should have shown work. These assert the split: three answers on the
 * line, everything else behind one click, and nothing lost in the move.
 */
describe('the compact goal header', () => {
  /**
   * A real date inside the forecast horizon: past `MAX_FORECAST_DAYS` the
   * honest verdict is "No forecast", which is a different test.
   */
  async function withDeadline(): Promise<Goal> {
    const { todayStr, addDays } = await import('../../lib/dates');
    return {
      id: 'g',
      title: 'Physics Final',
      start: todayStr(),
      deadline: addDays(todayStr(), 30),
      datesConfirmed: true,
      nodes: [openLeaf('a', 60), { id: 'b', title: 'b', status: 'done', estimateMin: 60 }],
    };
  }

  /** Mon–Fri 09:00–17:00, so the forecast has real hours to divide into. */

  it('states the deadline and remaining effort, and nothing else', async () => {
    await mountGoal(await withDeadline());
    const cluster = screen.getByRole('button', { name: 'Goal status and dates' });

    // No verdict word: `goalHealth` priced the work against the free hours
    // before the deadline, and there are none.
    expect(cluster.textContent).not.toContain('On track');
    expect(cluster.textContent).toMatch(/Due/);
    expect(cluster.textContent).toContain('1h left');
  });

  it('keeps the date fields and the clear/confirm controls out of the header', async () => {
    await mountGoal(await withDeadline());
    expect(screen.queryByLabelText('Start date')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear dates' })).toBeNull();

    openStatus();
    expect(screen.getByLabelText('Start date')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear dates' })).toBeTruthy();
  });

  it('opens the panel on the dates, with no verdict sentence above them', async () => {
    await mountGoal(await withDeadline());
    openStatus();
    expect(screen.queryByText(/of work fits in/)).toBeNull();
    expect(screen.getByLabelText('Start date')).toBeTruthy();
  });

  /**
   * Completing a goal is one of the rarest actions on the page and used to own
   * the loudest control on it — a full-width accent button under the header.
   */
  it('puts the lifecycle in the overflow menu, not on the page', async () => {
    const store = await mountGoal({
      id: 'g', title: 'Done soon', nodes: [{ id: 'a', title: 'a', status: 'done' }],
    });
    expect(screen.queryByRole('button', { name: 'Complete goal' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Goal actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Complete goal' }));

    expect(store.getState().goals[0].completedAt).toBeTruthy();
  });

  it('offers Reopen once a goal is completed', async () => {
    await mountGoal({
      id: 'g', title: 'Archived', completedAt: '2026-08-01',
      nodes: [{ id: 'a', title: 'a', status: 'done' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Goal actions' }));
    expect(screen.getByRole('menuitem', { name: 'Reopen goal' })).toBeTruthy();
  });
});
