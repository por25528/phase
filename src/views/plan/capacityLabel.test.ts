import { describe, it, expect } from 'vitest';
import type { DayCapacity, WeekCapacity } from '../../lib/capacity';
import { formatMinutes, capacityParts, isOverCommitted } from './capacityLabel';

function day(over: Partial<DayCapacity> = {}): DayCapacity {
  return {
    date: '2026-07-28', freeMin: 195, plannedMin: 120, unestimated: 0,
    blockedBy: [], hasData: true, ...over,
  };
}

describe('formatMinutes', () => {
  it.each([
    [0, '0m'],
    [45, '45m'],
    [60, '1h'],
    [120, '2h'],
    [195, '3h 15m'],
    [1440, '24h'],
  ])('formats %i as %s', (min, expected) => {
    expect(formatMinutes(min)).toBe(expected);
  });
});

describe('capacityParts', () => {
  it('shows free and planned', () => {
    expect(capacityParts(day({ freeMin: 195, plannedMin: 120 })))
      .toEqual(['3h 15m free', '2h planned']);
  });

  it('appends an unestimated count, pluralised', () => {
    expect(capacityParts(day({ unestimated: 1 }))).toContain('1 unestimated');
    expect(capacityParts(day({ unestimated: 2 }))).toContain('2 unestimated');
  });

  it('omits planned when nothing is committed', () => {
    expect(capacityParts(day({ plannedMin: 0, unestimated: 0 })))
      .toEqual(['3h 15m free']);
  });

  it('says "no calendar data" instead of free hours when hasData is false', () => {
    expect(capacityParts(day({ hasData: false, plannedMin: 120 })))
      .toEqual(['no calendar data', '2h planned']);
  });
});

describe('isOverCommitted', () => {
  it('is true when planned exceeds free', () => {
    expect(isOverCommitted({ freeMin: 60, plannedMin: 120, hasData: true })).toBe(true);
  });

  it('is false when planned fits', () => {
    expect(isOverCommitted({ freeMin: 120, plannedMin: 60, hasData: true })).toBe(false);
  });

  it('is false when planned exactly fills the day', () => {
    expect(isOverCommitted({ freeMin: 120, plannedMin: 120, hasData: true })).toBe(false);
  });

  it('never claims over-commitment without calendar data', () => {
    expect(isOverCommitted({ freeMin: 0, plannedMin: 999, hasData: false })).toBe(false);
  });
});

describe('capacityParts over a WeekCapacity', () => {
  // The same formatter serves the week — WeekCapacity structurally satisfies
  // CapacityFigures, so no second function is needed.
  const week: WeekCapacity = {
    days: [], freeMin: 2700, plannedMin: 300, unestimated: 3, hasData: true,
  };

  it('summarises the week', () => {
    expect(capacityParts(week)).toEqual(['45h free', '5h planned', '3 unestimated']);
  });
});
