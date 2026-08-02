import { describe, it, expect } from 'vitest';
import { canvasSpan, snapMinute, CLICK_THRESHOLD_PX } from './canvasCreate';
import { DEFAULT_SLOT_MIN, SLOT_GRANULARITY_MIN } from './slot';

describe('snapMinute', () => {
  it('snaps to the grain the rest of the scheduler already uses', () => {
    expect(snapMinute(542)).toBe(540);
    expect(snapMinute(543)).toBe(545);
    expect(snapMinute(540)).toBe(540);
  });
});

describe('canvasSpan', () => {
  it('treats a click as a default-length block', () => {
    expect(canvasSpan(540, 540)).toEqual({ startMin: 540, durationMin: DEFAULT_SLOT_MIN });
  });

  it('treats a tiny drag as a click, not a one-minute block', () => {
    const span = canvasSpan(540, 540 + CLICK_THRESHOLD_PX - 1);
    expect(span.durationMin).toBe(DEFAULT_SLOT_MIN);
  });

  it('uses the dragged extent once the drag is real', () => {
    expect(canvasSpan(540, 615)).toEqual({ startMin: 540, durationMin: 75 });
  });

  it('snaps both edges', () => {
    expect(canvasSpan(542, 613)).toEqual({ startMin: 540, durationMin: 75 });
  });

  it('handles an upward drag by ordering the edges', () => {
    expect(canvasSpan(615, 540)).toEqual({ startMin: 540, durationMin: 75 });
  });

  it('never produces a block shorter than the snap grain', () => {
    // A drag long enough to beat the click threshold but which snaps to zero.
    const span = canvasSpan(540, 540 + CLICK_THRESHOLD_PX + 1);
    expect(span.durationMin).toBeGreaterThanOrEqual(SLOT_GRANULARITY_MIN);
  });

  it('clamps a click near midnight so the block stays inside the day', () => {
    const span = canvasSpan(1430, 1430);
    expect(span.startMin + span.durationMin).toBeLessThanOrEqual(1440);
  });

  it('clamps a drag that runs off the bottom of the day', () => {
    const span = canvasSpan(1380, 2000);
    expect(span.startMin).toBe(1380);
    expect(span.startMin + span.durationMin).toBe(1440);
  });

  it('clamps a drag that starts above midnight', () => {
    const span = canvasSpan(-200, 120);
    expect(span.startMin).toBe(0);
    expect(span.durationMin).toBe(120);
  });
});
