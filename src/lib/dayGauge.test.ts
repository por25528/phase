import { describe, expect, it } from 'vitest';
import type { AvailabilityWindow } from '../db/types';
import { dayGauge } from './dayGauge';

/**
 * 2026-08-22 is a Saturday — `dowOf` 5 (0 = Monday).
 * 2026-08-24 is the Monday after — `dowOf` 0.
 */
const SAT = '2026-08-22';
const MON = '2026-08-24';

const nineToSix: AvailabilityWindow[] = [{ dow: 5, startMin: 540, endMin: 1080 }];

/** Close enough for a fraction: these are pixel positions, not money. */
const near = (value: number | null, expected: number) => {
  expect(value).not.toBeNull();
  expect(value!).toBeCloseTo(expected, 6);
};

describe('dayGauge', () => {
  it('spans the day’s window and puts the sittings on it in proportion', () => {
    const g = dayGauge({
      date: SAT,
      windows: nineToSix,
      // 10:00–11:00 and 14:00–15:30 of a 09:00–18:00 (540 minute) window.
      sittings: [{ startMin: 600, endMin: 660 }, { startMin: 840, endMin: 930 }],
      now: { date: SAT, minute: 720 },
    })!;

    expect(g.startMin).toBe(540);
    expect(g.endMin).toBe(1080);
    near(g.blocks[0].startFrac, 60 / 540);
    near(g.blocks[0].widthFrac, 60 / 540);
    near(g.blocks[1].startFrac, 300 / 540);
    near(g.blocks[1].widthFrac, 90 / 540);
  });

  it('marks every two hours strictly inside the window, and names the minute', () => {
    const g = dayGauge({
      date: SAT, windows: nineToSix, sittings: [], now: { date: SAT, minute: 720 },
    })!;

    // 10, 12, 14, 16 — the marks are anchored to MIDNIGHT, not to whenever the
    // window happens to open, so the scale reads as clock time rather than as
    // elapsed time. Not 18:00, which is the track's own right border.
    expect(g.ticks.map((t) => t.minute)).toEqual([600, 720, 840, 960]);
    near(g.ticks[0].frac, 60 / 540);
  });

  /**
   * The refusal, and the reason this returns `null` rather than an empty bar:
   * "nobody said when you work" and "you are out of time" are different
   * sentences, and only the page's words can tell them apart.
   */
  it('draws NOTHING when the day has no window at all', () => {
    expect(dayGauge({
      date: SAT, windows: [], sittings: [], now: { date: SAT, minute: 720 },
    })).toBeNull();

    // A window set, but not for this weekday — a day off is still no window.
    expect(dayGauge({
      date: SAT,
      windows: [{ dow: 0, startMin: 540, endMin: 1080 }],
      sittings: [],
      now: { date: SAT, minute: 720 },
    })).toBeNull();
  });

  it('draws a window with nothing on it', () => {
    const g = dayGauge({
      date: SAT, windows: nineToSix, sittings: [], now: { date: SAT, minute: 540 },
    })!;

    expect(g.blocks).toEqual([]);
    expect(g.open).toEqual([{ startFrac: 0, widthFrac: 1 }]);
  });

  it('clips a block that runs past the window rather than stretching the scale', () => {
    const g = dayGauge({
      date: SAT,
      windows: nineToSix,
      // 17:00–20:00: two hours of it are outside a window that shuts at 18:00.
      sittings: [{ startMin: 1020, endMin: 1200 }],
      now: { date: SAT, minute: 720 },
    })!;

    expect(g.endMin).toBe(1080);
    near(g.blocks[0].startFrac, 480 / 540);
    near(g.blocks[0].widthFrac, 60 / 540);
  });

  it('drops a block that falls entirely outside the window', () => {
    const g = dayGauge({
      date: SAT,
      windows: nineToSix,
      sittings: [{ startMin: 1200, endMin: 1260 }],
      now: { date: SAT, minute: 720 },
    })!;

    expect(g.blocks).toEqual([]);
  });

  /**
   * Not reachable through `parseAvailability`, which rejects a duplicate `dow`
   * — the model is one window per weekday today. The geometry takes a LIST
   * anyway, because hulling two windows and hulling one is the same code and
   * the gap between them then draws itself.
   */
  it('hulls multiple windows in one day and leaves the gap between them closed', () => {
    const g = dayGauge({
      date: SAT,
      windows: [
        { dow: 5, startMin: 540, endMin: 720 },   // 09:00–12:00
        { dow: 5, startMin: 840, endMin: 1080 },  // 14:00–18:00
      ],
      sittings: [],
      now: { date: SAT, minute: 600 },
    })!;

    expect(g.startMin).toBe(540);
    expect(g.endMin).toBe(1080);
    expect(g.open).toHaveLength(2);
    near(g.open[0].startFrac, 0);
    near(g.open[0].widthFrac, 180 / 540);
    near(g.open[1].startFrac, 300 / 540);
    near(g.open[1].widthFrac, 240 / 540);
  });

  it('takes the windows in start order however they were stored', () => {
    const g = dayGauge({
      date: SAT,
      windows: [
        { dow: 5, startMin: 840, endMin: 1080 },
        { dow: 5, startMin: 540, endMin: 720 },
      ],
      sittings: [],
      now: { date: SAT, minute: 600 },
    })!;

    near(g.open[0].startFrac, 0);
  });

  it('has nothing spent and no marker before the window opens', () => {
    const g = dayGauge({
      date: SAT, windows: nineToSix, sittings: [], now: { date: SAT, minute: 400 },
    })!;

    expect(g.spentFrac).toBe(0);
    // 06:40 is not a position on a 09:00–18:00 scale, and pinning the marker to
    // the left edge would say the day had begun.
    expect(g.nowFrac).toBeNull();
  });

  it('is wholly spent and unmarked after the window closes', () => {
    const g = dayGauge({
      date: SAT, windows: nineToSix, sittings: [], now: { date: SAT, minute: 1300 },
    })!;

    expect(g.spentFrac).toBe(1);
    expect(g.nowFrac).toBeNull();
  });

  it('marks the clock and the spent head at the same place inside the window', () => {
    const g = dayGauge({
      date: SAT, windows: nineToSix, sittings: [], now: { date: SAT, minute: 1000 },
    })!;

    near(g.nowFrac, 460 / 540);
    near(g.spentFrac, 460 / 540);
  });

  it('dims nothing and marks nothing on a day that is not today', () => {
    const g = dayGauge({
      date: MON,
      windows: [{ dow: 0, startMin: 540, endMin: 1080 }],
      sittings: [{ startMin: 600, endMin: 660 }],
      now: { date: SAT, minute: 1000 },
    })!;

    expect(g.nowFrac).toBeNull();
    expect(g.spentFrac).toBeNull();
    // The work on it is still drawn: only the tense is absent.
    expect(g.blocks).toHaveLength(1);
  });

  it('refuses a window with no span rather than dividing by it', () => {
    expect(dayGauge({
      date: SAT,
      windows: [{ dow: 5, startMin: 600, endMin: 600 }],
      sittings: [],
      now: { date: SAT, minute: 600 },
    })).toBeNull();
  });
});
