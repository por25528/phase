// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantSurface } from './AssistantSurface';
import type { AssistantSnapshot } from '../../lib/assistantProtocol';
import type { RecommendedWork } from '../../lib/executionAdvisor';

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
    proposal: null,
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

  it('keeps alternatives behind Other options and reveals at most two', () => {
    const alternatives = [
      work({ key: 'step:n2', title: 'Read chapter 5' }),
      work({ key: 'step:n3', title: 'Pitch deck' }),
      work({ key: 'step:n4', title: 'Email advisor' }),
    ];
    render(
      <AssistantSurface
        snapshot={ready({ advice: { kind: 'work', primary: work(), alternatives } })}
        onAction={() => {}}
      />,
    );

    expect(screen.queryByText('Read chapter 5')).toBeNull();
    const disclosure = screen.getByRole('button', { name: 'Other options' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Read chapter 5')).toBeTruthy();
    expect(screen.getByText('Pitch deck')).toBeTruthy();
    expect(screen.queryByText('Email advisor')).toBeNull();
    // The alternatives are not headings — one focal point on the page.
    expect(screen.getAllByRole('heading')).toHaveLength(1);
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
    expect(screen.getByText('Start with 30m')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Other options' }));
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

  it('keeps the running session controls above a neutral notice', () => {
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
    expect(screen.queryByText('Nothing needs you right now.')).toBeNull();
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
    // The invitation belongs to work that has not started. This one has.
    expect(screen.queryByText(/Start with/)).toBeNull();
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
    expect(screen.getByText('12m of 45–60m')).toBeTruthy();
    const line = screen.getByText('12m of 45–60m');
    expect(line.textContent).toBe('12m of 45–60m');
  });

  it('requires an explicit Confirm on a proposal', () => {
    const onAction = vi.fn();
    render(
      <AssistantSurface
        snapshot={ready({
          proposal: { kind: 'capture', id: 'p1', title: 'Lab report', goalId: null, date: '2026-08-14' },
        })}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'confirm-proposal', id: 'p1' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'cancel-proposal' });
  });

  it('offers subject choices without guessing', () => {
    const onAction = vi.fn();
    render(
      <AssistantSurface
        snapshot={ready({
          proposal: {
            kind: 'choose-subject', id: 'p2', verb: 'complete',
            choices: [
              { ref: { kind: 'step', id: 'n1', goalId: 'g1' }, title: 'Lab report', goalTitle: 'Algorithms' },
              { ref: { kind: 'step', id: 'n2', goalId: 'g2' }, title: 'Lab report', goalTitle: 'Biology' },
            ],
          },
        })}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Biology/ }));
    expect(onAction).toHaveBeenCalledWith({ type: 'choose-subject', proposalId: 'p2', subjectId: 'n2' });
  });

  it('focuses the Phase command field with the approved prompt', () => {
    render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Ask Phase' });
    expect(input.getAttribute('placeholder')).toBe('Ask Phase or add something…');
    expect(document.activeElement).toBe(input);
  });

  it('submits typed input as one action', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);
    const input = screen.getByRole('textbox', { name: 'Ask Phase' });
    fireEvent.change(input, { target: { value: 'Add lab report Friday' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAction).toHaveBeenCalledWith({ type: 'submit-input', text: 'Add lab report Friday' });
  });

  it('gives examples in the zero state without pretending to be a chat transcript', () => {
    render(
      <AssistantSurface snapshot={ready({ advice: { kind: 'clear' } })} onAction={() => {}} />,
    );
    expect(screen.getByText('What fits in 30m?')).toBeTruthy();
    expect(screen.queryByRole('log')).toBeNull();
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
          proposal: { kind: 'capture', id: 'p1', title: 'X', goalId: null, date: null },
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
});
