import { describe, it, expect } from 'vitest';
import { ymOf, ymOfWeek, weekShowingMonth, shiftYm, ymLabel, monthGrid, paddedMonthGrid, deadlinePresets } from './calendar';
import { weekOf } from './plan';
import { addDays } from './dates';

describe('which month a week belongs to', () => {
  it('is the month of its Thursday, not of its Monday', () => {
    // Sep 2026 starts on a Tuesday, so its first week starts Mon Aug 31.
    expect(weekOf('2026-09-01')).toBe('2026-08-31');
    expect(ymOf('2026-08-31')).toBe('2026-08');   // the wrong answer
    expect(ymOfWeek('2026-08-31')).toBe('2026-09'); // the right one
  });

  it('leaves a week wholly inside its month alone', () => {
    expect(ymOfWeek('2026-08-03')).toBe('2026-08');
  });

  it('weekShowingMonth is its exact inverse, for every month of three years', () => {
    // The property paging depends on: resolve the week that shows a month, ask
    // which month that week belongs to, and get the month back. Anchoring on
    // the 1st instead of the 4th breaks this for any month starting on a
    // Sunday — February 2026 — and the header then refuses to advance.
    for (let y = 2025; y <= 2027; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        const ym = `${y}-${String(m).padStart(2, '0')}`;
        expect(ymOfWeek(weekShowingMonth(ym))).toBe(ym);
      }
    }
  });

  it('steps a month at a time in both directions', () => {
    let cursor = weekShowingMonth('2026-12');
    cursor = weekShowingMonth(shiftYm(ymOfWeek(cursor), 1));
    expect(ymOfWeek(cursor)).toBe('2027-01');
    cursor = weekShowingMonth(shiftYm(ymOfWeek(cursor), -1));
    expect(ymOfWeek(cursor)).toBe('2026-12');
  });
});

describe('ym helpers', () => {
  it('ymOf strips the day', () => expect(ymOf('2026-07-02')).toBe('2026-07'));
  it('shiftYm crosses year boundaries', () => {
    expect(shiftYm('2026-01', -1)).toBe('2025-12');
    expect(shiftYm('2026-12', 1)).toBe('2027-01');
    expect(shiftYm('2026-07', 0)).toBe('2026-07');
  });
  it('ymLabel is human month + year', () => expect(ymLabel('2026-07')).toBe('July 2026'));
});

describe('monthGrid', () => {
  it('July 2026 starts Mon Jun 29 and ends Sun Aug 2 (5 rows)', () => {
    const g = monthGrid('2026-07');
    expect(g).toHaveLength(5);
    expect(g[0][0]).toBe('2026-06-29');
    expect(g[0][2]).toBe('2026-07-01'); // Jul 1 2026 is a Wednesday
    expect(g[4][6]).toBe('2026-08-02');
    g.forEach(w => expect(w).toHaveLength(7));
  });
  it('Feb 2026 fits in 5 rows (Feb 1 is a Sunday, 28 days)', () => {
    const g = monthGrid('2026-02');
    expect(g).toHaveLength(5);
    expect(g[0][0]).toBe('2026-01-26');
    expect(g[4][6]).toBe('2026-03-01');
  });
});

describe('monthGrid (Monday-first)', () => {
  it('rows start on Monday', () => {
    // July 2026 starts on a Wednesday; the grid's first cell is Mon Jun 29
    const grid = monthGrid('2026-07');
    expect(grid[0][0]).toBe('2026-06-29');
  });

  it('every row has 7 days and covers the whole month', () => {
    const grid = monthGrid('2026-07');
    for (const week of grid) expect(week).toHaveLength(7);
    expect(grid.flat()).toContain('2026-07-01');
    expect(grid.flat()).toContain('2026-07-31');
  });
});

describe('the grid a picker needs', () => {
  it('is always six rows of seven, whatever the month', () => {
    for (const ym of ['2026-08', '2026-02', '2021-02', '2026-05', '2027-01']) {
      const weeks = paddedMonthGrid(ym);
      expect(weeks.length, ym).toBe(6);
      weeks.forEach((w) => expect(w.length, ym).toBe(7));
    }
  });

  // Feb 2021 started on a Monday and has 28 days — exactly four rows, the
  // smallest a month can be. An `if` that padded once would leave it at five.
  it('pads a four-row month all the way to six', () => {
    expect(monthGrid('2021-02')).toHaveLength(4);
    expect(paddedMonthGrid('2021-02')).toHaveLength(6);
  });

  it('keeps every day monthGrid produced, in order', () => {
    const natural = monthGrid('2026-08').flat();
    expect(paddedMonthGrid('2026-08').flat().slice(0, natural.length)).toEqual(natural);
  });

  it('runs continuously across the padding seam', () => {
    const days = paddedMonthGrid('2021-02').flat();
    days.slice(1).forEach((d, i) => expect(d).toBe(addDays(days[i], 1)));
  });
});

describe('deadline presets', () => {
  it('offers two weeks out, the month end and the year end', () => {
    expect(deadlinePresets('2026-08-14')).toEqual([
      { label: 'In 2 weeks', date: '2026-08-28' },
      { label: 'End of month', date: '2026-08-31' },
      { label: 'End of year', date: '2026-12-31' },
    ]);
  });

  it('knows February in a leap year from February in an ordinary one', () => {
    expect(deadlinePresets('2028-02-01')[1].date).toBe('2028-02-29');
    expect(deadlinePresets('2026-02-01')[1].date).toBe('2026-02-28');
  });

  /**
   * Two buttons that write the same date are one button and a lie about the
   * choice on offer. In December the month end IS the year end.
   */
  it('drops a preset that duplicates one already offered', () => {
    expect(deadlinePresets('2026-12-05').map((p) => p.label))
      .toEqual(['In 2 weeks', 'End of month']);
  });
});
