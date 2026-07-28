import { describe, it, expect } from 'vitest';
import { parseEstimateInput } from './estimateInput';

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
});
