import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CYCLE_CONFIG, clampCycleConfig, parseCycleConfig, serializeCycleConfig,
  cycleFor, workRemainingMs, breakRemainingMs, nextBoundaryDelayMs, applyCycleBoundary,
} from './focusCycle';
import { startFocusSession, pauseFocusSession, resumeFocusSession, parseActiveFocusSession, serializeActiveFocusSession } from './focusSession';
import type { ActiveFocusSession } from './focusSession';

const MIN = 60_000;
const T0 = 1_700_000_000_000;

function pomodoro(over: Partial<ActiveFocusSession> = {}): ActiveFocusSession {
  const base = startFocusSession({
    ref: { kind: 'task', id: 't1', goalId: null },
    title: 'Problem set 4',
    expected: { kind: 'estimate', minutes: 60 },
    focusLevel: 'medium',
    nowMs: T0,
  });
  return { ...base, cycle: cycleFor(DEFAULT_CYCLE_CONFIG), ...over };
}

describe('config', () => {
  it('clamps every field into its range', () => {
    expect(clampCycleConfig({ workMin: 1, breakMin: 0, longBreakMin: 999, longEvery: 1 }))
      .toEqual({ workMin: 5, breakMin: 1, longBreakMin: 60, longEvery: 2 });
  });
  it('parses malformed input field-by-field to defaults', () => {
    expect(parseCycleConfig('garbage')).toEqual(DEFAULT_CYCLE_CONFIG);
    expect(parseCycleConfig(JSON.stringify({ workMin: 50 })))
      .toEqual({ ...DEFAULT_CYCLE_CONFIG, workMin: 50 });
    expect(parseCycleConfig(serializeCycleConfig({ workMin: 30, breakMin: 10, longBreakMin: 20, longEvery: 3 })))
      .toEqual({ workMin: 30, breakMin: 10, longBreakMin: 20, longEvery: 3 });
  });
});

describe('arithmetic', () => {
  it('counts down the work interval from banked active time', () => {
    expect(workRemainingMs(pomodoro(), T0 + 10 * MIN)).toBe(15 * MIN);
  });
  it('measures the current interval, not the whole session', () => {
    const s = pomodoro({ cycle: { ...cycleFor(DEFAULT_CYCLE_CONFIG), completed: 1 }, accumulatedMs: 25 * MIN, startedAtMs: T0 - 30 * MIN });
    expect(workRemainingMs(s, T0 + 10 * MIN)).toBe(15 * MIN);
  });
  it('is null for a calm session', () => {
    const calm = { ...pomodoro() };
    delete calm.cycle;
    expect(workRemainingMs(calm, T0)).toBeNull();
    expect(nextBoundaryDelayMs(calm, T0)).toBeNull();
  });
  it('a manual pause freezes the countdown and has no break countdown', () => {
    const paused = pauseFocusSession(pomodoro(), T0 + 10 * MIN);
    expect(workRemainingMs(paused, T0 + 60 * MIN)).toBeNull();
    expect(breakRemainingMs(paused, T0 + 60 * MIN)).toBeNull();
    expect(nextBoundaryDelayMs(paused, T0 + 60 * MIN)).toBeNull();
  });
});

describe('applyCycleBoundary', () => {
  it('flips to break AT the boundary, so overshoot is never banked as work', () => {
    const out = applyCycleBoundary(pomodoro(), T0 + 26 * MIN)!;
    expect(out.event).toBe('work-ended');
    expect(out.session.phase).toBe('break');
    expect(out.session.accumulatedMs).toBe(25 * MIN);
    expect(out.session.cycle).toMatchObject({ completed: 1, breakKind: 'short', breakStartedMs: T0 + 25 * MIN });
  });
  it('every longEvery-th break is long', () => {
    const s = pomodoro({ cycle: { ...cycleFor(DEFAULT_CYCLE_CONFIG), completed: 3 }, accumulatedMs: 75 * MIN, activeSinceMs: T0 });
    const out = applyCycleBoundary(s, T0 + 25 * MIN)!;
    expect(out.session.cycle!.breakKind).toBe('long');
    expect(out.session.cycle!.completed).toBe(4);
  });
  it('marks a finished break once, without changing phase', () => {
    const flipped = applyCycleBoundary(pomodoro(), T0 + 25 * MIN)!.session;
    const out = applyCycleBoundary(flipped, T0 + 31 * MIN)!;
    expect(out.event).toBe('break-ended');
    expect(out.session.phase).toBe('break');
    expect(out.session.cycle!.breakNotified).toBe(true);
    expect(applyCycleBoundary(out.session, T0 + 60 * MIN)).toBeNull();
  });
  it('is null before any boundary is due', () => {
    expect(applyCycleBoundary(pomodoro(), T0 + 10 * MIN)).toBeNull();
  });
});

describe('resume and persistence', () => {
  it('resume clears the cycle break bookkeeping', () => {
    const flipped = applyCycleBoundary(pomodoro(), T0 + 25 * MIN)!.session;
    const resumed = resumeFocusSession(flipped, T0 + 30 * MIN);
    expect(resumed.cycle).toMatchObject({ completed: 1 });
    expect(resumed.cycle!.breakStartedMs).toBeUndefined();
    expect(resumed.cycle!.breakKind).toBeUndefined();
    expect(resumed.cycle!.breakNotified).toBeUndefined();
  });
  it('a cycle survives the settings-row round trip', () => {
    const s = applyCycleBoundary(pomodoro(), T0 + 25 * MIN)!.session;
    expect(parseActiveFocusSession(serializeActiveFocusSession(s))).toEqual(s);
  });
  it('a malformed cycle reads as a calm session, never as no session', () => {
    const raw = JSON.parse(serializeActiveFocusSession(pomodoro()));
    raw.cycle = { workMin: 'lots' };
    const parsed = parseActiveFocusSession(JSON.stringify(raw))!;
    expect(parsed).not.toBeNull();
    expect(parsed.cycle).toBeUndefined();
  });
});
