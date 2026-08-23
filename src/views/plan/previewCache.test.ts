import { describe, expect, it, vi } from 'vitest';
import { SLOT_GRANULARITY_MIN } from '../../lib/slot';
import { bucketAim, makePreviewCache, type PreviewInputs } from './previewCache';

/**
 * The cache exists to stop a full `spansOn` walk of every goal and every task
 * running on each of the hundreds of move events one drag emits. So every test
 * here counts CALLS, not slots: a memo that returns the right answer by doing
 * the work again has fixed nothing.
 */
const GOALS: readonly unknown[] = [{ id: 'g1' }];
const TASKS: readonly unknown[] = [{ id: 't1' }];

function inputs(over: Partial<PreviewInputs> = {}): PreviewInputs {
  return {
    goals: GOALS,
    tasks: TASKS,
    allDayBlocks: true,
    date: '2026-08-25',
    aimMin: 600,
    itemId: 'n1',
    ...over,
  };
}

const SLOT = { startMin: 600, durationMin: 90 };

describe('bucketAim', () => {
  it('is the same rounding `resolveSlot` applies before it searches', () => {
    // Not a second opinion about where the block lands — the raw aim is still
    // what reaches the store. This only decides whether the store is asked.
    expect(bucketAim(602)).toBe(600);
    expect(bucketAim(598)).toBe(600);
    expect(bucketAim(603)).toBe(605);
    expect(SLOT_GRANULARITY_MIN).toBe(5);
  });
});

describe('makePreviewCache', () => {
  it('computes once for a repeated input', () => {
    const cache = makePreviewCache();
    const compute = vi.fn(() => SLOT);
    expect(cache.read(inputs(), compute)).toBe(SLOT);
    expect(cache.read(inputs(), compute)).toBe(SLOT);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('computes once for every aim inside one 5-minute bucket', () => {
    // The grid is 1px per minute, so a slow drag emits roughly one event per
    // minute crossed. Four of every five of them cannot change the answer.
    const cache = makePreviewCache();
    const compute = vi.fn(() => SLOT);
    for (const aimMin of [598, 599, 600, 601, 602]) cache.read(inputs({ aimMin }), compute);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('recomputes when the aim crosses into the next bucket', () => {
    const cache = makePreviewCache();
    const compute = vi.fn(() => SLOT);
    cache.read(inputs({ aimMin: 602 }), compute);
    cache.read(inputs({ aimMin: 603 }), compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('caches a null — a day booked solid must not be re-walked either', () => {
    const cache = makePreviewCache();
    const compute = vi.fn((): null => null);
    expect(cache.read(inputs(), compute)).toBeNull();
    expect(cache.read(inputs(), compute)).toBeNull();
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('recomputes when the drag crosses into another day', () => {
    const cache = makePreviewCache();
    const compute = vi.fn(() => SLOT);
    cache.read(inputs(), compute);
    cache.read(inputs({ date: '2026-08-26' }), compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('recomputes for a different item, and for a different sitting of one item', () => {
    const cache = makePreviewCache();
    const compute = vi.fn(() => SLOT);
    cache.read(inputs(), compute);
    cache.read(inputs({ itemId: 'n2' }), compute);
    // `blockId` picks which bar `vacating` excludes, so two sittings of the
    // same task resolve differently at the same aim.
    cache.read(inputs({ itemId: 'n2', blockId: 'b1' }), compute);
    cache.read(inputs({ itemId: 'n2', blockId: 'b2' }), compute);
    expect(compute).toHaveBeenCalledTimes(4);
  });

  it('recomputes when the world is written to mid-drag', () => {
    // The agent socket can schedule something while a block is in the air. A
    // cache keyed on the drag alone would draw the outline against occupancy
    // that no longer exists — honest invalidation is the price of the memo.
    const cache = makePreviewCache();
    const compute = vi.fn(() => SLOT);
    cache.read(inputs(), compute);
    cache.read(inputs({ goals: [{ id: 'g1' }] }), compute);
    cache.read(inputs({ goals: [{ id: 'g1' }], tasks: [{ id: 't1' }] }), compute);
    cache.read(inputs({ goals: [{ id: 'g1' }], tasks: [{ id: 't1' }], allDayBlocks: false }), compute);
    expect(compute).toHaveBeenCalledTimes(4);
  });

  it('forgets on clear, so nothing survives into the next drag', () => {
    const cache = makePreviewCache();
    const compute = vi.fn(() => SLOT);
    cache.read(inputs(), compute);
    cache.clear();
    cache.read(inputs(), compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
