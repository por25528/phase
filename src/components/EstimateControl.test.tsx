// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal } from '../db/types';

/**
 * The estimate control, driven through the real DOM.
 *
 * The parsing underneath is covered without a DOM (`lib/estimateInput.test.ts`)
 * and the writes are covered in `store.test.ts`. What neither can see is the
 * wiring this file exists for: whether the badge swaps for the field, whether a
 * preset is reachable by keyboard without the focusout handler closing the
 * panel first, whether the control appears on leaves and not containers, and
 * whether a click inside it can fall through to the row and tick the step off.
 *
 * That last one is the reason this is a DOM test rather than a unit test. Every
 * row in `GoalTree` runs its primary action on click, and nearly every pixel of
 * one is covered by a child that stops propagation. A control that failed to
 * stop its own clicks would complete the step it was trying to estimate.
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[] }> => ({ goals: [], habits: [], tasks: [], sessions: [] })),
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
vi.mock('../db/db', () => dbMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const PROJECT: Goal = {
  id: 'g',
  title: '6.5840',
  column: 0,
  nodes: [
    { id: 'a', title: 'Implement AppendEntries' },
    { id: 'b', title: 'Already estimated', estimateMin: 45 },
    // Only reachable from an imported or hand-edited file; `parseEstimateInput`
    // cannot produce it.
    { id: 'junk', title: 'Junk import', estimateMin: 0 },
    {
      id: 'grp',
      title: 'A container',
      children: [{ id: 'c1', title: 'A child leaf' }],
    },
  ],
};

type Store = typeof import('../state/store');

async function mountTree(): Promise<{ store: Store; user: ReturnType<typeof userEvent.setup> }> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(PROJECT)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../state/store');
  await store.initStore();
  const { GoalTree } = await import('./GoalTree');
  const TreeHost = () => {
    const { goals } = store.useAppStore();
    return createElement(GoalTree, { nodes: goals[0].nodes });
  };
  render(createElement(TreeHost));
  return { store, user: userEvent.setup() };
}

const estimateOf = (store: Store, id: string): number | undefined => {
  const find = (nodes: Goal['nodes']): number | undefined => {
    for (const n of nodes) {
      if (n.id === id) return n.estimateMin;
      if (n.children) {
        const hit = find(n.children);
        if (hit !== undefined) return hit;
      }
    }
    return undefined;
  };
  return find(store.getState().goals[0].nodes);
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('reaching the estimate from the step tree', () => {
  it('offers an estimate control on every leaf', async () => {
    await mountTree();
    expect(
      screen.getByRole('button', { name: 'Set estimate for "Implement AppendEntries"' }),
    ).toBeTruthy();
  });

  it('shows an existing estimate formatted, not as raw minutes', async () => {
    await mountTree();
    // The rail used to render `${estimateMin}m`, so 120 read "120m". The shared
    // control formats through `formatEstimateValue`, so both surfaces agree.
    const badge = screen.getByRole('button', {
      name: 'Estimate for "Already estimated": 45m. Change it',
    });
    expect(badge.textContent).toBe('45m');
  });

  it('treats an unusable imported estimate as unset rather than blank', async () => {
    // `estimateMin: 0` is not an estimate anywhere else in the app, but the
    // badge used `minutes !== undefined` and `formatEstimateValue(0)` is '' —
    // so the row carried a blank, non-quiet button labelled
    // `Estimate for "X": . Change it`.
    await mountTree();
    const badge = screen.getByRole('button', { name: 'Set estimate for "Junk import"' });
    expect(badge.textContent).toBe('+ est');
    expect(badge.className).toContain('quiet-control');
  });

  it('does not offer one on a container', async () => {
    await mountTree();
    // `setNodeEstimate` refuses containers outright, and `addChild` deletes
    // `estimateMin` when a leaf becomes one. A control here would be a button
    // whose only outcome is a silent no-op.
    expect(screen.queryByRole('button', { name: /estimate for "A container"/i })).toBeNull();
  });

  it('types an estimate and commits it with Enter', async () => {
    const { store, user } = await mountTree();
    await user.click(
      screen.getByRole('button', { name: 'Set estimate for "Implement AppendEntries"' }),
    );
    const field = screen.getByRole('textbox', {
      name: 'Estimate for Implement AppendEntries',
    });
    await user.type(field, '1h30{Enter}');
    expect(estimateOf(store, 'a')).toBe(90);
  });

  it('sets an estimate from a preset', async () => {
    const { store, user } = await mountTree();
    await user.click(
      screen.getByRole('button', { name: 'Set estimate for "Implement AppendEntries"' }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Set estimate for "Implement AppendEntries" to 2h',
      }),
    );
    expect(estimateOf(store, 'a')).toBe(120);
  });

  it('clears an estimate', async () => {
    const { store, user } = await mountTree();
    await user.click(
      screen.getByRole('button', { name: 'Estimate for "Already estimated": 45m. Change it' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Clear estimate for "Already estimated"' }),
    );
    expect(estimateOf(store, 'b')).toBeUndefined();
  });

  it('offers no clear control when there is nothing to clear', async () => {
    const { user } = await mountTree();
    await user.click(
      screen.getByRole('button', { name: 'Set estimate for "Implement AppendEntries"' }),
    );
    expect(
      screen.queryByRole('button', { name: /^Clear estimate for "Implement AppendEntries"/ }),
    ).toBeNull();
  });

  /*
   * The focusout handler must not fire when focus moves WITHIN the control.
   *
   * The rail's previous inline version closed the editor on any blur, which
   * would make every preset unreachable: tabbing to one blurs the input, and so
   * would clicking it. `EstimateControl` checks `relatedTarget` against its own
   * container for exactly this.
   */
  it('keeps the panel open while tabbing from the field to a preset', async () => {
    const { store, user } = await mountTree();
    await user.click(
      screen.getByRole('button', { name: 'Set estimate for "Implement AppendEntries"' }),
    );
    await user.tab();
    const preset = screen.getByRole('button', {
      name: 'Set estimate for "Implement AppendEntries" to 15m',
    });
    expect(document.activeElement).toBe(preset);

    await user.keyboard('{Enter}');
    expect(estimateOf(store, 'a')).toBe(15);
  });

  /*
   * Committing collapses the panel, unmounting the button the user is standing
   * on. Without an explicit hand-back, focus falls to `<body>` — and from there
   * Tab restarts at the top of the document, so estimating the second step of a
   * twelve-step project becomes a hunt.
   */
  it('returns focus to the badge after committing a preset', async () => {
    const { user } = await mountTree();
    const open = () =>
      screen.getByRole('button', { name: /estimate for "Implement AppendEntries"/i });
    await user.click(open());
    await user.click(
      screen.getByRole('button', {
        name: 'Set estimate for "Implement AppendEntries" to 45m',
      }),
    );
    expect(document.activeElement).toBe(open());
  });

  it('returns focus to the badge after committing with Enter', async () => {
    const { user } = await mountTree();
    await user.click(
      screen.getByRole('button', { name: 'Set estimate for "Implement AppendEntries"' }),
    );
    const field = screen.getByRole('textbox', {
      name: 'Estimate for Implement AppendEntries',
    });
    await user.type(field, '90{Enter}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', {
        name: 'Estimate for "Implement AppendEntries": 1h30. Change it',
      }),
    );
  });

  it('does not yank focus back when the user clicks away', async () => {
    const { user } = await mountTree();
    await user.click(
      screen.getByRole('button', { name: 'Set estimate for "Implement AppendEntries"' }),
    );
    // Focus moved somewhere the user chose; stealing it back would fight them.
    const other = screen.getByRole('button', { name: 'Set estimate for "A child leaf"' });
    await user.click(other);
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: 'Set estimate for "Implement AppendEntries"' }),
    );
  });

  /*
   * Typing a draft and then clicking a preset must write the PRESET, once.
   *
   * `EstimateField` commits on blur, and a button press blurs the input before
   * its own click fires. So the draft committed first and unmounted the presets
   * mid-gesture: the estimate was written twice (arming two undo entries, so
   * one ⌘Z restored a value the user never chose) and the click was swallowed.
   */
  it('writes only the preset when a draft was typed first', async () => {
    const { store, user } = await mountTree();
    await user.click(
      screen.getByRole('button', { name: 'Set estimate for "Implement AppendEntries"' }),
    );
    const field = screen.getByRole('textbox', {
      name: 'Estimate for Implement AppendEntries',
    });
    await user.type(field, '45');
    await user.click(
      screen.getByRole('button', {
        name: 'Set estimate for "Implement AppendEntries" to 1h',
      }),
    );

    expect(estimateOf(store, 'a')).toBe(60);
    // One write, so one undo, and undoing returns to no estimate at all.
    store.actions.undoLastDelete();
    expect(estimateOf(store, 'a')).toBeUndefined();
  });

  it('reverts an unparseable entry instead of wiping the estimate', async () => {
    const { store, user } = await mountTree();
    await user.click(
      screen.getByRole('button', { name: 'Estimate for "Already estimated": 45m. Change it' }),
    );
    const field = screen.getByRole('textbox', { name: 'Estimate for Already estimated' });
    await user.clear(field);
    await user.type(field, 'soon{Enter}');
    // A typo is not an instruction to delete. Only an EMPTY field clears.
    expect(estimateOf(store, 'b')).toBe(45);
  });

  it('does not complete the step when the control is clicked', async () => {
    const { store, user } = await mountTree();
    await user.click(
      screen.getByRole('button', { name: 'Set estimate for "Implement AppendEntries"' }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Set estimate for "Implement AppendEntries" to 30m',
      }),
    );
    const leaf = store.getState().goals[0].nodes.find((n) => n.id === 'a');
    expect(leaf?.status).toBeUndefined();
  });
});

describe('logging actual time from the step tree', () => {
  it('offers a log control on every leaf and none on a container', async () => {
    await mountTree();
    expect(screen.getByRole('button', { name: 'Log time on "Implement AppendEntries"' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /log time on "A container"/i })).toBeNull();
  });

  it('logs from a preset and shows the running total', async () => {
    const { store, user } = await mountTree();
    await user.click(screen.getByRole('button', { name: 'Log time on "Implement AppendEntries"' }));
    await user.click(
      screen.getByRole('button', { name: 'Log 1h on "Implement AppendEntries"' }),
    );

    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().sessions[0]).toMatchObject({ nodeId: 'a', minutes: 60 });
    expect(
      screen.getByRole('button', { name: 'Logged 1h on "Implement AppendEntries". Log more' }),
    ).toBeTruthy();
  });

  it('accumulates a second sitting rather than replacing the first', async () => {
    const { store, user } = await mountTree();
    await user.click(screen.getByRole('button', { name: 'Log time on "Implement AppendEntries"' }));
    await user.click(screen.getByRole('button', { name: 'Log 30m on "Implement AppendEntries"' }));
    await user.click(
      screen.getByRole('button', { name: 'Logged 30m on "Implement AppendEntries". Log more' }),
    );
    await user.click(screen.getByRole('button', { name: 'Log 15m on "Implement AppendEntries"' }));

    expect(store.getState().sessions).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Logged 45m on "Implement AppendEntries". Log more' }),
    ).toBeTruthy();
  });

  it('shows the comparison against the estimate', async () => {
    const { user } = await mountTree();
    // "Already estimated" carries a 45m estimate; logging 1h is 1.3× over.
    await user.click(screen.getByRole('button', { name: 'Log time on "Already estimated"' }));
    await user.click(screen.getByRole('button', { name: 'Log 1h on "Already estimated"' }));

    const badge = screen.getByRole('button', {
      name: 'Logged 1h on "Already estimated". Log more',
    });
    expect(badge.getAttribute('title')).toBe(
      'Logged 1h against a 45m estimate — 1.3× over',
    );
  });

  it('says so when there is no estimate to compare against', async () => {
    const { user } = await mountTree();
    await user.click(screen.getByRole('button', { name: 'Log time on "Implement AppendEntries"' }));
    await user.click(screen.getByRole('button', { name: 'Log 1h on "Implement AppendEntries"' }));

    const badge = screen.getByRole('button', {
      name: 'Logged 1h on "Implement AppendEntries". Log more',
    });
    expect(badge.getAttribute('title')).toBe('Logged 1h — no estimate to compare against');
  });

  it('clears a mis-logged entry', async () => {
    const { store, user } = await mountTree();
    await user.click(screen.getByRole('button', { name: 'Log time on "Implement AppendEntries"' }));
    await user.click(screen.getByRole('button', { name: 'Log 4h on "Implement AppendEntries"' }));

    await user.click(
      screen.getByRole('button', { name: 'Logged 4h on "Implement AppendEntries". Log more' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Clear the time logged on "Implement AppendEntries"' }),
    );
    expect(store.getState().sessions).toEqual([]);
  });

  it('offers no clear control before anything is logged', async () => {
    const { user } = await mountTree();
    await user.click(screen.getByRole('button', { name: 'Log time on "Implement AppendEntries"' }));
    expect(
      screen.queryByRole('button', { name: /^Clear the time logged/ }),
    ).toBeNull();
  });

  it('does not complete the step when time is logged on it', async () => {
    const { store, user } = await mountTree();
    await user.click(screen.getByRole('button', { name: 'Log time on "Implement AppendEntries"' }));
    await user.click(screen.getByRole('button', { name: 'Log 30m on "Implement AppendEntries"' }));
    // Logging time is journalling, not progress. The row's click handler must
    // never see this.
    expect(store.getState().goals[0].nodes.find((n) => n.id === 'a')?.status).toBeUndefined();
  });

  it('types a duration and commits it with Enter', async () => {
    const { store, user } = await mountTree();
    await user.click(screen.getByRole('button', { name: 'Log time on "Implement AppendEntries"' }));
    const field = screen.getByRole('textbox', {
      name: 'Estimate for time on Implement AppendEntries',
    });
    await user.type(field, '2h15{Enter}');
    expect(store.getState().sessions[0].minutes).toBe(135);
  });

  it('logs only the preset when a draft was typed first', async () => {
    const { store, user } = await mountTree();
    await user.click(screen.getByRole('button', { name: 'Log time on "Implement AppendEntries"' }));
    const field = screen.getByRole('textbox', {
      name: 'Estimate for time on Implement AppendEntries',
    });
    await user.type(field, '45');
    await user.click(screen.getByRole('button', { name: 'Log 1h on "Implement AppendEntries"' }));

    // Worse here than for an estimate: the ledger is append-only, so a stray
    // draft commit is not overwritten by the preset — it is ADDED to it.
    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().sessions[0].minutes).toBe(60);
  });

  it('returns focus to the badge after logging', async () => {
    const { user } = await mountTree();
    await user.click(screen.getByRole('button', { name: 'Log time on "Implement AppendEntries"' }));
    await user.click(screen.getByRole('button', { name: 'Log 30m on "Implement AppendEntries"' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Logged 30m on "Implement AppendEntries". Log more' }),
    );
  });
});
