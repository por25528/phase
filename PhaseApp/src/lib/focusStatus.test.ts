import { describe, expect, it } from 'vitest';
import { focusStatusOf, validFocusRequest } from './focusStatus';
import { startFocusSession, pauseFocusSession, type ActiveFocusSession } from './focusSession';

const t0 = 1_700_000_000_000;
const MIN = 60_000;

function draft(): ActiveFocusSession {
  return startFocusSession({
    ref: { kind: 'step', id: 'n1', goalId: 'g1' },
    title: 'Problem set 4',
    goalTitle: 'Algorithms',
    expected: { kind: 'starter', minutes: 30 },
    focusLevel: 'medium',
    nowMs: t0,
  });
}

describe('focusStatusOf', () => {
  it('answers null for no session', () => {
    expect(focusStatusOf(null)).toBeNull();
  });

  it('carries timestamps and never a duration', () => {
    const status = focusStatusOf(draft());
    expect(status).toEqual({
      phase: 'active',
      activeSinceMs: t0,
      accumulatedMs: 0,
      title: 'Problem set 4',
    });
  });

  /**
   * The four fields are the WHOLE of what crosses. The ref, the goal, the
   * evidence, the focus level and the proposed minutes stay in the renderer:
   * the menu bar needs a phase, two numbers and a name, and what never crosses
   * cannot become a second opinion about the session.
   */
  it('projects away everything the menu bar has no use for', () => {
    const status = focusStatusOf(draft());
    expect(Object.keys(status ?? {}).sort())
      .toEqual(['accumulatedMs', 'activeSinceMs', 'phase', 'title']);
  });

  /**
   * A cycle rides the snapshot so the tray and the pill can count DOWN out of
   * the same banked numbers, without a second opinion about what a pomodoro
   * is. `breakNotified` stays behind: main sends no notices, so it has no use
   * for the flag that stops the second one.
   */
  it('carries the cycle when there is one, minus the bookkeeping main cannot use', () => {
    const cycled: ActiveFocusSession = {
      ...draft(),
      cycle: {
        workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4,
        completed: 1, breakStartedMs: t0 + 25 * MIN, breakKind: 'short',
        breakNotified: true,
      },
    };
    expect(focusStatusOf(cycled)?.cycle).toEqual({
      workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4,
      completed: 1, breakStartedMs: t0 + 25 * MIN, breakKind: 'short',
    });
  });

  it('omits the cycle entirely for a calm session', () => {
    expect(Object.keys(focusStatusOf(draft()) ?? {}).sort())
      .toEqual(['accumulatedMs', 'activeSinceMs', 'phase', 'title']);
  });

  it('reports a break as banked time with no running stretch', () => {
    const status = focusStatusOf(pauseFocusSession(draft(), t0 + 20 * MIN));
    expect(status).toMatchObject({
      phase: 'break', activeSinceMs: null, accumulatedMs: 20 * MIN,
    });
  });
});

describe('validFocusRequest', () => {
  it('accepts the three menu verbs', () => {
    expect(validFocusRequest({ type: 'take-break' })).toBe(true);
    expect(validFocusRequest({ type: 'resume' })).toBe(true);
    expect(validFocusRequest({ type: 'finish' })).toBe(true);
  });

  it('accepts the watcher’s two observations only with their figures', () => {
    expect(validFocusRequest({ type: 'auto-break', idleStartMs: t0 })).toBe(true);
    expect(validFocusRequest({ type: 'returned', awayMs: 12 * MIN })).toBe(true);
    expect(validFocusRequest({ type: 'auto-break' })).toBe(false);
    expect(validFocusRequest({ type: 'returned' })).toBe(false);
  });

  it('is total: an unknown verb or a broken figure is a refusal, never a throw', () => {
    for (const bad of [
      null, undefined, 'finish', 42, [], {},
      { type: 'start-focus' },
      { type: 'quit' },
      { type: 'auto-break', idleStartMs: -1 },
      { type: 'auto-break', idleStartMs: Number.NaN },
      { type: 'auto-break', idleStartMs: '1700000000000' },
      { type: 'returned', awayMs: Number.POSITIVE_INFINITY },
    ]) {
      expect(validFocusRequest(bad)).toBe(false);
    }
  });
});
