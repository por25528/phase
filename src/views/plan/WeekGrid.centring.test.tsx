// @vitest-environment jsdom
import { createElement, createRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WeekGrid } from './WeekGrid';

/**
 * When the week grid may move itself, and when it must not.
 *
 * This has been wrong in both directions. It first re-centred on EVERY render —
 * including the 60-second now-line tick — so on a narrow window a manual scroll
 * to Friday was destroyed within the minute. Narrowing the dependency to the
 * week fixed that and introduced the opposite gap: a grid that is not yet
 * scrollable at mount, and becomes scrollable when the window is dragged
 * narrower, stayed pinned at Monday with today off screen until the week or the
 * date changed.
 *
 * The rules are timing, so they are tested as timing rather than described in a
 * comment.
 */

const DAYS = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'];
const TODAY = '2026-07-30'; // Thursday — index 3, so a real centring is required
const RANGE = { startMin: 540, endMin: 1080 };

/** Drives the ResizeObserver callbacks the way a browser would. */
let observers: Array<() => void> = [];

beforeAll(() => {
  class FakeResizeObserver {
    cb: () => void;
    constructor(cb: () => void) { this.cb = cb; }
    observe() { observers.push(this.cb); }
    disconnect() { observers = observers.filter((c) => c !== this.cb); }
    unobserve() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
});

afterEach(() => { observers = []; cleanup(); });

/**
 * jsdom lays nothing out, so `scrollWidth`/`clientWidth` are 0 and the grid can
 * never look scrollable. These stub the one measurement the effect reads.
 */
function makeScrollable(el: HTMLElement, { scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
}

function mount(week = DAYS) {
  const scrollerRef = createRef<HTMLDivElement>();
  const gridRef = createRef<HTMLDivElement>();
  const { rerender } = render(
    createElement(WeekGrid, {
      days: week,
      today: TODAY,
      nowMinute: 600,
      windows: [],
      scrollWindow: RANGE,
      scrollerRef,
      gridRef,
      children: () => null,
    }),
  );
  const scroller = scrollerRef.current as HTMLElement;
  return { scroller, rerender, scrollerRef, gridRef };
}

const resize = () => act(() => { observers.forEach((cb) => cb()); });

describe('centring on today', () => {
  it('does nothing while the whole week fits', () => {
    const { scroller } = mount();
    makeScrollable(scroller, { scrollWidth: 800, clientWidth: 800 });
    resize();
    expect(scroller.scrollLeft).toBe(0);
  });

  /**
   * The gap the ResizeObserver exists to close: not scrollable at mount, then
   * the window is dragged narrower.
   */
  it('centres the first time it becomes scrollable', () => {
    const { scroller } = mount();
    makeScrollable(scroller, { scrollWidth: 780, clientWidth: 420 });
    resize();
    expect(scroller.scrollLeft).toBeGreaterThan(0);
  });

  it('centres only once — a second resize leaves the position alone', () => {
    const { scroller } = mount();
    makeScrollable(scroller, { scrollWidth: 780, clientWidth: 420 });
    resize();
    const settled = scroller.scrollLeft;

    scroller.scrollLeft = 0; // stand in for any later layout nudge
    resize();

    expect(scroller.scrollLeft).toBe(0);
    expect(settled).toBeGreaterThan(0);
  });
});

describe('respecting a manual scroll', () => {
  it('never moves the grid again once the user has scrolled it', () => {
    const { scroller } = mount();
    makeScrollable(scroller, { scrollWidth: 780, clientWidth: 420 });

    // The user drags to Friday before it ever became scrollable enough to centre.
    scroller.scrollLeft = 700;
    act(() => { scroller.dispatchEvent(new Event('scroll')); });

    resize();
    expect(scroller.scrollLeft).toBe(700);
  });

  it('does not mistake its OWN scroll for the user’s', () => {
    const { scroller } = mount();
    makeScrollable(scroller, { scrollWidth: 780, clientWidth: 420 });
    resize(); // programmatic centring
    const centred = scroller.scrollLeft;
    expect(centred).toBeGreaterThan(0);

    // The browser dispatches a scroll event for that write. It must be consumed,
    // not recorded as a user gesture — otherwise the NEXT week would never centre.
    act(() => { scroller.dispatchEvent(new Event('scroll')); });

    const next = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
    cleanup();
    const second = mount(next);
    makeScrollable(second.scroller, { scrollWidth: 780, clientWidth: 420 });
    resize();
    // `today` is not in that week, so there is nothing to centre on — the point
    // is only that the effect ran rather than being latched off.
    expect(second.scroller.scrollLeft).toBe(0);
  });
});

describe('changing week', () => {
  it('re-arms centring, so a manual scroll does not leak into the next week', () => {
    const { scroller, rerender, scrollerRef, gridRef } = mount();
    makeScrollable(scroller, { scrollWidth: 780, clientWidth: 420 });
    scroller.scrollLeft = 700;
    act(() => { scroller.dispatchEvent(new Event('scroll')); });
    resize();
    expect(scroller.scrollLeft).toBe(700); // honoured for THIS week

    // Same week shown again but re-rendered around today: re-arms and centres.
    const shifted = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'];
    act(() => {
      rerender(
        createElement(WeekGrid, {
          days: shifted.map((d) => d),
          today: TODAY,
          nowMinute: 601,
          windows: [],
          scrollWindow: RANGE,
          scrollerRef,
          gridRef,
          children: () => null,
        }),
      );
    });
    // A pure re-render of the SAME week must not re-centre — that was the
    // original every-render bug.
    resize();
    expect(scroller.scrollLeft).toBe(700);
  });
});

describe('vertical restoration', () => {
  it('scrolls to the start of the working window rather than to midnight', () => {
    const scrollerRef = createRef<HTMLDivElement>();
    const gridRef = createRef<HTMLDivElement>();
    render(
      <WeekGrid
        days={DAYS}
        today={DAYS[3]}
        nowMinute={null}
        windows={[]}
        scrollWindow={{ startMin: 540, endMin: 1080 }}
        scrollerRef={scrollerRef}
        gridRef={gridRef}
      >
        {() => null}
      </WeekGrid>,
    );
    // 09:00 at 1px/minute.
    expect(scrollerRef.current?.scrollTop).toBe(540);
  });
});
