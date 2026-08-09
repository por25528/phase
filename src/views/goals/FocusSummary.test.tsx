// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FocusSummary as Model } from '../../lib/plan';
import { FocusSummary } from './FocusSummary';

const model = (over: Partial<Model> = {}): Model => ({
  slots: { used: 1, limit: 3, goalIds: ['a'] },
  needsFirstStep: { count: 0, goalIds: [] },
  behind: { count: 0, goalIds: [] },
  plannedRemaining: { count: 0, goalIds: [] },
  blocked: { count: 0, goalIds: [] },
  ...over,
}) as Model;

function mount(summary: Model, active: Parameters<typeof FocusSummary>[0]['active'] = null) {
  const onToggle = vi.fn();
  const onClear = vi.fn();
  render(createElement(FocusSummary, { summary, active, onToggle, onClear }));
  return { onToggle, onClear };
}

afterEach(() => cleanup());

describe('the board’s attention signals', () => {
  /**
   * They were five bordered, shadowed tiles with 24px numerals standing between
   * the reader and the goals, on every visit, whether or not any of them
   * applied — and on a common laptop height that pushed the first card below
   * the fold.
   */
  it('is a row of filters, not a band of cards', () => {
    mount(model({ behind: { count: 2, goalIds: ['a', 'b'] } } as Partial<Model>));
    const group = screen.getByRole('group', { name: 'Filter goals' });
    expect(group.className).not.toContain('grid');
    expect(group.querySelector('.shadow-card')).toBeNull();
  });

  /**
   * A permanent row of zeroes is a region people learn to skip, which is the
   * failure the tiles had — just shorter.
   */
  it('drops a signal with nothing behind it rather than greying it', () => {
    mount(model({ behind: { count: 2, goalIds: ['a', 'b'] } } as Partial<Model>));
    expect(screen.getAllByRole('button')).toHaveLength(2); // slots + behind
    expect(screen.queryByText(/every task stuck/)).toBeNull();
  });

  it('renders nothing at all when no signal applies', () => {
    const { container } = render(createElement(FocusSummary, {
      summary: model({ slots: { used: 0, limit: 3, goalIds: [] } } as Partial<Model>),
      active: null,
      onToggle: vi.fn(),
      onClear: vi.fn(),
    }));
    expect(container.firstChild).toBeNull();
  });

  it('reports the filter it is, and toggles it', () => {
    const { onToggle } = mount(model({ behind: { count: 2, goalIds: ['a', 'b'] } } as Partial<Model>));
    const chip = screen.getByRole('button', { name: /Schedule: 2/ });

    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledWith('behind');
  });

  it('offers a way out once a filter is on', () => {
    const { onClear } = mount(model({ behind: { count: 2, goalIds: ['a', 'b'] } } as Partial<Model>), 'behind');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(onClear).toHaveBeenCalled();
  });
});
