// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clockLabel } from '../../lib/clock';
import { NowDivider } from './NowDivider';

/**
 * `clockLabel` follows the LOCALE's hour cycle — `14:32` in a 24-hour locale,
 * `2:32pm` in a 12-hour one — and caches the resolved cycle at module scope on
 * first call, so it cannot be re-pointed after the fact. `clock.test.ts` dodges
 * this by passing the hour-cycle flag explicitly at every call; a component
 * cannot, because it calls `clockLabel(nowMinute)` with one argument.
 *
 * So the formatting is stubbed out. `clockLabel` is exhaustively covered by its
 * own suite; what belongs HERE is the divider's own job — that it renders that
 * label and builds its accessible name from it.
 */
vi.mock('../../lib/clock', () => ({ clockLabel: vi.fn(() => '2:32pm') }));

afterEach(cleanup);

/**
 * The boundary between the day behind you and the day ahead was a bare
 * `h-px bg-accent` marked `aria-hidden`: it spent the app's one accent colour
 * on a rule that said nothing, and said nothing at all to a screen reader.
 * A separator that earns the accent names the minute it is drawn at.
 */
describe('NowDivider', () => {
  it('shows the current time', () => {
    render(<NowDivider nowMinute={14 * 60 + 32} />);
    expect(screen.getByText('2:32pm')).toBeTruthy();
  });

  it('is a labelled separator, not a hidden rule', () => {
    render(<NowDivider nowMinute={14 * 60 + 32} />);
    const sep = screen.getByRole('separator');
    expect(sep.getAttribute('aria-label')).toBe('Now, 2:32pm');
  });

  it('formats the minute it was given, not one it derived', () => {
    render(<NowDivider nowMinute={9 * 60} />);
    expect(vi.mocked(clockLabel).mock.calls.some((c) => c[0] === 540)).toBe(true);
  });
});
