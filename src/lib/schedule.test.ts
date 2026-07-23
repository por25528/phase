import { describe, expect, it } from 'vitest';
import type { Goal } from '../db/types';
import {
  hasGoalSpan,
  hasTrustedSchedule,
  isValidLocalDate,
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

  it('rejects empty or malformed local-date strings as a goal span', () => {
    expect(hasGoalSpan(goal({ start: '' }))).toBe(false);
    expect(hasGoalSpan(goal({ deadline: '' }))).toBe(false);
    expect(hasGoalSpan(goal({ start: '2026-7-01' }))).toBe(false);
    expect(hasGoalSpan(goal({ deadline: 'not-a-date' }))).toBe(false);
    expect(hasTrustedSchedule(goal({ start: '', datesConfirmed: true }))).toBe(false);
  });

  it('rejects semantic calendar errors and reversed persisted spans', () => {
    expect(hasGoalSpan(goal({ start: '2026-02-30' }))).toBe(false);
    expect(hasGoalSpan(goal({ deadline: '2026-13-01' }))).toBe(false);
    expect(hasGoalSpan(goal({ start: '2026-12-01', deadline: '2026-11-30' }))).toBe(false);
    expect(hasTrustedSchedule(goal({
      start: '2026-12-01',
      deadline: '2026-11-30',
      datesConfirmed: true,
    }))).toBe(false);
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

  it('rejects each supplied malformed or calendar-invalid date', () => {
    expect(projectDateError('2026-02-30', '2026-12-31')).toBe('Start must be a valid date.');
    expect(projectDateError('tomorrow', '2026-12-31')).toBe('Start must be a valid date.');
    expect(projectDateError('2026-01-01', '2026-13-01')).toBe('Deadline must be a valid date.');
  });
});

describe('isValidLocalDate', () => {
  it('round-trips real YYYY-MM-DD calendar dates', () => {
    expect(isValidLocalDate('2024-02-29')).toBe(true);
    expect(isValidLocalDate('2026-02-29')).toBe(false);
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('2026-7-01')).toBe(false);
  });
});
