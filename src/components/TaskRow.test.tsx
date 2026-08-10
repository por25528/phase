// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskRow } from './TaskRow';

afterEach(cleanup);

/**
 * A row needs an interactive checkbox AND a full-row click target. A button
 * inside a button is invalid and swallows the inner control's label, so the
 * row stretches ONE button across itself and raises the lead control above it.
 * These tests pin that shape, because it is the whole reason the component
 * exists rather than each surface hand-rolling its own row.
 */
describe('TaskRow', () => {
  it('renders the title and subtitle', () => {
    render(<TaskRow title="A Tour of Computer Systems" subtitle="CS:APP" />);
    expect(screen.getByText('A Tour of Computer Systems')).toBeTruthy();
    expect(screen.getByText('CS:APP')).toBeTruthy();
  });

  it('calls onOpen when the row is activated', () => {
    const onOpen = vi.fn();
    render(<TaskRow title="Read chapter 1" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Read chapter 1' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('never nests the lead control inside the row button', () => {
    render(
      <TaskRow
        title="Read chapter 1"
        onOpen={() => {}}
        lead={<button type="button" aria-label="Mark done" />}
      />,
    );
    const rowButton = screen.getByRole('button', { name: 'Read chapter 1' });
    const lead = screen.getByRole('button', { name: 'Mark done' });
    expect(rowButton.contains(lead)).toBe(false);
    expect(lead.parentElement?.className).toContain('z-10');
    expect(lead.parentElement?.className).toContain('relative');
  });

  it('stretches the row overlay across the button', () => {
    render(<TaskRow title="Read chapter 1" onOpen={() => {}} />);
    const rowButton = screen.getByRole('button', { name: 'Read chapter 1' });
    const overlay = rowButton.querySelector('[aria-hidden="true"]');
    expect(overlay).not.toBe(null);
    expect(overlay?.className).toContain('absolute');
    expect(overlay?.className).toContain('inset-0');
  });

  it('draws the focus ring on the stretched overlay', () => {
    render(<TaskRow title="Read chapter 1" onOpen={() => {}} />);
    const rowButton = screen.getByRole('button', { name: 'Read chapter 1' });
    const overlay = rowButton.querySelector('[aria-hidden="true"]');
    expect(rowButton.className).toContain('group');
    expect(overlay?.className).toContain('group-focus-visible:ring-2');
    expect(overlay?.className).toContain('group-focus-visible:ring-accent');
  });

  it('does not open the row when the lead control is clicked', () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    render(
      <TaskRow
        title="Read chapter 1"
        onOpen={onOpen}
        lead={<button type="button" aria-label="Mark done" onClick={onToggle} />}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('prefers an explicit ariaLabel over the title', () => {
    render(<TaskRow title="Read chapter 1" ariaLabel="Plan “Read chapter 1” tomorrow" onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Plan “Read chapter 1” tomorrow' })).toBeTruthy();
  });

  it('renders a static row with no button when onOpen is absent', () => {
    render(<TaskRow title="Read chapter 1" />);
    expect(screen.queryByRole('button')).toBe(null);
  });

  it('marks a completed row without hiding its text', () => {
    render(<TaskRow title="Read chapter 1" completed />);
    const title = screen.getByText('Read chapter 1');
    expect(title.className).toContain('line-through');
  });

  it('reserves the time cell only when a time is given', () => {
    const { container: withTime } = render(<TaskRow title="A" time="14:00" />);
    expect(withTime.textContent).toContain('14:00');
    expect(withTime.querySelector('[data-row-time]')?.className).toContain('w-[48px]');
    expect(withTime.querySelector('[data-row-time]')?.className).not.toContain('z-10');
    cleanup();
    const { container: without } = render(<TaskRow title="A" />);
    expect(without.querySelector('[data-row-time]')).toBe(null);
  });

  it('keeps the subtitle in the button name when no ariaLabel is given', () => {
    render(<TaskRow title="Read chapter 1" subtitle="CS:APP" onOpen={() => {}} />);
    const rowButton = screen.getByRole('button');
    expect(rowButton.getAttribute('aria-label')).toBe(null);
    expect(rowButton.textContent).toContain('CS:APP');
  });
});
