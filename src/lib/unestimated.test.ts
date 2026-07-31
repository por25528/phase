import { describe, it, expect } from 'vitest';
import { unestimatedCommitments } from './unestimated';
import { workloadOf } from './capacity';
import type { PlannedLeaf } from './plan';
import type { Task } from '../db/types';

const leaf = (over: Partial<PlannedLeaf> = {}): PlannedLeaf => ({
  goalId: 'g1',
  goalTitle: '6.5840',
  nodeId: 'n1',
  title: 'A step',
  done: false,
  plannedWeek: '2026-07-27',
  ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'A task',
  done: false,
  goalId: null,
  ...over,
});

describe('unestimatedCommitments', () => {
  it('lists unfinished work carrying no estimate', () => {
    const items = unestimatedCommitments([leaf()], [task()]);
    expect(items.map((i) => i.id)).toEqual(['n1', 't1']);
  });

  it('excludes anything already estimated', () => {
    const items = unestimatedCommitments(
      [leaf({ estimateMin: 45 })],
      [task({ estimateMin: 30 })],
    );
    expect(items).toEqual([]);
  });

  it('excludes done work, which capacity does not charge for either', () => {
    const items = unestimatedCommitments(
      [leaf({ done: true })],
      [task({ done: true })],
    );
    expect(items).toEqual([]);
  });

  it('treats an unusable estimate as unestimated', () => {
    // `normalizeEstimate` rejects 0, negatives, NaN and Infinity. Anything it
    // rejects is not a price, so capacity counts it as unestimated and this
    // list has to agree.
    const items = unestimatedCommitments(
      [
        leaf({ nodeId: 'zero', estimateMin: 0 }),
        leaf({ nodeId: 'neg', estimateMin: -30 }),
        leaf({ nodeId: 'nan', estimateMin: Number.NaN }),
        leaf({ nodeId: 'inf', estimateMin: Number.POSITIVE_INFINITY }),
      ],
      [],
    );
    expect(items.map((i) => i.id)).toEqual(['zero', 'neg', 'nan', 'inf']);
  });

  it('marks whether the item is already on the grid', () => {
    const items = unestimatedCommitments(
      [
        leaf({ nodeId: 'placed', plannedDay: '2026-07-28', plannedStartMin: 540 }),
        leaf({ nodeId: 'dayOnly', plannedDay: '2026-07-28' }),
        leaf({ nodeId: 'anyday' }),
      ],
      [
        task({ id: 'tPlaced', date: '2026-07-28', startMin: 600 }),
        task({ id: 'tDated', date: '2026-07-28' }),
      ],
    );
    expect(items.map((i) => [i.id, i.placed])).toEqual([
      ['placed', true],
      // A day without a start minute is NOT on the grid — the same predicate
      // `isPlacedLeaf` and `backlogGroups` partition on.
      ['dayOnly', false],
      ['anyday', false],
      ['tPlaced', true],
      ['tDated', false],
    ]);
  });

  it('resolves a task’s project title when it has one', () => {
    const items = unestimatedCommitments(
      [],
      [task({ goalId: 'g1' })],
      new Map([['g1', '6.5840']]),
    );
    expect(items[0].goalTitle).toBe('6.5840');
  });

  it('leaves a loose task without a project title', () => {
    const items = unestimatedCommitments([], [task({ goalId: null })], new Map());
    expect(items[0].goalTitle).toBeUndefined();
  });

  /*
   * The invariant that matters: this list is rendered beside the count, and the
   * count comes from `workloadOf`. A header reading "4 unestimated" that opens
   * a list of three is worse than no list. Assert the two against each other
   * over a mixed set rather than trusting that both call `normalizeEstimate`.
   */
  it('has exactly the length capacity reports', () => {
    const leaves = [
      leaf({ nodeId: 'a' }),
      leaf({ nodeId: 'b', estimateMin: 60 }),
      leaf({ nodeId: 'c', done: true }),
      leaf({ nodeId: 'd', estimateMin: 0 }),
      leaf({ nodeId: 'e', done: true, estimateMin: 30 }),
      leaf({ nodeId: 'f', plannedDay: '2026-07-28', plannedStartMin: 540 }),
    ];
    const tasks = [
      task({ id: 't1' }),
      task({ id: 't2', estimateMin: 25 }),
      task({ id: 't3', done: true }),
    ];

    const { unestimated } = workloadOf(leaves, tasks);
    expect(unestimatedCommitments(leaves, tasks)).toHaveLength(unestimated);
  });

  it('returns nothing for an empty week', () => {
    expect(unestimatedCommitments([], [])).toEqual([]);
  });
});
