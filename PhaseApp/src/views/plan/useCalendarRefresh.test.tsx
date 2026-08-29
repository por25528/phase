// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { useCalendarRefresh, CALENDAR_STALE_MS } from './useCalendarRefresh';
import type { DateRange } from '../../lib/calendarRange';

// Hoisted: `vi.mock`'s factory runs before module-level consts are assigned,
// so the mock has to be created inside the hoisted block.
const { refreshCalendar } = vi.hoisted(() => ({
  refreshCalendar: vi.fn(async (_week?: string) => {}),
}));
vi.mock('../../state/store', () => ({ actions: { refreshCalendar } }));

function Harness({ weekStart, range, fetchedAt }: {
  weekStart: string; range: DateRange | null; fetchedAt: string | null;
}) {
  useCalendarRefresh(weekStart, range, fetchedAt);
  return null;
}

const COVERING: DateRange = { rangeStart: '2026-07-27', rangeEnd: '2026-09-28' };

beforeEach(() => {
  refreshCalendar.mockClear();
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
});
