import { describe, it, expect, vi } from 'vitest';
import { handleAgentWrite } from './agentWrites';
import type { Goal, GoalNode, Task } from '../db/types';
import type { FullState } from '../state/store';

/**
 * The harness holds a MUTABLE state, and the default spies edit it the way the
 * real actions would.
 *
 * That is not decoration. Three verbs — `add_task`, `estimate`,
 * `create_project` — are honest only because they re-read the store after
 * calling a `void` action, so a spy that changed nothing would (correctly)
 * make them report a refusal. Handing them a frozen fixture would test the
 * opposite of the thing.
 */
function harness(opts: {
  goals?: Goal[];
  tasks?: Task[];
  state?: Partial<FullState>;
  actions?: Record<string, unknown>;
} = {}) {
  let current = {
    goals: opts.goals ?? [],
    tasks: opts.tasks ?? [],
    habits: [],
    sessions: [],
    lives: [],
    availability: [],
    allDayBlocks: false,
    hydration: 'ready',
    persistFailed: false,
    pendingUndo: null,
    toast: null,
    ...opts.state,
  } as unknown as FullState;

  const patch = (next: Partial<FullState>) => {
    current = { ...current, ...next } as FullState;
  };

  const withNode = (goalId: string, fn: (nodes: GoalNode[]) => void) => {
    const goals = structuredClone(current.goals);
    const goal = goals.find((g) => g.id === goalId);
    if (goal) fn(goal.nodes);
    patch({ goals });
  };

  const findEverywhere = (nodes: GoalNode[], id: string): GoalNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const hit = n.children ? findEverywhere(n.children, id) : null;
      if (hit) return hit;
    }
    return null;
  };

  const spies: Record<string, unknown> = {
    toggleLeaf: vi.fn(),
    toggleTask: vi.fn(),
    setNodeStatus: vi.fn(() => true),
    setNodesStatus: vi.fn(() => true),
    removeNodes: vi.fn(() => true),
    removeTask: vi.fn(),
    undoLastDelete: vi.fn(),
    renameNode: vi.fn(),
    scheduleNode: vi.fn(() => true),
    scheduleTask: vi.fn(() => true),
    addGoals: vi.fn((goals: Goal[]) => patch({ goals: [...current.goals, ...goals] })),
    addRootNode: vi.fn((goalId: string, title: string) => {
      withNode(goalId, (nodes) => nodes.push({ id: 'fresh', title }));
    }),
    addChild: vi.fn((parentId: string, title: string) => {
      const goal = current.goals.find((g) => findEverywhere(g.nodes, parentId));
      if (!goal) return;
      withNode(goal.id, (nodes) => {
        const parent = findEverywhere(nodes, parentId);
        if (parent) (parent.children ??= []).push({ id: 'fresh', title });
      });
    }),
    setNodeEstimate: vi.fn((nodeId: string, minutes: number | null) => {
      const goal = current.goals.find((g) => findEverywhere(g.nodes, nodeId));
      if (!goal) return;
      withNode(goal.id, (nodes) => {
        const node = findEverywhere(nodes, nodeId);
        if (!node) return;
        if (minutes === null || minutes <= 0) delete node.estimateMin;
        else node.estimateMin = Math.round(minutes);
      });
    }),
    ...opts.actions,
  };

  return {
    deps: { actions: spies as never, getState: () => current },
    spies: spies as Record<string, ReturnType<typeof vi.fn>>,
    patch,
  };
}

const GOAL = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1', title: 'Thesis', nodes: [{ id: 'n1', title: 'Draft outline' }], ...over,
});

const errorOf = (res: { ok: boolean } | { error: string }) => (res as { error: string }).error;

describe('complete_task', () => {
  it('completes a step through the same function the checkbox calls', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite(
      { tool: 'complete_task', ref: { kind: 'step', id: 'n1', goalId: 'g1' } },
      h.deps,
    );
    // toggleLeaf takes the node id ALONE — it does not take a goalId.
    expect(h.spies.toggleLeaf).toHaveBeenCalledWith('n1');
    expect(res).toEqual({ ok: true, data: { completed: 'n1' } });
  });

  it('completes a loose task through toggleTask', () => {
    const h = harness({ tasks: [{ id: 't1', title: 'Post form', done: false, goalId: null }] });
    const res = handleAgentWrite(
      { tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } },
      h.deps,
    );
    expect(h.spies.toggleTask).toHaveBeenCalledWith('t1');
    expect(res.ok).toBe(true);
  });

  it('refuses an already-done step rather than un-ticking it', () => {
    const h = harness({ goals: [GOAL({ nodes: [{ id: 'n1', title: 'Draft outline', status: 'done' }] })] });
    const res = handleAgentWrite(
      { tool: 'complete_task', ref: { kind: 'step', id: 'n1', goalId: 'g1' } },
      h.deps,
    );
    // `toggleLeaf` TOGGLES: calling it here would reverse the completion while
    // reporting `{ completed }`, which is the one thing this surface may never do.
    expect(h.spies.toggleLeaf).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(errorOf(res)).toContain('already done');
  });

  it('refuses a container', () => {
    const h = harness({
      goals: [GOAL({ nodes: [{ id: 'n1', title: 'Chapter 1', children: [{ id: 'n2', title: 'Read' }] }] })],
    });
    const res = handleAgentWrite(
      { tool: 'complete_task', ref: { kind: 'step', id: 'n1', goalId: 'g1' } },
      h.deps,
    );
    expect(h.spies.toggleLeaf).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  it('names an id it cannot find', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite(
      { tool: 'complete_task', ref: { kind: 'step', id: 'nope', goalId: 'g1' } },
      h.deps,
    );
    expect(res).toEqual({ ok: false, error: 'No task with id "nope".' });
  });

  it('refuses anything inside a completed project', () => {
    const h = harness({ goals: [GOAL({ completedAt: '2026-08-01' })] });
    const res = handleAgentWrite(
      { tool: 'complete_task', ref: { kind: 'step', id: 'n1', goalId: 'g1' } },
      h.deps,
    );
    expect(h.spies.toggleLeaf).not.toHaveBeenCalled();
    expect(errorOf(res)).toContain('completed');
  });

  it('surfaces a failed persist even though the action returned nothing', () => {
    const h = harness({
      tasks: [{ id: 't1', title: 'Post form', done: false, goalId: null }],
      state: { persistFailed: true },
    });
    const res = handleAgentWrite(
      { tool: 'complete_task', ref: { kind: 'task', id: 't1', goalId: null } },
      h.deps,
    );
    expect(res.ok).toBe(false);
    expect(errorOf(res)).toContain('could not be saved');
    expect(errorOf(res)).toContain('Export');
  });
});

describe('set_status', () => {
  it('spends setNodeStatus — the singular form, which is the one that carries blockedOn', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite(
      { tool: 'set_status', nodeId: 'n1', status: 'blocked', blockedOn: 'the library reopening' },
      h.deps,
    );
    expect(h.spies.setNodeStatus).toHaveBeenCalledWith('n1', 'blocked', 'the library reopening');
    expect(res.ok).toBe(true);
  });

  it('reports a refusal instead of claiming success', () => {
    const h = harness({ goals: [GOAL()], actions: { setNodeStatus: vi.fn(() => false) } });
    const res = handleAgentWrite({ tool: 'set_status', nodeId: 'n1', status: 'doing' }, h.deps);
    expect(res).toEqual({ ok: false, error: 'That status change did not apply.' });
  });

  it('routes done through toggleLeaf, as TaskPage’s popover does', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite({ tool: 'set_status', nodeId: 'n1', status: 'done' }, h.deps);
    // Same function the checkbox calls ⇒ the identical `Completed "X"` undo.
    expect(h.spies.toggleLeaf).toHaveBeenCalledWith('n1');
    expect(h.spies.setNodeStatus).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });

  it('refuses a blockedOn reason attached to a status that cannot hold one', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite(
      { tool: 'set_status', nodeId: 'n1', status: 'doing', blockedOn: 'nothing' },
      h.deps,
    );
    // `blockedOn` exists only while the status is 'blocked'. Passing it through
    // would drop it silently; the request says something the store cannot hold.
    expect(h.spies.setNodeStatus).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  it('refuses a container, whose status is derived', () => {
    const h = harness({
      goals: [GOAL({ nodes: [{ id: 'n1', title: 'Chapter 1', children: [{ id: 'n2', title: 'Read' }] }] })],
    });
    const res = handleAgentWrite({ tool: 'set_status', nodeId: 'n1', status: 'doing' }, h.deps);
    expect(h.spies.setNodeStatus).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });
});

describe('create_project', () => {
  it('returns parseGoalImport’s rejection verbatim', () => {
    const h = harness();
    const res = handleAgentWrite({ tool: 'create_project', project: { nodes: [] } }, h.deps);
    expect(h.spies.addGoals).not.toHaveBeenCalled();
    // The parser owns the schema; restating its message here would let the two drift.
    expect(res).toEqual({ ok: false, error: "Goal #1 is missing a title." });
  });

  it('adds the parsed goals and names what it created', () => {
    const h = harness();
    const res = handleAgentWrite(
      { tool: 'create_project', project: { title: 'Dissertation', subgoals: ['Read', 'Write'] } },
      h.deps,
    );
    expect(h.spies.addGoals).toHaveBeenCalledTimes(1);
    const data = (res as { data: { created: { id: string; title: string }[] } }).data;
    expect(data.created).toHaveLength(1);
    expect(data.created[0].title).toBe('Dissertation');
    expect(data.created[0].id).toBeTruthy();
  });
});

describe('add_task', () => {
  it('adds a root step and answers with the id it created', () => {
    const h = harness({ goals: [GOAL({ nodes: [] })] });
    const res = handleAgentWrite(
      { tool: 'add_task', goalId: 'g1', title: 'Read chapter 7' },
      h.deps,
    );
    expect(h.spies.addRootNode).toHaveBeenCalledWith('g1', 'Read chapter 7');
    // The id is the point: without it the model has to re-read the project and
    // match by title before it can estimate or schedule what it just made.
    expect(res).toEqual({ ok: true, data: { nodeId: 'fresh', goalId: 'g1', title: 'Read chapter 7' } });
  });

  it('adds under a parent when one is named', () => {
    const h = harness({
      goals: [GOAL({ nodes: [{ id: 'n1', title: 'Chapter 1', children: [{ id: 'n2', title: 'Read' }] }] })],
    });
    const res = handleAgentWrite(
      { tool: 'add_task', goalId: 'g1', parentId: 'n1', title: 'Take notes' },
      h.deps,
    );
    expect(h.spies.addChild).toHaveBeenCalledWith('n1', 'Take notes');
    expect(res.ok).toBe(true);
  });

  it('names a project it cannot find', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite({ tool: 'add_task', goalId: 'nope', title: 'X' }, h.deps);
    expect(res).toEqual({ ok: false, error: 'No project with id "nope".' });
  });

  it('refuses a parent that is not in the named project', () => {
    const h = harness({ goals: [GOAL(), GOAL({ id: 'g2', nodes: [{ id: 'other', title: 'Elsewhere' }] })] });
    const res = handleAgentWrite(
      { tool: 'add_task', goalId: 'g1', parentId: 'other', title: 'X' },
      h.deps,
    );
    expect(h.spies.addChild).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  it('reports a refusal when nothing actually arrived', () => {
    const h = harness({ goals: [GOAL({ nodes: [] })], actions: { addRootNode: vi.fn() } });
    const res = handleAgentWrite({ tool: 'add_task', goalId: 'g1', title: 'X' }, h.deps);
    expect(res.ok).toBe(false);
  });
});

describe('rename', () => {
  it('renames through renameNode', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite({ tool: 'rename', nodeId: 'n1', title: 'Outline v2' }, h.deps);
    expect(h.spies.renameNode).toHaveBeenCalledWith('n1', 'Outline v2');
    expect(res.ok).toBe(true);
  });

  it('names an id it cannot find', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite({ tool: 'rename', nodeId: 'nope', title: 'X' }, h.deps);
    expect(h.spies.renameNode).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, error: 'No task with id "nope".' });
  });
});

describe('estimate', () => {
  it('sets a leaf’s estimate', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite({ tool: 'estimate', nodeId: 'n1', minutes: 45 }, h.deps);
    expect(h.spies.setNodeEstimate).toHaveBeenCalledWith('n1', 45);
    expect(res.ok).toBe(true);
  });

  it('clears one with null', () => {
    const h = harness({ goals: [GOAL({ nodes: [{ id: 'n1', title: 'Draft outline', estimateMin: 30 }] })] });
    const res = handleAgentWrite({ tool: 'estimate', nodeId: 'n1', minutes: null }, h.deps);
    expect(h.spies.setNodeEstimate).toHaveBeenCalledWith('n1', null);
    expect(res.ok).toBe(true);
  });

  it('reports a refusal when the number did not land', () => {
    // `setNodeEstimate` returns void and refuses silently — on a frozen project,
    // and on a node carrying a `children` array. The only honest check is the
    // store afterwards.
    const h = harness({ goals: [GOAL()], actions: { setNodeEstimate: vi.fn() } });
    const res = handleAgentWrite({ tool: 'estimate', nodeId: 'n1', minutes: 45 }, h.deps);
    expect(res.ok).toBe(false);
  });

  it('refuses a container', () => {
    const h = harness({
      goals: [GOAL({ nodes: [{ id: 'n1', title: 'Chapter 1', children: [{ id: 'n2', title: 'Read' }] }] })],
    });
    const res = handleAgentWrite({ tool: 'estimate', nodeId: 'n1', minutes: 45 }, h.deps);
    expect(h.spies.setNodeEstimate).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });
});

describe('schedule', () => {
  it('books a step with no blockId, so the store arms the undo itself', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite(
      { tool: 'schedule', ref: { kind: 'step', id: 'n1', goalId: 'g1' }, day: '2026-08-14' },
      h.deps,
    );
    // aimMin 0 is "anywhere that day" — what every distance booking passes.
    expect(h.spies.scheduleNode).toHaveBeenCalledWith('g1', 'n1', '2026-08-14', 0);
    expect(res.ok).toBe(true);
  });

  it('passes startMin through as the aim', () => {
    const h = harness({ goals: [GOAL()] });
    handleAgentWrite(
      { tool: 'schedule', ref: { kind: 'step', id: 'n1', goalId: 'g1' }, day: '2026-08-14', startMin: 540 },
      h.deps,
    );
    expect(h.spies.scheduleNode).toHaveBeenCalledWith('g1', 'n1', '2026-08-14', 540);
  });

  it('books a loose task', () => {
    const h = harness({ tasks: [{ id: 't1', title: 'Post form', done: false, goalId: null }] });
    const res = handleAgentWrite(
      { tool: 'schedule', ref: { kind: 'task', id: 't1', goalId: null }, day: '2026-08-14' },
      h.deps,
    );
    expect(h.spies.scheduleTask).toHaveBeenCalledWith('t1', '2026-08-14', 0);
    expect(res.ok).toBe(true);
  });

  it('reports the refusal in the store’s own words', () => {
    const h = harness({
      goals: [GOAL()],
      actions: {
        scheduleNode: vi.fn(() => false),
      },
    });
    // `scheduleNode` writes `describeNoRoom`'s sentence as a toast before it
    // refuses; repeating it here would be a second way to say "no room".
    h.spies.scheduleNode = vi.fn(() => {
      h.patch({ toast: 'No free time left that day — the longest gap is 20m.' });
      return false;
    });
    const d = { ...h.deps, actions: { ...(h.deps.actions as object), scheduleNode: h.spies.scheduleNode } as never };
    const res = handleAgentWrite(
      { tool: 'schedule', ref: { kind: 'step', id: 'n1', goalId: 'g1' }, day: '2026-08-14' },
      d,
    );
    expect(res).toEqual({ ok: false, error: 'No free time left that day — the longest gap is 20m.' });
  });

  it('refuses a well-formed but impossible day', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite(
      { tool: 'schedule', ref: { kind: 'step', id: 'n1', goalId: 'g1' }, day: '2026-13-45' },
      h.deps,
    );
    expect(h.spies.scheduleNode).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  it('refuses a requested sitting length rather than dropping it', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite(
      { tool: 'schedule', ref: { kind: 'step', id: 'n1', goalId: 'g1' }, day: '2026-08-14', minutes: 90 },
      h.deps,
    );
    // A fresh sitting is sized from the estimate; no action takes a length.
    expect(h.spies.scheduleNode).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(errorOf(res)).toContain('estimate');
  });
});

describe('delete', () => {
  it('deletes a step through the bulk form, which reports whether it wrote', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite(
      { tool: 'delete', ref: { kind: 'step', id: 'n1', goalId: 'g1' } },
      h.deps,
    );
    expect(h.spies.removeNodes).toHaveBeenCalledWith(['n1']);
    expect(res).toEqual({ ok: true, data: { deleted: 'n1' } });
  });

  it('does not claim a delete that was refused', () => {
    const h = harness({ goals: [GOAL()], actions: { removeNodes: vi.fn(() => false) } });
    const res = handleAgentWrite(
      { tool: 'delete', ref: { kind: 'step', id: 'n1', goalId: 'g1' } },
      h.deps,
    );
    expect(res).toEqual({ ok: false, error: 'Nothing was deleted.' });
  });

  it('deletes a loose task', () => {
    const h = harness({ tasks: [{ id: 't1', title: 'Post form', done: false, goalId: null }] });
    const res = handleAgentWrite(
      { tool: 'delete', ref: { kind: 'task', id: 't1', goalId: null } },
      h.deps,
    );
    expect(h.spies.removeTask).toHaveBeenCalledWith('t1');
    expect(res.ok).toBe(true);
  });

  it('names a task it cannot find', () => {
    const h = harness();
    const res = handleAgentWrite(
      { tool: 'delete', ref: { kind: 'task', id: 't9', goalId: null } },
      h.deps,
    );
    expect(h.spies.removeTask).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, error: 'No task with id "t9".' });
  });
});

describe('undo_last', () => {
  it('names what it reversed', () => {
    const h = harness({ state: { pendingUndo: { label: 'Deleted "Draft outline"' } } });
    const res = handleAgentWrite({ tool: 'undo_last' }, h.deps);
    expect(h.spies.undoLastDelete).toHaveBeenCalled();
    expect(res).toEqual({ ok: true, data: { undone: 'Deleted "Draft outline"' } });
  });

  it('admits when the sweep already dropped the entry', () => {
    const h = harness({ state: { pendingUndo: null } });
    const res = handleAgentWrite({ tool: 'undo_last' }, h.deps);
    expect(h.spies.undoLastDelete).not.toHaveBeenCalled();
    expect(res).toEqual({
      ok: false,
      error: 'Nothing to undo — an edit in Phase since then cleared it.',
    });
  });
});

describe('reads', () => {
  it('refuses a read, which the dispatcher should never have sent here', () => {
    const h = harness();
    const res = handleAgentWrite({ tool: 'today' }, h.deps);
    expect(res.ok).toBe(false);
  });
});
