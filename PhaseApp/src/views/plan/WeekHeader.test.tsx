// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WeekHeader } from './WeekHeader';
import type { WeekCapacity } from '../../lib/capacity';

afterEach(cleanup);

const cap: WeekCapacity = {
  days: [
    { date: '2026-08-10', plannedMin: 60, backlogMin: 0, unestimated: 0, blockedBy: [], hasData: false },
    { date: '2026-08-11', plannedMin: 60, backlogMin: 0, unestimated: 0, blockedBy: [], hasData: false },
  ], plannedMin: 120, backlogMin: 0, unestimated: 2, hasData: false,
};

const noop = () => {};
const base = {
  weekStart: '2026-08-10',
  isPast: false,
  capacity: cap,
  onPrev: noop, onNext: noop, onToday: noop,
};

describe('WeekHeader', () => {
  // `text-h1` → `text-mast`: the range is the Instrument header's masthead
  // now, a step above a document's own title. Still the UI face and still a
  // real heading — the two things this test has always been about.
  it('renders the range as a real heading, not a section label', () => {
    render(<WeekHeader {...base} />);
    const h = screen.getByRole('heading', { level: 2 });
    expect(h.className).toContain('text-mast');
    expect(h.className).not.toContain('uppercase');
    expect(h.className).not.toContain('font-disp');
  });

  it('stamps the week number and year above the range', () => {
    render(<WeekHeader {...base} />);
    // 2026-08-10 is the Monday of ISO week 33.
    expect(screen.getByText('Week 33')).toBeTruthy();
    // The stamp carries what the heading below it cannot: the year.
    expect(screen.getByText('10 – 16 Aug 2026')).toBeTruthy();
  });

  it('stamps nothing in month mode', () => {
    render(<WeekHeader {...base} mode="month" monthCapacity={cap} />);
    expect(screen.queryByText(/^Week /)).toBeNull();
  });

  /*
   * The gauge and the bar are gone with the free time that gave them a
   * denominator. What is left is the figures, which is what the gauge was
   * always a second reading of.
   */
  it('draws no gauge and no bar, in either mode', () => {
    const { container, rerender } = render(<WeekHeader {...base} />);
    expect(container.querySelector('[data-testid="week-gauge"]')).toBeNull();
    expect(container.querySelector('[data-testid="meter-planned"]')).toBeNull();
    rerender(<WeekHeader {...base} mode="month" monthCapacity={cap} />);
    expect(container.querySelector('[data-testid="week-gauge"]')).toBeNull();
    expect(container.querySelector('[data-testid="meter-planned"]')).toBeNull();
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
    // The count is a key/value cell now, so the phrase lives in its
    // accessible name rather than in one text node. See LoadRule.test.
    expect(screen.getByLabelText('2 unestimated')).toBeTruthy();
  });

  it('says nothing about capacity in month mode until the month figure arrives', () => {
    render(<WeekHeader {...base} mode="month" />);
    // No month capacity handed down ⇒ no week figures relabelled as a month's.
    expect(screen.queryByLabelText('2 unestimated')).toBeNull();
  });

  /*
   * The tense split is gone with `freeMin`. What replaced it is a rule about
   * the CELLS themselves: `head` is spent exactly once, and it is `Planned` —
   * the week is planned against what is on it, now that nothing measures what
   * would fit.
   */
  it('leads with Planned and states no free figure at all', () => {
    render(<WeekHeader {...base} />);
    expect(document.querySelector('[data-fig="planned"]')?.textContent).toContain('2h');
    expect(document.querySelector('[data-fig="free"]')).toBeNull();
    expect(document.querySelector('[data-fig="left"]')).toBeNull();
    expect(document.querySelector('[data-fig="spent"]')).toBeNull();
  });

  /*
   * An untouched week draws its stamp and range alone. The rule is guarded on
   * the cells rather than on `capacity`, so a week with nothing planned and
   * four unpriced tasks still has one thing to say.
   */
  it('draws no rule at all for a week with nothing on it', () => {
    const empty: WeekCapacity = {
      days: [], plannedMin: 0, backlogMin: 0, unestimated: 0, hasData: false,
    };
    const { container } = render(<WeekHeader {...base} capacity={empty} />);
    expect(container.querySelector('[data-fig]')).toBeNull();
  });

  it('still draws the rule when the only thing to say is an unpriced count', () => {
    const unpriced: WeekCapacity = {
      days: [], plannedMin: 0, backlogMin: 0, unestimated: 4, hasData: false,
    };
    render(<WeekHeader {...base} capacity={unpriced} />);
    expect(screen.getByLabelText('4 unestimated')).toBeTruthy();
  });

  /*
   * The calendar caveat. `WeekHeader` used to take a `calendarAvailable`
   * boolean that nobody ever passed, and derive the string 'calendar not
   * connected' from `hasData` — a statement that becomes false the moment a
   * calendar CAN be connected and still be short of data. The header renders
   * the finished string now; `calendarHealth` decides it.
   */
  it('shows the caveat it is given', () => {
    render(<WeekHeader {...base} caveat="calendar needs reconnecting" />);
    expect(screen.getByText('calendar needs reconnecting')).toBeTruthy();
  });

  it('shows nothing when there is no caveat', () => {
    render(<WeekHeader {...base} caveat={null} />);
    expect(screen.queryByText(/calendar/i)).toBeNull();
  });

  it('shows no caveat when it is not given one at all', () => {
    render(<WeekHeader {...base} />);
    expect(screen.queryByText(/calendar/i)).toBeNull();
  });

  // The trap the old `capacityNote` comment warned about: the caveat must NOT
  // be conditional on having no blocks. A stale or partially-covered cache
  // produces blockedBy entries AND a caveat at the same time — exactly when it
  // matters most.
  it('still shows the caveat on a week that has busy blocks', () => {
    const withBlocks: WeekCapacity = {
      ...cap,
      days: [{
        date: '2026-08-10', plannedMin: 60, backlogMin: 0, unestimated: 0,
        blockedBy: ['standup'], hasData: false,
      }],
    };
    render(<WeekHeader {...base} capacity={withBlocks} caveat="no calendar data for this week" />);
    expect(screen.getByText('no calendar data for this week')).toBeTruthy();
  });

  it('still reports the week figures alongside the caveat', () => {
    render(<WeekHeader {...base} caveat="calendar not connected" />);
    expect(document.querySelector('[data-fig="planned"]')?.textContent).toContain('2h');
  });

  // Month mode reports a month, and a week's caveat under a month's heading
  // would be the same category error the figures already avoid.
  it('states no week caveat in month mode', () => {
    render(<WeekHeader {...base} mode="month" monthCapacity={cap} caveat="calendar not connected" />);
    expect(screen.queryByText('calendar not connected')).toBeNull();
  });
});
