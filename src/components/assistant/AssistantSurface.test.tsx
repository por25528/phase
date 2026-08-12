// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantSurface } from './AssistantSurface';
import type { AssistantSnapshot } from '../../lib/assistantProtocol';
import type { RecommendedWork } from '../../lib/executionAdvisor';

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

  it('renders at most two alternatives, quietly', () => {
    const alts = [
      work({ key: 'step:n2', title: 'Read chapter 5', reason: 'free-time' }),
      work({ key: 'step:n3', title: 'Pitch deck', reason: 'free-time' }),
    ];
    render(
      <AssistantSurface
        snapshot={ready({ advice: { kind: 'work', primary: work(), alternatives: alts } })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText('Read chapter 5')).toBeTruthy();
    expect(screen.getByText('Pitch deck')).toBeTruthy();
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

  it('exposes the approved verbs for an active session', () => {
    const onAction = vi.fn();
    render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
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

  it('submits typed input as one action', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);
    const input = screen.getByRole('textbox', { name: 'Ask the assistant' });
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
