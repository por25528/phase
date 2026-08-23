// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LoadRule } from './LoadRule';
import type { LoadCell } from './capacityLabel';

afterEach(cleanup);

const priced = { plannedMin: 300, backlogMin: 60, unestimated: 0, hasData: false };
const unpriced = { plannedMin: 700, backlogMin: 100, unestimated: 3, hasData: false };

/*
 * `parts: string[]` became `cells: LoadCell[]`.
 *
 * The Instrument header states a figure as a key over a value, so a phrase
 * like `5h planned` is no longer one text node and `getByText` cannot see it.
 * Each cell carries `data-fig` for exactly this reason — a per-cell hook that
 * costs the user nothing, where a `title` repeating what is already on screen
 * would have been a tooltip written for a test.
 */
const CELLS: LoadCell[] = [
  { key: 'Planned', value: '5h', tone: 'head' },
  { key: 'To place', value: '1h', tone: 'quiet' },
];

function fig(container: HTMLElement, key: string): string {
  return container.querySelector(`[data-fig="${key}"]`)?.textContent ?? '';
}

describe('LoadRule', () => {
  it('renders the figures it is given, as a key over a value', () => {
    const { container } = render(<LoadRule figures={priced} cells={CELLS} />);
    expect(fig(container, 'planned')).toContain('Planned');
    expect(fig(container, 'planned')).toContain('5h');
    expect(fig(container, 'to place')).toContain('1h');
  });

  it('gives exactly one figure the headline tone', () => {
    const { container } = render(<LoadRule figures={priced} cells={CELLS} />);
    expect(container.querySelectorAll('.font-semibold.text-ink').length).toBe(1);
  });

  /*
   * The bar and the seven-cell gauge are both gone, with the free time that
   * gave them a denominator. A bar whose only denominator is its own value is
   * always exactly full, which is a decoration rather than a reading.
   */
  it('draws no bar and no gauge', () => {
    const { container } = render(<LoadRule figures={priced} cells={CELLS} />);
    expect(container.querySelector('[data-testid="meter-planned"]')).toBeNull();
    expect(container.querySelector('[data-testid="meter-backlog"]')).toBeNull();
    expect(container.querySelector('[data-testid="capacity-mark"]')).toBeNull();
    expect(container.querySelector('[data-testid="week-gauge"]')).toBeNull();
  });

  it('paints no warning colour — nothing on this rule passes a verdict', () => {
    const { container } = render(<LoadRule figures={unpriced} cells={CELLS} />);
    expect(container.innerHTML).not.toContain('bg-warn');
  });

  it('states its span when given one', () => {
    render(<LoadRule figures={priced} cells={[]} spanLabel="Jul 27 – Sep 6" />);
    expect(screen.getByText('Jul 27 – Sep 6')).toBeTruthy();
  });

  it('offers the unestimated count as a button when it can be opened', () => {
    render(
      <LoadRule
        figures={unpriced}
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
    const { container } = render(<LoadRule figures={unpriced} cells={[]} />);
    expect(screen.queryByRole('button', { name: /unestimated/i })).toBeNull();
    expect(fig(container, 'unestimated')).toContain('Unestimated');
    expect(screen.getByLabelText('3 unestimated')).toBeTruthy();
  });

  it('keeps the exception last, on the reading edge', () => {
    const { container } = render(<LoadRule figures={unpriced} cells={CELLS} />);
    const keys = Array.from(container.querySelectorAll('[data-fig]'))
      .map((el) => el.getAttribute('data-fig'));
    expect(keys[keys.length - 1]).toBe('unestimated');
  });
});
