import { describe, expect, it } from 'vitest';
import { parseDateInput } from './dateInput';

const REF = '2026-07-30';

describe('parseDateInput', () => {
  it('accepts the ISO form the field edits in', () => {
    expect(parseDateInput('2026-08-02', REF)).toBe('2026-08-02');
    expect(parseDateInput('  2026-08-02  ', REF)).toBe('2026-08-02');
  });

  it('accepts the display form the rest of the app uses', () => {
    expect(parseDateInput('Aug 2', REF)).toBe('2026-08-02');
    expect(parseDateInput('aug 2', REF)).toBe('2026-08-02');
    expect(parseDateInput('AUG 2', REF)).toBe('2026-08-02');
  });

  it('accepts the day-first spelling too', () => {
    expect(parseDateInput('2 Aug', REF)).toBe('2026-08-02');
  });

  it('takes an explicit year over the reference year', () => {
    expect(parseDateInput('Aug 2 2027', REF)).toBe('2027-08-02');
    expect(parseDateInput('Aug 2, 2027', REF)).toBe('2027-08-02');
  });

  it('defaults the year to the reference date', () => {
    expect(parseDateInput('Jan 5', '2027-03-01')).toBe('2027-01-05');
  });

  it('rejects a real calendar impossibility rather than rolling it over', () => {
    expect(parseDateInput('2026-02-30', REF)).toBeNull();
    expect(parseDateInput('Feb 30', REF)).toBeNull();
    expect(parseDateInput('2026-13-01', REF)).toBeNull();
  });

  it('rejects anything ambiguous or unparseable', () => {
    // The whole point: 02/08/2026 means Feb 8 to one reader and Aug 2 to another.
    expect(parseDateInput('02/08/2026', REF)).toBeNull();
    expect(parseDateInput('', REF)).toBeNull();
    expect(parseDateInput('next tuesday', REF)).toBeNull();
    expect(parseDateInput('Augu', REF)).toBeNull();
  });

  it('keeps a leap day that really exists', () => {
    expect(parseDateInput('Feb 29', '2028-01-01')).toBe('2028-02-29');
    expect(parseDateInput('Feb 29', '2027-01-01')).toBeNull();
  });
});
