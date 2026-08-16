// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanNotice } from './PlanNotice';

afterEach(cleanup);

describe('PlanNotice', () => {
  it('shows the availability notice when hours are unset', () => {
    render(<PlanNotice needsHours showHint onOpenSettings={() => {}} />);
    expect(screen.getByRole('button', { name: 'Set your working hours' })).toBeTruthy();
  });

  // Both at once used to render two identical bordered boxes stacked, pushing
  // the grid down. Availability wins: it describes a state that makes the
  // hint's advice impossible to follow.
  it('shows only the availability notice when both apply', () => {
    render(<PlanNotice needsHours showHint onOpenSettings={() => {}} />);
    expect(screen.queryByText(/onto a day/)).toBeNull();
  });

  it('shows the hint when hours are set', () => {
    render(<PlanNotice needsHours={false} showHint onOpenSettings={() => {}} />);
    expect(screen.getByText(/onto a day/)).toBeTruthy();
  });

  it('renders nothing when neither applies', () => {
    const { container } = render(
      <PlanNotice needsHours={false} showHint={false} onOpenSettings={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
