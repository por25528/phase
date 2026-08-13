import { describe, it, expect } from 'vitest';
import {
  startFocusSession,
  pauseFocusSession,
  resumeFocusSession,
  finishFocusSession,
  discardFocusSession,
  elapsedFocusMinutes,
  parseActiveFocusSession,
  serializeActiveFocusSession,
  staleFocusLimitMin,
  STALE_FOCUS_MIN,
  type ActiveFocusSession,
} from './focusSession';
import type { ExpectedTime } from './expectedTime';

const MIN = 60_000;
const t0 = 1_700_000_000_000;

const starter: ExpectedTime = { kind: 'starter', minutes: 30 };

function start(over: Partial<Parameters<typeof startFocusSession>[0]> = {}): ActiveFocusSession {
  return startFocusSession({
    ref: { kind: 'step', id: 'n1', goalId: 'g1' },
    title: 'Problem set 4',
    goalTitle: 'Algorithms',
    expected: starter,
    nowMs: t0,
    ...over,
  });
}

describe('focusSession', () => {
  it('start creates an active draft with a frozen target title and evidence', () => {
    const s = start();
    expect(s.phase).toBe('active');
    expect(s.title).toBe('Problem set 4');
    expect(s.goalTitle).toBe('Algorithms');
    expect(s.ref).toEqual({ kind: 'step', id: 'n1', goalId: 'g1' });
    expect(s.expected).toEqual(starter);
    expect(s.startedAtMs).toBe(t0);
    expect(s.activeSinceMs).toBe(t0);
    expect(s.accumulatedMs).toBe(0);
    expect(s.id).toBeTruthy();
  });

  it('elapsed work excludes breaks', () => {
    let s = start();
    s = pauseFocusSession(s, t0 + 20 * MIN);          // 20m worked
    s = resumeFocusSession(s, t0 + 50 * MIN);          // 30m break
    expect(elapsedFocusMinutes(s, t0 + 60 * MIN)).toBe(30); // 20 + 10
  });

  it('pause and resume are idempotent', () => {
    const s = start();
    const paused = pauseFocusSession(s, t0 + 10 * MIN);
    expect(pauseFocusSession(paused, t0 + 15 * MIN)).toEqual(paused);
    const resumed = resumeFocusSession(paused, t0 + 20 * MIN);
    expect(resumeFocusSession(resumed, t0 + 25 * MIN)).toEqual(resumed);
  });

  it('no transition depends on a one-second interval', () => {
    // Elapsed time is a pure function of the timestamps handed in: jumping the
    // clock forward by an hour in one step reads exactly like sixty ticks.
    const s = start();
    expect(elapsedFocusMinutes(s, t0 + 60 * MIN)).toBe(60);
    expect(elapsedFocusMinutes(s, t0 + 60 * MIN)).toBe(60); // and re-asking changes nothing
  });

  it('normal completion returns one rounded, positive log request', () => {
    const s = start();
    const finish = finishFocusSession(s, t0 + 25.4 * MIN);
    expect(finish).toEqual({ kind: 'log', minutes: 25 });
  });

  it('a sub-minute session still logs one positive minute', () => {
    const s = start();
    const finish = finishFocusSession(s, t0 + 10_000);
    expect(finish).toEqual({ kind: 'log', minutes: 1 });
  });

  it('an implausibly long session returns needs-confirmation and no log request', () => {
    const s = start();
    const finish = finishFocusSession(s, t0 + (STALE_FOCUS_MIN + 1) * MIN);
    expect(finish.kind).toBe('needs-confirmation');
    if (finish.kind !== 'needs-confirmation') return;
    expect(finish.session.phase).toBe('confirming');
    expect(finish.session.activeSinceMs).toBeNull();
    expect(finish.session.proposedMinutes).toBe(STALE_FOCUS_MIN + 1);
  });

  it('stale means the larger of 180 minutes or twice the history high end', () => {
    const history: ExpectedTime = { kind: 'history', lowMin: 90, highMin: 120, confidence: 'high', sampleCount: 5 };
    expect(staleFocusLimitMin(history)).toBe(240);
    expect(staleFocusLimitMin({ kind: 'history', lowMin: 20, highMin: 40, confidence: 'medium', sampleCount: 2 })).toBe(STALE_FOCUS_MIN);
    expect(staleFocusLimitMin(starter)).toBe(STALE_FOCUS_MIN);

    // 200 minutes is stale for a starter but plausible against long history.
    const long = start({ expected: history });
    expect(finishFocusSession(long, t0 + 200 * MIN)).toEqual({ kind: 'log', minutes: 200 });
  });

  it('discard returns null and never fabricates a session', () => {
    expect(discardFocusSession(start())).toBeNull();
  });

  it('malformed persisted JSON parses to null', () => {
    expect(parseActiveFocusSession('not json')).toBeNull();
    expect(parseActiveFocusSession('{}')).toBeNull();
    expect(parseActiveFocusSession('null')).toBeNull();
    expect(parseActiveFocusSession(JSON.stringify({ ...start(), phase: 'sleeping' }))).toBeNull();
    expect(parseActiveFocusSession(JSON.stringify({ ...start(), startedAtMs: -5 }))).toBeNull();
    expect(parseActiveFocusSession(JSON.stringify({ ...start(), startedAtMs: Infinity }))).toBeNull();
    expect(parseActiveFocusSession(JSON.stringify({ ...start(), accumulatedMs: -1 }))).toBeNull();
    expect(parseActiveFocusSession(JSON.stringify({ ...start(), ref: { kind: 'step', id: 'n1' } }))).toBeNull();
    expect(parseActiveFocusSession(JSON.stringify({ ...start(), ref: undefined }))).toBeNull();
    expect(parseActiveFocusSession(JSON.stringify({ ...start(), expected: { kind: 'guess' } }))).toBeNull();
  });

  it('a well-formed draft round-trips through serialize and parse', () => {
    const s = pauseFocusSession(start(), t0 + 10 * MIN);
    expect(parseActiveFocusSession(serializeActiveFocusSession(s))).toEqual(s);

    const taskDraft = start({ ref: { kind: 'task', id: 't1', goalId: null }, goalTitle: undefined });
    expect(parseActiveFocusSession(serializeActiveFocusSession(taskDraft))).toEqual(taskDraft);
  });

  it('rejects a clock that runs backwards instead of banking negative time', () => {
    const s = start();
    const paused = pauseFocusSession(s, t0 - 10 * MIN);
    expect(paused.accumulatedMs).toBe(0);
    expect(elapsedFocusMinutes(s, t0 - 5 * MIN)).toBe(0);
  });
});
