import { describe, it, expect } from 'vitest';
import type { DayCapacity, WeekCapacity } from '../../lib/capacity';
import {
  formatMinutes, capacityParts, capacityNote, isOverCommitted, dayLoadLabel, dayLoadHint,
  loadParts, unestimatedLabel, weekFreeSplit, weekLoadParts, capacityMeter,
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

/*
 * The week header's free figure is split by tense. `weekCapacity` sums a PAST
 * day's whole window into `freeMin` (NO_PAST_LIMIT, so retrospectives read
 * true), so on any day but Monday the week's `freeMin` is mostly ELAPSED. The
 * header must not spend the word "free" on hours that have already gone.
 */
describe('weekFreeSplit / weekLoadParts', () => {
  // A whole 9h working day, past days holding their full window; Sat/Sun off.
  // Mirrors what weekCapacity produces: Mon–Fri hold 9h, the weekend is off.
  const days = (): DayCapacity[] =>
    ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16']
      .map((date) => {
        const off = ['2026-08-15', '2026-08-16'].includes(date);
        const freeMin = off ? 0 : 540;
        return { date, freeMin, plannedMin: 0, backlogMin: 0, unestimated: 0, blockedBy: [], hasData: true };
      });

  const week = (_today: string, over: Partial<WeekCapacity> = {}): WeekCapacity => {
    const d = over.days ?? days();
    return {
      days: d,
      freeMin: d.reduce((s, x) => s + x.freeMin, 0),
      plannedMin: 0, backlogMin: 0, unestimated: 0, hasData: true, ...over,
    };
  };

  it('splits the free figure into what is left and what is spent', () => {
    // Saturday 15 Aug: Mon–Fri (45h) all elapsed, today and Sunday are off.
    expect(weekFreeSplit(week('2026-08-15'), '2026-08-15')).toEqual({ leftMin: 0, spentMin: 2700 });
  });

  it('reads "0m left · 45h spent" on that Saturday — never "45h free"', () => {
    expect(weekLoadParts(week('2026-08-15'), '2026-08-15')).toEqual(['0m left', '45h spent']);
  });

  it('counts today\'s own remaining window as left, not spent', () => {
    // Wednesday: Mon+Tue spent (18h), Wed–Fri still ahead (27h), weekend off.
    expect(weekFreeSplit(week('2026-08-12'), '2026-08-12')).toEqual({ leftMin: 2700 - 1080, spentMin: 1080 });
    expect(weekLoadParts(week('2026-08-12'), '2026-08-12')).toEqual(['27h left', '18h spent']);
  });

  it('reads a fully-future week exactly as it does today — a bare "free"', () => {
    // Nothing before Monday, so nothing is spent and the split collapses.
    expect(weekFreeSplit(week('2026-08-03'), '2026-08-03')).toEqual({ leftMin: 2700, spentMin: 0 });
    expect(weekLoadParts(week('2026-08-03'), '2026-08-03')).toEqual(['45h free']);
  });

  it('left + spent is exactly freeMin even when days is somehow empty', () => {
    const w = week('2026-08-15', { days: [], freeMin: 2700 });
    const { leftMin, spentMin } = weekFreeSplit(w, '2026-08-15');
    expect(leftMin + spentMin).toBe(2700);
    expect(weekLoadParts(w, '2026-08-15')).toEqual(['45h free']);
  });

  it('appends planned and to-place after the split, unchanged', () => {
    expect(weekLoadParts(week('2026-08-15', { plannedMin: 300, backlogMin: 30 }), '2026-08-15'))
      .toEqual(['0m left', '45h spent', '5h planned', '30m to place']);
    expect(weekLoadParts(week('2026-08-03', { plannedMin: 300 }), '2026-08-03'))
      .toEqual(['45h free', '5h planned']);
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

describe('capacityMeter', () => {
  const base = { freeMin: 600, plannedMin: 0, backlogMin: 0 };

  it('spans freeMin when the week fits', () => {
    const m = capacityMeter({ ...base, plannedMin: 300, backlogMin: 150 });
    expect(m.over).toBe(false);
    expect(m.plannedFrac).toBeCloseTo(0.5);
    expect(m.backlogFrac).toBeCloseTo(0.25);
    // 1.0 means "the mark is the bar's own right edge" — not drawn.
    expect(m.capacityMarkFrac).toBeCloseTo(1);
  });

  it('spans the committed total when over, and marks where free ran out', () => {
    const m = capacityMeter({ freeMin: 600, plannedMin: 700, backlogMin: 100 });
    expect(m.over).toBe(true);
    // D = 800. Segments fill the whole bar.
    expect(m.plannedFrac).toBeCloseTo(0.875);
    expect(m.backlogFrac).toBeCloseTo(0.125);
    expect(m.plannedFrac + m.backlogFrac).toBeCloseTo(1);
    expect(m.capacityMarkFrac).toBeCloseTo(0.75);
  });

  it('never lets the segments exceed the bar', () => {
    for (const c of [
      { freeMin: 0, plannedMin: 300, backlogMin: 0 },
      { freeMin: 60, plannedMin: 0, backlogMin: 999 },
      { freeMin: 1000, plannedMin: 1, backlogMin: 1 },
    ]) {
      const m = capacityMeter(c);
      expect(m.plannedFrac + m.backlogFrac).toBeLessThanOrEqual(1.0000001);
      expect(m.plannedFrac).toBeGreaterThanOrEqual(0);
      expect(m.backlogFrac).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns zeros rather than NaN when there is nothing at all', () => {
    const m = capacityMeter({ freeMin: 0, plannedMin: 0, backlogMin: 0 });
    expect(m.plannedFrac).toBe(0);
    expect(m.backlogFrac).toBe(0);
    expect(m.capacityMarkFrac).toBe(1);
    expect(m.over).toBe(false);
  });

  // The whole reason this function exists: the bar cannot contradict the text.
  it('agrees with isOverCommitted on every input', () => {
    const table = [
      { freeMin: 600, plannedMin: 0, backlogMin: 0 },
      { freeMin: 600, plannedMin: 600, backlogMin: 0 },
      { freeMin: 600, plannedMin: 599, backlogMin: 2 },
      { freeMin: 600, plannedMin: 0, backlogMin: 601 },
      { freeMin: 0, plannedMin: 0, backlogMin: 0 },
      { freeMin: 0, plannedMin: 1, backlogMin: 0 },
    ];
    for (const c of table) {
      expect(capacityMeter(c).over).toBe(isOverCommitted(c));
    }
  });
});
