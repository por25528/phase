import { describe, expect, it } from 'vitest';
import type { GoalNode } from '../db/types';
import {
  visibleRowIds,
  rangeBetween,
  topLevelSelection,
  openLeavesUnder,
  allLeavesUnder,
  selectionRemovalCount,
  pruneSelection,
} from './selection';

// A realistic shape: two flat steps, a group of three, and a group nested two
// deep — the "6.1200 psets with sub-problems" case.
const TREE: GoalNode[] = [
  { id: 'a', title: 'Pset 6', status: 'done', doneAt: '2026-07-01' },
  { id: 'b', title: 'Pset 7' },
  {
    id: 'g1',
    title: 'Pset 8',
    children: [
      { id: 'g1a', title: 'Problems 1–3' },
      { id: 'g1b', title: 'Problems 4–6', status: 'done', doneAt: '2026-07-02' },
      {
        id: 'g2',
        title: 'Writeup',
        children: [
          { id: 'g2a', title: 'Draft' },
          { id: 'g2b', title: 'Proofread' },
        ],
      },
    ],
  },
  { id: 'c', title: 'Pset 9' },
];

const ALL_OPEN = new Set(['g1', 'g2']);

describe('visibleRowIds', () => {
  it('lists rows in render order when everything is expanded', () => {
    expect(visibleRowIds(TREE, ALL_OPEN)).toEqual(['a', 'b', 'g1', 'g1a', 'g1b', 'g2', 'g2a', 'g2b', 'c']);
  });

  it('counts a collapsed container as ONE row — its children are unmounted', () => {
    expect(visibleRowIds(TREE, new Set())).toEqual(['a', 'b', 'g1', 'c']);
  });

  it('stops at the collapsed level, not the whole subtree', () => {
    expect(visibleRowIds(TREE, new Set(['g1']))).toEqual(['a', 'b', 'g1', 'g1a', 'g1b', 'g2', 'c']);
  });

  it('handles an empty tree', () => {
    expect(visibleRowIds([], ALL_OPEN)).toEqual([]);
  });

  /**
   * A folded run of finished siblings is off screen for exactly the reason a
   * collapsed subtree is, so a shift-range must not reach into one. Both
   * answers come from `foldDone`, so the tree and this cannot disagree about
   * where the runs are — which is the failure mode worth a test: a range that
   * silently selects rows nobody can see.
   */
  const FOLDED: GoalNode[] = [
    { id: 'a', title: 'Pset 6', status: 'done', doneAt: '2026-07-01' },
    { id: 'b', title: 'Pset 7', status: 'done', doneAt: '2026-07-01' },
    { id: 'c', title: 'Pset 8' },
  ];

  it('drops a folded run of finished rows', () => {
    expect(visibleRowIds(FOLDED, new Set())).toEqual(['c']);
  });

  it('takes the run back once it is revealed', () => {
    expect(visibleRowIds(FOLDED, new Set(), new Set(['a']))).toEqual(['a', 'b', 'c']);
  });

  it('leaves a lone finished row on screen — one row is not a run', () => {
    expect(visibleRowIds(TREE, ALL_OPEN)).toContain('a');
    expect(visibleRowIds(TREE, ALL_OPEN)).toContain('g1b');
  });

  it('folds inside a subtree too, and only while its parent is open', () => {
    const nested: GoalNode[] = [
      { id: 'g', title: 'Group', children: [...FOLDED] },
    ];
    expect(visibleRowIds(nested, new Set(['g']))).toEqual(['g', 'c']);
    expect(visibleRowIds(nested, new Set(['g']), new Set(['a']))).toEqual(['g', 'a', 'b', 'c']);
  });

  it('does not descend into a folded container, however expanded it is', () => {
    const nested: GoalNode[] = [
      {
        id: 'g',
        title: 'Finished group',
        children: [{ id: 'x', title: 'x', status: 'done', doneAt: '2026-07-01' }],
      },
      { id: 'b', title: 'b', status: 'done', doneAt: '2026-07-01' },
      { id: 'c', title: 'c' },
    ];
    expect(visibleRowIds(nested, new Set(['g']))).toEqual(['c']);
  });
});

describe('rangeBetween', () => {
  const visible = visibleRowIds(TREE, ALL_OPEN);

  it('selects the inclusive run downward', () => {
    expect(rangeBetween(visible, 'b', 'g1b')).toEqual(['b', 'g1', 'g1a', 'g1b']);
  });

  it('works upward too — shift-click has no direction', () => {
    expect(rangeBetween(visible, 'g1b', 'b')).toEqual(['b', 'g1', 'g1a', 'g1b']);
  });

  it('is just the row when both ends are the same', () => {
    expect(rangeBetween(visible, 'b', 'b')).toEqual(['b']);
  });

  /**
   * A stale anchor — the row was deleted, or its container was collapsed —
   * must not silently select from the top of the tree.
   */
  it('returns nothing when an endpoint is off screen', () => {
    expect(rangeBetween(visible, 'gone', 'b')).toEqual([]);
    expect(rangeBetween(visibleRowIds(TREE, new Set()), 'g1a', 'b')).toEqual([]);
  });
});

describe('topLevelSelection', () => {
  it('drops ids already covered by a selected ancestor', () => {
    expect(topLevelSelection(TREE, new Set(['g1', 'g1a', 'g2b']))).toEqual(['g1']);
  });

  it('keeps siblings that cover each other in no way', () => {
    expect(topLevelSelection(TREE, new Set(['b', 'c']))).toEqual(['b', 'c']);
  });

  it('keeps a deep selection when no ancestor of it is selected', () => {
    expect(topLevelSelection(TREE, new Set(['g2a', 'b']))).toEqual(['b', 'g2a']);
  });

  it('returns nothing for an empty or unknown selection', () => {
    expect(topLevelSelection(TREE, new Set())).toEqual([]);
    expect(topLevelSelection(TREE, new Set(['nope']))).toEqual([]);
  });
});

describe('openLeavesUnder', () => {
  it('expands a selected container to its open leaves', () => {
    expect(openLeavesUnder(TREE, new Set(['g1']))).toEqual(['g1a', 'g2a', 'g2b']);
  });

  it('skips leaves that are already done', () => {
    expect(openLeavesUnder(TREE, new Set(['a', 'b']))).toEqual(['b']);
  });

  it('counts a leaf once when its container is also selected', () => {
    expect(openLeavesUnder(TREE, new Set(['g1', 'g1a', 'g2']))).toEqual(['g1a', 'g2a', 'g2b']);
  });

  it('reaches through two levels of nesting', () => {
    expect(openLeavesUnder(TREE, new Set(['g2']))).toEqual(['g2a', 'g2b']);
  });

  it('returns nothing when the selection holds only finished work', () => {
    expect(openLeavesUnder(TREE, new Set(['a']))).toEqual([]);
  });
});

describe('allLeavesUnder', () => {
  // `setNodesStatus` uses this instead of `openLeavesUnder` because a done
  // leaf moving back to 'todo' is a real, offered transition, not a no-op to
  // filter away like it is for `completeNodes`.
  it('includes an already-done leaf, unlike openLeavesUnder', () => {
    expect(allLeavesUnder(TREE, new Set(['a']))).toEqual(['a']);
  });

  it('expands a selected container to ALL its leaves, done or not', () => {
    expect(allLeavesUnder(TREE, new Set(['g1']))).toEqual(['g1a', 'g1b', 'g2a', 'g2b']);
  });

  it('counts a leaf once when its container is also selected', () => {
    expect(allLeavesUnder(TREE, new Set(['g1', 'g1a', 'g2']))).toEqual(['g1a', 'g1b', 'g2a', 'g2b']);
  });

  it('reaches through two levels of nesting', () => {
    expect(allLeavesUnder(TREE, new Set(['g2']))).toEqual(['g2a', 'g2b']);
  });
});

describe('selectionRemovalCount', () => {
  /**
   * The delete toast has to name a number the user can check against what
   * vanished — "Deleted 1 step" for a group of six is how people stop trusting
   * undo.
   */
  it('counts the whole subtree, not the selected rows', () => {
    // g1 + g1a + g1b + g2 + g2a + g2b
    expect(selectionRemovalCount(TREE, new Set(['g1']))).toBe(6);
  });

  it('does not double-count an id covered by a selected ancestor', () => {
    expect(selectionRemovalCount(TREE, new Set(['g1', 'g1a', 'g2a']))).toBe(6);
  });

  it('adds up disjoint selections', () => {
    expect(selectionRemovalCount(TREE, new Set(['b', 'c']))).toBe(2);
    expect(selectionRemovalCount(TREE, new Set(['b', 'g2']))).toBe(4);
  });

  it('is zero for an empty selection', () => {
    expect(selectionRemovalCount(TREE, new Set())).toBe(0);
  });
});

describe('pruneSelection', () => {
  it('drops ids that are no longer in the tree', () => {
    expect([...pruneSelection(TREE, new Set(['b', 'deleted']))]).toEqual(['b']);
  });

  it('returns the SAME set when nothing was lost, so React can bail out', () => {
    const ids = new Set(['b', 'c']);
    expect(pruneSelection(TREE, ids)).toBe(ids);
  });

  it('leaves an empty selection alone', () => {
    const ids = new Set<string>();
    expect(pruneSelection(TREE, ids)).toBe(ids);
  });

  it('keeps ids inside collapsed containers — collapsed is not gone', () => {
    expect([...pruneSelection(TREE, new Set(['g2b']))]).toEqual(['g2b']);
  });
});
