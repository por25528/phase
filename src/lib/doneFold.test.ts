import { describe, expect, it } from 'vitest';
import type { GoalNode } from '../db/types';
import { FOLD_NAMES_MAX, MIN_FOLD_RUN, foldDone, foldSummary, isFinished } from './doneFold';

const leaf = (id: string, extra: Partial<GoalNode> = {}): GoalNode => ({ id, title: id, ...extra });
const done = (id: string): GoalNode => leaf(id, { status: 'done', doneAt: '2026-08-16' });
const group = (id: string, children: GoalNode[]): GoalNode => ({ id, title: id, children });

/** The shape a fold produced, as a compact string, so a case reads at a glance. */
const shape = (list: GoalNode[]): string[] =>
  foldDone(list).map((item) =>
    item.kind === 'node' ? item.node.id : `[${item.run.nodes.map((n) => n.id).join('+')}]`,
  );

describe('isFinished', () => {
  it('answers a leaf with its own status', () => {
    expect(isFinished(done('a'))).toBe(true);
    expect(isFinished(leaf('a'))).toBe(false);
    expect(isFinished(leaf('a', { status: 'doing' }))).toBe(false);
  });

  /**
   * The one hard rule of the fold: it must never hide a container that still
   * has open children. It holds by construction rather than by a check,
   * because a container has no status of its own and `containerStatus` is
   * `'done'` only when every leaf beneath it is.
   */
  it('never calls a container finished while anything under it is open', () => {
    expect(isFinished(group('g', [done('a'), leaf('b')]))).toBe(false);
    expect(isFinished(group('g', [done('a'), leaf('b', { status: 'blocked' })]))).toBe(false);
    expect(isFinished(group('g', [group('h', [done('a'), leaf('b')])]))).toBe(false);
  });

  it('calls a container finished only when every leaf beneath it is', () => {
    expect(isFinished(group('g', [done('a'), done('b')]))).toBe(true);
    expect(isFinished(group('g', [group('h', [done('a')]), done('b')]))).toBe(true);
  });

  it('leaves an empty group alone — nothing finished is not the same as finished', () => {
    expect(isFinished({ id: 'g', title: 'g', children: [] })).toBe(false);
  });
});

describe('foldDone', () => {
  it('gathers a run of adjacent finished siblings', () => {
    expect(shape([done('a'), done('b'), leaf('c')])).toEqual(['[a+b]', 'c']);
  });

  it('never reorders — a run folds exactly where it sits', () => {
    expect(shape([leaf('a'), done('b'), done('c'), leaf('d')])).toEqual(['a', '[b+c]', 'd']);
  });

  it('folds each run separately rather than gathering all done work into one', () => {
    expect(shape([done('a'), done('b'), leaf('c'), done('d'), done('e')]))
      .toEqual(['[a+b]', 'c', '[d+e]']);
  });

  /**
   * A lone finished row costs one line, and a fold line costs one line — so
   * folding it saves nothing and takes away the checkbox that would un-tick
   * it. It also means ticking a task never makes it vanish under the cursor
   * unless its neighbour was already done.
   */
  it('leaves a run of one alone', () => {
    expect(MIN_FOLD_RUN).toBe(2);
    expect(shape([leaf('a'), done('b'), leaf('c')])).toEqual(['a', 'b', 'c']);
  });

  it('folds a finished container the same way it folds a leaf', () => {
    expect(shape([group('g', [done('x'), done('y')]), done('b'), leaf('c')]))
      .toEqual(['[g+b]', 'c']);
  });

  it('leaves a container with open children in the list, beside the run', () => {
    expect(shape([done('a'), group('g', [leaf('x')]), done('b'), done('c')]))
      .toEqual(['a', 'g', '[b+c]']);
  });

  it('folds a whole finished list into one item', () => {
    expect(shape([done('a'), done('b'), done('c')])).toEqual(['[a+b+c]']);
  });

  it('returns nothing for nothing', () => {
    expect(foldDone([])).toEqual([]);
  });

  it('keys a run by its first node, so opening one survives a later un-tick', () => {
    const items = foldDone([done('a'), done('b'), done('c')]);
    expect(items[0].kind === 'run' && items[0].run.key).toBe('a');
  });
});

describe('foldSummary', () => {
  it('names what the line is holding', () => {
    expect(foldSummary({ key: 'a', nodes: [leaf('One'), leaf('Two')] })).toBe('One, Two');
  });

  it('says how many more rather than running off the edge', () => {
    const nodes = ['One', 'Two', 'Three', 'Four', 'Five'].map((t) => leaf(t));
    expect(FOLD_NAMES_MAX).toBe(3);
    expect(foldSummary({ key: 'One', nodes })).toBe('One, Two, Three +2 more');
  });
});
