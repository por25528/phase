import { describe, expect, it } from 'vitest';
import { revealDomId, weekForReveal, groupKeyContaining, type RevealTarget } from './reveal';
import { LOOSE_GROUP_KEY, type BacklogGroup } from './backlog';
import type { Task } from '../db/types';

function task(id: string, date?: string, startMin?: number): Task {
  return { id, title: id, done: false, goalId: null, ...(date ? { date } : {}), ...(startMin !== undefined ? { startMin } : {}) };
}

function target(kind: 'task' | 'habit', id: string): RevealTarget {
  return { kind, id, nonce: 1 };
}

function group(goalId: string | null, taskIds: string[]): BacklogGroup {
  return {
    goalId,
    goalTitle: goalId ?? 'Loose tasks',
    pct: 0,
    items: taskIds.map((id) => ({ kind: 'task' as const, id, goalId, title: id })),
  };
}

describe('revealDomId', () => {
  it('is stable and distinguishes kinds sharing an id', () => {
    expect(revealDomId('task', 'x1')).toBe('plan-row-task-x1');
    expect(revealDomId('habit', 'x1')).not.toBe(revealDomId('task', 'x1'));
    expect(revealDomId('step', 'x1')).not.toBe(revealDomId('task', 'x1'));
  });
});

describe('weekForReveal', () => {
  const current = '2026-07-27'; // a Monday

  it('jumps to the week of a task scheduled on the grid', () => {
    const t = task('t1', '2026-08-12', 540);
    expect(weekForReveal(target('task', 't1'), [t], current)).toBe('2026-08-10');
  });

  it('jumps for a dated task with no start minute — it is in THAT week’s backlog', () => {
    const t = task('t1', '2026-08-12');
    expect(weekForReveal(target('task', 't1'), [t], current)).toBe('2026-08-10');
  });

  it('stays put for a dateless task — it is in the current week’s backlog', () => {
    expect(weekForReveal(target('task', 't1'), [task('t1')], current)).toBe(current);
  });

  it('stays put for a task that no longer exists', () => {
    expect(weekForReveal(target('task', 'gone'), [task('t1', '2026-08-12')], current)).toBe(current);
  });

  it('stays put for a habit — habits are not week-scoped', () => {
    expect(weekForReveal(target('habit', 'h1'), [task('h1', '2026-08-12')], current)).toBe(current);
  });

  it('resolves a task dated on a Sunday to that week’s Monday, not the next', () => {
    const t = task('t1', '2026-08-16'); // Sunday
    expect(weekForReveal(target('task', 't1'), [t], current)).toBe('2026-08-10');
  });
});

describe('groupKeyContaining', () => {
  const groups = [group('g1', ['a', 'b']), group(null, ['c'])];

  it('finds the project group holding the task', () => {
    expect(groupKeyContaining(groups, target('task', 'b'))).toBe('g1');
  });

  it('maps the project-less bucket to the loose key', () => {
    expect(groupKeyContaining(groups, target('task', 'c'))).toBe(LOOSE_GROUP_KEY);
  });

  it('returns null when the task is not in the rail at all', () => {
    expect(groupKeyContaining(groups, target('task', 'zzz'))).toBeNull();
  });

  it('returns null for a habit — habits never live in the backlog', () => {
    expect(groupKeyContaining(groups, target('habit', 'b'))).toBeNull();
  });

  it('searches items, not the capped `shown` slice — the cap is what it exists to defeat', () => {
    const big = group('g1', ['i0', 'i1', 'i2', 'i3', 'i4', 'i5']);
    expect(groupKeyContaining([big], target('task', 'i5'))).toBe('g1');
  });
});
