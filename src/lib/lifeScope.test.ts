import { describe, expect, it } from 'vitest';
import type { Goal, Life } from '../db/types';
import {
  goalsInScope, lifeTabs, nowLimit, resolveScope, withScopeLife,
} from './lifeScope';

const life = (id: string, order: number): Life => ({ id, title: id.toUpperCase(), order });
const goal = (id: string, lifeId?: string): Goal => ({
  id, title: id, nodes: [], ...(lifeId ? { lifeId } : {}),
});
const done = (id: string, lifeId?: string): Goal => ({ ...goal(id, lifeId), completedAt: '2026-08-01' });

describe('resolveScope', () => {
  it('keeps all, unassigned and a live life id', () => {
    const lives = [life('a', 0)];
    expect(resolveScope('all', lives)).toBe('all');
    expect(resolveScope('unassigned', lives)).toBe('unassigned');
    expect(resolveScope('a', lives)).toBe('a');
  });

  it('falls back to all when the scope names a deleted life', () => {
    expect(resolveScope('gone', [life('a', 0)])).toBe('all');
    expect(resolveScope('a', [])).toBe('all');
  });
});

describe('lifeTabs', () => {
  it('is empty when no life has been named', () => {
    expect(lifeTabs([], [goal('g')])).toEqual([]);
  });

  it('leads with All, then lives in order', () => {
    const lives = [life('b', 2), life('a', 1)];
    expect(lifeTabs(lives, [goal('g', 'a')]).map((t) => t.scope)).toEqual(['all', 'a', 'b']);
  });

  it('keeps a named life that holds nothing', () => {
    const tabs = lifeTabs([life('a', 0), life('b', 1)], [goal('g', 'a')]);
    expect(tabs.map((t) => t.scope)).toEqual(['all', 'a', 'b']);
  });

  it('adds Unassigned only when a live goal is unassigned', () => {
    const lives = [life('a', 0)];
    expect(lifeTabs(lives, [goal('g', 'a')]).map((t) => t.scope)).toEqual(['all', 'a']);
    expect(lifeTabs(lives, [goal('g', 'a'), goal('loose')]).map((t) => t.scope))
      .toEqual(['all', 'a', 'unassigned']);
  });

  it('treats a dangling lifeId as unassigned, and ignores completed goals', () => {
    const lives = [life('a', 0)];
    expect(lifeTabs(lives, [goal('g', 'a'), goal('x', 'gone')]).map((t) => t.scope))
      .toEqual(['all', 'a', 'unassigned']);
    expect(lifeTabs(lives, [goal('g', 'a'), done('old')]).map((t) => t.scope))
      .toEqual(['all', 'a']);
  });

  it('labels All and Unassigned, and uses the life title otherwise', () => {
    const tabs = lifeTabs([life('a', 0)], [goal('g', 'a'), goal('loose')]);
    expect(tabs.map((t) => t.label)).toEqual(['All', 'A', 'Unassigned']);
  });
});

describe('goalsInScope', () => {
  const lives = [life('a', 0), life('b', 1)];
  const goals = [goal('g1', 'a'), goal('g2', 'b'), goal('g3'), goal('g4', 'gone')];

  it('returns everything for all', () => {
    expect(goalsInScope(goals, 'all', lives)).toBe(goals);
  });

  it('returns one life, and never a dangling member', () => {
    expect(goalsInScope(goals, 'a', lives).map((g) => g.id)).toEqual(['g1']);
  });

  it('counts a dangling lifeId as unassigned', () => {
    expect(goalsInScope(goals, 'unassigned', lives).map((g) => g.id)).toEqual(['g3', 'g4']);
  });
});

describe('nowLimit', () => {
  const tabsFor = (n: number): { scope: string; label: string }[] =>
    [{ scope: 'all', label: 'All' }, ...Array.from({ length: n }, (_, i) => ({ scope: `l${i}`, label: `L${i}` }))];

  it('is three for any single tab', () => {
    expect(nowLimit('a', tabsFor(2))).toBe(3);
    expect(nowLimit('unassigned', tabsFor(2))).toBe(3);
  });

  it('sums the caps of the tabs beside All', () => {
    expect(nowLimit('all', tabsFor(2))).toBe(6);
    expect(nowLimit('all', tabsFor(3))).toBe(9);
  });

  it('clamps to three when there are no tabs at all', () => {
    expect(nowLimit('all', [])).toBe(3);
  });
});

describe('withScopeLife', () => {
  it('stamps the scoped life onto a new goal', () => {
    expect(withScopeLife(goal('g'), 'a').lifeId).toBe('a');
  });

  it('leaves a goal unassigned under all and unassigned', () => {
    expect(withScopeLife(goal('g'), 'all').lifeId).toBeUndefined();
    expect(withScopeLife(goal('g'), 'unassigned').lifeId).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const g = goal('g');
    withScopeLife(g, 'a');
    expect(g.lifeId).toBeUndefined();
  });
});
