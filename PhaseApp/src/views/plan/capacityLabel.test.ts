import { describe, it, expect } from 'vitest';
import type { DayCapacity, WeekCapacity } from '../../lib/capacity';
import {
  formatMinutes, capacityParts, dayLoadLabel, dayLoadHint,
  loadParts, unestimatedLabel, weekLoadCells, weekLoadParts,
} from './capacityLabel';

function day(over: Partial<DayCapacity> = {}): DayCapacity {
  return {
    date: '2026-07-28', plannedMin: 120, backlogMin: 0, unestimated: 0,
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

/*
 * Every figure here is a COMMITMENT. There is no free figure any more, so
 * nothing on this surface prices what you have taken on against what would
 * fit — it states the first and makes no claim about the second.
 */
describe('capacityParts', () => {
  it('states what is on the calendar', () => {
    expect(capacityParts(day({ plannedMin: 120, backlogMin: 0 })))
      .toEqual(['2h planned']);
  });

  it('appends an unestimated count, pluralised', () => {
    expect(capacityParts(day({ unestimated: 1 }))).toContain('1 unestimated');
    expect(capacityParts(day({ unestimated: 2 }))).toContain('2 unestimated');
  });

  it('says nothing at all about a day with nothing on it', () => {
    expect(capacityParts(day({ plannedMin: 0, unestimated: 0 }))).toEqual([]);
  });

  it('is unaffected by hasData, which is about the calendar cache', () => {
    expect(capacityParts(day({ hasData: true, plannedMin: 120 }))).toEqual(['2h planned']);
    expect(capacityParts(day({ hasData: false, plannedMin: 120 }))).toEqual(['2h planned']);
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
    expect(loadParts(day({ plannedMin: 120, unestimated: 4 }))).toEqual(['2h planned']);
  });

  it('includes work committed but not placed', () => {
    expect(loadParts(day({ plannedMin: 120, backlogMin: 30 })))
      .toEqual(['2h planned', '30m to place']);
  });

  it('is null when everything is priced', () => {
    expect(unestimatedLabel({ unestimated: 0 })).toBeNull();
  });

  it('names the count when something is not', () => {
    expect(unestimatedLabel({ unestimated: 1 })).toBe('1 unestimated');
    expect(unestimatedLabel({ unestimated: 4 })).toBe('4 unestimated');
  });

  it('still composes into capacityParts unchanged', () => {
    const c = day({ plannedMin: 120, backlogMin: 30, unestimated: 2 });
    expect(capacityParts(c)).toEqual([...loadParts(c), unestimatedLabel(c)]);
  });

  it('composes to exactly the priced parts when nothing is unestimated', () => {
    const c = day({ unestimated: 0 });
    expect(capacityParts(c)).toEqual(loadParts(c));
  });
});

describe('capacityParts over a WeekCapacity', () => {
  // The same formatter serves the week — WeekCapacity structurally satisfies
  // CapacityFigures, so no second function is needed.
  const week: WeekCapacity = {
    days: [], plannedMin: 300, backlogMin: 0, unestimated: 3, hasData: true,
  };

  it('summarises the week', () => {
    expect(capacityParts(week)).toEqual(['5h planned', '3 unestimated']);
  });
});

/*
 * `head` is spent exactly once per readout, and it is `Planned`. Two headlines
 * is no headline, and the week is planned against what is on it now that
 * nothing measures what would fit.
 */
describe('weekLoadCells / weekLoadParts', () => {
  it('says nothing about an untouched week', () => {
    expect(weekLoadCells({ plannedMin: 0, backlogMin: 0 })).toEqual([]);
    expect(weekLoadParts({ plannedMin: 0, backlogMin: 0 })).toEqual([]);
  });

  it('makes Planned the one head cell', () => {
    const cells = weekLoadCells({ plannedMin: 720, backlogMin: 180 });
    expect(cells).toEqual([
      { key: 'Planned', value: '12h', tone: 'head' },
      { key: 'To place', value: '3h', tone: 'quiet' },
    ]);
    expect(cells.filter((c) => c.tone === 'head')).toHaveLength(1);
  });

  it('heads the readout when nothing is committed either way', () => {
    expect(weekLoadCells({ plannedMin: 720, backlogMin: 0 }))
      .toEqual([{ key: 'Planned', value: '12h', tone: 'head' }]);
  });

  /*
   * A week whose whole commitment is unplaced still has one figure to lead
   * with — the alternative is a readout with no head at all, which is the
   * hierarchy this cell shape exists to establish, undone.
   */
  it('promotes To place when there is nothing planned above it', () => {
    expect(weekLoadCells({ plannedMin: 0, backlogMin: 180 }))
      .toEqual([{ key: 'To place', value: '3h', tone: 'head' }]);
  });

  it('reads the cells back as sentences without a second table of words', () => {
    expect(weekLoadParts({ plannedMin: 300, backlogMin: 30 }))
      .toEqual(['5h planned', '30m to place']);
  });
});

describe('dayLoadLabel', () => {
  it('states the minutes ON the day', () => {
    // It read `1h 30m / 6h` while free time existed. The denominator is gone.
    expect(dayLoadLabel({ plannedMin: 90, backlogMin: 0 })).toBe('1h 30m');
  });

  it('says nothing about an empty day — seven columns of "0m" is noise', () => {
    expect(dayLoadLabel({ plannedMin: 0, backlogMin: 0 })).toBeNull();
  });

  it('speaks up for a day that is committed but unplaced', () => {
    // `0m` is the whole point here: the rail beside this is listing the work,
    // and the column is visibly empty.
    expect(dayLoadLabel({ plannedMin: 0, backlogMin: 60 })).toBe('0m');
  });
});

describe('dayLoadHint', () => {
  it('spells the figures out', () => {
    expect(dayLoadHint({ plannedMin: 300, backlogMin: 0, unestimated: 2, hasData: true }))
      .toBe('5h planned · 2 unestimated');
  });

  it('is empty on a day with nothing on it, so the caller can withhold the tooltip', () => {
    expect(dayLoadHint({ plannedMin: 0, backlogMin: 0, unestimated: 0, hasData: true })).toBe('');
  });
});
