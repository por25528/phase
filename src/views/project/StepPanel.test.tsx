// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, GoalNode, Session } from '../../db/types';
import { makeBlock } from '../../lib/blocks';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: Session[] }> => ({
    goals: [], habits: [], tasks: [], sessions: [],
  })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async (): Promise<AvailabilityWindow[]> => []),
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
beforeEach(() => vi.clearAllMocks());

const containerNode: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{
    id: 'n1', title: 'Auth work',
    start: '2026-08-01', deadline: '2026-08-05',
    children: [
      { id: 'n2', title: 'Configure provider', status: 'done' },
      { id: 'n3', title: 'Wire up callback' },
    ],
  }],
};

/** A container with no span set, for the "no dates" placeholder case. */
const undatedContainer: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{
    id: 'n1', title: 'Auth work',
    children: [
      { id: 'n2', title: 'Configure provider', status: 'done' },
      { id: 'n3', title: 'Wire up callback' },
    ],
  }],
};

/** A second container, sibling to `containerNode`'s, for node-switching cases. */
const twoContainerGoal: Goal = {
  id: 'g1', title: 'Project',
  nodes: [
    { id: 'n1', title: 'Group A', children: [{ id: 'n1a', title: 'Leaf' }] },
    { id: 'n2', title: 'Group B', children: [{ id: 'n2a', title: 'Leaf' }] },
  ],
};

const plannedLeaf: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{ id: 'n1', title: 'Wire up auth',
    plannedWeek: '2026-07-27', blocks: [makeBlock('2026-07-28', 540, 60)] }],
};

const unplannedLeaf: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{ id: 'n1', title: 'Wire up auth' }],
};

/** A week commitment with nothing placed on a day yet — `plannedWeek` with no `blocks`. */
const committedLeaf: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{ id: 'n1', title: 'Wire up auth', plannedWeek: '2026-07-27' }],
};

type Store = typeof import('../../state/store');

async function preparePanel(goal: Goal, sessions: Session[] = []): Promise<Store> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(goal)], habits: [], tasks: [], sessions,
  });
  const store = await import('../../state/store');
  await store.initStore();
  store.actions.openProject(goal.id);
  store.actions.openStep(goal.nodes[0].id);
  return store;
}

/**
 * Open one property's popover.
 *
 * The panel states a derived status and a date span, and keeps the span's
 * editor one click behind the value it edits, so a test that wants the editor
 * has to ask for it the way a person does. The trigger's accessible name is
 * `<Property>: <value>`.
 */
function openProperty(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}: `) }));
}

async function mountPanel(goal: Goal, sessions: Session[] = []): Promise<Store> {
  const store = await preparePanel(goal, sessions);
  const { StepPanel } = await import('./StepPanel');
  const Host = () => {
    const current = store.useAppStore();
    const liveGoal = current.goals.find((g) => g.id === goal.id)!;
    const liveNode = liveGoal.nodes.find((n) => n.id === goal.nodes[0].id)!;
    return createElement(StepPanel, { goal: liveGoal, node: liveNode, actions: current.actions });
  };
  render(createElement(Host));
  return store;
}

describe('StepPanel', () => {
  it('does not steal focus and shows the title as a button at rest', async () => {
    await mountPanel(containerNode);

    expect(document.activeElement?.tagName).not.toBe('INPUT');
    expect(screen.getByRole('button', { name: 'Rename task "Auth work"' }).textContent).toBe('Auth work');
  });

  it('shows the new step title when the mounted panel switches nodes', async () => {
    const store = await preparePanel(twoContainerGoal);
    const { StepPanel } = await import('./StepPanel');
    const renameNode = vi.spyOn(store.actions, 'renameNode');
    const goal = store.getState().goals[0];
    const view = render(createElement(StepPanel, {
      goal,
      node: goal.nodes[0],
      actions: store.actions,
    }));

    view.rerender(createElement(StepPanel, {
      goal,
      node: goal.nodes[1],
      actions: store.actions,
    }));

    expect(screen.getByRole('button', { name: 'Rename task "Group B"' }).textContent).toBe('Group B');
    expect(renameNode).not.toHaveBeenCalled();
  });

  it('renames the selected step from the title editor', async () => {
    const store = await preparePanel(twoContainerGoal);
    const { StepPanel } = await import('./StepPanel');
    const renameNode = vi.spyOn(store.actions, 'renameNode');
    const goal = store.getState().goals[0];
    render(createElement(StepPanel, {
      goal,
      node: goal.nodes[1],
      actions: store.actions,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Rename task "Group B"' }));
    const editor = screen.getByDisplayValue('Group B');
    fireEvent.change(editor, { target: { value: 'Renamed B' } });
    fireEvent.keyDown(editor, { key: 'Enter' });

    expect(store.getState().goals[0].nodes[0].title).toBe('Group A');
    expect(store.getState().goals[0].nodes[1].title).toBe('Renamed B');
    expect(renameNode).toHaveBeenCalledWith('n2', 'Renamed B');
  });

  it('abandons a title edit on Escape', async () => {
    const store = await preparePanel(twoContainerGoal);
    const { StepPanel } = await import('./StepPanel');
    const goal = store.getState().goals[0];
    render(createElement(StepPanel, {
      goal,
      node: goal.nodes[1],
      actions: store.actions,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Rename task "Group B"' }));
    const editor = screen.getByDisplayValue('Group B');
    fireEvent.change(editor, { target: { value: 'Discarded B' } });
    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(store.getState().goals[0].nodes[1].title).toBe('Group B');
    expect(screen.queryByDisplayValue('Discarded B')).toBeNull();
    expect(screen.getByRole('button', { name: 'Rename task "Group B"' }).textContent).toBe('Group B');
  });

  it('shows the title as a level-2 heading and labels both span fields', async () => {
    await mountPanel(containerNode);

    expect(screen.getByRole('heading', { level: 2, name: 'Auth work' })).toBeTruthy();
    // Both ends of the span are still here — one click behind the date the row
    // states, because Phase stores a span and a task is read for its end.
    openProperty('Dates');
    expect(screen.getByLabelText('Span start')).toBeTruthy();
    expect(screen.getByLabelText('Span end')).toBeTruthy();
  });

  it('states the deadline on the row, and names the property when there is none', async () => {
    await mountPanel(containerNode);
    expect(screen.getByRole('button', { name: /^Dates: /})).toBeTruthy();

    cleanup();
    await mountPanel(undatedContainer);
    // Never a zero or an empty field: the placeholder says which property is
    // unset, which is also how you set it.
    expect(screen.getByRole('button', { name: 'Dates: No dates' })).toBeTruthy();
  });

  it('shows read-only derived status for a container, with nothing to press', async () => {
    await mountPanel(containerNode);

    expect(screen.queryByRole('button', { name: /^Status: / })).toBeNull();
    // containerNode: one done leaf, one open leaf with no status → 'todo'.
    expect(screen.getByText('to do')).toBeTruthy();
  });

  it('lists a container\'s tasks with a count', async () => {
    await mountPanel(containerNode);

    // The count replaces the bare `50%`: one done of two direct children, with
    // both numbers on screen. `nodePct` rolls up the whole subtree, so its
    // percentage had a denominator that appeared nowhere.
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Configure provider' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wire up callback' })).toBeTruthy();
  });

  it('selects a child from the container\'s task list', async () => {
    const store = await mountPanel(containerNode);

    fireEvent.click(screen.getByRole('button', { name: 'Wire up callback' }));

    expect(store.getState().openStepId).toBe('n3');
  });

  it('offers to open the container as a workspace, unconditionally', async () => {
    const store = await mountPanel(containerNode);
    fireEvent.click(screen.getByRole('button', { name: 'Open "Auth work" as a workspace' }));
    expect(store.getState().openAreaId).toBe('n1');
  });

  it('closes with the close button', async () => {
    const store = await mountPanel(containerNode);

    fireEvent.click(screen.getByRole('button', { name: 'Close task details' }));

    expect(store.getState().openStepId).toBeNull();
  });

  it('renders the container\'s notes', async () => {
    const notedContainer: Goal = {
      id: 'g1', title: 'Project',
      nodes: [{
        id: 'n1', title: 'Auth work', notes: 'Note A',
        children: [{ id: 'n2', title: 'Configure provider' }],
      }],
    };
    await mountPanel(notedContainer);

    expect(screen.getByLabelText('Task notes').textContent).toContain('Note A');
  });

  it('routes a cleared span date through clearNodeDates', async () => {
    const store = await mountPanel(containerNode);
    openProperty('Dates');
    const start = screen.getByLabelText('Span start');

    fireEvent.focus(start);
    fireEvent.change(start, { target: { value: '' } });
    fireEvent.blur(start);

    const node = store.getState().goals[0].nodes[0] as GoalNode;
    expect(node.start).toBeUndefined();
    expect(node.deadline).toBeUndefined();
  });
});

describe('ScheduleMenu', () => {
  /**
   * `StepPanel` no longer carries a WHEN cell at all — a leaf opens as its own
   * `TaskPage` now. Two surfaces still open `ScheduleMenu`: a leaf row's WHEN
   * cell in `GoalTree`, and `TaskPage`'s Schedule chip. This renders the menu
   * directly, against the same goal fixtures `StepPanel`'s own tests use, so
   * the `plannedWeek`-only commitment case stays covered once, rather than
   * twice over through whichever surface happens to reach it.
   */
  async function mountMenu(goal: Goal): Promise<Store> {
    const store = await preparePanel(goal);
    const { ScheduleMenu } = await import('../../components/SchedulePopover');
    const Host = () => {
      const current = store.useAppStore();
      const liveGoal = current.goals.find((g) => g.id === goal.id)!;
      const liveNode = liveGoal.nodes.find((n) => n.id === goal.nodes[0].id)!;
      return createElement(ScheduleMenu, {
        goalId: liveGoal.id,
        node: liveNode,
        close: () => {},
      });
    };
    render(createElement(Host));
    return store;
  }

  it('offers no Clear item for a task with neither a sitting nor a week commitment', async () => {
    await mountMenu(unplannedLeaf);

    expect(screen.queryByRole('menuitem', { name: /Clear schedule/ })).toBeNull();
  });

  it('offers Clear for a placed sitting, and it clears the whole placement', async () => {
    const store = await mountMenu(plannedLeaf);

    expect(screen.getByRole('menuitem', { name: 'Sit again today' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear schedule' }));

    const node = store.getState().goals[0].nodes[0];
    expect(node.blocks).toBeUndefined();
    expect(node.plannedWeek).toBeUndefined();
  });

  it('offers Clear for a week commitment with nothing placed on a day yet', async () => {
    const store = await mountMenu(committedLeaf);

    // "Sit again today" only makes sense once something is already sitting
    // somewhere — a bare week commitment has nothing to "sit again" from.
    expect(screen.queryByRole('menuitem', { name: 'Sit again today' })).toBeNull();
    const clearItem = screen.getByRole('menuitem', { name: 'Clear schedule' });
    expect(clearItem).toBeTruthy();

    fireEvent.click(clearItem);

    expect(store.getState().goals[0].nodes[0].plannedWeek).toBeUndefined();
  });
});
