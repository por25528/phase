// @vitest-environment jsdom
import { createElement, createRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WeekGrid } from './WeekGrid';

/**
 * The other half of the current-time indicator.
 *
 * A hairline across today's column says the minute; a dot in the TIME GUTTER
 * is what still says it when today has been scrolled off screen sideways — the
 * grid is `min-w-[780px]` and scrolls horizontally on any narrow window, so
 * that is not an edge case. The gutter is sticky, so the dot always rides with
 * the hour labels.
 */

const DAYS = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'];
const RANGE = { startMin: 480, endMin: 1200 };

afterEach(cleanup);

function mount(today: string, nowMinute: number | null) {
  return render(createElement(WeekGrid, {
    days: DAYS,
    today,
    nowMinute,
    windows: [],
    scrollWindow: RANGE,
    scrollerRef: createRef<HTMLDivElement>(),
    gridRef: createRef<HTMLDivElement>(),
    children: () => null,
  }));
}

describe('the time gutter’s now dot', () => {
  it('marks the current minute when today is in the week on screen', () => {
    const { container } = mount('2026-07-30', 620);
    const dot = container.querySelector('[data-testid="now-dot"]') as HTMLElement | null;
    expect(dot).not.toBeNull();
    // 1px per minute — the same scale the hour labels are placed on, so the
    // dot and the hairline in DayColumn cannot land on different rows.
    expect(dot?.style.top).toBe('620px');
  });

  it('says nothing on a week that does not contain today', () => {
    const { container } = mount('2026-09-01', 620);
    expect(container.querySelector('[data-testid="now-dot"]')).toBeNull();
  });

  it('says nothing when the minute is unknown', () => {
    const { container } = mount('2026-07-30', null);
    expect(container.querySelector('[data-testid="now-dot"]')).toBeNull();
  });

  /*
   * `hourMarks()` runs to minute 1440 because the grid needs a rule at its own
   * bottom edge, but that mark is not an hour OF this day — `clockLabel`
   * renders it `12am+1`, and a column that begins and ends with `12am` reads
   * as a mistake. 24 labels, 25 rules.
   */
  it('labels 24 hours and not the closing midnight', () => {
    const { container } = mount('2026-07-30', 620);
    const labels = Array.from(container.querySelectorAll('.font-mono.text-tiny.tabular-nums'))
      .map((el) => el.textContent);
    expect(labels.length).toBe(24);
    expect(labels.some((l) => l?.includes('+1'))).toBe(false);
  });
});
