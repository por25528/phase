import { describe, it, expect } from 'vitest';
import type { GoalNode } from '../db/types';
import { stepStatus, isDone, containerStatus, cycleStatus, applyStatus } from './status';

const leaf = (over: Partial<GoalNode> = {}): GoalNode => ({ id: 'n', title: 'n', ...over });

describe('stepStatus', () => {
  it('defaults an untouched leaf to todo', () => {
    expect(stepStatus(leaf())).toBe('todo');
  });

  it('reads the new field when present', () => {
    expect(stepStatus(leaf({ status: 'blocked' }))).toBe('blocked');
  });

  it('treats an explicitly stored todo as todo', () => {
    expect(stepStatus(leaf({ status: 'todo' }))).toBe('todo');
  });
});

describe('isDone', () => {
  it('is true only for done', () => {
    expect(isDone(leaf({ status: 'done' }))).toBe(true);
    expect(isDone(leaf({ status: 'doing' }))).toBe(false);
    expect(isDone(leaf({ status: 'blocked' }))).toBe(false);
    expect(isDone(leaf())).toBe(false);
  });
});

describe('containerStatus', () => {
  const group = (...kids: GoalNode[]): GoalNode => ({ id: 'g', title: 'g', children: kids });

  it('is done when every descendant leaf is done', () => {
    expect(containerStatus(group(leaf({ status: 'done' }), leaf({ status: 'done' })))).toBe('done');
  });

  it('is doing when any descendant is doing', () => {
    expect(containerStatus(group(leaf({ status: 'doing' }), leaf()))).toBe('doing');
  });

  /**
   * Strict on purpose. One blocked child among four workable ones is not a
   * blocked container — you can still work it, and dimming it would hide four
   * available rows behind one stuck one.
   */
  it('is blocked only when EVERY open descendant is blocked', () => {
    expect(containerStatus(group(leaf({ status: 'blocked' }), leaf({ status: 'done' })))).toBe('blocked');
    expect(containerStatus(group(leaf({ status: 'blocked' }), leaf()))).toBe('todo');
  });

  it('recurses through nested containers', () => {
    expect(containerStatus(group(group(leaf({ status: 'doing' }))))).toBe('doing');
  });

  it('calls an empty container todo rather than done', () => {
    expect(containerStatus(group())).toBe('todo');
  });
});

describe('cycleStatus', () => {
  // `done` is never reachable by cycling: the checkbox remains the only thing
  // that moves a number.
  it('walks todo → doing → blocked → todo', () => {
    expect(cycleStatus('todo')).toBe('doing');
    expect(cycleStatus('doing')).toBe('blocked');
    expect(cycleStatus('blocked')).toBe('todo');
  });

  it('sends a done step back to todo, never onward to doing', () => {
    expect(cycleStatus('done')).toBe('todo');
  });
});

describe('applyStatus', () => {
  it('stamps doneAt on the way into done', () => {
    const n = applyStatus(leaf(), 'done', '2026-08-07');
    expect(n.status).toBe('done');
    expect(n.doneAt).toBe('2026-08-07');
  });

  it('clears doneAt on the way out of done', () => {
    const n = applyStatus(leaf({ status: 'done', doneAt: '2026-08-01' }), 'todo', '2026-08-07');
    expect(n.status).toBeUndefined();
    expect(n.doneAt).toBeUndefined();
  });

  it('never stores todo — an absent field IS todo', () => {
    const n = applyStatus(leaf({ status: 'doing' }), 'todo', '2026-08-07');
    expect('status' in n).toBe(false);
  });

  it('carries the blocked reason, and drops it on the way out', () => {
    const blocked = applyStatus(leaf(), 'blocked', '2026-08-07', 'waiting on the grader');
    expect(blocked.blockedOn).toBe('waiting on the grader');
    const after = applyStatus(blocked, 'doing', '2026-08-07');
    expect(after.blockedOn).toBeUndefined();
  });

  it('does not mutate the node it was given', () => {
    const before = leaf({ status: 'doing' });
    applyStatus(before, 'done', '2026-08-07');
    expect(before.status).toBe('doing');
    expect(before.doneAt).toBeUndefined();
  });
});
