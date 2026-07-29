import { describe, it, expect } from 'vitest';
import { aimMinuteFor } from './dropTarget';

const RANGE = { startMin: 480, endMin: 1200 }; // 08:00–20:00

describe('aimMinuteFor', () => {
  it('maps the top of the column to the range start', () => {
    expect(aimMinuteFor(100, 100, 720, RANGE)).toBe(480);
  });
  it('maps the bottom of the column to the range end', () => {
    expect(aimMinuteFor(820, 100, 720, RANGE)).toBe(1200);
  });
  it('maps the midpoint to the middle of the range', () => {
    expect(aimMinuteFor(460, 100, 720, RANGE)).toBe(840);
  });
  it('clamps a drop above the column to the range start', () => {
    expect(aimMinuteFor(0, 100, 720, RANGE)).toBe(480);
  });
  it('clamps a drop below the column to the range end', () => {
    expect(aimMinuteFor(9999, 100, 720, RANGE)).toBe(1200);
  });
  it('returns the range start for a zero-height rect rather than dividing by zero', () => {
    expect(aimMinuteFor(100, 100, 0, RANGE)).toBe(480);
  });
});
