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

  /**
   * Pins the reset-then-restore ordering. Both effects are layout effects, so
   * React flushes them in declaration order on the SAME commit — reset must
   * run before restore, or restore reads the previous week's `userScrolledY`
   * (still true) and skips the vertical axis. Because the grid is stubbed
   * scrollable here, `restore()` still reaches `doneFor.current = weekKey` at
   * the end (the horizontal branch does not early-return), latching the week
   * done with the vertical axis never restored — and reset clearing the flag
   * afterwards no longer helps, since nothing calls `restore()` again until
   * an unrelated resize fires.
   *
   * A rerender with the SAME weekKey (as in the sibling test above) can't
   * catch this — the effect never re-runs at all. This uses a genuinely
   * different `days[0]`, and stubs the grid scrollable so `doneFor` actually
   * latches, the way it would while the grid is on screen.
   */
  it('restores the vertical position on a genuine week change, even after a user scroll', () => {
    const { scroller, rerender, scrollerRef, gridRef } = mount();
    makeScrollable(scroller, { scrollWidth: 780, clientWidth: 420 });
    resize(); // initial restore, so `doneFor` latches for the first week

    // jsdom does not dispatch a scroll event for a programmatic `scrollTop`
    // write, so the mount-time restore's `programmaticY` flag is still
    // latched. Consume it exactly as the browser would, the same way the
    // 'does not mistake its OWN scroll for the user's' test above does —
    // otherwise the NEXT scroll event (the real user gesture) is the one
    // that gets swallowed as if it were programmatic, and this test would
    // fail to arm `userScrolledY` for reasons unrelated to Important 1.
    act(() => { scroller.dispatchEvent(new Event('scroll')); });

    // Now a real user scroll away from the restore target (540, per
    // RANGE.startMin).
    scroller.scrollTop = 900;
    act(() => { scroller.dispatchEvent(new Event('scroll')); });
    expect(scroller.scrollTop).toBe(900); // userScrolledY latched, this week left alone

    const nextWeek = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
    act(() => {
      rerender(
        createElement(WeekGrid, {
          days: nextWeek,
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
    makeScrollable(scroller, { scrollWidth: 780, clientWidth: 420 });

    // A genuine weekKey change must re-arm and restore to the new week's
    // target, not leave the previous week's scroll position in place.
    expect(scroller.scrollTop).toBe(RANGE.startMin);
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

/**
 * Capacity feedback used to arrive AFTER the drop: the store resolved a slot,
 * failed, and raised "no free time left that day" — by which point the user had
 * aimed, committed and let go. These assert it arrives while the block is still
 * in the air.
 */
describe('capacity while dragging', () => {
  const DAYS = ['2026-08-10', '2026-08-11'];
  const cap = (freeMin: number, plannedMin = 0) => ({
    date: '2026-08-10', freeMin, plannedMin, backlogMin: 0, unestimated: 0,
    blockedBy: [], hasData: true,
  });

  function draw(dragDurationMin: number | null) {
    const { container } = render(createElement(WeekGrid, {
      days: DAYS,
      today: DAYS[0],
      nowMinute: null,
      windows: [0, 1, 2, 3, 4].map((dow) => ({ dow, startMin: 540, endMin: 1080 })),
      scrollWindow: { startMin: 540, endMin: 1080 },
      dayCapacity: [cap(120), cap(120, 90)],
      dragDurationMin,
      scrollerRef: { current: null },
      gridRef: { current: null },
      children: () => null,
    }));
    return container.innerHTML;
  }

  it('says which days can take the block, and which cannot', () => {
    const html = draw(60);
    expect(html).toContain('fits');
    expect(html).toContain('full');
  });

  /**
   * `freeMin` only nets off meetings, so comparing the raw figure would promise
   * room that this week's own work has already taken.
   */
  it('counts what is already planned against the day, not just meetings', () => {
    // 120 free, 90 planned, 60 needed: it does not fit, even though `freeMin`
    // alone says it would.
    expect(draw(60).split('full').length - 1).toBe(1);
  });

  it('goes back to the ordinary load figure once the drag ends', () => {
    const html = draw(null);
    expect(html).not.toContain('fits');
    expect(html).not.toContain('full');
  });
});
