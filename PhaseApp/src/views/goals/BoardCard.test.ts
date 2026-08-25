import { describe, expect, it } from 'vitest';
import type { Goal } from '../../db/types';
import { storedDateRangeLabel } from './BoardCard';

function goal(over: Partial<Goal>): Goal {
  return {
    id: 'g',
    title: 'Project',
    nodes: [],
    ...over,
  };
}

describe('storedDateRangeLabel', () => {
  it('formats valid complete and partial legacy date ranges', () => {
    expect(storedDateRangeLabel(goal({
      start: '2026-07-01',
      deadline: '2026-12-31',
    }))).toBe('Jul 1 → Dec 31');
    expect(storedDateRangeLabel(goal({ start: '2026-07-01' }))).toBe('Starts Jul 1');
    expect(storedDateRangeLabel(goal({ deadline: '2026-12-31' }))).toBe('Due Dec 31');
  });

  it('never formats invalid legacy date values', () => {
    expect(storedDateRangeLabel(goal({
      start: '2026-02-30',
      deadline: '2026-12-31',
    }))).toBe('Invalid stored date');
    expect(storedDateRangeLabel(goal({ deadline: 'not-a-date' }))).toBe('Invalid stored date');
  });
});
