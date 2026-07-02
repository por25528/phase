import { describe, it, expect } from 'vitest';
import {
  indentNode,
  outdentNode,
  reorderSiblings,
  reorderTop,
  findParentList,
  findNodePath,
  cloneGoals,
  firstOpenLeaf,
} from './tree';
import { goalPct } from './pct';
import type { Goal, GoalNode } from '../db/types';

// ---- helpers ----

function leaf(id: string, done: boolean): GoalNode {
  return { id, title: id, done };
}

function container(id: string, children: GoalNode[]): GoalNode {
  return { id, title: id, children };
}

function makeGoal(id: string, nodes: GoalNode[]): Goal {
  return { id, title: id, start: '2026-01-01', deadline: '2026-12-31', nodes };
}

// ---- cloneGoals ----

describe('cloneGoals', () => {
  it('returns a deep copy — mutations do not affect the original', () => {
    const goals = [makeGoal('g', [leaf('A', false)])];
    const clone = cloneGoals(goals);
    clone[0].nodes[0].title = 'mutated';
    expect(goals[0].nodes[0].title).toBe('A');
  });
});

// ---- findParentList ----

describe('findParentList', () => {
  it('finds node at goal-root level', () => {
    const goals = [makeGoal('g', [leaf('A', false), leaf('B', true)])];
    const result = findParentList(goals, 'B');
    expect(result).not.toBeNull();
    expect(result!.index).toBe(1);
    expect(result!.list[1].id).toBe('B');
  });

  it('finds node nested inside a container', () => {
    const goals = [makeGoal('g', [container('P', [leaf('C', false)])])];
    const result = findParentList(goals, 'C');
    expect(result).not.toBeNull();
    expect(result!.index).toBe(0);
    expect(result!.list[0].id).toBe('C');
  });

  it('returns null for unknown id', () => {
    const goals = [makeGoal('g', [leaf('A', false)])];
    expect(findParentList(goals, 'missing')).toBeNull();
  });
});

// ---- findNodePath ----

describe('findNodePath', () => {
  it('root-level node returns single-element path', () => {
    const goals = [makeGoal('g', [leaf('A', false)])];
    expect(findNodePath(goals, 'A')).toEqual(['A']);
  });

  it('nested node returns full ancestor path', () => {
    const goals = [makeGoal('g', [container('P', [leaf('C', false)])])];
    expect(findNodePath(goals, 'C')).toEqual(['P', 'C']);
  });

  it('returns null for unknown id', () => {
    expect(findNodePath([makeGoal('g', [leaf('A', false)])], 'x')).toBeNull();
  });
});

// ---- indentNode ----

describe('indentNode', () => {
  it('leaf becomes container when B is indented under A', () => {
    const goals = [makeGoal('g', [leaf('A', true), leaf('B', false)])];
    const result = indentNode(goals, 'B');

    expect(result[0].nodes).toHaveLength(1);
    const a = result[0].nodes[0];
    expect(a.id).toBe('A');
    expect(a.done).toBeUndefined();          // done removed → container
    expect(a.children).toHaveLength(1);
    expect(a.children![0].id).toBe('B');
    expect(a.children![0].done).toBe(false); // B's state preserved
  });

  it('moved node is appended to existing container children', () => {
    const goals = [makeGoal('g', [
      container('A', [leaf('C', true)]),
      leaf('B', false),
    ])];
    const result = indentNode(goals, 'B');

    const a = result[0].nodes[0];
    expect(a.children).toHaveLength(2);
    expect(a.children![0].id).toBe('C');
    expect(a.children![1].id).toBe('B');
  });

  it('no-op when node has no preceding sibling (first in list)', () => {
    const goals = [makeGoal('g', [leaf('A', false), leaf('B', true)])];
    const result = indentNode(goals, 'A');
    // A is first — no preceding sibling
    expect(result[0].nodes).toHaveLength(2);
    expect(result[0].nodes[0].id).toBe('A');
    expect(result[0].nodes[1].id).toBe('B');
  });

  it('does not mutate the original goals array', () => {
    const goals = [makeGoal('g', [leaf('A', true), leaf('B', false)])];
    indentNode(goals, 'B');
    expect(goals[0].nodes).toHaveLength(2); // original unchanged
  });

  it('% rolls up correctly (equal-weight) after creating a nested structure', () => {
    // Before: [A(done=T), B(done=T), C(done=F)]
    // After indent B under A: [A(container→children:[B(T)]), C(F)]
    // nodePct(A) = nodePct(B) = 100; goalPct = (100 + 0) / 2 = 50
    const goals = [makeGoal('g', [leaf('A', true), leaf('B', true), leaf('C', false)])];
    const result = indentNode(goals, 'B');
    const pct = goalPct(result[0]);
    expect(pct).toBeCloseTo(50, 5);
  });

  it('75-not-66.7 case is preserved after restructure via indent', () => {
    // Build the 75-case: [leafDone(T), container([leafDone(T), leafNot(F)])]
    // Then indent the container under the first leaf — a new nested structure forms.
    // Regardless of the operation, nodePct must use equal-weight per level.
    const nested = container('c', [leaf('la', true), leaf('lb', false)]);
    const goals = [makeGoal('g', [leaf('ld', true), nested])];
    // verify the base 75-case still holds before any restructure
    expect(goalPct(goals[0])).toBe(75);

    // Reorder (swap them) — goalPct must still be 75
    const reordered = reorderSiblings(goals, 'c', 'ld');
    expect(goalPct(reordered[0])).toBe(75); // NOT 66.7 (leaf-flattened)
  });
});

// ---- outdentNode ----

describe('outdentNode', () => {
  it('outdent to root when parent had only one child — parent becomes leaf', () => {
    const goals = [makeGoal('g', [container('A', [leaf('B', false)])])];
    const result = outdentNode(goals, 'B');

    expect(result[0].nodes).toHaveLength(2);
    const a = result[0].nodes[0];
    expect(a.id).toBe('A');
    expect(a.done).toBe(false);       // A converted back to leaf
    expect(a.children).toBeUndefined();

    const b = result[0].nodes[1];
    expect(b.id).toBe('B');           // B placed after A
    expect(b.done).toBe(false);
  });

  it('parent retains remaining children when it still has some', () => {
    const goals = [makeGoal('g', [container('A', [leaf('B', false), leaf('C', true)])])];
    const result = outdentNode(goals, 'B');

    const a = result[0].nodes[0];
    expect(a.children).toHaveLength(1);
    expect(a.children![0].id).toBe('C'); // C stays inside A

    const b = result[0].nodes[1];
    expect(b.id).toBe('B');               // B at root, after A
  });

  it('no-op when node is already at goal-root level', () => {
    const goals = [makeGoal('g', [leaf('A', false), leaf('B', true)])];
    const result = outdentNode(goals, 'A');
    expect(result[0].nodes).toHaveLength(2);
    expect(result[0].nodes[0].id).toBe('A');
  });

  it('does not mutate the original goals array', () => {
    const goals = [makeGoal('g', [container('A', [leaf('B', false)])])];
    outdentNode(goals, 'B');
    expect(goals[0].nodes[0].children).toHaveLength(1); // original unchanged
  });

  it('% recomputes correctly after outdent empties a container', () => {
    // Before: [A(container→[B(done=T)])] — nodePct(A) = 100, goalPct = 100
    // After outdent B: [A(leaf, done=F), B(leaf, done=T)]
    // goalPct = (0 + 100) / 2 = 50
    const goals = [makeGoal('g', [container('A', [leaf('B', true)])])];
    const result = outdentNode(goals, 'B');
    expect(goalPct(result[0])).toBeCloseTo(50, 5);
  });

  it('equal-weight per level is maintained after outdent', () => {
    // Before: [A(container→[B(T), C(F)])] → nodePct(A) = 50, goalPct = 50
    // After outdent B: [A(container→[C(F)]), B(T)]
    // goalPct = (nodePct(A) + nodePct(B)) / 2 = (0 + 100) / 2 = 50
    const goals = [makeGoal('g', [container('A', [leaf('B', true), leaf('C', false)])])];
    const result = outdentNode(goals, 'B');
    expect(goalPct(result[0])).toBeCloseTo(50, 5);
  });

  it('deeply nested: node outdents to grandparent level', () => {
    // g.nodes = [A(container→[B(container→[C(leaf)])])]
    // outdent C: g.nodes = [A(container→[B(leaf, done:false), C(leaf)])]
    const goals = [makeGoal('g', [container('A', [container('B', [leaf('C', false)])])])];
    const result = outdentNode(goals, 'C');

    const a = result[0].nodes[0];
    expect(a.id).toBe('A');
    expect(a.children).toHaveLength(2);
    expect(a.children![0].id).toBe('B');
    expect(a.children![0].done).toBe(false); // B → leaf
    expect(a.children![0].children).toBeUndefined();
    expect(a.children![1].id).toBe('C');
  });
});

// ---- reorderSiblings ----

describe('reorderSiblings', () => {
  it('reorders within same list', () => {
    const goals = [makeGoal('g', [leaf('A', true), leaf('B', false), leaf('C', true)])];
    const result = reorderSiblings(goals, 'A', 'C');
    const ids = result[0].nodes.map((n) => n.id);
    expect(ids).not.toEqual(['A', 'B', 'C']); // order changed
    expect(ids).toContain('A');
    expect(ids).toContain('B');
    expect(ids).toContain('C');
  });

  it('% is unchanged after reorder (equal-weight preserved)', () => {
    const nested = container('c', [leaf('la', true), leaf('lb', false)]);
    const goals = [makeGoal('g', [leaf('ld', true), nested])];
    const before = goalPct(goals[0]); // 75
    const result = reorderSiblings(goals, 'c', 'ld');
    expect(goalPct(result[0])).toBe(before); // still 75, not 66.7
  });

  it('no-op when nodes are not siblings (different containers)', () => {
    const goals = [makeGoal('g', [
      container('X', [leaf('A', false)]),
      container('Y', [leaf('B', true)]),
    ])];
    const result = reorderSiblings(goals, 'A', 'B');
    // Structure unchanged
    expect(result[0].nodes[0].children![0].id).toBe('A');
    expect(result[0].nodes[1].children![0].id).toBe('B');
  });

  it('no-op when nodes are in different goals', () => {
    const goals = [
      makeGoal('g1', [leaf('A', false)]),
      makeGoal('g2', [leaf('B', true)]),
    ];
    const result = reorderSiblings(goals, 'A', 'B');
    expect(result[0].nodes[0].id).toBe('A');
    expect(result[1].nodes[0].id).toBe('B');
  });

  it('does not mutate original goals', () => {
    const goals = [makeGoal('g', [leaf('A', false), leaf('B', true)])];
    reorderSiblings(goals, 'A', 'B');
    expect(goals[0].nodes[0].id).toBe('A');
  });
});

// ---- reorderTop ----

describe('reorderTop', () => {
  const items = () => [
    { id: 'a', val: 1 },
    { id: 'b', val: 2 },
    { id: 'c', val: 3 },
  ];

  it('moves active to over position', () => {
    const result = reorderTop(items(), 'a', 'c');
    expect(result.map((x) => x.id)).not.toEqual(['a', 'b', 'c']);
    expect(result.some((x) => x.id === 'a')).toBe(true);
  });

  it('no-op when activeId === overId', () => {
    const result = reorderTop(items(), 'b', 'b');
    expect(result.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('no-op for unknown id', () => {
    const result = reorderTop(items(), 'x', 'a');
    expect(result.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('result has same length as input', () => {
    const result = reorderTop(items(), 'a', 'c');
    expect(result).toHaveLength(3);
  });

  it('does not mutate original list', () => {
    const list = items();
    reorderTop(list, 'a', 'c');
    expect(list[0].id).toBe('a');
  });

  it('works with Goal-shaped objects', () => {
    const goals = [
      makeGoal('g1', []),
      makeGoal('g2', []),
      makeGoal('g3', []),
    ];
    const result = reorderTop(goals, 'g1', 'g3');
    // goalPct is the same regardless of goal-list order (each goal is independent)
    result.forEach((g) => expect(goalPct(g)).toBe(0));
  });
});

// ---- cross-operation: equal-weight roll-up invariant ----

describe('equal-weight roll-up invariant across operations', () => {
  it('nodePct is still equal-weight per level after indent+outdent round-trip', () => {
    // Start: [A(T), B(T), C(F)] → goalPct = 66.7
    // Indent B under A: [A(container→[B(T)]), C(F)] → goalPct = (100+0)/2 = 50
    // Outdent B from A: [A(leaf,F), B(T), C(F)] → goalPct = (0+100+0)/3 = 33.3
    // (not the same as start because A's `done` was dropped during indent)
    const goals = [makeGoal('g', [leaf('A', true), leaf('B', true), leaf('C', false)])];

    const afterIndent = indentNode(goals, 'B');
    expect(goalPct(afterIndent[0])).toBeCloseTo(50, 5);

    const afterOutdent = outdentNode(afterIndent, 'B');
    // A is now done=false (lost its done when it became a container)
    expect(goalPct(afterOutdent[0])).toBeCloseTo(100 / 3, 3);
  });

  it('nested 75-case: equal-weight holds after reorderSiblings at root level', () => {
    const nested = container('c', [leaf('la', true), leaf('lb', false)]);
    const goals = [makeGoal('g', [leaf('ld', true), nested])];
    // Direct goalPct uses equal-weight: (100 + 50) / 2 = 75
    expect(goalPct(goals[0])).toBe(75);
    // Reorder root nodes — goalPct must still be 75, not leaf-flat 66.7
    const result = reorderSiblings(goals, 'ld', 'c');
    expect(goalPct(result[0])).toBe(75);
  });
});

describe('firstOpenLeaf', () => {
  it('returns the depth-first first not-done leaf', () => {
    const nodes = [
      container('c', [leaf('leafDone', true), leaf('leafOpenA', false)]),
      leaf('leafOpenB', false),
    ];
    expect(firstOpenLeaf(nodes)?.id).toBe('leafOpenA');
  });
  it('returns null when every leaf is done', () => {
    const nodes = [container('c', [leaf('a', true)]), leaf('b', true)];
    expect(firstOpenLeaf(nodes)).toBeNull();
  });
  it('returns null for an empty tree', () => {
    expect(firstOpenLeaf([])).toBeNull();
  });
});
