import { describe, it, expect } from 'vitest';
import { nodePct, goalPct, goalPctBasis } from './pct';
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
      { id: 'big', title: 'Implement Raft', done: false, estimateMin: 360 },
      { id: 'a', title: 'a', done: true, estimateMin: 20 },
      { id: 'b', title: 'b', done: true, estimateMin: 20 },
      { id: 'c', title: 'c', done: true, estimateMin: 20 },
      { id: 'd', title: 'd', done: true, estimateMin: 20 },
    ]);
    expect(goalPct(g)).toBeCloseTo((80 / 440) * 100, 5);
    expect(goalPctBasis(g)).toBe('weighted');
  });

  it('falls back to equal weight when any sibling lacks an estimate', () => {
    // The dangerous case: without all-or-nothing, the single estimated leaf
    // would dominate the whole set.
    const g = goal([
      { id: 'big', title: 'big', done: false, estimateMin: 360 },
      { id: 'a', title: 'a', done: true },
    ]);
    expect(goalPct(g)).toBe(50);
    expect(goalPctBasis(g)).toBe('equal');
  });

  it('treats an unusable estimate as missing, matching normalizeEstimate', () => {
    for (const bad of [0, -30, Number.NaN, Number.POSITIVE_INFINITY]) {
      const g = goal([
        { id: 'x', title: 'x', done: false, estimateMin: 360 },
        { id: 'y', title: 'y', done: true, estimateMin: bad },
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
      { id: 'a', title: 'a', done: true, estimateMin: 0.4 },
      { id: 'b', title: 'b', done: false, estimateMin: 60 },
    ]);
    expect(goalPct(g)).toBe(50);
    expect(goalPctBasis(g)).toBe('equal');
  });

  it('rounds a fractional estimate the same way capacity does', () => {
    // normalizeEstimate rounds, so 30.4 weighs 30 — the same number the
    // capacity readout charges for it. The two must not disagree.
    const g = goal([
      { id: 'a', title: 'a', done: true, estimateMin: 30.4 },
      { id: 'b', title: 'b', done: false, estimateMin: 90 },
    ]);
    expect(goalPct(g)).toBeCloseTo((30 / 120) * 100, 5);
  });

  it('gives a container the summed weight of its subtree', () => {
    // Without this, any set mixing a leaf and a container could never be
    // weighted — which is nearly every real project.
    const g = goal([
      { id: 'solo', title: 'solo', done: true, estimateMin: 100 },
      container([
        { id: 'c1', title: 'c1', done: false, estimateMin: 300 },
        { id: 'c2', title: 'c2', done: false, estimateMin: 100 },
      ]),
    ]);
    // Container weighs 400 and is 0% done; the solo leaf weighs 100 at 100%.
    expect(goalPct(g)).toBeCloseTo((100 / 500) * 100, 5);
    expect(goalPctBasis(g)).toBe('weighted');
  });

  it('weights inside a container independently of its siblings', () => {
    const nested = container([
      { id: 'x', title: 'x', done: true, estimateMin: 180 },
      { id: 'y', title: 'y', done: false, estimateMin: 20 },
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
      { id: 'x', title: 'x', done: true, estimateMin: 180 },
      { id: 'y', title: 'y', done: false, estimateMin: 20 },
    ]);
    const g = goal([
      nested,
      { id: 'bare', title: 'bare', done: false }, // no estimate → top level is equal-weight
    ]);
    // Top level: (90 + 0) / 2 = 45. The container's own 90 is still weighted.
    expect(goalPct(g)).toBeCloseTo(45, 5);
    expect(goalPctBasis(g)).toBe('equal');
  });

  it('is unchanged for a fully unestimated project', () => {
    const g = goal([
      { id: 'a', title: 'a', done: true },
      { id: 'b', title: 'b', done: false },
      { id: 'c', title: 'c', done: false },
    ]);
    expect(goalPct(g)).toBeCloseTo(33.333, 2);
    expect(goalPctBasis(g)).toBe('equal');
  });

  it('reaches 100 when every weighted leaf is done', () => {
    const g = goal([
      { id: 'a', title: 'a', done: true, estimateMin: 360 },
      { id: 'b', title: 'b', done: true, estimateMin: 20 },
    ]);
    expect(goalPct(g)).toBe(100);
  });

  it('is 0 when no weighted leaf is done', () => {
    const g = goal([
      { id: 'a', title: 'a', done: false, estimateMin: 360 },
      { id: 'b', title: 'b', done: false, estimateMin: 20 },
    ]);
    expect(goalPct(g)).toBe(0);
  });

  it('an estimate never completes a step by itself', () => {
    // The invariant the whole progress model rests on: estimates change how
    // much a leaf is WORTH, never whether it is done.
    const g = goal([{ id: 'a', title: 'a', done: false, estimateMin: 500 }]);
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
          { id: 'deep1', title: 'deep1', done: true, estimateMin: 60 },
          { id: 'deep2', title: 'deep2', done: false, estimateMin: 60 },
        ]),
        { id: 'mid', title: 'mid', done: true, estimateMin: 120 },
      ]),
    ]);
    // Inner container: 60 of 120 → 50%, weight 120. Outer set: (50×120 +
    // 100×120) / 240 = 75.
    expect(goalPct(g)).toBeCloseTo(75, 5);
    expect(goalPctBasis(g)).toBe('weighted');
  });
});
