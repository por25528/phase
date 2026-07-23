import { describe, expect, it } from 'vitest';
import type { GoalWithSpan } from '../../lib/schedule';
import { canEditProjectSpan } from './GoalRow';

function goal(datesConfirmed?: boolean): GoalWithSpan {
  return {
    id: 'g',
    title: 'Project',
    start: '2026-07-01',
    deadline: '2026-12-31',
    datesConfirmed,
    nodes: [],
  };
}

describe('Timeline project span editing', () => {
  it('keeps legacy unconfirmed spans read-only while preserving confirmed editing', () => {
    expect(canEditProjectSpan(goal())).toBe(false);
    expect(canEditProjectSpan(goal(false))).toBe(false);
    expect(canEditProjectSpan(goal(true))).toBe(true);
  });
});
