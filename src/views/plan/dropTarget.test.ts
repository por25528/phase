import { describe, it, expect } from 'vitest';
import { aimMinuteFor } from './dropTarget';

const RANGE = { startMin: 480, endMin: 1200 }; // 08:00–20:00

// `draggedTop` here stands in for `active.rect.current.initial.top + delta.y`
// — the top edge of the dragged block/ghost, not the pointer's clientY. The
// call basis changed (Finding 4) but the pure mapping is identical: a Y
// position relative to the column's rect, clamped into the visible range.
describe('aimMinuteFor', () => {
  it('maps the dragged top at the column top to the range start', () => {
    expect(aimMinuteFor(100, 100, 720, RANGE)).toBe(480);
  });
  it('maps the dragged top at the column bottom to the range end', () => {
    expect(aimMinuteFor(820, 100, 720, RANGE)).toBe(1200);
  });
  it('maps the dragged top at the column midpoint to the middle of the range', () => {
    expect(aimMinuteFor(460, 100, 720, RANGE)).toBe(840);
  });
  it('maps a dragged top a quarter down the column to a quarter through the range', () => {
    // Asymmetric fraction (25%, not 50%) so an inverted mapping (using
    // 1 - pct instead of pct) or a swapped start/end would fail this case
    // even though it happens to agree with the midpoint case above.
    expect(aimMinuteFor(280, 100, 720, RANGE)).toBe(660); // 480 + 0.25 * 720
  });
  it('clamps a dragged top above the column to the range start', () => {
    expect(aimMinuteFor(0, 100, 720, RANGE)).toBe(480);
  });
  it('clamps a dragged top below the column to the range end', () => {
    expect(aimMinuteFor(9999, 100, 720, RANGE)).toBe(1200);
  });
  it('returns the range start for a zero-height rect rather than dividing by zero', () => {
    expect(aimMinuteFor(100, 100, 0, RANGE)).toBe(480);
  });
});
