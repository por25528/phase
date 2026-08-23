// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanNotice } from './PlanNotice';

afterEach(cleanup);

/*
 * There were two notices, and most of this file was about which one won: the
 * working-hours one outranked the drag hint, because it described a state that
 * made the hint's advice impossible to follow. Both the state and the notice
 * are gone, so there is one notice and nothing to arbitrate.
 */
describe('PlanNotice', () => {
  it('shows the drag hint when asked', () => {
    render(<PlanNotice showHint />);
    expect(screen.getByText(/onto a day/)).toBeTruthy();
  });

  it('has no working-hours notice left to show', () => {
    render(<PlanNotice showHint />);
    expect(screen.queryByRole('button', { name: 'Set your working hours' })).toBeNull();
  });

  it('renders nothing when the hint does not apply', () => {
    const { container } = render(<PlanNotice showHint={false} />);
    expect(container.firstChild).toBeNull();
  });
});
