// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SectionHeader } from './SectionHeader';
import { sectionLabel } from './sectionLabel';

afterEach(cleanup);

/**
 * Four labels floating in whitespace with no line anywhere is how Today came to
 * read as a page that had not finished loading. The rule is the section; these
 * pin the two things a caller can get wrong about it.
 */
describe('SectionHeader', () => {
  it('speaks the one label voice, on the rows’ own left edge', () => {
    render(<SectionHeader label="Carried over" />);

    const label = screen.getByRole('heading', { name: 'Carried over' });
    expect(label.className).toContain(sectionLabel);
    // `TaskRow` pads its content by the same 8px, so the label sits over the
    // checkbox rather than over the rule's own end.
    expect(label.className).toContain('px-[8px]');
    expect(label.parentElement!.className).toContain('border-b');
  });

  it('draws the rule with nothing on its far end when the section has no fact', () => {
    const { container } = render(<SectionHeader label="Rest of today" />);

    // Label, spacer — and no third child inventing a figure the rows already show.
    expect(container.querySelector('div')!.childElementCount).toBe(2);
  });

  it('carries a fact on the reading edge when given one', () => {
    render(<SectionHeader label="Free time" right="2h 30m free today" />);

    expect(screen.getByText('2h 30m free today')).toBeTruthy();
  });

  it('draws a zero, which is a fact, and not an absent one', () => {
    render(<SectionHeader label="Carried over" right={0} />);

    // `right &&` would swallow this — 0 is falsy and "0" is a thing to say.
    expect(screen.getByText('0')).toBeTruthy();
  });
});
