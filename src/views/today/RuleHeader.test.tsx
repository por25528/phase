// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RuleHeader } from './RuleHeader';
import { ruleTag } from '../../components/sectionLabel';

afterEach(cleanup);

/**
 * The rule is the section, and now the label is the rule. These pin the three
 * things a caller can get wrong about it — inherited from `SectionHeader`'s
 * own tests, which is what this component replaced.
 */
describe('RuleHeader', () => {
  it('speaks the rule-tag voice, in a cell on the rule itself', () => {
    render(<RuleHeader label="Carried over" />);

    const label = screen.getByRole('heading', { name: 'Carried over' });
    expect(label.className).toContain(ruleTag);
    // The cell IS the separation: its own border is what lets the tag carry
    // ink instead of receding the way a floating label has to.
    expect(label.className).toContain('border-r');
    expect(label.parentElement!.className).toContain('border-b');
  });

  it('draws the rule with nothing on its far end when the section has no fact', () => {
    const { container } = render(<RuleHeader label="Rest of today" />);

    // Tag, spacer — and no third cell inventing a figure the rows already show.
    expect(container.querySelector('div')!.childElementCount).toBe(2);
  });

  it('carries a fact on the reading edge when given one', () => {
    render(<RuleHeader label="Free time" right="2h 30m free today" />);

    expect(screen.getByText('2h 30m free today')).toBeTruthy();
  });

  it('draws a zero, which is a fact, and not an absent one', () => {
    render(<RuleHeader label="Carried over" right={0} />);

    // `right &&` would swallow this — 0 is falsy and "0" is a thing to say.
    expect(screen.getByText('0')).toBeTruthy();
  });
});
