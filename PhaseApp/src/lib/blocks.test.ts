import { describe, expect, it } from 'vitest';
import type { GoalNode } from '../db/types';
import {
  addBlock,
  blocksOf,
  blocksOn,
  clearBlocks,
  firstBlock,
  isPlaced,
  makeBlock,
  planVsEstimate,
  plannedMinutes,
  removeBlock,
  replaceBlock,
  setOnlyBlock,
  sortedBlocks,
} from './blocks';

const node = (over: Partial<GoalNode> = {}): GoalNode => ({ id: 'n', title: 'Implement parser', ...over });

describe('reading sittings', () => {
  it('treats a node with no blocks as unplaced, without a null check for callers', () => {
    expect(blocksOf(node())).toEqual([]);
    expect(isPlaced(node())).toBe(false);
    expect(firstBlock(node())).toBeUndefined();
  });

  it('orders sittings by day, then by hour', () => {
    const n = node({ blocks: [
      makeBlock('2026-08-14', 540, 60),
      makeBlock('2026-08-12', 900, 60),
      makeBlock('2026-08-12', 540, 60),
    ] });
    expect(sortedBlocks(n).map((b) => `${b.date} ${b.startMin}`))
      .toEqual(['2026-08-12 540', '2026-08-12 900', '2026-08-14 540']);
    expect(firstBlock(n)?.startMin).toBe(540);
  });

  it('picks out one day’s sittings, of which there may be several', () => {
    const n = node({ blocks: [
      makeBlock('2026-08-12', 540, 60),
      makeBlock('2026-08-12', 900, 60),
      makeBlock('2026-08-14', 540, 60),
    ] });
    expect(blocksOn(n, '2026-08-12')).toHaveLength(2);
  });

  /**
   * The figure that only exists because a sitting owns its own length: four
   * hours of task, sat as two hours and two hours.
   */
  it('adds up what has been set aside across every sitting', () => {
    const n = node({ blocks: [makeBlock('2026-08-12', 540, 120), makeBlock('2026-08-14', 540, 120)] });
    expect(plannedMinutes(n)).toBe(240);
  });
});

describe('planVsEstimate', () => {
  it('states the two numbers when both exist', () => {
    const n = node({ estimateMin: 180, blocks: [makeBlock('2026-08-12', 540, 120)] });
    expect(planVsEstimate(n)).toEqual({ planned: 120, estimate: 180 });
  });

  /**
   * Nothing to compare is not a discrepancy of zero. An unestimated task with
   * three sittings has no target to have missed, and saying "0" about it would
   * be inventing the very number `unestimated` exists to refuse.
   */
  it('says nothing when there is no estimate, or nothing placed', () => {
    expect(planVsEstimate(node({ blocks: [makeBlock('2026-08-12', 540, 60)] }))).toBeNull();
    expect(planVsEstimate(node({ estimateMin: 60 }))).toBeNull();
  });

  it('treats an unusable estimate as no estimate, like every other reader', () => {
    expect(planVsEstimate(node({ estimateMin: 0.4, blocks: [makeBlock('2026-08-12', 540, 60)] }))).toBeNull();
  });
});

describe('writing sittings', () => {
  it('adds one beside the others', () => {
    const n = node({ blocks: [makeBlock('2026-08-12', 540, 60)] });
    addBlock(n, makeBlock('2026-08-14', 540, 60));
    expect(n.blocks).toHaveLength(2);
  });

  it('replaces every sitting with one — the "put it here" write', () => {
    const n = node({ blocks: [makeBlock('2026-08-12', 540, 60), makeBlock('2026-08-14', 540, 60)] });
    setOnlyBlock(n, makeBlock('2026-08-13', 600, 90));
    expect(n.blocks).toEqual([expect.objectContaining({ date: '2026-08-13', minutes: 90 })]);
  });

  it('moves one sitting without touching its siblings', () => {
    const a = makeBlock('2026-08-12', 540, 60);
    const b = makeBlock('2026-08-14', 540, 60);
    const n = node({ blocks: [a, b] });

    replaceBlock(n, a.id, { date: '2026-08-13', startMin: 900 });

    expect(n.blocks).toEqual([
      expect.objectContaining({ id: a.id, date: '2026-08-13', startMin: 900, minutes: 60 }),
      b,
    ]);
  });

  /**
   * Absent, never `[]`. Presence IS the "is this placed" test, and an empty
   * array is the same legacy-leaf ambiguity `children` already suffers — a node
   * whose last sitting was removed must be indistinguishable from one that
   * never had any.
   */
  it('removes the array entirely when the last sitting goes', () => {
    const a = makeBlock('2026-08-12', 540, 60);
    const n = node({ blocks: [a] });

    removeBlock(n, a.id);

    expect('blocks' in n).toBe(false);
    expect(isPlaced(n)).toBe(false);
  });

  it('keeps the array while any sitting remains', () => {
    const a = makeBlock('2026-08-12', 540, 60);
    const n = node({ blocks: [a, makeBlock('2026-08-14', 540, 60)] });
    removeBlock(n, a.id);
    expect(n.blocks).toHaveLength(1);
  });

  it('clears the lot', () => {
    const n = node({ blocks: [makeBlock('2026-08-12', 540, 60)] });
    clearBlocks(n);
    expect('blocks' in n).toBe(false);
  });

  it('gives every sitting its own id', () => {
    const ids = [makeBlock('2026-08-12', 540, 60), makeBlock('2026-08-12', 540, 60)].map((b) => b.id);
    expect(new Set(ids).size).toBe(2);
  });
});
