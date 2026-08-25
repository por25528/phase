// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LifeTabs } from './LifeTabs';
import type { LifeTab } from '../../lib/lifeScope';

const TABS: LifeTab[] = [
  { scope: 'all', label: 'All' },
  { scope: 'uni', label: 'University' },
  { scope: 'startup', label: 'Startup' },
];

afterEach(cleanup);

describe('LifeTabs', () => {
  it('renders nothing when no life has been named', () => {
    const { container } = render(<LifeTabs tabs={[]} scope="all" onChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('marks exactly the active tab selected', () => {
    render(<LifeTabs tabs={TABS} scope="uni" onChange={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
  });

  it('reports the scope it was clicked on', async () => {
    const onChange = vi.fn();
    render(<LifeTabs tabs={TABS} scope="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Startup' }));
    expect(onChange).toHaveBeenCalledWith('startup');
  });

  it('keeps one tab stop and moves with the arrow keys', async () => {
    const onChange = vi.fn();
    render(<LifeTabs tabs={TABS} scope="all" onChange={onChange} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    tabs[0].focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('uni');
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenCalledWith('startup');
  });
});
