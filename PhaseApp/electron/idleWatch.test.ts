import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { createIdleWatch, IDLE_BREAK_SEC, POLL_MS, RETURN_IDLE_SEC } =
  nativeRequire('./idleWatch.cjs') as typeof import('./idleWatch.cjs');

type FocusStatus = Parameters<ReturnType<typeof createIdleWatch>['setFocusStatus']>[0];

const T0 = 1_700_000_000_000;
const SEC = 1_000;

const active = (over: Partial<NonNullable<FocusStatus>> = {}): NonNullable<FocusStatus> => ({
  phase: 'active', activeSinceMs: T0, accumulatedMs: 0, title: 'Problem set 4', ...over,
});
const paused: NonNullable<FocusStatus> = { ...active(), phase: 'break', activeSinceMs: null };
const confirming: NonNullable<FocusStatus> = { ...active(), phase: 'confirming', activeSinceMs: null };
const rating: NonNullable<FocusStatus> = { ...active(), phase: 'rating', activeSinceMs: null };

/**
 * A hand-driven watcher. The module re-arms its own one-shot timer, so `poll()`
 * is exactly one interval and `polling()` answers whether anything is watching
 * at all — which is the fact half these tests are about.
 */
function watcher(idleSeconds = 0) {
  let idle = idleSeconds;
  let clock = T0;
  let scheduled: (() => void) | null = null;
  let suspend: (() => void) | null = null;
  let lock: (() => void) | null = null;

  const getIdleSeconds = vi.fn(() => idle);
  const cancel = vi.fn(() => { scheduled = null; });
  const setTimer = vi.fn((fn: () => void, _ms: number) => {
    scheduled = fn;
    return cancel;
  });
  const offSuspend = vi.fn(() => { suspend = null; });
  const offLockScreen = vi.fn(() => { lock = null; });
  const onSuspend = vi.fn((fn: () => void) => { suspend = fn; return offSuspend; });
  const onLockScreen = vi.fn((fn: () => void) => { lock = fn; return offLockScreen; });
  const notifyRenderer = vi.fn();
  const logError = vi.fn();

  const watch = createIdleWatch({
    getIdleSeconds,
    onSuspend,
    onLockScreen,
    setTimer,
    now: () => clock,
    notifyRenderer,
    logError,
  });

  return {
    watch,
    getIdleSeconds,
    setTimer,
    cancel,
    notifyRenderer,
    logError,
    onSuspend,
    onLockScreen,
    offSuspend,
    offLockScreen,
    setIdle: (seconds: number) => { idle = seconds; },
    advance: (ms: number) => { clock += ms; },
    at: () => clock,
    polling: () => scheduled !== null,
    poll: () => {
      const fn = scheduled;
      scheduled = null;
      fn?.();
    },
    suspend: () => suspend?.(),
    lock: () => lock?.(),
    requests: () => notifyRenderer.mock.calls.map((call) => call[0]),
  };
}

describe('when it watches at all', () => {
  it('polls nothing until a session is active', () => {
    const w = watcher();
    w.watch.start();
    expect(w.polling()).toBe(false);
    w.watch.setFocusStatus(null);
    expect(w.polling()).toBe(false);
  });

  it('starts polling on an active snapshot, at the stated interval', () => {
    const w = watcher();
    w.watch.setFocusStatus(active());
    expect(w.polling()).toBe(true);
    expect(w.setTimer).toHaveBeenCalledWith(expect.any(Function), POLL_MS);
  });

  it('does not poll a break the user took, or a session awaiting an answer', () => {
    const w = watcher();
    w.watch.setFocusStatus(paused);
    expect(w.polling()).toBe(false);
    w.watch.setFocusStatus(confirming);
    expect(w.polling()).toBe(false);
    w.watch.setFocusStatus(rating);
    expect(w.polling()).toBe(false);
  });

  it('stops the moment the session ends', () => {
    const w = watcher();
    w.watch.setFocusStatus(active());
    w.watch.setFocusStatus(null);
    expect(w.polling()).toBe(false);
    expect(w.cancel).toHaveBeenCalled();
  });

  it('does not stack a second timer when active snapshots keep arriving', () => {
    const w = watcher();
    w.watch.setFocusStatus(active());
    w.watch.setFocusStatus(active({ accumulatedMs: 60_000 }));
    w.watch.setFocusStatus(active({ accumulatedMs: 120_000 }));
    expect(w.setTimer).toHaveBeenCalledTimes(1);
  });

  it('asks the OS nothing while it is not watching', () => {
    const w = watcher();
    w.watch.setFocusStatus(paused);
    expect(w.getIdleSeconds).not.toHaveBeenCalled();
  });
});

describe('the idle threshold', () => {
  it('stays quiet under five minutes and keeps watching', () => {
    const w = watcher(IDLE_BREAK_SEC - 1);
    w.watch.setFocusStatus(active());
    w.poll();
    expect(w.notifyRenderer).not.toHaveBeenCalled();
    expect(w.polling()).toBe(true);
  });

  /**
   * The pause is stamped at the moment input STOPPED, not at the moment the
   * threshold fired. That is the whole feature: banking must not resume for
   * the five minutes nobody was there.
   */
  it('fires at the threshold with the moment input stopped, not the moment it noticed', () => {
    const w = watcher();
    w.watch.setFocusStatus(active());
    w.advance(6 * 60 * SEC);
    w.setIdle(360);
    w.poll();
    expect(w.requests()).toEqual([{ type: 'auto-break', idleStartMs: w.at() - 360 * SEC }]);
  });

  it('fires exactly once, however long the absence runs', () => {
    const w = watcher();
    w.watch.setFocusStatus(active());
    w.setIdle(IDLE_BREAK_SEC);
    w.poll();
    w.setIdle(IDLE_BREAK_SEC * 10);
    w.poll();
    w.poll();
    expect(w.requests().filter((r) => r.type === 'auto-break')).toHaveLength(1);
  });

  it('keeps polling after the auto-break, so the return can be seen', () => {
    const w = watcher(IDLE_BREAK_SEC);
    w.watch.setFocusStatus(active());
    w.poll();
    expect(w.polling()).toBe(true);
    // And it survives the break snapshot the renderer publishes in answer.
    w.watch.setFocusStatus(paused);
    expect(w.polling()).toBe(true);
  });
});

describe('suspend and lock', () => {
  it('pause immediately, at now — a closed lid does not wait five minutes', () => {
    const w = watcher();
    w.watch.start();
    w.watch.setFocusStatus(active());
    w.advance(90 * SEC);
    w.suspend();
    expect(w.requests()).toEqual([{ type: 'auto-break', idleStartMs: w.at() }]);
  });

  it('a locked screen is the same event', () => {
    const w = watcher();
    w.watch.start();
    w.watch.setFocusStatus(active());
    w.lock();
    expect(w.requests()).toEqual([{ type: 'auto-break', idleStartMs: T0 }]);
  });

  it('do nothing when no session is active', () => {
    const w = watcher();
    w.watch.start();
    w.watch.setFocusStatus(paused);
    w.suspend();
    w.lock();
    w.watch.setFocusStatus(null);
    w.suspend();
    expect(w.notifyRenderer).not.toHaveBeenCalled();
  });

  it('do not fire a second time over an auto-break already sent', () => {
    const w = watcher();
    w.watch.start();
    w.watch.setFocusStatus(active());
    w.suspend();
    w.lock();
    expect(w.requests()).toHaveLength(1);
  });

  it('start is idempotent — one subscription per event, however often it is called', () => {
    const w = watcher();
    w.watch.start();
    w.watch.start();
    expect(w.onSuspend).toHaveBeenCalledTimes(1);
    expect(w.onLockScreen).toHaveBeenCalledTimes(1);
  });
});

describe('coming back', () => {
  it('reports the absence once, then stops watching', () => {
    const w = watcher();
    w.watch.setFocusStatus(active());
    w.setIdle(IDLE_BREAK_SEC);
    w.advance(IDLE_BREAK_SEC * SEC);
    w.poll();
    w.watch.setFocusStatus(paused);

    w.advance(7 * 60 * SEC);
    w.setIdle(0);
    w.poll();

    expect(w.requests()[1]).toEqual({ type: 'returned', awayMs: 12 * 60 * SEC });
    // Nothing left to notice: the next active snapshot is what re-arms it.
    expect(w.polling()).toBe(false);

    w.poll();
    expect(w.requests().filter((r) => r.type === 'returned')).toHaveLength(1);
  });

  it('does not call a still-idle machine a return', () => {
    const w = watcher();
    w.watch.setFocusStatus(active());
    w.setIdle(IDLE_BREAK_SEC);
    w.poll();
    w.setIdle(RETURN_IDLE_SEC);
    w.poll();
    expect(w.requests()).toHaveLength(1);
    expect(w.polling()).toBe(true);
  });

  /**
   * A resume is proof the user is back, whether or not this module saw it
   * happen — so the pending return is dropped rather than announced later
   * over a session that has moved on.
   */
  it('drops the pending return when the session goes active again', () => {
    const w = watcher();
    w.watch.setFocusStatus(active());
    w.setIdle(IDLE_BREAK_SEC);
    w.poll();

    w.setIdle(0);
    w.watch.setFocusStatus(active({ activeSinceMs: T0 + 10 * 60 * SEC }));
    w.poll();

    expect(w.requests().filter((r) => r.type === 'returned')).toHaveLength(0);
    // And the threshold applies afresh to the new stretch.
    w.setIdle(IDLE_BREAK_SEC);
    w.poll();
    expect(w.requests().filter((r) => r.type === 'auto-break')).toHaveLength(2);
  });

  it('drops it when the session ends or lands in confirming or rating while away', () => {
    for (const settled of [null, confirming, rating]) {
      const w = watcher();
      w.watch.setFocusStatus(active());
      w.setIdle(IDLE_BREAK_SEC);
      w.poll();

      w.watch.setFocusStatus(settled);
      expect(w.polling()).toBe(false);
      w.setIdle(0);
      w.poll();
      expect(w.requests().filter((r) => r.type === 'returned')).toHaveLength(0);
    }
  });
});

describe('failures stay local', () => {
  it('an OS that will not answer is logged and asked again next interval', () => {
    const w = watcher();
    w.watch.setFocusStatus(active());
    w.getIdleSeconds.mockImplementationOnce(() => { throw new Error('no idle time'); });
    expect(() => w.poll()).not.toThrow();
    expect(w.logError).toHaveBeenCalledWith(
      '[phase-shell] idle time unavailable',
      expect.any(Error),
    );
    expect(w.polling()).toBe(true);
  });

  it('a renderer that is gone does not end the watch', () => {
    const w = watcher(IDLE_BREAK_SEC);
    w.watch.setFocusStatus(active());
    w.notifyRenderer.mockImplementationOnce(() => { throw new Error('window gone'); });
    expect(() => w.poll()).not.toThrow();
    expect(w.logError).toHaveBeenCalledWith(
      '[phase-shell] idle watch could not reach the window',
      expect.any(Error),
    );
    expect(w.polling()).toBe(true);
  });
});

describe('dispose', () => {
  it('stops the poll and removes both subscriptions', () => {
    const w = watcher();
    w.watch.start();
    w.watch.setFocusStatus(active());
    expect(w.polling()).toBe(true);

    w.watch.dispose();
    expect(w.polling()).toBe(false);
    expect(w.cancel).toHaveBeenCalled();
    expect(w.offSuspend).toHaveBeenCalledTimes(1);
    expect(w.offLockScreen).toHaveBeenCalledTimes(1);
  });

  it('forgets the session, so a stale suspend cannot pause anything', () => {
    const w = watcher();
    w.watch.start();
    w.watch.setFocusStatus(active());
    w.watch.dispose();
    w.suspend();
    expect(w.notifyRenderer).not.toHaveBeenCalled();
  });

  it('is safe with nothing ever started', () => {
    const w = watcher();
    expect(() => w.watch.dispose()).not.toThrow();
  });
});
