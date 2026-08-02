import { describe, it, expect } from 'vitest';
import { aimMinuteFor } from './dropTarget';
import { minuteToPx } from '../../lib/grid';

/**
 * The grid is a scroller. Its content box starts `gridOffsetPx` below the
 * scroller's own top edge — that is the sticky day headings and the all-day
 * lane, which live inside the scroller but above the hour grid.
 *
 * Every case below fixes the scroller at viewport y=100 with a 60px header
 * band, and varies only `scrollTop`. The point of the coordinate change is
 * that the SAME viewport position means a LATER minute once the grid has been
 * scrolled — which is precisely what the old viewport-only arithmetic got
 * wrong, and what made autoScroll unsafe to enable.
 */
const SCROLLER_TOP = 100;
const HEADER = 60;
const DAY_START = 0;
const DAY_END = 1440;

function aim(draggedTopViewport: number, scrollTop = 0): number {
  return aimMinuteFor({
    draggedTopViewport,
    scrollerTopViewport: SCROLLER_TOP,
    scrollTop,
    gridOffsetPx: HEADER,
  });
}

describe('aimMinuteFor', () => {
  it('maps the top of an unscrolled grid to midnight', () => {
    expect(aim(SCROLLER_TOP + HEADER)).toBe(0);
  });

  it('maps a position down the unscrolled grid to that many minutes', () => {
    // 540px below the grid top, at 1px/minute, is 09:00.
    expect(aim(SCROLLER_TOP + HEADER + 540)).toBe(540);
  });

  it('adds the scroll offset — the whole point of the coordinate change', () => {
    // Same pixel on screen, but the grid has been scrolled down 480px, so the
    // minute under it is 480 later. Viewport-only arithmetic returns 540 here
    // and is wrong by eight hours.
    expect(aim(SCROLLER_TOP + HEADER + 540, 480)).toBe(1020);
  });

  it('is stable under scroll for a fixed content position', () => {
    // Scrolling and moving the pointer by the same amount must not change the
    // answer: the block stays under the same minute.
    const unscrolled = aim(SCROLLER_TOP + HEADER + 600, 0);
    const scrolled = aim(SCROLLER_TOP + HEADER + 300, 300);
    expect(scrolled).toBe(unscrolled);
  });

  it('clamps above the grid to midnight rather than a negative minute', () => {
    expect(aim(SCROLLER_TOP - 500)).toBe(DAY_START);
  });

  it('clamps below the grid to the end of the day', () => {
    expect(aim(SCROLLER_TOP + HEADER + 99999)).toBe(DAY_END);
  });

  it('clamps once the scroll offset alone pushes past the end of the day', () => {
    expect(aim(SCROLLER_TOP + HEADER + 100, 1_000_000)).toBe(DAY_END);
  });

  it('clamps at the low end via the scroll term, not just a far-above-scroller position', () => {
    // The dragged position itself is well inside the grid; it's a negative
    // scrollTop that pushes contentY below DAY_START_MIN. This exercises the
    // clamp through the scroll term rather than only through
    // draggedTopViewport, which is the other way contentY can go negative.
    expect(aim(SCROLLER_TOP + HEADER + 100, -1000)).toBe(DAY_START);
  });

  it('rounds a fractional minute up at .7', () => {
    expect(aim(SCROLLER_TOP + HEADER + 540.7)).toBe(541);
  });

  it('rounds half a minute up — pins round-half-up, not round-half-to-even', () => {
    expect(aim(SCROLLER_TOP + HEADER + 540.5)).toBe(541);
  });

  it('includes the exact last minute of the day, not just up to it', () => {
    expect(aim(SCROLLER_TOP + HEADER + 1440)).toBe(1440);
  });

  it('includes the minute just before the end of the day', () => {
    expect(aim(SCROLLER_TOP + HEADER + 1439)).toBe(1439);
  });

  it('agrees with minuteToPx — pixels and minutes are the same number only because PX_PER_MINUTE is 1', () => {
    expect(aim(SCROLLER_TOP + HEADER + minuteToPx(540))).toBe(540);
  });
});
