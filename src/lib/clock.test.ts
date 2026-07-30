import { describe, expect, it } from 'vitest';
import { clockLabel } from './clock';

describe('clockLabel (12-hour)', () => {
  it('formats whole hours without minutes', () => {
    expect(clockLabel(0, false)).toBe('12am');
    expect(clockLabel(540, false)).toBe('9am');
    expect(clockLabel(720, false)).toBe('12pm');
    expect(clockLabel(780, false)).toBe('1pm');
    expect(clockLabel(1380, false)).toBe('11pm');
  });

  it('pads part hours', () => {
    expect(clockLabel(545, false)).toBe('9:05am');
    expect(clockLabel(915, false)).toBe('3:15pm');
  });

  it('marks a rollover past midnight rather than wrapping silently', () => {
    expect(clockLabel(1470, false)).toBe('12:30am+1');
    expect(clockLabel(1440, false)).toBe('12am+1');
  });
});

// C-1's acceptance criterion asks for the user's locale format; the app used to
// hardcode am/pm, so a 24-hour-locale user saw "1pm" where they expect "13:00".
describe('clockLabel (24-hour locale)', () => {
  it('zero-pads and drops the meridiem', () => {
    expect(clockLabel(0, true)).toBe('00:00');
    expect(clockLabel(540, true)).toBe('09:00');
    expect(clockLabel(780, true)).toBe('13:00');
    expect(clockLabel(1380, true)).toBe('23:00');
  });

  it('keeps part hours and the rollover marker', () => {
    expect(clockLabel(915, true)).toBe('15:15');
    expect(clockLabel(1470, true)).toBe('00:30+1');
  });
});
