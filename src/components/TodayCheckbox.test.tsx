// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TodayCheckbox } from './TodayCheckbox';

afterEach(cleanup);

describe('TodayCheckbox', () => {
  it('uses the stronger border token when unchecked', () => {
    render(<TodayCheckbox checked={false} onToggle={() => {}} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.className).toContain('border-check');
    expect(checkbox.className).not.toContain('border-line-2');
  });

  it('uses the accent tokens when checked', () => {
    render(<TodayCheckbox checked onToggle={() => {}} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.className).toContain('border-accent');
    expect(checkbox.className).toContain('bg-accent');
  });

  it('reflects checked state through its checkbox semantics', () => {
    const { rerender } = render(<TodayCheckbox checked={false} onToggle={() => {}} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.getAttribute('aria-checked')).toBe('false');

    rerender(<TodayCheckbox checked onToggle={() => {}} />);
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
  });

  it('toggles when enabled but not when disabled', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<TodayCheckbox checked={false} onToggle={onToggle} />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<TodayCheckbox checked={false} onToggle={onToggle} disabled />);
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
