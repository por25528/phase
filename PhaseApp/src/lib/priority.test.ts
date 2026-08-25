import { describe, it, expect } from 'vitest';
import { byPriority } from './priority';
import type { Goal } from '../db/types';

// Minimal goal factory — only the fields byPriority reads matter here.
function goal(id: string, column?: number): Goal {
  return { id, title: id, start: '2026-01-01', deadline: '2026-12-31', nodes: [], column };
}

describe('byPriority', () => {
  it('orders goals by column ascending (0 = highest priority, first)', () => {
    const ordered = byPriority([goal('c', 2), goal('a', 0), goal('b', 1)]);
    expect(ordered.map((g) => g.id)).toEqual(['a', 'b', 'c']);
  });

  it('is stable — goals in the same column keep their existing order', () => {
    const ordered = byPriority([goal('a', 1), goal('b', 0), goal('c', 1), goal('d', 0)]);
    expect(ordered.map((g) => g.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('treats a missing column as 0 (highest priority)', () => {
    const ordered = byPriority([goal('a', 1), goal('b'), goal('c', 0)]);
    expect(ordered.map((g) => g.id)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [goal('a', 2), goal('b', 0)];
    byPriority(input);
    expect(input.map((g) => g.id)).toEqual(['a', 'b']);
  });
});
