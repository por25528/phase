import { describe, it, expect } from 'vitest';
import { ymOf, ymOfWeek, weekShowingMonth, shiftYm, ymLabel, monthGrid } from './calendar';
import { weekOf } from './plan';

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
