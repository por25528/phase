// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantSnapshot } from '../../lib/assistantProtocol';
import type { WorkRef } from '../../lib/expectedTime';
import { useAssistantSendoff } from './useAssistantSendoff';

const REF = { kind: 'step', id: 'n1', goalId: 'g1' } as const;

function ready(over: Partial<Extract<AssistantSnapshot, { status: 'ready' }>> = {}): AssistantSnapshot {
  return {
    status: 'ready',
    advice: { kind: 'clear' },
    activeFocus: null,
    ...over,
  };
}

function focused(ref: WorkRef = REF): AssistantSnapshot {
  return ready({
    activeFocus: {
      ref,
      title: 'Problem set 4',
      phase: 'active',
      elapsedMin: 0,
      expected: { kind: 'estimate', minutes: 45 },
    },
  });
}

describe('useAssistantSendoff', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('two same-tick start calls invoke onStart once and enter pending', () => {
    const onStart = vi.fn();
    const onClose = vi.fn();
    const initial = ready();
    const { result } = renderHook(() => useAssistantSendoff({
      snapshot: initial,
      reducedMotion: false,
      resetKey: 0,
      onStart,
      onClose,
    }));

    act(() => {
      result.current.start(REF);
      result.current.start(REF);
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(REF);
    expect(result.current.stage).toBe('pending');
    expect(result.current.pending).toBe(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.stage).toBe('idle');
  });

  it('ignores the exact snapshot object that was present at start', () => {
    const onClose = vi.fn();
    const initial = ready();
    const { result, rerender } = renderHook(
      ({ snapshot }) => useAssistantSendoff({
        snapshot,
        reducedMotion: false,
        resetKey: 0,
        onStart: vi.fn(),
        onClose,
      }),
      { initialProps: { snapshot: initial } },
    );

    act(() => result.current.start(REF));
    rerender({ snapshot: initial });
    expect(result.current.stage).toBe('pending');
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.stage).toBe('idle');
  });

  it('a different activeFocus.ref neither confirms nor closes', () => {
    const onClose = vi.fn();
    const initial = ready();
    const { result, rerender } = renderHook(
      ({ snapshot }) => useAssistantSendoff({
        snapshot,
        reducedMotion: false,
        resetKey: 0,
        onStart: vi.fn(),
        onClose,
      }),
      { initialProps: { snapshot: initial } },
    );

    act(() => result.current.start(REF));
    rerender({ snapshot: focused({ kind: 'task', id: 't1', goalId: null }) });
    expect(result.current.stage).toBe('pending');
    expect(onClose).not.toHaveBeenCalled();

    rerender({ snapshot: focused({ kind: 'step', id: 'n1', goalId: 'other' }) });
    expect(result.current.stage).toBe('pending');
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.stage).toBe('idle');
  });

  it('leaves after 660ms, then finishExit closes once and sets hidden', () => {
    const onClose = vi.fn();
    const initial = ready();
    const { result, rerender } = renderHook(
      ({ snapshot }) => useAssistantSendoff({
        snapshot,
        reducedMotion: false,
        resetKey: 0,
        onStart: vi.fn(),
        onClose,
      }),
      { initialProps: { snapshot: initial } },
    );

    act(() => result.current.start(REF));
    rerender({ snapshot: focused(REF) });
    expect(result.current.stage).toBe('message');

    act(() => vi.advanceTimersByTime(659));
    expect(result.current.stage).toBe('message');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.stage).toBe('leaving');

    act(() => result.current.finishExit());
    act(() => result.current.finishExit());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.stage).toBe('hidden');

    act(() => vi.advanceTimersByTime(2000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via the 1000ms fallback when finishExit never runs', () => {
    const onClose = vi.fn();
    const initial = ready();
    const { result, rerender } = renderHook(
      ({ snapshot }) => useAssistantSendoff({
        snapshot,
        reducedMotion: false,
        resetKey: 0,
        onStart: vi.fn(),
        onClose,
      }),
      { initialProps: { snapshot: initial } },
    );

    act(() => result.current.start(REF));
    rerender({ snapshot: focused(REF) });
    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.stage).toBe('hidden');
  });

  it('reduced motion closes at exactly 350ms with no leaving choreography', () => {
    const onClose = vi.fn();
    const initial = ready();
    const { result, rerender } = renderHook(
      ({ snapshot }) => useAssistantSendoff({
        snapshot,
        reducedMotion: true,
        resetKey: 0,
        onStart: vi.fn(),
        onClose,
      }),
      { initialProps: { snapshot: initial } },
    );

    act(() => result.current.start(REF));
    rerender({ snapshot: focused(REF) });
    expect(result.current.stage).toBe('message');

    act(() => vi.advanceTimersByTime(349));
    expect(result.current.stage).toBe('message');
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.stage).toBe('hidden');
  });

  it('a new warning snapshot restores idle and cancels timers', () => {
    const onClose = vi.fn();
    const initial = ready();
    const { result, rerender } = renderHook(
      ({ snapshot }) => useAssistantSendoff({
        snapshot,
        reducedMotion: false,
        resetKey: 0,
        onStart: vi.fn(),
        onClose,
      }),
      { initialProps: { snapshot: initial } },
    );

    act(() => result.current.start(REF));
    rerender({
      snapshot: ready({ notice: { tone: 'warning', text: 'A session is already running.' } }),
    });
    expect(result.current.stage).toBe('idle');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a resetKey change clears timers, request and closed state, and returns idle', () => {
    const onClose = vi.fn();
    const initial = ready();
    const { result, rerender } = renderHook(
      ({ snapshot, resetKey }) => useAssistantSendoff({
        snapshot,
        reducedMotion: false,
        resetKey,
        onStart: vi.fn(),
        onClose,
      }),
      { initialProps: { snapshot: initial, resetKey: 0 } },
    );

    act(() => result.current.start(REF));
    rerender({ snapshot: focused(REF), resetKey: 0 });
    expect(result.current.stage).toBe('message');

    rerender({ snapshot: focused(REF), resetKey: 1 });
    expect(result.current.stage).toBe('idle');
    act(() => vi.advanceTimersByTime(2000));
    expect(onClose).not.toHaveBeenCalled();

    act(() => result.current.start(REF));
    rerender({ snapshot: focused(REF), resetKey: 1 });
    expect(result.current.stage).toBe('message');
    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.stage).toBe('hidden');
  });

  it('unmount clears every timer', () => {
    const onClose = vi.fn();
    const initial = ready();
    const { result, rerender, unmount } = renderHook(
      ({ snapshot }) => useAssistantSendoff({
        snapshot,
        reducedMotion: false,
        resetKey: 0,
        onStart: vi.fn(),
        onClose,
      }),
      { initialProps: { snapshot: initial } },
    );

    act(() => result.current.start(REF));
    rerender({ snapshot: focused(REF) });
    expect(result.current.stage).toBe('message');

    unmount();
    act(() => vi.advanceTimersByTime(2000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a stalled send-off recovers to idle at 5000ms and allows a retry', () => {
    const onStart = vi.fn();
    const onClose = vi.fn();
    const initial = ready();
    const { result } = renderHook(() => useAssistantSendoff({
      snapshot: initial,
      reducedMotion: false,
      resetKey: 0,
      onStart,
      onClose,
    }));

    act(() => result.current.start(REF));
    expect(result.current.stage).toBe('pending');

    act(() => vi.advanceTimersByTime(4999));
    expect(result.current.stage).toBe('pending');
    expect(onClose).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.stage).toBe('idle');
    expect(onClose).not.toHaveBeenCalled();

    act(() => result.current.start(REF));
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(result.current.stage).toBe('pending');

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.stage).toBe('idle');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('an ack just before the timeout keeps message and the stale pending timer cannot reset it', () => {
    const onStart = vi.fn();
    const onClose = vi.fn();
    const initial = ready();
    const { result, rerender } = renderHook(
      ({ snapshot }) => useAssistantSendoff({
        snapshot,
        reducedMotion: false,
        resetKey: 0,
        onStart,
        onClose,
      }),
      { initialProps: { snapshot: initial } },
    );

    act(() => result.current.start(REF));
    act(() => vi.advanceTimersByTime(4999));
    expect(result.current.stage).toBe('pending');

    rerender({ snapshot: focused(REF) });
    expect(result.current.stage).toBe('message');

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.stage).toBe('message');
    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.stage).toBe('hidden');
  });

  it('keeps current callbacks in refs so identity changes do not corrupt timing', () => {
    const firstStart = vi.fn();
    const firstClose = vi.fn();
    const secondStart = vi.fn();
    const secondClose = vi.fn();
    const initial = ready();
    const { result, rerender } = renderHook(
      ({ snapshot, onStart, onClose }) => useAssistantSendoff({
        snapshot,
        reducedMotion: false,
        resetKey: 0,
        onStart,
        onClose,
      }),
      {
        initialProps: { snapshot: initial, onStart: firstStart, onClose: firstClose },
      },
    );

    act(() => result.current.start(REF));
    expect(firstStart).toHaveBeenCalledTimes(1);

    rerender({ snapshot: initial, onStart: secondStart, onClose: secondClose });
    rerender({ snapshot: focused(REF), onStart: secondStart, onClose: secondClose });
    expect(result.current.stage).toBe('message');

    act(() => vi.advanceTimersByTime(1000));
    expect(firstClose).not.toHaveBeenCalled();
    expect(secondClose).toHaveBeenCalledTimes(1);
    expect(result.current.stage).toBe('hidden');
  });
});
