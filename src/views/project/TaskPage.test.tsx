// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, Session } from '../../db/types';
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

const goalSeed: Goal = {
  id: 'g1',
  title: 'Fitness',
  nodes: [
    { id: 'n1', title: 'Run 5k', estimateMin: 45 },
    { id: 'n2', title: 'Book induction', status: 'blocked', blockedOn: 'front desk' },
    // Two sittings whose total (90m) differs from the estimate (120m), so the
    // discrepancy line has something to say. `plannedWeek` is set the same way
    // `scheduleNode` sets it on a real booking (`node.plannedWeek ??= weekOf(day)`).
    {
      id: 'n3',
      title: 'Long run',
      estimateMin: 120,
      plannedWeek: '2026-08-03',
      blocks: [makeBlock('2026-08-04', 540, 60), makeBlock('2026-08-05', 600, 30)],
    },
    // A nested pair, so a mounted leaf has both a preceding sibling (canIndent)
    // and a parent (canOutdent) — the only fixture shape that can show both
    // menu items at once.
    {
      id: 'n4',
      title: 'Nested group',
      children: [
        { id: 'n5', title: 'First nested step' },
        { id: 'n6', title: 'Second nested step' },
      ],
    },
  ],
};

type Store = typeof import('../../state/store');

/**
 * Boot a store holding `goalSeed`, open the goal and one of its leaves, and
 * render the page against live store state — the same shape `preparePanel`
 * uses in StepPanel.test.tsx, so an action's effect is readable through
 * `store.getState()`.
 */
async function mountTask(nodeId: string): Promise<Store> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(goalSeed)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../../state/store');
  await store.initStore();
  store.actions.openProject('g1');
  store.actions.openStep(nodeId);
  const { TaskPage } = await import('./TaskPage');
  const Host = () => {
    const current = store.useAppStore();
    const goal = current.goals.find((g) => g.id === 'g1')!;
    const node = findNode(goal.nodes, nodeId)!;
    return createElement(TaskPage, {
      goal,
      node,
      backLabel: goal.title,
      onBack: () => current.actions.closeStep(),
    });
  };
  render(createElement(Host));
  return store;
}

function findNode(nodes: Goal['nodes'], id: string): Goal['nodes'][number] | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

describe('TaskPage', () => {
  it('states the task and offers a way back to what contains it', async () => {
    await mountTask('n1');

    expect(screen.getByRole('heading', { name: 'Run 5k' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Fitness/ })).toBeTruthy();
  });

  it('shows the blocked reason without opening the status popover', async () => {
    await mountTask('n2');

    // The reason is what makes a blocked task actionable. Behind the control
    // that set the status, the page could say "Blocked" and never say what by.
    // Plain DOM read: `@testing-library/jest-dom` is NOT installed in this
    // project, so `toHaveValue` does not exist. No test here uses it.
    expect((screen.getByLabelText('Blocked on') as HTMLInputElement).value).toBe('front desk');
  });

  it('writes the blocked reason through to the store on blur', async () => {
    const store = await mountTask('n2');

    const input = screen.getByLabelText('Blocked on') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'waiting on landlord' } });
    fireEvent.blur(input);

    expect(store.getState().goals[0].nodes[1].blockedOn).toBe('waiting on landlord');
    expect(store.getState().goals[0].nodes[1].status).toBe('blocked');
  });

  it('completes through toggleLeaf, so the tick arms an undo', async () => {
    const store = await mountTask('n1');

    fireEvent.click(screen.getByRole('button', { name: /^Status: / }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: /^done$/i }));
    });

    expect(store.getState().goals[0].nodes[0].status).toBe('done');
    expect(store.getState().pendingUndo).not.toBeNull();
  });

  it('does not un-complete an already-done task when Done is picked again', async () => {
    // toggleLeaf TOGGLES: it is only safe to route 'done' through it on the
    // transition INTO 'done'. Picking Done a second time must be a no-op, not
    // a silent uncomplete — the guard in TaskPage.tsx is the only thing
    // stopping that.
    const store = await mountTask('n1');

    fireEvent.click(screen.getByRole('button', { name: /^Status: / }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: /^done$/i }));
    });
    expect(store.getState().goals[0].nodes[0].status).toBe('done');

    fireEvent.click(screen.getByRole('button', { name: /^Status: / }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: /^done$/i }));
    });

    expect(store.getState().goals[0].nodes[0].status).toBe('done');
  });

  it('offers rename and delete for a top-level leaf, and not the chip verbs', async () => {
    await mountTask('n2');

    fireEvent.click(screen.getByRole('button', { name: /^Actions for / }));

    expect(screen.getByRole('menuitem', { name: /Rename/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Schedule/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Estimate/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Add task/ })).toBeNull();
  });

  it('offers both Indent and Outdent for a nested leaf with a preceding sibling', async () => {
    // n6 is nested inside n4 (canOutdent) and follows n5 (canIndent) — the
    // only fixture shape where both items are legitimately present at once.
    await mountTask('n6');

    fireEvent.click(screen.getByRole('button', { name: /^Actions for / }));

    expect(screen.getByRole('menuitem', { name: /Indent/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Outdent/ })).toBeTruthy();
  });

  it('offers to break the task into subtasks, since no tree row can here', async () => {
    await mountTask('n1');

    expect(screen.getByRole('button', { name: /Break .* into subtasks/ })).toBeTruthy();
  });

  it('edits the estimate in place, without a popover', async () => {
    await mountTask('n1');

    // Assert EstimateControl's own accessible name, not just the text "45m" —
    // a static `<span>45m</span>` or a `PropertyChip` (the popover this test
    // exists to forbid) would also render that text.
    const trigger = screen.getByRole('button', { name: 'Estimate for "Run 5k": 45m. Change it' });
    expect(trigger).toBeTruthy();

    fireEvent.click(trigger);

    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('offers to schedule a task that has no sitting', async () => {
    await mountTask('n2');

    expect(screen.getByRole('button', { name: 'Schedule: Not scheduled' })).toBeTruthy();
  });

  describe('sittings', () => {
    it('lists every sitting, and states the plan-vs-estimate discrepancy', async () => {
      await mountTask('n3');

      // Both rows appear, each carrying its own Remove button — the schedule
      // chip above also says "Aug 4", so these are scoped to the specific
      // per-sitting row rather than any text match on the page.
      expect(screen.getByRole('button', { name: 'Remove the sitting on Aug 4' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Remove the sitting on Aug 5' })).toBeTruthy();
      // 60m + 30m planned against a 120m estimate.
      expect(screen.getByText('1h 30m set aside for a 2h task')).toBeTruthy();
    });

    it('removes exactly one sitting when its Remove button is clicked', async () => {
      const store = await mountTask('n3');

      fireEvent.click(screen.getByRole('button', { name: 'Remove the sitting on Aug 4' }));

      const node = store.getState().goals[0].nodes[2];
      expect(node.blocks?.length).toBe(1);
      expect(node.blocks?.[0].date).toBe('2026-08-05');
    });

    it('offers Sit again today and Clear all', async () => {
      // A Monday inside the mocked availability window, so the slot search
      // has somewhere to put the new sitting — matching StepPanel.test.tsx's
      // pattern for the same store action.
      vi.setSystemTime(new Date(2026, 6, 27, 8));
      dbMocks.loadAvailability.mockResolvedValueOnce(
        [0, 1, 2, 3, 4].map((dow) => ({ dow, startMin: 540, endMin: 1020 })),
      );
      const store = await mountTask('n3');

      fireEvent.click(screen.getByRole('button', { name: 'Sit again today' }));
      expect(store.getState().goals[0].nodes[2].blocks?.length).toBe(3);

      fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
      expect(store.getState().goals[0].nodes[2].blocks).toBeUndefined();

      vi.useRealTimers();
    });
  });
});
