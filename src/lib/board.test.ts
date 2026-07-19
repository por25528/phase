import { describe, it, expect } from 'vitest';
import { leafCount, groupByColumn, weaveCompleted } from './board';
import type { Goal, GoalNode } from '../db/types';

// ---- helpers ----

function leaf(id: string, done: boolean): GoalNode {
  return { id, title: id, done };
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

// ---- weaveCompleted ----

describe('weaveCompleted', () => {
  const done = (id: string, column: number): Goal => ({ ...makeGoal(id, column), completedAt: '2026-07-01' });

  it('re-inserts a hidden goal at its within-column index after an active reorder', () => {
    const goals = [makeGoal('A', 0), done('B', 0), makeGoal('C', 0)];
    // actives dragged to [C, A]; completed B omitted from the layout
    expect(weaveCompleted(goals, [['C', 'A'], [], [], []])).toEqual([['C', 'B', 'A'], [], [], []]);
  });

  it('pins a hidden goal at the top when it was first', () => {
    const goals = [done('A', 0), makeGoal('B', 0), makeGoal('C', 0)];
    expect(weaveCompleted(goals, [['C', 'B'], [], [], []])).toEqual([['A', 'C', 'B'], [], [], []]);
  });

  it('keeps a hidden goal in its own column, not Now', () => {
    const goals = [makeGoal('A', 0), done('L', 2), makeGoal('M', 2)];
    expect(weaveCompleted(goals, [['A'], [], ['M'], []])).toEqual([['A'], [], ['L', 'M'], []]);
  });

  it('is a no-op when nothing is hidden', () => {
    const goals = [makeGoal('A', 0), makeGoal('B', 1)];
    expect(weaveCompleted(goals, [['A'], ['B'], [], []])).toEqual([['A'], ['B'], [], []]);
  });
});
