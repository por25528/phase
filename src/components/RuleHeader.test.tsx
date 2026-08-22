// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RULE_H, RuleHeader } from './RuleHeader';

afterEach(cleanup);

describe('RuleHeader', () => {
  it('sets the name and the fact at opposite ends of one rule', () => {
    const { container } = render(<RuleHeader label="Now" fact="1 / 3" />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain('border-b');
    expect(screen.getByText('Now')).toBeTruthy();
    expect(screen.getByText('1 / 3')).toBeTruthy();
    // The name's cell comes first and the fact's last, with the rule between.
    expect(row.firstElementChild!.textContent).toBe('Now');
    expect(row.lastElementChild!.textContent).toBe('1 / 3');
  });

  /**
   * The label voice is declared once in `sectionLabel.ts` — the only file the
   * design-scale guard lets declare it — and imported. A call site that spelled
   * the classes itself would pass this test and fail that one, which is the
   * point of asserting the shared string rather than its parts.
   */
  it('wears the shared rule-tag voice rather than a local one', () => {
    render(<RuleHeader label="Later" fact="0" />);
    // The voice is on the CELL; the inner span exists only so a name that
    // cannot fit its track truncates instead of spilling across the hairline.
    expect(screen.getByText('Later').parentElement!.className).toContain('font-mono');
    expect(screen.getByText('Later').className).toContain('truncate');
    expect(screen.getByText('0').className).toContain('tabular-nums');
  });

  it('takes a tone for the fact and leaves the name alone', () => {
    render(<RuleHeader label="Now" fact="4 / 3" factClassName="text-warn font-semibold" />);
    expect(screen.getByText('4 / 3').className).toContain('text-warn');
    expect(screen.getByText('Now').parentElement!.className).not.toContain('text-warn');
  });

  /**
   * The board's trailing margin draws one of these so its hairline continues
   * the four bays' — flush, which only holds because the height is fixed
   * rather than derived from a label that is not there.
   */
  it('draws a bare rule of the same height when it carries nothing', () => {
    const { container } = render(<RuleHeader />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain(RULE_H);
    expect(row.textContent).toBe('');
    // The spacer span survives — it IS the rule between the two absent cells.
    expect(row.children).toHaveLength(1);
  });

  it('draws no empty cell for a fact it was not given', () => {
    const { container } = render(<RuleHeader label="Someday" />);
    expect(container.firstElementChild!.children).toHaveLength(2);
  });
});
