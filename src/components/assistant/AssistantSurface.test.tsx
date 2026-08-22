// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantSurface } from './AssistantSurface';
import type { AssistantFocusView, AssistantSnapshot } from '../../lib/assistantProtocol';
import type { RecommendedWork } from '../../lib/executionAdvisor';
import { ghostBtn, primaryBtn, secondaryBtn } from '../dialogStyles';
import { sendoffFor } from '../../lib/sendoff';

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

function focusView(over: Partial<AssistantFocusView> = {}): AssistantFocusView {
  return {
    ref: { kind: 'step', id: 'n1', goalId: 'g1' },
    title: 'Problem set 4',
    goalTitle: 'Algorithms',
    phase: 'active',
    elapsedMin: 12,
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
    focusLevel: 'medium',
    ...over,
  };
}

describe('AssistantSurface', () => {
  it('renders skeleton rows while loading, not a spinner or a blank pane', () => {
    render(<AssistantSurface snapshot={{ status: 'loading' }} onAction={() => {}} />);
    expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/loading/i)).toBeNull();
  });

  /*
   * `bg-fill` is the INK token (#1A1A18 light, #EBE7DE dark), not a surface.
   * Filling the skeleton with it painted three solid black bars in light mode
   * — the loading state was the least Stone-conformant thing in the app.
   */
  it('fills skeleton rows with a surface token, never the ink token', () => {
    render(<AssistantSurface snapshot={{ status: 'loading' }} onAction={() => {}} />);
    for (const row of screen.getAllByTestId('skeleton-row')) {
      expect(row.className).toContain('bg-hover');
      expect(row.className).not.toContain('bg-fill');
    }
  });

  it('makes the one primary recommendation the focal heading', () => {
    render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Problem set 4' })).toBeTruthy();
  });

  it('focuses nothing when it opens, so no ring paints on arrival', () => {
    const { container } = render(
      <AssistantSurface snapshot={ready()} onAction={() => {}} presentation="shelf" />,
    );
    expect(container.querySelector('[autofocus]')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it.each(['active', 'break'] as const)('focuses nothing during a %s session either', (phase) => {
    const focus = {
      ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
      title: 'Problem set 4', phase,
      elapsedMin: 12, expected: { kind: 'estimate' as const, minutes: 45 },
    };
    const { container } = render(
      <AssistantSurface snapshot={ready({ activeFocus: focus })} onAction={() => {}} />,
    );
    expect(container.querySelector('[autofocus]')).toBeNull();
    expect(document.activeElement).toBe(document.body);
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

  it('shows two alternatives regardless of the focus dial', () => {
    const alternatives = [
      work({ key: 'step:n2', title: 'Read chapter 5' }),
      work({ key: 'step:n3', title: 'Pitch deck' }),
    ];
    for (const focusLevel of ['low', 'medium', 'high'] as const) {
      cleanup();
      render(
        <AssistantSurface
          snapshot={ready({ focusLevel, advice: { kind: 'work', primary: work(), alternatives } })}
          onAction={() => {}}
          presentation="shelf"
        />,
      );
      expect(screen.getByText('Read chapter 5')).toBeTruthy();
      expect(screen.getByText('Pitch deck')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Problem set 4' })).toBeTruthy();
    }
  });

  /*
   * OVERTURNS the previous pin, which required the alternatives to be absent
   * during a session.
   *
   * CLAUDE.md records why they were withheld: WIDTH — two full-length buttons
   * needed the room — "not a decision to remove the ability to switch". The
   * band layout gives the width back, so the constraint is gone and the
   * `Other options` disclosure with it. The label changes because the verb
   * does: you START work you have not begun, and you SWITCH TO one that
   * displaces a running sitting.
   */
  it('offers the alternatives to switch to while a session is running', () => {
    const onAction = vi.fn();
    const alternatives = [work({
      key: 'step:n2',
      ref: { kind: 'step', id: 'n2', goalId: 'g1' },
      title: 'Read chapter 5',
    })];
    render(
      <AssistantSurface
        snapshot={ready({ activeFocus: focusView(), advice: { kind: 'work', primary: work(), alternatives } })}
        onAction={onAction}
        presentation="shelf"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Other options' })).toBeNull();
    expect(screen.getByText('Switch to')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Complete session' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Read chapter 5/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: 'switch-focus',
      ref: { kind: 'step', id: 'n2', goalId: 'g1' },
    });
  });

  /*
   * Two labels, because they are two verbs. One band, because they are one
   * region — a reader must never have to look in two places for "what else
   * could I be doing".
   */
  it('labels the same band Or when nothing is running', () => {
    const alternatives = [work({ key: 'step:n2', title: 'Read chapter 5' })];
    render(
      <AssistantSurface
        snapshot={ready({ advice: { kind: 'work', primary: work(), alternatives } })}
        onAction={() => {}}
        presentation="shelf"
      />,
    );
    expect(screen.getByText('Or')).toBeTruthy();
    expect(screen.queryByText('Switch to')).toBeNull();
  });

  /*
   * The heading started at 71px during a session and 37px the instant it
   * ended, because the checkbox and the ring are both withheld in
   * `confirming`. The slots are reserved instead: the checkbox slot always,
   * the ring slot across all three session phases. `confirming` still renders
   * NEITHER control — the existing pin on that stands — it just keeps the room.
   */
  it('reserves the gutter in confirming so the title does not shift left', () => {
    const { container } = render(
      <AssistantSurface
        snapshot={ready({ activeFocus: focusView({ phase: 'confirming', proposedMinutes: 200 }) })}
        onAction={() => {}}
        presentation="shelf"
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(container.querySelector('[data-gutter]')).toBeTruthy();
    expect(container.querySelector('[data-ring-slot]')).toBeTruthy();
  });

  it.each(['active', 'break'] as const)('reserves the same two slots during a %s session', (phase) => {
    const { container } = render(
      <AssistantSurface
        snapshot={ready({ activeFocus: focusView({ phase }) })}
        onAction={() => {}}
        presentation="shelf"
      />,
    );
    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect(container.querySelector('[data-gutter]')).toBeTruthy();
    expect(container.querySelector('[data-ring-slot]')).toBeTruthy();
  });

  /*
   * Idle work has no ring to reserve room for — that step happens only when
   * the whole card's content changes anyway.
   */
  it('reserves the checkbox slot but no ring slot when idle', () => {
    const { container } = render(
      <AssistantSurface snapshot={ready()} onAction={() => {}} presentation="shelf" />,
    );
    expect(container.querySelector('[data-gutter]')).toBeTruthy();
    expect(container.querySelector('[data-ring-slot]')).toBeNull();
  });

  /*
   * The band's one-row arrangement is what 620px was designed around. At the
   * embedded panel's 380px the gutter, the ring slot, the gaps and two
   * `shrink-0` buttons take the row, and the title measured 28.4px running —
   * drawn as `D…` — and 48.6px in `confirming`, where the question about the
   * session wrapped into 189px of vertical text (`scripts/shot-shelf.cjs`,
   * which renders the real component at both real widths; jsdom has no layout
   * and cannot see any of it). Stacking is what this panel did before the
   * bands landed, and it gives the title 274px back.
   *
   * Structural, not pixels: the actions are a SIBLING FOLLOWING the block that
   * holds the title, in a column embedded and in a row on the shelf. Both
   * arrangements keep the reserved gutter, which is the other thing the title's
   * left edge depends on.
   */
  it('stacks the actions under the work embedded and keeps them on the title row on the shelf', () => {
    const band = () => screen.getByRole('button', { name: 'Start session' })
      .parentElement!.parentElement!;

    render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    expect(band().className).toContain('flex-col');
    expect(band().querySelector('[data-gutter]')).toBeTruthy();
    expect(band().contains(screen.getByRole('heading', { name: 'Problem set 4' }))).toBe(true);
    cleanup();

    render(<AssistantSurface snapshot={ready()} onAction={() => {}} presentation="shelf" />);
    expect(band().className).not.toContain('flex-col');
    expect(band().querySelector('[data-gutter]')).toBeTruthy();
    expect(band().contains(screen.getByRole('heading', { name: 'Problem set 4' }))).toBe(true);
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

  it('shows a sourced quote during the confirmed send-off', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T09:00:00Z'));
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
    const quote = sendoffFor(Date.now());
    const status = screen.getByRole('status').textContent ?? '';
    expect(status).toContain(quote.text);
    expect(status).toContain(quote.who);
    expect(status).toContain(quote.source);
    expect(screen.queryByRole('textbox')).toBeNull();
    vi.useRealTimers();
  });

  it('routes an alternative Start session through the same send-off as the primary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T09:00:00Z'));
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
    const quote = sendoffFor(Date.now());
    const status = screen.getByRole('status').textContent ?? '';
    expect(status).toContain(quote.text);
    expect(status).toContain(quote.who);
    expect(status).toContain(quote.source);
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

  // The verdict survives Job 1 and the copy does not. It can no longer say
  // "Phase doesn't know your working hours yet" — every install starts on
  // DEFAULT_AVAILABILITY, so the only way to reach this is to switch every day
  // off in Settings — and it can no longer imply nothing may be scheduled,
  // because everything may. What is genuinely lost is the denominator, which
  // is what the sentence now names. See PlanNotice.tsx.
  it('says the hours were switched off instead of inventing a zero-minute plan', () => {
    render(
      <AssistantSurface snapshot={ready({ advice: { kind: 'needs-hours' } })} onAction={() => {}} />,
    );
    expect(screen.getByText(/switched off in Settings/i)).toBeTruthy();
  });

  it('Escape emits exactly one close action', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ type: 'close' });
  });

  /*
   * OVERTURNS the previous pin, which required `line-clamp-2`.
   *
   * That was right when the title had 165px of a 620px window and needed two
   * lines to say anything. The band layout gives it 433px, and one line makes
   * the card's height independent of its content — which is what a window that
   * is fixed-height and CLIPS rather than scrolls actually wants. The full
   * string stays reachable on `title`.
   */
  it('truncates a long primary title to one line and keeps it in the tooltip', () => {
    const long = 'Write the extremely long literature review section that keeps growing '
      + 'until it no longer fits on one line at any sane width';
    render(
      <AssistantSurface
        snapshot={ready({
          advice: { kind: 'work', primary: work({ title: long }), alternatives: [] },
        })}
        onAction={() => {}}
        presentation="shelf"
      />,
    );
    const title = screen.getByRole('heading', { name: long });
    expect(title.className).toContain('truncate');
    expect(title.className).not.toContain('line-clamp-2');
    expect(title.getAttribute('title')).toBe(long);
    expect(screen.getByText('Algorithms').className).toContain('truncate');
  });

  /*
   * The same rule during a session: `FocusPanel` and `AdvicePanel` must not
   * disagree about how a title overflows, which is why both spend `workTitle`.
   */
  it('truncates the running session title the same way', () => {
    const long = 'Write the extremely long literature review section that keeps growing '
      + 'until it no longer fits on one line at any sane width';
    render(
      <AssistantSurface
        snapshot={ready({ activeFocus: focusView({ title: long }) })}
        onAction={() => {}}
        presentation="shelf"
      />,
    );
    const title = screen.getByRole('heading', { name: long });
    expect(title.className).toContain('truncate');
    expect(title.getAttribute('title')).toBe(long);
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

  // The focus dial deliberately has no number keys — only the time dial can own them,
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
    expect(screen.getByRole('group', { name: 'How much focus you have' })).toBeTruthy();
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

  /*
   * The same 620-vs-380 split, one component lower down.
   *
   * On the shelf an alternative's title and its metadata share a line, the
   * metadata `shrink-0`. At 380px that leaves the NAME OF THE WORK about 114px
   * while `Comparative Literature · Usually 45–60m` takes 227 — the hierarchy
   * this band exists to correct, inverted. `Sidecar` stacked them as two
   * `block` spans for that reason, and flattening it into one row was a
   * regression rather than a simplification.
   *
   * jsdom has no layout, so this pins the structural branch and not the widths
   * — the same move the dial test above makes.
   */
  it('stacks an alternative row embedded and keeps it on one line on the shelf', () => {
    const alternatives = [work({ key: 'step:n2', title: 'Read chapter 5' })];
    const snapshot = ready({ advice: { kind: 'work', primary: work(), alternatives } });

    render(<AssistantSurface snapshot={snapshot} onAction={() => {}} />);
    const embedded = screen.getByRole('button', { name: /Read chapter 5/ });
    expect(embedded.className).not.toContain('flex');
    expect(embedded.querySelector('span')!.className).toContain('block');
    cleanup();

    render(<AssistantSurface snapshot={snapshot} onAction={() => {}} presentation="shelf" />);
    const shelf = screen.getByRole('button', { name: /Read chapter 5/ });
    expect(shelf.className).toContain('flex');
    expect(shelf.querySelector('span')!.className).toContain('flex-1');
  });

  /*
   * The captions used to read "I've got" and "Focus" — one completes a
   * sentence with its control, the other names a thing. Two nouns of the same
   * kind is the fix. They take the mono voice because the bar is the
   * instrument's legend; that amends Stone §5's exception for this site.
   *
   * The uppercase is legal because the voice is DECLARED in `sectionLabel.ts`
   * and imported from there — `designScale.test.ts`'s guard is a FILE
   * allowlist that never inspects the line, so `font-mono` beside `uppercase`
   * satisfies nothing. `AssistantSurface.tsx` passes it by spelling
   * `uppercase` zero times, which is why what this asserts is the class the
   * caption resolves to and not a rule about how it was written.
   */
  it('captions the dials as parallel nouns in the mono voice', () => {
    render(<AssistantSurface snapshot={ready()} onAction={() => {}} presentation="shelf" />);
    for (const word of ['Time', 'Focus']) {
      const caption = screen.getByText(word);
      expect(caption.className).toContain('font-mono');
      expect(caption.className).toContain('uppercase');
    }
    expect(screen.queryByText(/I’ve got/)).toBeNull();
  });

  /*
   * The dials are view state, the least important thing on the card, and they
   * held the position the eye lands on first. On the shelf they become a
   * bottom status bar. Embedded keeps them on top: that panel is
   * `max-h-[70vh] overflow-y-auto`, so a bottom bar there would scroll away
   * rather than pin.
   */
  it('puts the dial bar last on the shelf and first embedded', () => {
    const positionOfDials = () => {
      const bar = screen.getByRole('group', { name: 'How long you have' })
        .parentElement!.parentElement!;
      const card = bar.parentElement!;
      return [...card.children].indexOf(bar) === card.children.length - 1;
    };

    render(<AssistantSurface snapshot={ready()} onAction={() => {}} presentation="shelf" />);
    expect(positionOfDials()).toBe(true);
    cleanup();

    render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    expect(positionOfDials()).toBe(false);
  });

  it('sends the right verb from the right dial', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: '30m' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'set-time-level', level: 'low' });

    fireEvent.click(screen.getByRole('button', { name: 'High' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'set-focus-level', level: 'high' });
  });

  it('says nothing that short is left rather than nothing needs you', () => {
    const snapshot = ready({
      timeLevel: 'low',
      advice: { kind: 'work', primary: work({ title: 'Thesis chapter 2' }), alternatives: [], beyondWindow: true },
    });
    render(<AssistantSurface snapshot={snapshot} onAction={() => {}} />);
    expect(screen.getByText("Nothing that short left — this is next when you're ready.")).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Thesis chapter 2' })).toBeTruthy();
  });

  it('names the dial that emptied the queue', () => {
    render(
      <AssistantSurface
        snapshot={ready({
          advice: { kind: 'work', primary: work(), alternatives: [], beyondFocus: true },
        })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText(/Nothing light left/)).toBeTruthy();
    expect(screen.queryByText(/Nothing that short left/)).toBeNull();
  });

  it('drops the comparison from a running session at low focus', () => {
    const focus = {
      ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      phase: 'active' as const,
      elapsedMin: 18,
      expected: { kind: 'estimate' as const, minutes: 45 },
    };
    render(<AssistantSurface snapshot={ready({ focusLevel: 'low', activeFocus: focus })} onAction={() => {}} />);
    expect(screen.getByText('18m so far')).toBeTruthy();
    expect(screen.queryByText(/of 45m/)).toBeNull();
  });

  it('keeps the comparison at medium focus, where it is not pressure but information', () => {
    const focus = {
      ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      phase: 'active' as const,
      elapsedMin: 18,
      expected: { kind: 'estimate' as const, minutes: 45 },
    };
    render(<AssistantSurface snapshot={ready({ focusLevel: 'medium', activeFocus: focus })} onAction={() => {}} />);
    expect(screen.getByText('18m of 45m')).toBeTruthy();
  });

  // TimeLevel and FocusLevel are both `'low' | 'medium' | 'high'` — structurally
  // identical unions, so TypeScript accepts either dial's value where the other is
  // expected and would not have caught FocusPanel being wired to the time dial
  // instead of the focus dial. These two cases are the only thing that would:
  // they set the dials to opposite ends, so a mix-up flips the answer either way.
  it('reads the running-session comparison off the focus dial, not the time dial', () => {
    const focus = {
      ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      phase: 'active' as const,
      elapsedMin: 18,
      expected: { kind: 'estimate' as const, minutes: 45 },
    };
    render(
      <AssistantSurface
        snapshot={ready({ timeLevel: 'low', focusLevel: 'high', activeFocus: focus })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText('18m of 45m')).toBeTruthy();
  });

  it('drops the comparison at low focus even with plenty of time', () => {
    const focus = {
      ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      phase: 'active' as const,
      elapsedMin: 18,
      expected: { kind: 'estimate' as const, minutes: 45 },
    };
    render(
      <AssistantSurface
        snapshot={ready({ timeLevel: 'high', focusLevel: 'low', activeFocus: focus })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText('18m so far')).toBeTruthy();
    expect(screen.queryByText(/of 45m/)).toBeNull();
  });

  // `svg[aria-hidden]`, not `svg`: the checkbox draws a tick glyph of its own,
  // so a bare `svg` query answers "is there any icon here" and would report a
  // ring on the idle card and keep reporting one after the ring was deleted.
  // The ring is the decorative one — that is what `aria-hidden` says.
  it('draws a ring beside a running session and none while confirming', () => {
    const base = {
      ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
      title: 'Problem set 4', elapsedMin: 12,
      expected: { kind: 'estimate' as const, minutes: 45 },
    };
    const { container, rerender } = render(
      <AssistantSurface snapshot={ready({ activeFocus: { ...base, phase: 'active' } })} onAction={() => {}} />,
    );
    expect(container.querySelector('svg[aria-hidden]')).toBeTruthy();

    rerender(
      <AssistantSurface
        snapshot={ready({ activeFocus: { ...base, phase: 'confirming', proposedMinutes: 12 } })}
        onAction={() => {}}
      />,
    );
    expect(container.querySelector('svg[aria-hidden]')).toBeNull();
  });

  it('draws no ring on the idle card, where nothing is running', () => {
    const { container } = render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    expect(container.querySelector('svg[aria-hidden]')).toBeNull();
  });
});

describe('marking the offered work done', () => {
  it('offers a checkbox on the idle card, named for the work', () => {
    render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Complete "Problem set 4"' })).toBeTruthy();
  });

  it('dispatches complete-work with the primary ref', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete "Problem set 4"' }));

    expect(onAction).toHaveBeenCalledWith({
      type: 'complete-work',
      ref: { kind: 'step', id: 'n1', goalId: 'g1' },
    });
  });

  it('offers it on a running session too — that is when you come back', () => {
    render(<AssistantSurface snapshot={ready({ activeFocus: focusView() })} onAction={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Complete "Problem set 4"' })).toBeTruthy();
  });

  it('offers it on a break', () => {
    render(<AssistantSurface
      snapshot={ready({ activeFocus: focusView({ phase: 'break' }) })}
      onAction={() => {}}
    />);
    expect(screen.getByRole('checkbox', { name: 'Complete "Problem set 4"' })).toBeTruthy();
  });

  /*
   * `confirming` is already asking "was that real work?". A tick there would
   * answer a different question than the one on screen.
   */
  it('withholds it while a session is confirming', () => {
    render(<AssistantSurface
      snapshot={ready({ activeFocus: focusView({ phase: 'confirming', proposedMinutes: 200 }) })}
      onAction={() => {}}
    />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  /*
   * AlternativesBand's rows are a list of things to PICK, and a list of
   * choices is not a commit.
   */
  it('puts no checkbox on the alternatives', () => {
    render(<AssistantSurface
      snapshot={ready({ advice: { kind: 'work', primary: work(), alternatives: [
        work({ key: 'step:n2', ref: { kind: 'step', id: 'n2', goalId: 'g1' }, title: 'Read chapter 3' }),
      ] } })}
      onAction={() => {}}
      presentation="shelf"
    />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByRole('checkbox', { name: 'Complete "Read chapter 3"' })).toBeNull();
  });
});
