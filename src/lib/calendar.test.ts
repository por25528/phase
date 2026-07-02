import { describe, it, expect } from 'vitest';
import { ymOf, shiftYm, ymLabel, monthGrid } from './calendar';

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
  it('July 2026 starts Sun Jun 28 and ends Sat Aug 1 (5 rows)', () => {
    const g = monthGrid('2026-07');
    expect(g).toHaveLength(5);
    expect(g[0][0]).toBe('2026-06-28');
    expect(g[0][3]).toBe('2026-07-01'); // Jul 1 2026 is a Wednesday
    expect(g[4][6]).toBe('2026-08-01');
    g.forEach(w => expect(w).toHaveLength(7));
  });
  it('Feb 2026 fits in 4 rows (Feb 1 is a Sunday, 28 days)', () => {
    const g = monthGrid('2026-02');
    expect(g).toHaveLength(4);
    expect(g[0][0]).toBe('2026-02-01');
    expect(g[3][6]).toBe('2026-02-28');
  });
});
