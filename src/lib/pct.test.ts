import { describe, it, expect } from 'vitest';
import { nodePct, goalPct } from './pct';
import type { Goal, GoalNode } from '../db/types';

function leaf(done: boolean): GoalNode {
  return { id: 'l', title: 'leaf', done };
}
function container(children: GoalNode[]): GoalNode {
  return { id: 'c', title: 'container', children };
}
function goal(nodes: GoalNode[]): Goal {
  return { id: 'g', title: 'goal', start: '2026-01-01', deadline: '2026-12-31', nodes };
}

describe('nodePct', () => {
  it('leaf done → 100', () => {
    expect(nodePct(leaf(true))).toBe(100);
  });

  it('leaf not done → 0', () => {
    expect(nodePct(leaf(false))).toBe(0);
  });

  it('container with 2 of 4 done → 50', () => {
    const n = container([
      { id: 'a', title: 'a', done: true },
      { id: 'b', title: 'b', done: true },
      { id: 'c', title: 'c', done: false },
      { id: 'd', title: 'd', done: false },
    ]);
    expect(nodePct(n)).toBe(50);
  });

  // CRITICAL: equal-weight per level, NOT flattened over all leaves
  // goal nodes = [ leafDone, container{ children:[leafDone, leafNot] } ]
  // top level: (100 + 50) / 2 = 75 (NOT 2/3 leaves = 66.7)
  it('nested container uses equal-weight per level (75, not 66.7)', () => {
    const nested = container([
      { id: 'la', title: 'la', done: true },
      { id: 'lb', title: 'lb', done: false },
    ]);
    const topLevel = goal([
      { id: 'ld', title: 'ld', done: true },
      nested,
    ]);
    expect(goalPct(topLevel)).toBe(75);
  });

  it('empty children array is treated as a leaf (done?100:0)', () => {
    const n: GoalNode = { id: 'e', title: 'empty', done: false, children: [] };
    expect(nodePct(n)).toBe(0);
    const n2: GoalNode = { id: 'e2', title: 'empty done', done: true, children: [] };
    expect(nodePct(n2)).toBe(100);
  });
});

describe('goalPct', () => {
  it('goal with no nodes → 0', () => {
    expect(goalPct(goal([]))).toBe(0);
  });

  it('1 of 3 done → exact fraction 33.333…', () => {
    const g = goal([
      { id: 'a', title: 'a', done: true },
      { id: 'b', title: 'b', done: false },
      { id: 'c', title: 'c', done: false },
    ]);
    const pct = goalPct(g);
    expect(pct).toBeCloseTo(33.333, 2);
    expect(Math.round(pct)).toBe(33);
  });
});
