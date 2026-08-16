// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CapacityMeter } from './CapacityMeter';

afterEach(cleanup);

const healthy = { freeMin: 600, plannedMin: 300, backlogMin: 60, unestimated: 0, hasData: false };
const over = { freeMin: 600, plannedMin: 700, backlogMin: 100, unestimated: 3, hasData: false };

describe('CapacityMeter', () => {
  it('renders the parts it is given', () => {
    render(<CapacityMeter figures={healthy} parts={['10h free', '5h planned']} />);
    expect(screen.getByText('10h free')).toBeTruthy();
    expect(screen.getByText('5h planned')).toBeTruthy();
  });

  it('hides the capacity tick when the week fits', () => {
    const { container } = render(<CapacityMeter figures={healthy} parts={[]} />);
    expect(container.querySelector('[data-testid="capacity-mark"]')).toBeNull();
  });

  it('shows the capacity tick and warns when over', () => {
    const { container } = render(<CapacityMeter figures={over} parts={[]} />);
    expect(container.querySelector('[data-testid="capacity-mark"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="meter-planned"]')?.className)
      .toContain('bg-warn');
  });

  it('states its span when given one', () => {
    render(<CapacityMeter figures={healthy} parts={[]} spanLabel="Jul 27 – Sep 6" />);
    expect(screen.getByText('Jul 27 – Sep 6')).toBeTruthy();
  });

  it('offers the unestimated count as a button when it can be opened', () => {
    render(
      <CapacityMeter
        figures={over}
        parts={[]}
        unestimatedOpen={false}
        onToggleUnestimated={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /unestimated/i });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('states the unestimated count as text when there is nowhere to open it', () => {
    render(<CapacityMeter figures={over} parts={[]} />);
    expect(screen.queryByRole('button', { name: /unestimated/i })).toBeNull();
    expect(screen.getByText('3 unestimated')).toBeTruthy();
  });
});
