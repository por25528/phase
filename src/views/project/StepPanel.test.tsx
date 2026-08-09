// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
    id: 'n1', title: 'Wire up auth',
    start: '2026-08-01', deadline: '2026-08-05',
  }],
};

const plannedLeaf: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{
    id: 'n1', title: 'Wire up auth',
    plannedWeek: '2026-07-27', plannedDay: '2026-07-28', plannedStartMin: 540,
  }],
};

const unplannedLeaf: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{ id: 'n1', title: 'Wire up auth' }],
};

const checkpointLeaf: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{ id: 'n1', title: 'Wire up auth', checkpoint: true }],
};

const emptyChildrenLeaf: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{ id: 'n1', title: 'Wire up auth', children: [] }],
};

const containerNode: Goal = {
  id: 'g1', title: 'Project',
  nodes: [{
    id: 'n1', title: 'Auth work',
    children: [
      { id: 'n2', title: 'Configure provider', status: 'done' },
      { id: 'n3', title: 'Wire up callback' },
    ],
  }],
};

const twoStepGoal: Goal = {
  id: 'g1', title: 'Project',
  nodes: [
    { id: 'n1', title: 'Step A' },
    { id: 'n2', title: 'Step B' },
  ],
};

const twoStepGoalWithNotes: Goal = {
  ...twoStepGoal,
  nodes: [
    { id: 'n1', title: 'Step A', notes: 'Note A' },
    { id: 'n2', title: 'Step B', notes: 'Note B' },
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
    expect(screen.getByRole('button', { name: 'Rename task "Wire up auth"' }).textContent).toBe('Wire up auth');
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

    expect(screen.getByRole('button', { name: 'Rename task "Step B"' }).textContent).toBe('Step B');
    expect(renameNode).not.toHaveBeenCalled();
  });

  it('seeds notes and reseeds them when the mounted panel switches nodes', async () => {
    const store = await preparePanel(twoStepGoalWithNotes);
    const { StepPanel } = await import('./StepPanel');
    const setNodeNotes = vi.spyOn(store.actions, 'setNodeNotes');
    const goal = store.getState().goals[0];
    const view = render(createElement(StepPanel, {
      goal,
      node: goal.nodes[0],
      actions: store.actions,
    }));

    expect(screen.getByLabelText('Task notes').textContent).toContain('Note A');

    view.rerender(createElement(StepPanel, {
      goal,
      node: goal.nodes[1],
      actions: store.actions,
    }));

    expect(screen.getByLabelText('Task notes').textContent).toContain('Note B');
    expect(setNodeNotes).not.toHaveBeenCalled();
  });

  it('defers a debounced note save while an undo is pending, then flushes on blur', async () => {
    vi.useFakeTimers();
    try {
      const store = await preparePanel(twoStepGoal);
      const { StepPanel } = await import('./StepPanel');
      const goal = store.getState().goals[0];
      render(createElement(StepPanel, {
        goal,
        node: goal.nodes[0],
        actions: store.actions,
      }));

      store.actions.removeNode('n2');
      expect(store.getState().pendingUndo).not.toBeNull();

      const editor = screen.getByLabelText('Task notes');
      editor.innerHTML = '<p>Typed while undo is available</p>';
      fireEvent.input(editor);
      act(() => { vi.advanceTimersByTime(801); });

      expect(store.getState().pendingUndo).not.toBeNull();
      expect(store.getState().goals[0].nodes[0].notes).toBeUndefined();

      fireEvent.blur(editor);

      expect(store.getState().goals[0].nodes[0].notes).toBe('Typed while undo is available');
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a pending note before deleting the active step so Undo restores the typing', async () => {
    vi.useFakeTimers();
    try {
      const store = await preparePanel(twoStepGoal);
      const { StepPanel } = await import('./StepPanel');
      const goal = store.getState().goals[0];
      render(createElement(StepPanel, {
        goal, node: goal.nodes[0], actions: store.actions,
      }));
      const setNodeNotes = vi.spyOn(store.actions, 'setNodeNotes');

      const editor = screen.getByLabelText('Task notes');
      editor.innerHTML = '<p>Typed before delete</p>';
      fireEvent.input(editor);
      await act(async () => { await Promise.resolve(); });

      store.actions.removeNode('n1');
      expect(setNodeNotes).toHaveBeenCalledWith('n1', 'Typed before delete');
      store.actions.undoLastDelete();

      expect(store.getState().goals[0].nodes[0].notes).toBe('Typed before delete');
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a pending note before bulk deletion so Undo restores the typing', async () => {
    vi.useFakeTimers();
    try {
      const store = await preparePanel(twoStepGoal);
      const { StepPanel } = await import('./StepPanel');
      const goal = store.getState().goals[0];
      render(createElement(StepPanel, {
        goal, node: goal.nodes[0], actions: store.actions,
      }));

      const editor = screen.getByLabelText('Task notes');
      editor.innerHTML = '<p>Typed before bulk delete</p>';
      fireEvent.input(editor);
      await act(async () => { await Promise.resolve(); });

      store.actions.removeNodes(['n1']);
      store.actions.undoLastDelete();

      expect(store.getState().goals[0].nodes[0].notes).toBe('Typed before bulk delete');
    } finally {
      vi.useRealTimers();
    }
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

    fireEvent.click(screen.getByRole('button', { name: 'Rename task "Step B"' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Rename task "Step B"' }));
    const editor = screen.getByDisplayValue('Step B');
    fireEvent.change(editor, { target: { value: 'Discarded B' } });
    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(store.getState().goals[0].nodes[1].title).toBe('Step B');
    expect(screen.queryByDisplayValue('Discarded B')).toBeNull();
    expect(screen.getByRole('button', { name: 'Rename task "Step B"' }).textContent).toBe('Step B');
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

    fireEvent.click(screen.getByRole('button', { name: 'Close task details' }));

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

  describe('status', () => {
    it('shows a radio group for a leaf with "to do" checked by default', async () => {
      await mountPanel(unplannedLeaf);

      const group = screen.getByRole('radiogroup', { name: 'Status' });
      const radios = within(group).getAllByRole('radio');
      expect(radios.map((r) => r.textContent)).toEqual(['to do', 'in progress', 'blocked', 'done']);
      expect(within(group).getByRole('radio', { name: 'to do' }).getAttribute('aria-checked')).toBe('true');
    });

    it('sets a leaf to in progress on click', async () => {
      const store = await mountPanel(unplannedLeaf);

      fireEvent.click(screen.getByRole('radio', { name: 'in progress' }));

      expect(store.getState().goals[0].nodes[0].status).toBe('doing');
      expect(screen.getByRole('radio', { name: 'in progress' }).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('radio', { name: 'to do' }).getAttribute('aria-checked')).toBe('false');
    });

    it('shows a blockedOn field only while blocked, and commits it on blur', async () => {
      const store = await mountPanel(unplannedLeaf);

      expect(screen.queryByLabelText('Blocked on')).toBeNull();

      fireEvent.click(screen.getByRole('radio', { name: 'blocked' }));
      expect(store.getState().goals[0].nodes[0].status).toBe('blocked');

      const reason = screen.getByLabelText('Blocked on');
      fireEvent.change(reason, { target: { value: 'the grader' } });
      fireEvent.blur(reason);

      expect(store.getState().goals[0].nodes[0].blockedOn).toBe('the grader');
    });

    it('hides the blockedOn field again once no longer blocked', async () => {
      const store = await mountPanel(unplannedLeaf);

      fireEvent.click(screen.getByRole('radio', { name: 'blocked' }));
      expect(screen.getByLabelText('Blocked on')).toBeTruthy();

      fireEvent.click(screen.getByRole('radio', { name: 'to do' }));

      expect(store.getState().goals[0].nodes[0].status).toBeUndefined();
      expect(screen.queryByLabelText('Blocked on')).toBeNull();
    });

    it('shows read-only derived status text for a container, with no radio group', async () => {
      await mountPanel(containerNode);

      expect(screen.queryByRole('radiogroup', { name: 'Status' })).toBeNull();
      // containerNode: one done leaf, one open leaf with no status → 'todo'.
      expect(screen.getByText('to do')).toBeTruthy();
    });

    // Same state change as the tree checkbox (toggleLeaf), same reversibility
    // story: completing from the panel must arm the identical undo, not a
    // silent setNodeStatus write.
    it('completing from the panel arms the same undo as the tree checkbox, and restores "to do"', async () => {
      const store = await mountPanel(unplannedLeaf);

      fireEvent.click(screen.getByRole('radio', { name: 'done' }));

      expect(store.getState().goals[0].nodes[0].status).toBe('done');
      expect(store.getState().pendingUndo?.label).toBe('Completed "Wire up auth"');

      store.actions.undoLastDelete();

      expect(store.getState().goals[0].nodes[0].status).toBeUndefined();
    });

    it('restores blockedOn when undoing a completion from blocked', async () => {
      const store = await mountPanel(unplannedLeaf);

      fireEvent.click(screen.getByRole('radio', { name: 'blocked' }));
      const reason = screen.getByLabelText('Blocked on');
      fireEvent.change(reason, { target: { value: 'the grader' } });
      fireEvent.blur(reason);
      expect(store.getState().goals[0].nodes[0].blockedOn).toBe('the grader');

      fireEvent.click(screen.getByRole('radio', { name: 'done' }));
      expect(store.getState().goals[0].nodes[0].status).toBe('done');
      expect(store.getState().goals[0].nodes[0].blockedOn).toBeUndefined();

      store.actions.undoLastDelete();

      expect(store.getState().goals[0].nodes[0].status).toBe('blocked');
      expect(store.getState().goals[0].nodes[0].blockedOn).toBe('the grader');
    });

    it('does not un-complete an already-done step when "done" is clicked again', async () => {
      const store = await mountPanel(unplannedLeaf);

      fireEvent.click(screen.getByRole('radio', { name: 'done' }));
      expect(store.getState().goals[0].nodes[0].status).toBe('done');
      const doneAt = store.getState().goals[0].nodes[0].doneAt;

      fireEvent.click(screen.getByRole('radio', { name: 'done' }));

      expect(store.getState().goals[0].nodes[0].status).toBe('done');
      expect(store.getState().goals[0].nodes[0].doneAt).toBe(doneAt);
    });
  });
});
