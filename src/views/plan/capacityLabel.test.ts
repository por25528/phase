import { describe, it, expect } from 'vitest';
import type { DayCapacity, WeekCapacity } from '../../lib/capacity';
import {
  formatMinutes, capacityParts, capacityNote, isOverCommitted, dayLoadLabel, dayLoadHint,
  loadParts, unestimatedLabel,
} from './capacityLabel';

function day(over: Partial<DayCapacity> = {}): DayCapacity {
  return {
    date: '2026-07-28', freeMin: 195, plannedMin: 120, backlogMin: 0, unestimated: 0,
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
    expect(capacityParts(day({ freeMin: 195, plannedMin: 120, backlogMin: 0 })))
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

  it('renders the free figure regardless of hasData', () => {
    expect(capacityParts(day({ hasData: true, freeMin: 195, plannedMin: 120 })))
      .toEqual(['3h 15m free', '2h planned']);
    expect(capacityParts(day({ hasData: false, freeMin: 195, plannedMin: 120 })))
      .toEqual(['3h 15m free', '2h planned']);
  });
});

/*
 * The week header renders the priced parts as text and the unestimated count
 * as a button, so the two are split. `capacityParts` still concatenates them
 * for the day heading's plain-text tooltip — these assert the split cannot
 * drift from the whole.
 */
describe('loadParts / unestimatedLabel', () => {
  it('leaves the unestimated count out of the priced parts', () => {
    expect(loadParts(day({ freeMin: 195, plannedMin: 120, unestimated: 4 })))
      .toEqual(['3h 15m free', '2h planned']);
  });

  it('includes work committed but not placed', () => {
    expect(loadParts(day({ freeMin: 195, plannedMin: 120, backlogMin: 30 })))
      .toEqual(['3h 15m free', '2h planned', '30m to place']);
  });

  it('is null when everything is priced', () => {
    expect(unestimatedLabel({ unestimated: 0 })).toBeNull();
  });

  it('names the count when something is not', () => {
    expect(unestimatedLabel({ unestimated: 1 })).toBe('1 unestimated');
    expect(unestimatedLabel({ unestimated: 4 })).toBe('4 unestimated');
  });

  it('still composes into capacityParts unchanged', () => {
    const c = day({ freeMin: 195, plannedMin: 120, backlogMin: 30, unestimated: 2 });
    expect(capacityParts(c)).toEqual([...loadParts(c), unestimatedLabel(c)]);
  });

  it('composes to exactly the priced parts when nothing is unestimated', () => {
    const c = day({ unestimated: 0 });
    expect(capacityParts(c)).toEqual(loadParts(c));
  });
});

describe('capacityNote', () => {
  it('flags calendar not connected when hasData is false', () => {
    expect(capacityNote({ hasData: false })).toBe('calendar not connected');
  });

  it('is null when hasData is true', () => {
    expect(capacityNote({ hasData: true })).toBeNull();
  });
});

describe('isOverCommitted', () => {
  it('is true when planned exceeds free', () => {
    expect(isOverCommitted({ freeMin: 60, plannedMin: 120, backlogMin: 0 })).toBe(true);
  });

  it('is false when planned fits', () => {
    expect(isOverCommitted({ freeMin: 120, plannedMin: 60, backlogMin: 0 })).toBe(false);
  });

  it('is false when planned exactly fills the day', () => {
    expect(isOverCommitted({ freeMin: 120, plannedMin: 120, backlogMin: 0 })).toBe(false);
  });

  it('is true when planned exceeds free even without calendar data', () => {
    expect(isOverCommitted({ freeMin: 0, plannedMin: 999, backlogMin: 0 })).toBe(true);
  });
});

describe('capacityParts over a WeekCapacity', () => {
  // The same formatter serves the week — WeekCapacity structurally satisfies
  // CapacityFigures, so no second function is needed.
  const week: WeekCapacity = {
    days: [], freeMin: 2700, plannedMin: 300, backlogMin: 0, unestimated: 3, hasData: true,
  };

  it('summarises the week', () => {
    expect(capacityParts(week)).toEqual(['45h free', '5h planned', '3 unestimated']);
  });
});

describe('dayLoadLabel', () => {
  it('reads planned over free', () => {
    expect(dayLoadLabel({ freeMin: 360, plannedMin: 90, backlogMin: 0 })).toBe('1h 30m / 6h');
  });

  it('says nothing about an empty day — seven columns of "0m / 6h" is noise', () => {
    expect(dayLoadLabel({ freeMin: 360, plannedMin: 0, backlogMin: 0 })).toBeNull();
  });

  it('speaks up for an off day that somehow has work on it', () => {
    // plannedMin 0 but no capacity at all is not over-committed, so it stays
    // quiet; the moment anything is planned onto it, 0m free is the whole point.
    expect(dayLoadLabel({ freeMin: 0, plannedMin: 0, backlogMin: 0 })).toBeNull();
    expect(dayLoadLabel({ freeMin: 0, plannedMin: 60, backlogMin: 0 })).toBe('1h / 0m');
  });

  it('still reports a day that is exactly full', () => {
    expect(dayLoadLabel({ freeMin: 120, plannedMin: 120, backlogMin: 0 })).toBe('2h / 2h');
  });
});

describe('dayLoadHint', () => {
  it('spells the figures out and names over-commitment', () => {
    expect(dayLoadHint({ freeMin: 120, plannedMin: 300, backlogMin: 0, unestimated: 2, hasData: true }))
      .toBe('2h free · 5h planned · 2 unestimated — over-committed');
  });

  it('omits the verdict when the day fits', () => {
    expect(dayLoadHint({ freeMin: 360, plannedMin: 60, backlogMin: 0, unestimated: 0, hasData: true }))
      .toBe('6h free · 1h planned');
  });
});
