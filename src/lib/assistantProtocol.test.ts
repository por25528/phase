import { describe, expect, it } from 'vitest';
import { elapsedAgainstExpected, expectedTimeLabel } from './assistantProtocol';

describe('expectedTimeLabel', () => {
  it('speaks a range as a range, a plan as a plan, and a starter as an invitation', () => {
    expect(expectedTimeLabel({
      kind: 'history', lowMin: 45, highMin: 60, confidence: 'high', sampleCount: 6,
    })).toBe('Usually 45–60m');
    expect(expectedTimeLabel({ kind: 'estimate', minutes: 30 })).toBe('Planned 30m');
    expect(expectedTimeLabel({ kind: 'starter', minutes: 30 })).toBe('Suggested 30m');
  });
});

describe('elapsedAgainstExpected', () => {
  it('states progress rather than inviting a start', () => {
    expect(elapsedAgainstExpected(0, { kind: 'starter', minutes: 30 })).toBe('0m of 30m');
    expect(elapsedAgainstExpected(5, { kind: 'estimate', minutes: 30 })).toBe('5m of 30m');
  });

  it('keeps a range a range', () => {
    expect(elapsedAgainstExpected(12, {
      kind: 'history', lowMin: 45, highMin: 60, confidence: 'high', sampleCount: 6,
    })).toBe('12m of 45–60m');
  });

  it('spells the elapsed side the way the rest of the shelf does', () => {
    // fmtMinutes, so it matches "Log 3h 20m" on the confirmation button. The
    // expected side stays raw minutes, so it matches expectedTimeLabel.
    expect(elapsedAgainstExpected(200, { kind: 'starter', minutes: 30 })).toBe('3h 20m of 30m');
    expect(elapsedAgainstExpected(90, { kind: 'estimate', minutes: 90 })).toBe('1h 30m of 90m');
  });

  it('never invites a start once a session is under way', () => {
    for (const expected of [
      { kind: 'starter', minutes: 30 },
      { kind: 'estimate', minutes: 30 },
      { kind: 'history', lowMin: 45, highMin: 60, confidence: 'high', sampleCount: 6 },
    ] as const) {
      expect(elapsedAgainstExpected(0, expected)).not.toMatch(/start/i);
      expect(elapsedAgainstExpected(0, expected)).not.toMatch(/planned/i);
      expect(elapsedAgainstExpected(0, expected)).not.toMatch(/usually/i);
    }
  });
});

describe('elapsedAgainstExpected at low focus', () => {
  it('states the number and withholds the verdict', () => {
    expect(elapsedAgainstExpected(18, { kind: 'estimate', minutes: 45 }, 'low')).toBe('18m so far');
    expect(elapsedAgainstExpected(18, {
      kind: 'history', lowMin: 40, highMin: 50, confidence: 'medium', sampleCount: 2,
    }, 'low')).toBe('18m so far');
  });

  it('defaults to stating the comparison, so existing callers are unchanged', () => {
    expect(elapsedAgainstExpected(18, { kind: 'estimate', minutes: 45 })).toBe('18m of 45m');
  });
});
