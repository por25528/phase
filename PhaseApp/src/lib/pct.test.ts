import { describe, it, expect } from 'vitest';
import { nodePct, goalPct, goalPctBasis } from './pct';
import type { Goal, GoalNode } from '../db/types';
import { migrateNodeStatus } from './migrateNodeStatus';

function leaf(done: boolean): GoalNode {
  return { id: 'l', title: 'leaf', ...(done ? { status: 'done' as const } : {}) };
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
      { id: 'a', title: 'a', status: 'done' },
      { id: 'b', title: 'b', status: 'done' },
      { id: 'c', title: 'c' },
      { id: 'd', title: 'd' },
    ]);
    expect(nodePct(n)).toBe(50);
  });

  // CRITICAL: equal-weight per level, NOT flattened over all leaves
  // goal nodes = [ leafDone, container{ children:[leafDone, leafNot] } ]
  // top level: (100 + 50) / 2 = 75 (NOT 2/3 leaves = 66.7)
  it('nested container uses equal-weight per level (75, not 66.7)', () => {
    const nested = container([
      { id: 'la', title: 'la', status: 'done' },
      { id: 'lb', title: 'lb' },
    ]);
    const topLevel = goal([
      { id: 'ld', title: 'ld', status: 'done' },
      nested,
    ]);
    expect(goalPct(topLevel)).toBe(75);
  });

  it('empty children array is treated as a leaf (done?100:0)', () => {
    const n: GoalNode = { id: 'e', title: 'empty', children: [] };
    expect(nodePct(n)).toBe(0);
    const n2: GoalNode = { id: 'e2', title: 'empty done', status: 'done', children: [] };
    expect(nodePct(n2)).toBe(100);
  });
});

describe('goalPct', () => {
  it('goal with no nodes → 0', () => {
    expect(goalPct(goal([]))).toBe(0);
  });

  it('1 of 3 done → exact fraction 33.333…', () => {
    const g = goal([
      { id: 'a', title: 'a', status: 'done' },
      { id: 'b', title: 'b' },
      { id: 'c', title: 'c' },
    ]);
    const pct = goalPct(g);
    expect(pct).toBeCloseTo(33.333, 2);
    expect(Math.round(pct)).toBe(33);
  });
});

/*
 * Weighting by `estimateMin`.
 *
 * The motivating case: a project is one big leaf and several trivial ones, so
 * an equal-weight mean flatters the trivial work — and that number drives the
 * pace deficit, the board card and the rail.
 *
 * The weight is the estimate the capacity engine already requires, not a new
 * S/M/L field, so this costs the user no additional input.
 */
describe('estimate-weighted roll-up', () => {
  it('weights siblings by their estimates', () => {
    // One 6h leaf and four 20m leaves. Ticking all four trivial ones is 80m of
    // 440m — 18%, not the 80% an equal-weight mean would report.
    const g = goal([
      { id: 'big', title: 'Implement Raft', estimateMin: 360 },
      { id: 'a', title: 'a', status: 'done', estimateMin: 20 },
      { id: 'b', title: 'b', status: 'done', estimateMin: 20 },
      { id: 'c', title: 'c', status: 'done', estimateMin: 20 },
      { id: 'd', title: 'd', status: 'done', estimateMin: 20 },
    ]);
    expect(goalPct(g)).toBeCloseTo((80 / 440) * 100, 5);
    expect(goalPctBasis(g)).toBe('weighted');
  });

  it('falls back to equal weight when any sibling lacks an estimate', () => {
    // The dangerous case: without all-or-nothing, the single estimated leaf
    // would dominate the whole set.
    const g = goal([
      { id: 'big', title: 'big', estimateMin: 360 },
      { id: 'a', title: 'a', status: 'done' },
    ]);
    expect(goalPct(g)).toBe(50);
    expect(goalPctBasis(g)).toBe('equal');
  });

  it('treats an unusable estimate as missing, matching normalizeEstimate', () => {
    for (const bad of [0, -30, Number.NaN, Number.POSITIVE_INFINITY]) {
      const g = goal([
        { id: 'x', title: 'x', estimateMin: 360 },
        { id: 'y', title: 'y', status: 'done', estimateMin: bad },
      ]);
      expect(goalPct(g)).toBe(50);
      expect(goalPctBasis(g)).toBe('equal');
    }
  });

  it('does not let a sub-minute estimate zero out a completed step', () => {
    // 0.4 used to normalise to 0 — a usable weight of nothing. The done leaf
    // then contributed 100×0 to the numerator and 0 to the denominator, so a
    // half-finished project rolled up to 0% while the drawer announced
    // "weighted by estimate" beside it. Now 0.4 is not an estimate at all, so
    // the set falls back to equal weight and reports the truth.
    const g = goal([
      { id: 'a', title: 'a', status: 'done', estimateMin: 0.4 },
      { id: 'b', title: 'b', estimateMin: 60 },
    ]);
    expect(goalPct(g)).toBe(50);
    expect(goalPctBasis(g)).toBe('equal');
  });

  it('rounds a fractional estimate the same way capacity does', () => {
    // normalizeEstimate rounds, so 30.4 weighs 30 — the same number the
    // capacity readout charges for it. The two must not disagree.
    const g = goal([
      { id: 'a', title: 'a', status: 'done', estimateMin: 30.4 },
      { id: 'b', title: 'b', estimateMin: 90 },
    ]);
    expect(goalPct(g)).toBeCloseTo((30 / 120) * 100, 5);
  });

  it('gives a container the summed weight of its subtree', () => {
    // Without this, any set mixing a leaf and a container could never be
    // weighted — which is nearly every real project.
    const g = goal([
      { id: 'solo', title: 'solo', status: 'done', estimateMin: 100 },
      container([
        { id: 'c1', title: 'c1', estimateMin: 300 },
        { id: 'c2', title: 'c2', estimateMin: 100 },
      ]),
    ]);
    // Container weighs 400 and is 0% done; the solo leaf weighs 100 at 100%.
    expect(goalPct(g)).toBeCloseTo((100 / 500) * 100, 5);
    expect(goalPctBasis(g)).toBe('weighted');
  });

  it('weights inside a container independently of its siblings', () => {
    const nested = container([
      { id: 'x', title: 'x', status: 'done', estimateMin: 180 },
      { id: 'y', title: 'y', estimateMin: 20 },
    ]);
    // 180 of 200 within the container.
    expect(nodePct(nested)).toBeCloseTo(90, 5);
  });

  /*
   * The fallback is evaluated PER SIBLING SET, so an estimated subtree keeps
   * its weighting even when a cousin has none. Verified by the top level
   * falling back while the container below it does not.
   */
  it('applies the fallback per set, not globally', () => {
    const nested = container([
      { id: 'x', title: 'x', status: 'done', estimateMin: 180 },
      { id: 'y', title: 'y', estimateMin: 20 },
    ]);
    const g = goal([
      nested,
      { id: 'bare', title: 'bare' }, // no estimate → top level is equal-weight
    ]);
    // Top level: (90 + 0) / 2 = 45. The container's own 90 is still weighted.
    expect(goalPct(g)).toBeCloseTo(45, 5);
    expect(goalPctBasis(g)).toBe('equal');
  });

  it('is unchanged for a fully unestimated project', () => {
    const g = goal([
      { id: 'a', title: 'a', status: 'done' },
      { id: 'b', title: 'b' },
      { id: 'c', title: 'c' },
    ]);
    expect(goalPct(g)).toBeCloseTo(33.333, 2);
    expect(goalPctBasis(g)).toBe('equal');
  });

  it('reaches 100 when every weighted leaf is done', () => {
    const g = goal([
      { id: 'a', title: 'a', status: 'done', estimateMin: 360 },
      { id: 'b', title: 'b', status: 'done', estimateMin: 20 },
    ]);
    expect(goalPct(g)).toBe(100);
  });

  it('is 0 when no weighted leaf is done', () => {
    const g = goal([
      { id: 'a', title: 'a', estimateMin: 360 },
      { id: 'b', title: 'b', estimateMin: 20 },
    ]);
    expect(goalPct(g)).toBe(0);
  });

  it('an estimate never completes a step by itself', () => {
    // The invariant the whole progress model rests on: estimates change how
    // much a leaf is WORTH, never whether it is done.
    const g = goal([{ id: 'a', title: 'a', estimateMin: 500 }]);
    expect(goalPct(g)).toBe(0);
  });

  it('reports an equal basis for a project with no steps', () => {
    expect(goalPctBasis(goal([]))).toBe('equal');
    expect(goalPct(goal([]))).toBe(0);
  });

  it('handles a deeply nested fully-estimated tree', () => {
    const g = goal([
      container([
        container([
          { id: 'deep1', title: 'deep1', status: 'done', estimateMin: 60 },
          { id: 'deep2', title: 'deep2', estimateMin: 60 },
        ]),
        { id: 'mid', title: 'mid', status: 'done', estimateMin: 120 },
      ]),
    ]);
    // Inner container: 60 of 120 → 50%, weight 120. Outer set: (50×120 +
    // 100×120) / 240 = 75.
    expect(goalPct(g)).toBeCloseTo(75, 5);
    expect(goalPctBasis(g)).toBe('weighted');
  });
});

/**
 * The load-bearing test of the whole slice.
 *
 * The percentage is what the pace deficit, the board card and the rail all read
 * from. Replacing the field it is computed from is only safe if migrating a
 * legacy `done`-shaped row produces the SAME number as the modern `status`
 * equivalent, so assert that directly rather than trusting the mapping.
 *
 * `legacy` simulates a raw stored/imported row from before this migration —
 * `done` is off the `GoalNode` interface now, but old JSON on disk still
 * carries it, which is exactly what `migrateNodeStatus` reads via
 * `hasOwnProperty`. `modern` is the same shape expressed the current way.
 * `goalPct`/`goalPctBasis` are only ever called on already-migrated data in
 * the app, so `before` is deliberately not part of this test.
 */
describe('pct survives the status migration unchanged', () => {
  const shapes: Array<{ name: string; legacy: Goal; modern: Goal }> = [
    { name: 'flat, half done',
      legacy: { id: 'g', title: 'G', nodes: [
        { id: 'a', title: 'A', done: true } as GoalNode, { id: 'b', title: 'B', done: false } as GoalNode,
      ] },
      modern: { id: 'g', title: 'G', nodes: [
        { id: 'a', title: 'A', status: 'done' }, { id: 'b', title: 'B' },
      ] } },
    { name: 'nested, uneven',
      legacy: { id: 'g', title: 'G', nodes: [
        { id: 'p', title: 'P', children: [
          { id: 'c1', title: 'C1', done: true } as GoalNode, { id: 'c2', title: 'C2', done: false } as GoalNode,
          { id: 'c3', title: 'C3', done: false } as GoalNode,
        ] },
        { id: 'q', title: 'Q', done: true } as GoalNode,
      ] },
      modern: { id: 'g', title: 'G', nodes: [
        { id: 'p', title: 'P', children: [
          { id: 'c1', title: 'C1', status: 'done' }, { id: 'c2', title: 'C2' },
          { id: 'c3', title: 'C3' },
        ] },
        { id: 'q', title: 'Q', status: 'done' },
      ] } },
    { name: 'estimate-weighted',
      legacy: { id: 'g', title: 'G', nodes: [
        { id: 'a', title: 'A', done: true, estimateMin: 360 } as GoalNode,
        { id: 'b', title: 'B', done: false, estimateMin: 20 } as GoalNode,
      ] },
      modern: { id: 'g', title: 'G', nodes: [
        { id: 'a', title: 'A', status: 'done', estimateMin: 360 },
        { id: 'b', title: 'B', estimateMin: 20 },
      ] } },
    { name: 'partially estimated, falls back to equal weight',
      legacy: { id: 'g', title: 'G', nodes: [
        { id: 'a', title: 'A', done: true, estimateMin: 360 } as GoalNode,
        { id: 'b', title: 'B', done: false } as GoalNode,
      ] },
      modern: { id: 'g', title: 'G', nodes: [
        { id: 'a', title: 'A', status: 'done', estimateMin: 360 },
        { id: 'b', title: 'B' },
      ] } },
    { name: 'nothing done',
      legacy: { id: 'g', title: 'G', nodes: [
        { id: 'a', title: 'A', done: false } as GoalNode, { id: 'b', title: 'B', done: false } as GoalNode,
      ] },
      modern: { id: 'g', title: 'G', nodes: [
        { id: 'a', title: 'A' }, { id: 'b', title: 'B' },
      ] } },
    { name: 'everything done',
      legacy: { id: 'g', title: 'G', nodes: [
        { id: 'a', title: 'A', done: true } as GoalNode, { id: 'b', title: 'B', done: true } as GoalNode,
      ] },
      modern: { id: 'g', title: 'G', nodes: [
        { id: 'a', title: 'A', status: 'done' }, { id: 'b', title: 'B', status: 'done' },
      ] } },
    { name: 'no steps at all',
      legacy: { id: 'g', title: 'G', nodes: [] },
      modern: { id: 'g', title: 'G', nodes: [] } },
    { name: 'emptied container (children: []) carrying a legacy done',
      // `removeNode` splices a container's last child and leaves `children: []`
      // behind — that is a LEAF, per `isLeaf` in status.ts, not a container.
      // A migration that tests `children !== undefined` instead classifies it
      // as a container, drops the legacy `done: true` on the floor, and writes
      // no `status` — silently moving `goalPct` for a real user's project.
      legacy: { id: 'g', title: 'G', nodes: [
        { id: 'a', title: 'A', done: true, children: [] } as GoalNode,
        { id: 'b', title: 'B' },
      ] },
      modern: { id: 'g', title: 'G', nodes: [
        { id: 'a', title: 'A', status: 'done', children: [] },
        { id: 'b', title: 'B' },
      ] } },
  ];

  for (const { name, legacy, modern } of shapes) {
    it(`is identical for: ${name}`, () => {
      const [migrated] = migrateNodeStatus([structuredClone(legacy)]);
      expect(goalPct(migrated)).toBe(goalPct(modern));
      expect(goalPctBasis(migrated)).toBe(goalPctBasis(modern));
    });
  }
});

describe('topics', () => {
  const topics = (kids: GoalNode[]): Goal => ({
    id: 'g', title: 'Algorithms', nodes: [{ id: 'area', title: 'Topics', topics: true, children: kids }],
  });
  it('an unrated topic is 0, shaky a third, okay two thirds, solid whole', () => {
    expect(goalPct(topics([{ id: 'a', title: 'A' }]))).toBe(0);
    expect(goalPct(topics([{ id: 'a', title: 'A', confidence: 'shaky', confidenceAt: '2026-09-01' }]))).toBeCloseTo(100 / 3);
    expect(goalPct(topics([{ id: 'a', title: 'A', confidence: 'okay', confidenceAt: '2026-09-01' }]))).toBeCloseTo(200 / 3);
    expect(goalPct(topics([{ id: 'a', title: 'A', confidence: 'solid', confidenceAt: '2026-09-01' }]))).toBe(100);
  });
  it('a topic ticked done by legacy data still reads its confidence, not the tick', () => {
    expect(goalPct(topics([{ id: 'a', title: 'A', status: 'done' }]))).toBe(0);
  });
  it('estimate weighting applies to topics like any leaf', () => {
    const g = topics([
      { id: 'a', title: 'A', estimateMin: 90, confidence: 'solid', confidenceAt: '2026-09-01' },
      { id: 'b', title: 'B', estimateMin: 30 },
    ]);
    expect(goalPct(g)).toBeCloseTo(75);
  });
  it('a mixed subject averages topics and steps by the same rules', () => {
    const g: Goal = {
      id: 'g', title: 'Algorithms', nodes: [
        { id: 'area', title: 'Topics', topics: true, children: [
          { id: 'a', title: 'A', confidence: 'solid', confidenceAt: '2026-09-01' },
        ] },
        { id: 'ps', title: 'Problem set' },
      ],
    };
    expect(goalPct(g)).toBe(50);
  });
});
