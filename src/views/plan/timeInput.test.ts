import { describe, it, expect } from 'vitest';
import { minutesToTimeValue, timeValueToMinutes } from './timeInput';

describe('minutesToTimeValue', () => {
  it.each([
    [0, '00:00'],
    [9, '00:09'],
    [60, '01:00'],
    [540, '09:00'],
    [1080, '18:00'],
    [1439, '23:59'],
    [1440, '24:00'],
  ])('formats %i minutes as %s', (min, expected) => {
    expect(minutesToTimeValue(min)).toBe(expected);
  });
});

describe('timeValueToMinutes', () => {
  it.each([
    ['00:00', 0],
    ['00:09', 9],
    ['01:00', 60],
    ['09:00', 540],
    ['18:00', 1080],
    ['23:59', 1439],
    ['24:00', 1440],
  ])('parses %s as %i minutes', (value, expected) => {
    expect(timeValueToMinutes(value)).toBe(expected);
  });

  it.each(['', 'abc', '9:00', '09:0', '25:00', '09:60', '-1:00', '09:-1', '09', '09:00:00'])(
    'rejects %s',
    (input) => {
      expect(timeValueToMinutes(input)).toBeUndefined();
    },
  );

  it('round-trips every quarter hour of the day', () => {
    for (let min = 0; min <= 1440; min += 15) {
      expect(timeValueToMinutes(minutesToTimeValue(min))).toBe(min);
    }
  });
});
