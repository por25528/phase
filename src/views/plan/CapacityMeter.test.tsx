// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CapacityMeter } from './CapacityMeter';
import type { DayGaugeCell, LoadCell } from './capacityLabel';

afterEach(cleanup);

const healthy = { freeMin: 600, plannedMin: 300, backlogMin: 60, unestimated: 0, hasData: false };
const over = { freeMin: 600, plannedMin: 700, backlogMin: 100, unestimated: 3, hasData: false };

/*
 * `parts: string[]` became `cells: LoadCell[]`.
 *
 * The Instrument header states a figure as a key over a value, so a phrase
 * like `10h free` is no longer one text node and `getByText` cannot see it.
 * Each cell carries `data-fig` for exactly this reason — a per-cell hook that
 * costs the user nothing, where a `title` repeating what is already on screen
 * would have been a tooltip written for a test.
 */
const CELLS: LoadCell[] = [
  { key: 'Free', value: '10h', tone: 'head' },
  { key: 'Planned', value: '5h', tone: 'quiet' },
];

const GAUGE: DayGaugeCell[] = [
  { date: '2026-08-10', plannedFrac: 0.2, backlogFrac: 0 },
  { date: '2026-08-11', plannedFrac: 1, backlogFrac: 0 },
];

function fig(container: HTMLElement, key: string): string {
  return container.querySelector(`[data-fig="${key}"]`)?.textContent ?? '';
}

describe('CapacityMeter', () => {
  it('renders the figures it is given, as a key over a value', () => {
    const { container } = render(<CapacityMeter figures={healthy} cells={CELLS} />);
    expect(fig(container, 'free')).toContain('Free');
    expect(fig(container, 'free')).toContain('10h');
    expect(fig(container, 'planned')).toContain('5h');
  });

  it('gives exactly one figure the headline tone', () => {
    const { container } = render(<CapacityMeter figures={healthy} cells={CELLS} />);
    const heads = container.querySelectorAll('.font-semibold.text-ink');
    expect(heads.length).toBe(1);
  });

  it('hides the capacity tick when the week fits', () => {
    const { container } = render(<CapacityMeter figures={healthy} cells={[]} />);
    expect(container.querySelector('[data-testid="capacity-mark"]')).toBeNull();
  });

  it('wears the healthy tokens on both segments when the week fits', () => {
    const { container } = render(<CapacityMeter figures={healthy} cells={[]} />);
    expect(container.querySelector('[data-testid="meter-planned"]')?.className)
      .toContain('bg-accent');
    expect(container.querySelector('[data-testid="meter-backlog"]')?.className)
      .toContain('bg-faint-2');
  });

  it('shows the capacity tick and warns on both segments when over', () => {
    const { container } = render(<CapacityMeter figures={over} cells={[]} />);
    expect(container.querySelector('[data-testid="capacity-mark"]')).toBeTruthy();
    const planned = container.querySelector('[data-testid="meter-planned"]')?.className;
    const backlog = container.querySelector('[data-testid="meter-backlog"]')?.className;
    expect(planned).toContain('bg-warn');
    expect(backlog).toContain('bg-warn/45');
    // The healthy tokens must be GONE, not merely joined by the warn ones.
    expect(planned).not.toContain('bg-accent');
    expect(backlog).not.toContain('bg-faint-2');
  });

  it('states its span when given one', () => {
    render(<CapacityMeter figures={healthy} cells={[]} spanLabel="Jul 27 – Sep 6" />);
    expect(screen.getByText('Jul 27 – Sep 6')).toBeTruthy();
  });

  /*
   * The gauge, and the one rule it must not break.
   *
   * `isOverCommitted` is a WEEK verdict. A cell may be drawn full — that is
   * what a day whose committed minutes exceed its free ones looks like — but
   * full is a drawing, and it must wear the same colour as every other cell,
   * because the only judgement on this surface is the week's.
   */
  describe('the seven-cell gauge', () => {
    it('draws one cell per day and marks today', () => {
      const { container } = render(
        <CapacityMeter figures={healthy} cells={[]} gauge={GAUGE} today="2026-08-11" />,
      );
      expect(container.querySelectorAll('[data-testid^="gauge-cell-"]').length).toBe(2);
      expect(container.querySelector('[data-testid="gauge-cell-2026-08-11"]')?.className)
        .toContain('ring-warn');
      expect(container.querySelector('[data-testid="gauge-cell-2026-08-10"]')?.className)
        .not.toContain('ring-warn');
    });

    it('passes no per-day verdict — a full cell wears the healthy colour', () => {
      const { container } = render(
        <CapacityMeter figures={healthy} cells={[]} gauge={GAUGE} today="2026-08-11" />,
      );
      // The second day is drawn full (plannedFrac 1) on a week that fits.
      const full = container.querySelector('[data-testid="gauge-planned-2026-08-11"]')?.className;
      expect(full).toContain('bg-accent');
      expect(full).not.toContain('bg-warn');
    });

    it('takes the week verdict whole when the week is over', () => {
      const { container } = render(
        <CapacityMeter figures={over} cells={[]} gauge={GAUGE} today="2026-08-11" />,
      );
      // Every cell, including the quiet one — the verdict is about the week.
      expect(container.querySelector('[data-testid="gauge-planned-2026-08-10"]')?.className)
        .toContain('bg-warn');
      expect(container.querySelector('[data-testid="gauge-planned-2026-08-11"]')?.className)
        .toContain('bg-warn');
    });

    it('falls back to the single bar when no gauge is handed down', () => {
      // Month mode. A seven-cell gauge is a week instrument.
      const { container } = render(<CapacityMeter figures={healthy} cells={[]} />);
      expect(container.querySelector('[data-testid="week-gauge"]')).toBeNull();
      expect(container.querySelector('[data-testid="meter-planned"]')).toBeTruthy();
    });
  });

  it('offers the unestimated count as a button when it can be opened', () => {
    render(
      <CapacityMeter
        figures={over}
        cells={[]}
        unestimatedOpen={false}
        onToggleUnestimated={() => {}}
      />,
    );
    // The accessible name is still the whole phrase. The cell splits the key
    // from the value on screen; a control announced as "3" would not say what
    // three of.
    const btn = screen.getByRole('button', { name: '3 unestimated' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('states the unestimated count as text when there is nowhere to open it', () => {
    const { container } = render(<CapacityMeter figures={over} cells={[]} />);
    expect(screen.queryByRole('button', { name: /unestimated/i })).toBeNull();
    expect(fig(container, 'unestimated')).toContain('Unestimated');
    expect(screen.getByLabelText('3 unestimated')).toBeTruthy();
  });

  it('keeps the exception last, on the reading edge', () => {
    const { container } = render(<CapacityMeter figures={over} cells={CELLS} />);
    const keys = Array.from(container.querySelectorAll('[data-fig]'))
      .map((el) => el.getAttribute('data-fig'));
    expect(keys[keys.length - 1]).toBe('unestimated');
  });
});
