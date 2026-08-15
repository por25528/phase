// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantSurface } from './AssistantSurface';
import type { AssistantSnapshot } from '../../lib/assistantProtocol';
import type { RecommendedWork } from '../../lib/executionAdvisor';
import { ghostBtn, primaryBtn, secondaryBtn } from '../dialogStyles';

// The surface reads Reduce Motion, so it needs a stable matchMedia.
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(cleanup);

function work(over: Partial<RecommendedWork> = {}): RecommendedWork {
  return {
    key: 'step:n1',
    ref: { kind: 'step', id: 'n1', goalId: 'g1' },
    title: 'Problem set 4',
    goalTitle: 'Algorithms',
    reason: 'scheduled-now',
    expected: { kind: 'estimate', minutes: 45 },
    ...over,
  };
}

function ready(over: Partial<Extract<AssistantSnapshot, { status: 'ready' }>> = {}): AssistantSnapshot {
  return {
    status: 'ready',
    advice: { kind: 'work', primary: work(), alternatives: [] },
    activeFocus: null,
    timeLevel: 'medium',
    detailLevel: 'medium',
    ...over,
  };
}

describe('AssistantSurface', () => {
  it('renders skeleton rows while loading, not a spinner or a blank pane', () => {
    render(<AssistantSurface snapshot={{ status: 'loading' }} onAction={() => {}} />);
    expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/loading/i)).toBeNull();
  });

  it('makes the one primary recommendation the focal heading', () => {
    render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Problem set 4' })).toBeTruthy();
  });

  it('shows the alternatives without asking for a click', () => {
    const alternatives = [work({ key: 'step:n2', title: 'Read chapter 5' })];
    render(
      <AssistantSurface
        snapshot={ready({ advice: { kind: 'work', primary: work(), alternatives } })}
        onAction={() => {}}
        presentation="shelf"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Other options' })).toBeNull();
    expect(screen.getByRole('button', { name: /Read chapter 5/ })).toBeTruthy();
  });

  it('hands over one thing and no menu at the lowest detail', () => {
    const alternatives = [
      work({ key: 'step:n2', title: 'Read chapter 5' }),
      work({ key: 'step:n3', title: 'Pitch deck' }),
    ];
    render(
      <AssistantSurface
        snapshot={ready({ detailLevel: 'low', advice: { kind: 'work', primary: work(), alternatives } })}
        onAction={() => {}}
        presentation="shelf"
      />,
    );
    expect(screen.queryByText('Read chapter 5')).toBeNull();
    expect(screen.queryByText('Pitch deck')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Problem set 4' })).toBeTruthy();
  });

  it('offers one alternative at medium and two at high', () => {
    const alternatives = [
      work({ key: 'step:n2', title: 'Read chapter 5' }),
      work({ key: 'step:n3', title: 'Pitch deck' }),
    ];
    const advice = { kind: 'work' as const, primary: work(), alternatives };

    const { rerender } = render(
      <AssistantSurface snapshot={ready({ detailLevel: 'medium', advice })} onAction={() => {}} presentation="shelf" />,
    );
    expect(screen.getByText('Read chapter 5')).toBeTruthy();
    expect(screen.queryByText('Pitch deck')).toBeNull();

    rerender(
      <AssistantSurface snapshot={ready({ detailLevel: 'high', advice })} onAction={() => {}} presentation="shelf" />,
    );
    expect(screen.getByText('Pitch deck')).toBeTruthy();
  });

  it('withholds the column while a session is running', () => {
    const focus = {
      ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
      title: 'Problem set 4', phase: 'active' as const,
      elapsedMin: 12, expected: { kind: 'estimate' as const, minutes: 45 },
    };
    const alternatives = [work({ key: 'step:n2', title: 'Read chapter 5' })];
    render(
      <AssistantSurface
        snapshot={ready({ activeFocus: focus, advice: { kind: 'work', primary: work(), alternatives } })}
        onAction={() => {}}
        presentation="shelf"
      />,
    );
    expect(screen.queryByText('Read chapter 5')).toBeNull();
    expect(screen.getByRole('button', { name: 'Complete session' })).toBeTruthy();
  });

  it('distinguishes history, planned estimate, and starter language', () => {
    const { rerender } = render(
      <AssistantSurface
        snapshot={ready({
          advice: {
            kind: 'work',
            primary: work({ expected: { kind: 'history', lowMin: 50, highMin: 90, confidence: 'high', sampleCount: 6 } }),
            alternatives: [],
          },
        })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText('Usually 50–90m')).toBeTruthy();
    expect(screen.queryByText(/planned/i)).toBeNull();

    rerender(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    expect(screen.getByText('Planned 45m')).toBeTruthy();

    rerender(
      <AssistantSurface
        snapshot={ready({
          advice: {
            kind: 'work',
            primary: work({ expected: { kind: 'starter', minutes: 30 } }),
            alternatives: [],
          },
        })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText('Suggested 30m')).toBeTruthy();
  });

  it('starts a session on the primary with a neutral verb', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    expect(onAction).toHaveBeenCalledWith({
      type: 'start-focus', ref: { kind: 'step', id: 'n1', goalId: 'g1' },
    });
  });

  it('disables Start session while the owner has not acknowledged it', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);
    const start = screen.getByRole('button', { name: 'Start session' });
    fireEvent.click(start);
    fireEvent.click(start);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(start.hasAttribute('disabled')).toBe(true);
  });

  it('shows only Good luck during the confirmed send-off', () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    const { rerender } = render(<AssistantSurface snapshot={ready()} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    rerender(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: work().ref,
            title: work().title,
            goalTitle: work().goalTitle,
            phase: 'active',
            elapsedMin: 0,
            expected: work().expected,
          },
        })}
        onAction={onAction}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Good luck!');
    expect(screen.queryByRole('textbox')).toBeNull();
    vi.useRealTimers();
  });

  it('routes an alternative Start session through the same send-off as the primary', () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    const alternative = work({ key: 'step:n2', title: 'Read chapter 5' });
    const { rerender } = render(
      <AssistantSurface
        snapshot={ready({ advice: { kind: 'work', primary: work(), alternatives: [alternative] } })}
        onAction={onAction}
      />,
    );
    const alt = screen.getByRole('button', { name: /Read chapter 5/ });
    fireEvent.click(alt);
    fireEvent.click(alt);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ type: 'start-focus', ref: alternative.ref });
    expect(alt.hasAttribute('disabled')).toBe(true);

    rerender(
      <AssistantSurface
        snapshot={ready({
          advice: { kind: 'work', primary: work(), alternatives: [alternative] },
          activeFocus: {
            ref: alternative.ref,
            title: alternative.title,
            goalTitle: alternative.goalTitle,
            phase: 'active',
            elapsedMin: 0,
            expected: alternative.expected,
          },
        })}
        onAction={onAction}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Good luck!');
    expect(screen.queryByRole('textbox')).toBeNull();
    vi.useRealTimers();
  });

  it('keeps the running session controls under a neutral notice', () => {
    render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', goalTitle: 'Algorithms', phase: 'active',
            elapsedMin: 25, expected: { kind: 'estimate', minutes: 45 },
          },
          notice: { tone: 'neutral', text: 'Nothing needs you right now.' },
        })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Problem set 4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Complete session' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take break' })).toBeTruthy();
    // A notice is a LINE ABOVE the body, never a replacement for it.
    expect(screen.getByText('Nothing needs you right now.')).toBeTruthy();
  });

  it('exposes the approved verbs for an active session', () => {
    const onAction = vi.fn();
    render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', goalTitle: 'Algorithms', phase: 'active',
            elapsedMin: 25, expected: { kind: 'estimate', minutes: 45 },
          },
        })}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Complete session' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'complete-focus' });
    fireEvent.click(screen.getByRole('button', { name: 'Take break' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'pause-focus' });
  });

  it('offers Continue on a break and the confirmation pair while confirming', () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', phase: 'break',
            elapsedMin: 25, expected: { kind: 'starter', minutes: 30 },
          },
        })}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'resume-focus' });

    rerender(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', phase: 'confirming',
            elapsedMin: 200, expected: { kind: 'starter', minutes: 30 },
            proposedMinutes: 200,
          },
        })}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Log 3h 20m' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'confirm-focus', minutes: 200 });
    fireEvent.click(screen.getByRole('button', { name: "Didn't happen" }));
    expect(onAction).toHaveBeenCalledWith({ type: 'confirm-focus', minutes: null });
  });

  it('states progress on a running session instead of inviting a start', () => {
    render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', phase: 'break',
            elapsedMin: 0, expected: { kind: 'starter', minutes: 30 },
          },
        })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText('0m of 30m · On a break')).toBeTruthy();
    // The expectation label belongs to work that has not started. This one has.
    expect(screen.queryByText(/Suggested/)).toBeNull();
    expect(screen.queryByText(/worked/)).toBeNull();
  });

  it('drops the break clause once the session is active and keeps a range a range', () => {
    render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', phase: 'active',
            elapsedMin: 12,
            expected: { kind: 'history', lowMin: 45, highMin: 60, confidence: 'high', sampleCount: 6 },
          },
        })}
        onAction={() => {}}
      />,
    );
    // toBe, not toContain: asserting the whole line proves the break clause is
    // absent without ever matching the "Take break" BUTTON, which an active
    // session always renders and which a naive /break/i query would find.
    const line = screen.getByText('12m of 45–60m');
    expect(line.textContent).toBe('12m of 45–60m');
  });

  it('has no textbox at all — the shelf starts work, it does not parse sentences', () => {
    render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keeps the primary action reachable when a notice is showing', () => {
    const snapshot = ready({ notice: { tone: 'warning', text: 'A session is already running.' } });
    render(<AssistantSurface snapshot={snapshot} onAction={() => {}} />);
    expect(screen.getByText('A session is already running.')).toBeTruthy();
    // The fault this replaces: the notice took the whole surface with it.
    expect(screen.getByRole('heading', { name: 'Problem set 4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start session' })).toBeTruthy();
  });

  it('says working hours are missing instead of inventing a zero-minute plan', () => {
    render(
      <AssistantSurface snapshot={ready({ advice: { kind: 'needs-hours' } })} onAction={() => {}} />,
    );
    expect(screen.getByText(/working hours/i)).toBeTruthy();
  });

  it('Escape emits exactly one close action', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ type: 'close' });
  });

  it('wraps a long primary title to two lines while quiet metadata truncates', () => {
    const long = 'Write the extremely long literature review section that keeps growing '
      + 'until it no longer fits on one line at any sane width';
    render(
      <AssistantSurface
        snapshot={ready({
          advice: { kind: 'work', primary: work({ title: long }), alternatives: [] },
        })}
        onAction={() => {}}
      />,
    );
    const title = screen.getByRole('heading', { name: long });
    expect(title.className).toContain('line-clamp-2');
    expect(screen.getByText('Algorithms').className).toContain('truncate');
  });

  it('gives every icon button an accessible name', () => {
    render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', phase: 'active',
            elapsedMin: 5, expected: { kind: 'starter', minutes: 30 },
          },
          notice: { tone: 'warning', text: 'No room that day' },
        })}
        onAction={() => {}}
      />,
    );
    for (const button of screen.getAllByRole('button')) {
      const name = button.getAttribute('aria-label') ?? button.textContent;
      expect(name?.trim()).toBeTruthy();
    }
  });

  it('gives an active session one filled primary, last, and an outlined partner', () => {
    render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', phase: 'active',
            elapsedMin: 25, expected: { kind: 'estimate', minutes: 45 },
          },
        })}
        onAction={() => {}}
      />,
    );
    const complete = screen.getByRole('button', { name: 'Complete session' });
    const pause = screen.getByRole('button', { name: 'Take break' });
    expect(complete.className).toBe(primaryBtn);
    expect(pause.className).toBe(secondaryBtn);
    // The commit button lands under the reading edge, per dialogFooter.
    expect([...complete.parentElement!.children].map((b) => b.textContent))
      .toEqual(['Take break', 'Complete session']);
  });

  it('moves the filled treatment to Continue on a break', () => {
    render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', phase: 'break',
            elapsedMin: 25, expected: { kind: 'starter', minutes: 30 },
          },
        })}
        onAction={() => {}}
      />,
    );
    const resume = screen.getByRole('button', { name: 'Continue' });
    expect(resume.className).toBe(primaryBtn);
    expect(screen.getByRole('button', { name: 'Complete session' }).className).toBe(secondaryBtn);
    expect([...resume.parentElement!.children].map((b) => b.textContent))
      .toEqual(['Complete session', 'Continue']);
  });

  it('leaves the dismissive answer borderless', () => {
    render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', phase: 'confirming',
            elapsedMin: 200, expected: { kind: 'starter', minutes: 30 },
            proposedMinutes: 200,
          },
        })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Log 3h 20m' }).className).toBe(primaryBtn);
    expect(screen.getByRole('button', { name: "Didn't happen" }).className).toBe(ghostBtn);
    // The commit button lands under the reading edge, per dialogFooter.
    expect([...screen.getByRole('button', { name: 'Log 3h 20m' }).parentElement!.children]
      .map((b) => b.textContent)).toEqual(["Didn't happen", 'Log 3h 20m']);
  });

  it('starts a session on a filled primary', () => {
    render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    expect(screen.getByRole('button', { name: 'Start session' }).className).toBe(primaryBtn);
  });

  it('keeps a list of choices as rows rather than a fourth button variant', () => {
    const alternatives = [work({ key: 'step:n2', title: 'Read chapter 5' })];
    render(
      <AssistantSurface
        snapshot={ready({ advice: { kind: 'work', primary: work(), alternatives } })}
        onAction={() => {}}
      />,
    );
    const row = screen.getByRole('button', { name: /Read chapter 5/ });
    expect(row.className).toContain('text-left');
    expect(row.className).not.toBe(primaryBtn);
    expect(row.className).not.toBe(secondaryBtn);
  });

  it('offers the three levels and reports which is on', () => {
    render(<AssistantSurface snapshot={ready({ timeLevel: 'low' })} onAction={() => {}} />);
    expect(screen.getByRole('button', { name: '30m' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '1h' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Any' })).toBeTruthy();
  });

  it('sends the level the user picked', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: '30m' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'set-time-level', level: 'low' });
  });

  // The display dial deliberately has no number keys — only the time dial can own them,
  // and the time dial is the one you reach for mid-session.
  it('keeps the number keys on the dial that changes what you are offered', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);
    fireEvent.keyDown(window, { key: '1' });
    expect(onAction).toHaveBeenCalledWith({ type: 'set-time-level', level: 'low' });
    fireEvent.keyDown(window, { key: '3' });
    expect(onAction).toHaveBeenCalledWith({ type: 'set-time-level', level: 'high' });
  });

  it('offers both dials, named for what each one does', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);

    expect(screen.getByRole('group', { name: 'How long you have' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'How much to show' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '30m' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Any' })).toBeTruthy();
  });

  // The 380px embedded host has nothing for a second label-plus-switch pair to
  // live in on one line — a side-by-side row overflows and clips, verified by
  // eye in a real browser (jsdom has no layout, so it cannot see that). This
  // pins the presentation branch that fixes it, not the pixels themselves.
  it('stacks the two dials embedded and keeps them side by side on the shelf', () => {
    render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    const embeddedOuter = screen.getByRole('group', { name: 'How long you have' })
      .parentElement!.parentElement!;
    expect(embeddedOuter.className).toContain('flex-col');
    cleanup();

    render(<AssistantSurface snapshot={ready()} onAction={() => {}} presentation="shelf" />);
    const shelfOuter = screen.getByRole('group', { name: 'How long you have' })
      .parentElement!.parentElement!;
    expect(shelfOuter.className).not.toContain('flex-col');
  });

  it('sends the right verb from the right dial', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: '30m' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'set-time-level', level: 'low' });

    fireEvent.click(screen.getByRole('button', { name: 'High' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'set-detail-level', level: 'high' });
  });

  it('says nothing light is left rather than nothing needs you', () => {
    const snapshot = ready({
      timeLevel: 'low',
      advice: { kind: 'work', primary: work({ title: 'Thesis chapter 2' }), alternatives: [], beyondWindow: true },
    });
    render(<AssistantSurface snapshot={snapshot} onAction={() => {}} />);
    expect(screen.getByText("Nothing light left — this is next when you're ready.")).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Thesis chapter 2' })).toBeTruthy();
  });

  it('drops the comparison from a running session at low detail', () => {
    const focus = {
      ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      phase: 'active' as const,
      elapsedMin: 18,
      expected: { kind: 'estimate' as const, minutes: 45 },
    };
    render(<AssistantSurface snapshot={ready({ detailLevel: 'low', activeFocus: focus })} onAction={() => {}} />);
    expect(screen.getByText('18m so far')).toBeTruthy();
    expect(screen.queryByText(/of 45m/)).toBeNull();
  });

  it('keeps the comparison at medium detail, where it is not pressure but information', () => {
    const focus = {
      ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      phase: 'active' as const,
      elapsedMin: 18,
      expected: { kind: 'estimate' as const, minutes: 45 },
    };
    render(<AssistantSurface snapshot={ready({ detailLevel: 'medium', activeFocus: focus })} onAction={() => {}} />);
    expect(screen.getByText('18m of 45m')).toBeTruthy();
  });

  // TimeLevel and DetailLevel are both `'low' | 'medium' | 'high'` — structurally
  // identical unions, so TypeScript accepts either dial's value where the other is
  // expected and would not have caught FocusPanel being wired to the time dial
  // instead of the display dial. These two cases are the only thing that would:
  // they set the dials to opposite ends, so a mix-up flips the answer either way.
  it('reads the running-session comparison off the display dial, not the time dial', () => {
    const focus = {
      ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      phase: 'active' as const,
      elapsedMin: 18,
      expected: { kind: 'estimate' as const, minutes: 45 },
    };
    render(
      <AssistantSurface
        snapshot={ready({ timeLevel: 'low', detailLevel: 'high', activeFocus: focus })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText('18m of 45m')).toBeTruthy();
  });

  it('drops the comparison at low display detail even with plenty of time', () => {
    const focus = {
      ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      phase: 'active' as const,
      elapsedMin: 18,
      expected: { kind: 'estimate' as const, minutes: 45 },
    };
    render(
      <AssistantSurface
        snapshot={ready({ timeLevel: 'high', detailLevel: 'low', activeFocus: focus })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText('18m so far')).toBeTruthy();
    expect(screen.queryByText(/of 45m/)).toBeNull();
  });
});
