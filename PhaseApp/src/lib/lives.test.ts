import { describe, expect, it } from 'vitest';
import type { Goal, Life } from '../db/types';
import {
  MAX_LIVES, canAddLife, lifeOf, nextLifeOrder, sanitizeBackupLives, sortedLives,
} from './lives';

const life = (id: string, order: number): Life => ({ id, title: id.toUpperCase(), order });
const goal = (id: string, lifeId?: string): Goal => ({ id, title: id, nodes: [], ...(lifeId ? { lifeId } : {}) });

describe('canAddLife', () => {
  it('allows up to three and refuses the fourth', () => {
    expect(canAddLife([])).toBe(true);
    expect(canAddLife([life('a', 0), life('b', 1)])).toBe(true);
    expect(canAddLife([life('a', 0), life('b', 1), life('c', 2)])).toBe(false);
    expect(MAX_LIVES).toBe(3);
  });
});

describe('nextLifeOrder', () => {
  it('is 0 for the first life and one past the highest after that', () => {
    expect(nextLifeOrder([])).toBe(0);
    expect(nextLifeOrder([life('a', 0), life('b', 4)])).toBe(5);
  });
});

describe('sortedLives', () => {
  it('orders by `order` without mutating the input', () => {
    const input = [life('b', 2), life('a', 1)];
    expect(sortedLives(input).map((l) => l.id)).toEqual(['a', 'b']);
    expect(input.map((l) => l.id)).toEqual(['b', 'a']);
  });
});

describe('lifeOf', () => {
  it('resolves an assigned goal, and returns null for unassigned', () => {
    const lives = [life('a', 0)];
    expect(lifeOf(goal('g', 'a'), lives)?.id).toBe('a');
    expect(lifeOf(goal('g'), lives)).toBeNull();
  });

  // A life can be deleted without rewriting its goals. The dangling id is
  // inert, exactly as a Session pointing at a deleted node is inert.
  it('returns null for a goal pointing at a life that no longer exists', () => {
    expect(lifeOf(goal('g', 'gone'), [life('a', 0)])).toBeNull();
  });
});

describe('sanitizeBackupLives', () => {
  it('returns an empty list for anything that is not an array', () => {
    expect(sanitizeBackupLives(undefined)).toEqual([]);
    expect(sanitizeBackupLives(null)).toEqual([]);
    expect(sanitizeBackupLives('MIT')).toEqual([]);
  });

  it('drops malformed rows and de-duplicates ids', () => {
    const out = sanitizeBackupLives([
      { id: 'a', title: 'MIT', order: 0 },
      { id: 'a', title: 'Duplicate', order: 1 },
      { id: '', title: 'Blank id', order: 2 },
      { title: 'No id', order: 3 },
      { id: 'b', title: 42, order: 4 },
      null,
      { id: 'c', title: 'Startup', order: 5 },
    ]);

    expect(out).toEqual([
      { id: 'a', title: 'MIT', order: 0 },
      { id: 'c', title: 'Startup', order: 5 },
    ]);
  });

  it('substitutes a positional order when the stored one is not a finite number', () => {
    expect(sanitizeBackupLives([{ id: 'a', title: 'MIT', order: 'first' }])).toEqual([
      { id: 'a', title: 'MIT', order: 0 },
    ]);
  });

  // A backup written by a future build with a higher cap must not smuggle a
  // fourth life past the constraint this build enforces everywhere else.
  it('caps at MAX_LIVES', () => {
    const out = sanitizeBackupLives(
      ['a', 'b', 'c', 'd'].map((id, i) => ({ id, title: id, order: i })),
    );
    expect(out.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });
});
