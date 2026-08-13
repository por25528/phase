import { describe, it, expect } from 'vitest';
import { leafCount, blockedLeafCount, firstBlockedLeaf, groupByColumn, weaveHidden, rankMoveTarget } from './board';
import type { Goal, GoalNode } from '../db/types';

// ---- helpers ----

function leaf(id: string, done: boolean): GoalNode {
  return { id, title: id, ...(done ? { status: 'done' as const } : {}) };
}

function blockedLeaf(id: string): GoalNode {
  return { id, title: id, status: 'blocked' };
}

function container(id: string, children: GoalNode[]): GoalNode {
  return { id, title: id, children };
}

function makeGoal(id: string, column?: number): Goal {
  return { id, title: id, start: '2026-01-01', deadline: '2026-12-31', nodes: [], column };
}

// ---- leafCount ----

describe('leafCount', () => {
  it('counts flat leaves and their done state', () => {
    const nodes = [leaf('a', true), leaf('b', false), leaf('c', true)];
    expect(leafCount(nodes)).toEqual({ total: 3, done: 2 });
  });

  it('recurses through containers, counting only leaves', () => {
    const nodes = [
      container('parent', [leaf('a', true), leaf('b', false)]),
      leaf('c', true),
    ];
    expect(leafCount(nodes)).toEqual({ total: 3, done: 2 });
  });

  it('recurses through nested containers arbitrarily deep', () => {
    const nodes = [
      container('a', [
        container('b', [leaf('c', true), leaf('d', true)]),
        leaf('e', false),
      ]),
    ];
    expect(leafCount(nodes)).toEqual({ total: 3, done: 2 });
  });

  it('returns zero for an empty node list', () => {
    expect(leafCount([])).toEqual({ total: 0, done: 0 });
  });

  it('does not count a container itself as a leaf', () => {
    const nodes = [container('parent', [leaf('a', true)])];
    expect(leafCount(nodes)).toEqual({ total: 1, done: 1 });
  });
});

// ---- blockedLeafCount ----

describe('blockedLeafCount', () => {
  it('is zero for a project with nothing stuck', () => {
    const nodes = [leaf('a', false), leaf('b', true)];
    expect(blockedLeafCount(nodes)).toBe(0);
  });

  it('counts flat blocked leaves', () => {
    const nodes = [blockedLeaf('a'), leaf('b', false), blockedLeaf('c')];
    expect(blockedLeafCount(nodes)).toBe(2);
  });

  it('recurses through nested containers', () => {
    const nodes = [
      container('a', [
        container('b', [blockedLeaf('c'), leaf('d', false)]),
        blockedLeaf('e'),
      ]),
    ];
    expect(blockedLeafCount(nodes)).toBe(2);
  });

  it('does not count a done leaf as blocked', () => {
    const nodes = [leaf('a', true)];
    expect(blockedLeafCount(nodes)).toBe(0);
  });

  it('returns zero for an empty node list', () => {
    expect(blockedLeafCount([])).toBe(0);
  });
});

// ---- firstBlockedLeaf ----

describe('firstBlockedLeaf', () => {
  it('returns null for a project with nothing stuck', () => {
    const nodes = [leaf('a', false), leaf('b', true)];
    expect(firstBlockedLeaf(nodes)).toBeNull();
  });

  it('returns the first flat blocked leaf in document order', () => {
    const nodes = [leaf('a', false), blockedLeaf('b'), blockedLeaf('c')];
    expect(firstBlockedLeaf(nodes)?.id).toBe('b');
  });

  it('descends into containers before later siblings, preserving document order', () => {
    const nodes = [
      container('a', [leaf('x', false), blockedLeaf('y')]),
      blockedLeaf('z'),
    ];
    expect(firstBlockedLeaf(nodes)?.id).toBe('y');
  });

  it('recurses through nested containers arbitrarily deep', () => {
    const nodes = [
      container('a', [
        container('b', [leaf('c', false), blockedLeaf('d')]),
      ]),
    ];
    expect(firstBlockedLeaf(nodes)?.id).toBe('d');
  });

  it('does not match a done leaf', () => {
    const nodes = [leaf('a', true)];
    expect(firstBlockedLeaf(nodes)).toBeNull();
  });

  it('returns null for an empty node list', () => {
    expect(firstBlockedLeaf([])).toBeNull();
  });
});

// ---- groupByColumn ----

describe('groupByColumn', () => {
  it('groups goal ids into their column, preserving input order within a column', () => {
    const goals = [makeGoal('a', 0), makeGoal('b', 1), makeGoal('c', 0)];
    expect(groupByColumn(goals, 4)).toEqual([['a', 'c'], ['b'], [], []]);
  });

  it('treats a missing column as 0', () => {
    const goals = [makeGoal('a', undefined)];
    expect(groupByColumn(goals, 4)).toEqual([['a'], [], [], []]);
  });

  it('clamps a negative column to 0', () => {
    const goals = [makeGoal('a', -3)];
    expect(groupByColumn(goals, 4)).toEqual([['a'], [], [], []]);
  });

  it('clamps a column at or beyond n to n - 1', () => {
    const goals = [makeGoal('a', 4), makeGoal('b', 99)];
    expect(groupByColumn(goals, 4)).toEqual([[], [], [], ['a', 'b']]);
  });

  it('returns n empty columns for an empty goals array', () => {
    expect(groupByColumn([], 3)).toEqual([[], [], []]);
  });
});

// ---- weaveHidden ----

describe('weaveHidden', () => {
  const done = (id: string, column: number): Goal => ({ ...makeGoal(id, column), completedAt: '2026-07-01' });

  it('re-inserts a hidden goal at its within-column index after an active reorder', () => {
    const goals = [makeGoal('A', 0), done('B', 0), makeGoal('C', 0)];
    // actives dragged to [C, A]; completed B omitted from the layout
    expect(weaveHidden(goals, [['C', 'A'], [], [], []])).toEqual([['C', 'B', 'A'], [], [], []]);
  });

  it('pins a hidden goal at the top when it was first', () => {
    const goals = [done('A', 0), makeGoal('B', 0), makeGoal('C', 0)];
    expect(weaveHidden(goals, [['C', 'B'], [], [], []])).toEqual([['A', 'C', 'B'], [], [], []]);
  });

  it('keeps a hidden goal in its own column, not Now', () => {
    const goals = [makeGoal('A', 0), done('L', 2), makeGoal('M', 2)];
    expect(weaveHidden(goals, [['A'], [], ['M'], []])).toEqual([['A'], [], ['L', 'M'], []]);
  });

  it('is a no-op when nothing is hidden', () => {
    const goals = [makeGoal('A', 0), makeGoal('B', 1)];
    expect(weaveHidden(goals, [['A'], ['B'], [], []])).toEqual([['A'], ['B'], [], []]);
  });
});

describe('weaveHidden', () => {
  const g = (id: string, column: number): Goal => ({ id, title: id, nodes: [], column });

  it('pins a hidden goal at the within-column index it held', () => {
    // The scoped-board case: 'a' shows University, 's' shows Startup.
    const goals = [g('s1', 3), g('u1', 3), g('s2', 3), g('u2', 3), g('u3', 3)];
    const reordered = [[], [], [], ['u3', 'u1', 'u2']];
    expect(weaveHidden(goals, reordered)[3]).toEqual(['s1', 'u3', 's2', 'u1', 'u2']);
  });

  it('is identity when nothing is hidden', () => {
    const goals = [g('a', 0), g('b', 0)];
    expect(weaveHidden(goals, [['b', 'a'], [], [], []])[0]).toEqual(['b', 'a']);
  });
});

describe('rankMoveTarget', () => {
  const visible = (...ids: string[]) => new Set(ids);

  it('steps over a hidden neighbour', () => {
    // Full column order: u1, s1, u2. University sees [u1, u2].
    const list = ['u1', 's1', 'u2'];
    // Moving u2 up lands on u1's index, not s1's.
    expect(rankMoveTarget(list, visible('u1', 'u2'), 'u2', -1)).toBe(0);
  });

  it('moves one visible slot when everything is visible', () => {
    const list = ['a', 'b', 'c'];
    expect(rankMoveTarget(list, visible('a', 'b', 'c'), 'b', -1)).toBe(0);
    expect(rankMoveTarget(list, visible('a', 'b', 'c'), 'b', 1)).toBe(2);
  });

  it('is null at both ends of the VISIBLE list, not the full one', () => {
    const list = ['s1', 'u1', 'u2', 's2'];
    const vis = visible('u1', 'u2');
    expect(rankMoveTarget(list, vis, 'u1', -1)).toBeNull();
    expect(rankMoveTarget(list, vis, 'u2', 1)).toBeNull();
  });

  it('is null for a goal that is absent or invisible', () => {
    expect(rankMoveTarget(['a', 'b'], visible('a', 'b'), 'zz', -1)).toBeNull();
    expect(rankMoveTarget(['a', 'b'], visible('a'), 'b', -1)).toBeNull();
  });
});
