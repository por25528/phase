// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

const leafWithDates: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{
    id: 'n1', title: 'Wire up auth', done: false,
    start: '2026-08-01', deadline: '2026-08-05',
  }],
};

const plannedLeaf: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{
    id: 'n1', title: 'Wire up auth', done: false,
    plannedWeek: '2026-07-27', plannedDay: '2026-07-28', plannedStartMin: 540,
  }],
};

const unplannedLeaf: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{ id: 'n1', title: 'Wire up auth', done: false }],
};

const checkpointLeaf: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{ id: 'n1', title: 'Wire up auth', done: false, checkpoint: true }],
};

const emptyChildrenLeaf: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{ id: 'n1', title: 'Wire up auth', done: false, children: [] }],
};

const containerNode: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{
    id: 'n1', title: 'Auth work',
    children: [
      { id: 'n2', title: 'Configure provider', done: true },
      { id: 'n3', title: 'Wire up callback', done: false },
    ],
  }],
};

const twoStepGoal: Goal = {
  id: 'g1', title: 'Project',
  nodes: [
    { id: 'n1', title: 'Step A', done: false },
    { id: 'n2', title: 'Step B', done: false },
  ],
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
    await mountPanel(leafWithDates);

    expect(document.activeElement?.tagName).not.toBe('INPUT');
    expect(screen.getByRole('button', { name: 'Rename step "Wire up auth"' }).textContent).toBe('Wire up auth');
  });

  it('shows the new step title when the mounted panel switches nodes', async () => {
    const store = await preparePanel(twoStepGoal);
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

    expect(screen.getByRole('button', { name: 'Rename step "Step B"' }).textContent).toBe('Step B');
    expect(renameNode).not.toHaveBeenCalled();
  });

  it('renames the selected step from the title editor', async () => {
    const store = await preparePanel(twoStepGoal);
    const { StepPanel } = await import('./StepPanel');
    const renameNode = vi.spyOn(store.actions, 'renameNode');
    const goal = store.getState().goals[0];
    render(createElement(StepPanel, {
      goal,
      node: goal.nodes[1],
      actions: store.actions,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Rename step "Step B"' }));
    const editor = screen.getByDisplayValue('Step B');
    fireEvent.change(editor, { target: { value: 'Renamed B' } });
    fireEvent.keyDown(editor, { key: 'Enter' });

    expect(store.getState().goals[0].nodes[0].title).toBe('Step A');
    expect(store.getState().goals[0].nodes[1].title).toBe('Renamed B');
    expect(renameNode).toHaveBeenCalledWith('n2', 'Renamed B');
  });

  it('abandons a title edit on Escape', async () => {
    const store = await preparePanel(twoStepGoal);
    const { StepPanel } = await import('./StepPanel');
    const goal = store.getState().goals[0];
    render(createElement(StepPanel, {
      goal,
      node: goal.nodes[1],
      actions: store.actions,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Rename step "Step B"' }));
    const editor = screen.getByDisplayValue('Step B');
    fireEvent.change(editor, { target: { value: 'Discarded B' } });
    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(store.getState().goals[0].nodes[1].title).toBe('Step B');
    expect(screen.queryByDisplayValue('Discarded B')).toBeNull();
    expect(screen.getByRole('button', { name: 'Rename step "Step B"' }).textContent).toBe('Step B');
  });

  it('shows the title as a level-2 heading and labels both span fields', async () => {
    await mountPanel(leafWithDates);

    expect(screen.getByRole('heading', { level: 2, name: 'Wire up auth' })).toBeTruthy();
    expect(screen.getByLabelText('Span start')).toBeTruthy();
    expect(screen.getByLabelText('Span end')).toBeTruthy();
  });

  it('shows a planned week and an Unschedule button', async () => {
    await mountPanel(plannedLeaf);

    expect(screen.getByText(/Plan/i)).toBeTruthy();
    expect(screen.getByText(/Jul 27/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unschedule' })).toBeTruthy();
  });

  it('explains when a step is not planned', async () => {
    await mountPanel(unplannedLeaf);

    expect(screen.getByText('Not planned — use the Plan view to commit this to a week.')).toBeTruthy();
  });

  it('shows estimate and log-time controls for a leaf', async () => {
    await mountPanel(leafWithDates);

    expect(screen.getByRole('button', { name: 'Set estimate for "Wire up auth"' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log time on "Wire up auth"' })).toBeTruthy();
  });

  it('shows only progress for a container', async () => {
    await mountPanel(containerNode);

    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /estimate for|Set estimate/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /log time/i })).toBeNull();
  });

  it('offers the checkpoint toggle on a leaf and updates its label when enabled', async () => {
    const store = await mountPanel(leafWithDates);

    fireEvent.click(screen.getByRole('button', { name: 'Mark "Wire up auth" as a checkpoint' }));

    expect(store.getState().goals[0].nodes[0].checkpoint).toBe(true);
    expect(screen.getByRole('button', { name: 'Remove checkpoint from "Wire up auth"' })).toBeTruthy();
  });

  it('offers and activates the checkpoint toggle on a leaf with empty children', async () => {
    const store = await mountPanel(emptyChildrenLeaf);

    fireEvent.click(screen.getByRole('button', { name: 'Mark "Wire up auth" as a checkpoint' }));

    expect(store.getState().goals[0].nodes[0].checkpoint).toBe(true);
  });

  it('shows the remove label for a checkpoint and omits the toggle on a container', async () => {
    await mountPanel(checkpointLeaf);
    expect(screen.getByRole('button', { name: 'Remove checkpoint from "Wire up auth"' })).toBeTruthy();

    cleanup();
    await mountPanel(containerNode);
    expect(screen.queryByRole('button', { name: /checkpoint/i })).toBeNull();
  });

  it('closes with the close button', async () => {
    const store = await mountPanel(leafWithDates);

    fireEvent.click(screen.getByRole('button', { name: 'Close step details' }));

    expect(store.getState().openStepId).toBeNull();
  });

  it('routes a cleared span date through clearNodeDates', async () => {
    const store = await mountPanel(leafWithDates);
    const start = screen.getByLabelText('Span start');

    fireEvent.focus(start);
    fireEvent.change(start, { target: { value: '' } });
    fireEvent.blur(start);

    const node = store.getState().goals[0].nodes[0] as GoalNode;
    expect(node.start).toBeUndefined();
    expect(node.deadline).toBeUndefined();
  });
});
