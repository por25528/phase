import { describe, it, expect } from 'vitest';
import { parseEstimateInput, formatEstimateValue } from './estimateInput';

describe('parseEstimateInput', () => {
  it.each([
    ['45', 45],
    ['45m', 45],
    ['90 min', 90],
    ['1h', 60],
    ['2h', 120],
    ['1h30', 90],
    ['1h30m', 90],
    ['1.5h', 90],
    ['0.5h', 30],
  ])('parses %s as %i minutes', (input, expected) => {
    expect(parseEstimateInput(input)).toBe(expected);
  });

  it.each(['', '   '])('treats %s as a deliberate clear', (input) => {
    expect(parseEstimateInput(input)).toBeNull();
  });

  it.each(['abc', '-30', '0', 'h', '--'])('rejects %s', (input) => {
    expect(parseEstimateInput(input)).toBeUndefined();
  });

  // Change 1: bare decimals are ambiguous for the minutes branch — only the
  // hours branch may be fractional.
  it.each([
    ['1.5', undefined],
    ['1.5m', undefined],
    ['.5', undefined],
    // unchanged: hours may be fractional
    ['1.5h', 90],
    ['.5h', 30],
    ['2h', 120],
    ['1h30', 90],
    ['1h30m', 90],
    // unchanged: bare/labelled integer minutes still work
    ['45', 45],
    ['45m', 45],
    ['90 min', 90],
  ])('parses %s as %s (bare-decimal rejection)', (input, expected) => {
    expect(parseEstimateInput(input)).toBe(expected);
  });

  // Change 2: cap parsed value at 24h (1440 minutes), inclusive boundary.
  it.each([
    ['1440', 1440],
    ['1441', undefined],
    ['24h', 1440],
    ['25h', undefined],
    ['999999', undefined],
    ['23h59', 1439],
  ])('parses %s as %s (24h cap)', (input, expected) => {
    expect(parseEstimateInput(input)).toBe(expected);
  });
});

describe('formatEstimateValue / parseEstimateInput round trip', () => {
  it.each(Array.from({ length: 1440 }, (_, i) => i + 1))(
    'round-trips %i minutes through formatEstimateValue → parseEstimateInput',
    (minutes) => {
      expect(parseEstimateInput(formatEstimateValue(minutes))).toBe(minutes);
    },
  );
});
