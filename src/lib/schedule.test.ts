import { describe, expect, it } from 'vitest';
import type { Goal } from '../db/types';
import {
  hasGoalSpan,
  hasTrustedSchedule,
  needsDateConfirmation,
  projectDateError,
} from './schedule';

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g',
    title: 'Goal',
    start: '2026-01-01',
    deadline: '2026-12-31',
    nodes: [],
    ...over,
  };
}

describe('schedule provenance', () => {
  it('treats legacy stored dates as a span that still needs confirmation', () => {
    const legacy = goal();

    expect(needsDateConfirmation(legacy)).toBe(true);
    expect(hasGoalSpan(legacy)).toBe(true);
    expect(hasTrustedSchedule(legacy)).toBe(false);
  });

  it('trusts a full span only when datesConfirmed is true', () => {
    expect(hasTrustedSchedule(goal({ datesConfirmed: true }))).toBe(true);
    expect(hasTrustedSchedule(goal({ datesConfirmed: false }))).toBe(false);
    expect(needsDateConfirmation(goal({ datesConfirmed: false }))).toBe(true);
  });
});

describe('projectDateError', () => {
  it('rejects a start after the deadline with the project date-order message', () => {
    expect(projectDateError('2026-08-01', '2026-07-31'))
      .toBe('Start must be on or before the deadline.');
  });

  it('accepts valid or incomplete date ranges', () => {
    expect(projectDateError('2026-07-31', '2026-07-31')).toBeNull();
    expect(projectDateError('2026-07-01', '2026-07-31')).toBeNull();
    expect(projectDateError('2026-07-01')).toBeNull();
  });
});
