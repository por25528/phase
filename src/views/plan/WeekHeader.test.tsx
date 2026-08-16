// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WeekHeader } from './WeekHeader';
import type { WeekCapacity } from '../../lib/capacity';

afterEach(cleanup);

const cap: WeekCapacity = {
  days: [
    { date: '2026-08-10', freeMin: 300, plannedMin: 60, backlogMin: 0, unestimated: 0, blockedBy: [], hasData: false },
    { date: '2026-08-11', freeMin: 300, plannedMin: 60, backlogMin: 0, unestimated: 0, blockedBy: [], hasData: false },
  ],
  freeMin: 600, plannedMin: 120, backlogMin: 0, unestimated: 2, hasData: false,
};

const noop = () => {};
const base = {
  weekStart: '2026-08-10',
  today: '2026-08-10',
  isPast: false,
  capacity: cap,
  onPrev: noop, onNext: noop, onToday: noop,
};

describe('WeekHeader', () => {
  it('renders the range as a real heading, not a section label', () => {
    render(<WeekHeader {...base} />);
    const h = screen.getByRole('heading', { level: 2 });
    expect(h.className).toContain('text-h1');
    expect(h.className).not.toContain('uppercase');
  });

  it('gives the nav arrows accessible names', () => {
    render(<WeekHeader {...base} />);
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy();
  });

  it('names the month on the arrows in month mode', () => {
    render(<WeekHeader {...base} mode="month" monthCapacity={cap} />);
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeTruthy();
  });

  // The bug this whole change exists to fix.
  it('reports capacity in month mode too', () => {
    render(
      <WeekHeader
        {...base}
        mode="month"
        monthCapacity={cap}
        monthSpanLabel="Jul 27 – Sep 6"
      />,
    );
    expect(screen.getByText('Jul 27 – Sep 6')).toBeTruthy();
    expect(screen.getByText('2 unestimated')).toBeTruthy();
  });

  it('says nothing about capacity in month mode until the month figure arrives', () => {
    render(<WeekHeader {...base} mode="month" />);
    // No month capacity handed down ⇒ no week figures relabelled as a month's.
    expect(screen.queryByText('2 unestimated')).toBeNull();
  });

  // Fix for: month mode used to call `loadParts`, which has no notion of
  // tense and prints the WHOLE window as "free" — a past day's `freeMin` is
  // its entire held window (NO_PAST_LIMIT), not what remains. Mid-month that
  // reads as "160h free" for hours that are mostly gone.
  it('splits a month\'s free figure by tense, same as a week', () => {
    const monthCap: WeekCapacity = {
      days: [
        // Before `today`: spent, not free.
        { date: '2026-08-10', freeMin: 300, plannedMin: 0, backlogMin: 0, unestimated: 0, blockedBy: [], hasData: false },
        { date: '2026-08-11', freeMin: 300, plannedMin: 0, backlogMin: 0, unestimated: 0, blockedBy: [], hasData: false },
        // On/after `today`: still ahead.
        { date: '2026-08-16', freeMin: 300, plannedMin: 0, backlogMin: 0, unestimated: 0, blockedBy: [], hasData: false },
        { date: '2026-08-17', freeMin: 300, plannedMin: 0, backlogMin: 0, unestimated: 0, blockedBy: [], hasData: false },
      ],
      freeMin: 1200, plannedMin: 0, backlogMin: 0, unestimated: 0, hasData: false,
    };
    render(
      <WeekHeader
        {...base}
        today="2026-08-16"
        mode="month"
        monthCapacity={monthCap}
        monthSpanLabel="Aug 3 – Aug 30"
      />,
    );
    // Spent: the two days before today (300 + 300 = 10h). Left: freeMin minus
    // spent (1200 - 600 = 600 = 10h).
    expect(screen.getByText('10h left')).toBeTruthy();
    expect(screen.getByText('10h spent')).toBeTruthy();
    expect(screen.queryByText(/^20h free$/)).toBeNull();
  });
});
