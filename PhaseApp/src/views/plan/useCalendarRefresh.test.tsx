// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { useCalendarRefresh } from './useCalendarRefresh';
import { CALENDAR_STALE_MS } from '../../lib/calendarHealth';
import { MAX_FORWARD_DAYS, type DateRange } from '../../lib/calendarRange';
import { addDays, todayStr } from '../../lib/dates';
import { weekOf } from '../../lib/plan';

// Hoisted: `vi.mock`'s factory runs before module-level consts are assigned,
// so the mock has to be created inside the hoisted block.
const { refreshCalendar, setCalendarWeek } = vi.hoisted(() => ({
  refreshCalendar: vi.fn(async (_week?: string) => {}),
  setCalendarWeek: vi.fn((_week: string) => {}),
}));
vi.mock('../../state/store', () => ({ actions: { refreshCalendar, setCalendarWeek } }));

function Harness({ weekStart, range, fetchedAt }: {
  weekStart: string; range: DateRange | null; fetchedAt: string | null;
}) {
  useCalendarRefresh(weekStart, range, fetchedAt);
  return null;
}

const COVERING: DateRange = { rangeStart: '2026-07-27', rangeEnd: '2026-09-28' };

beforeEach(() => {
  refreshCalendar.mockClear();
  setCalendarWeek.mockClear();
  vi.useRealTimers();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useCalendarRefresh', () => {
  it('refreshes once when the planner opens', () => {
    render(<Harness weekStart="2026-08-03" range={null} fetchedAt={null} />);
    expect(refreshCalendar).toHaveBeenCalledTimes(1);
    expect(refreshCalendar).toHaveBeenCalledWith('2026-08-03');
  });

  it('refreshes when the user navigates past the cached range', () => {
    const { rerender } = render(
      <Harness weekStart="2026-08-03" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />,
    );
    refreshCalendar.mockClear();

    rerender(<Harness weekStart="2026-11-30" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />);

    expect(refreshCalendar).toHaveBeenCalledWith('2026-11-30');
  });

  // The discriminating test. Paging back and forth inside the cached window is
  // the single most common thing a user does on this screen; refetching on
  // each step would spend a Google quota to learn nothing.
  it('does not refresh when navigating inside the cached range', () => {
    const { rerender } = render(
      <Harness weekStart="2026-08-03" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />,
    );
    refreshCalendar.mockClear();

    rerender(<Harness weekStart="2026-08-10" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />);

    expect(refreshCalendar).not.toHaveBeenCalled();
  });

  it('refreshes on focus once the cache is older than the stale interval', () => {
    render(<Harness weekStart="2026-08-03" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />);
    refreshCalendar.mockClear();

    vi.setSystemTime(new Date(Date.now() + CALENDAR_STALE_MS + 1000));
    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(refreshCalendar).toHaveBeenCalledTimes(1);
  });

  it('ignores a focus while the cache is still fresh', () => {
    render(<Harness weekStart="2026-08-03" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />);
    refreshCalendar.mockClear();

    vi.setSystemTime(new Date(Date.now() + 60_000));
    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(refreshCalendar).not.toHaveBeenCalled();
  });

  // The listener is registered once and reads through a ref, so it has to see
  // the week the user is actually on — not the one they opened on.
  it('refreshes the week currently on screen, not the one it mounted with', () => {
    const { rerender } = render(
      <Harness weekStart="2026-08-03" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />,
    );
    rerender(<Harness weekStart="2026-08-17" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />);
    refreshCalendar.mockClear();

    vi.setSystemTime(new Date(Date.now() + CALENDAR_STALE_MS + 1000));
    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(refreshCalendar).toHaveBeenCalledWith('2026-08-17');
  });

  it('stops listening once the planner unmounts', () => {
    const { unmount } = render(
      <Harness weekStart="2026-08-03" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />,
    );
    unmount();
    refreshCalendar.mockClear();

    vi.setSystemTime(new Date(Date.now() + CALENDAR_STALE_MS + 1000));
    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(refreshCalendar).not.toHaveBeenCalled();
  });

  // Every trigger anchors on the week the user is actually looking at, so the
  // store publishes it — that is what lets Connect and Settings' Refresh reach
  // the same week rather than only the current one.
  it('publishes the week on screen to the store', () => {
    const { rerender } = render(<Harness weekStart="2026-08-03" range={COVERING} fetchedAt={null} />);
    expect(setCalendarWeek).toHaveBeenCalledWith('2026-08-03');

    rerender(<Harness weekStart="2026-08-10" range={COVERING} fetchedAt={null} />);
    expect(setCalendarWeek).toHaveBeenLastCalledWith('2026-08-10');
  });

  /*
   * A week past what `fetchRange` can reach comes back uncovered every time.
   * Retrying it once per navigation is a fetch per keystroke that cannot
   * change the answer.
   */
  it('does not chase a week past the horizon', () => {
    const far = weekOf(addDays(todayStr(), MAX_FORWARD_DAYS + 30));
    render(<Harness weekStart={far} range={COVERING} fetchedAt={null} />);
    expect(refreshCalendar).not.toHaveBeenCalled();
  });

  it('still fetches for a week that is merely not cached yet', () => {
    const near = weekOf(addDays(todayStr(), 90));
    render(<Harness weekStart={near} range={COVERING} fetchedAt={null} />);
    expect(refreshCalendar).toHaveBeenCalledWith(near);
  });

  /*
   * The discriminating test for the missing dependency. A range arriving that
   * still does not cover the week on screen has to be retried — otherwise a
   * connect made while parked on an uncovered week leaves it caveated with no
   * trigger that will ever clear it.
   */
  it('retries when a new range arrives that still does not cover the week', () => {
    const week = weekOf(addDays(todayStr(), 90));
    const { rerender } = render(<Harness weekStart={week} range={null} fetchedAt={null} />);
    refreshCalendar.mockClear();

    rerender(<Harness weekStart={week} range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />);

    expect(refreshCalendar).toHaveBeenCalledWith(week);
  });

  // The other half: a range that DOES cover it must end the cycle, or the two
  // effects chase each other forever.
  it('stops once a range arrives that covers the week', () => {
    const week = '2026-08-31';
    const { rerender } = render(<Harness weekStart={week} range={null} fetchedAt={null} />);
    refreshCalendar.mockClear();

    rerender(<Harness weekStart={week} range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />);

    expect(refreshCalendar).not.toHaveBeenCalled();
  });
});
