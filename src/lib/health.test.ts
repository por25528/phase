import { describe, expect, it } from 'vitest';
import type { AvailabilityWindow, Goal, GoalNode } from '../db/types';
import { goalEffort } from './effort';
import { goalHealth, HEALTH_WORD } from './health';

// 2026-08-09 is a Sunday, so the first working day of the forecast is the 10th.
const TODAY = '2026-08-09';

/** Mon–Fri, `hours` a day. The deadline below leaves ten working days. */
const hoursADay = (hours: number): AvailabilityWindow[] =>
  [0, 1, 2, 3, 4].map((dow) => ({ dow, startMin: 540, endMin: 540 + hours * 60 }));

const leaf = (id: string, over: Partial<GoalNode> = {}): GoalNode => ({ id, title: id, ...over });

const dated = (nodes: GoalNode[], over: Partial<Goal> = {}): Goal => ({
  id: 'g',
  title: 'Physics Final',
  start: '2026-08-01',
  deadline: '2026-08-24',
  datesConfirmed: true,
  nodes,
  ...over,
});

const verdict = (goal: Goal, windows: AvailabilityWindow[]) =>
  goalHealth({ goal, effort: goalEffort(goal), today: TODAY, windows, blocks: [], allDayBlocks: true });

// 2026-08-10 … 08-24 inclusive holds eleven weekdays.
const WORKDAYS = 11;

describe('goalHealth', () => {
  it('says on track when the work fits with room to spare', () => {
    const v = verdict(dated([leaf('a', { estimateMin: 120 }), leaf('b', { estimateMin: 60 })]), hoursADay(1));
    expect(v.health).toBe('on-track');
    expect(v.reason).toContain('3h');
  });

  it('says tight when the buffer is under 15% of the work', () => {
    // 11 working hours free; 10h of work leaves 1h spare, under 15% of 10h.
    const v = verdict(dated([leaf('a', { estimateMin: 600 })]), hoursADay(1));
    expect(v.health).toBe('tight');
    expect(v.reason).toContain('1h spare');
  });

  it('says at risk when the work does not fit at all', () => {
    const v = verdict(dated([leaf('a', { estimateMin: 900 })]), hoursADay(1));
    expect(v.health).toBe('at-risk');
    expect(v.reason).toBe(`15h of work against ${WORKDAYS}h free before the deadline`);
  });

  /**
   * A floor is not a forecast. With anything unpriced the remaining figure can
   * only grow, so "fits with room to spare" is a claim about a number the app
   * knows is incomplete — but crying risk over missing data is how a forecast
   * gets ignored, so it caps at tight rather than escalating.
   */
  it('caps at tight while any open task is unestimated, however much room there is', () => {
    const v = verdict(dated([leaf('a', { estimateMin: 60 }), leaf('b')]), hoursADay(8));
    expect(v.health).toBe('tight');
    expect(v.reason).toContain('1 task still unestimated');
  });

  it('still says at risk when even the priced floor does not fit', () => {
    const v = verdict(dated([leaf('a', { estimateMin: 900 }), leaf('b')]), hoursADay(1));
    expect(v.health).toBe('at-risk');
  });

  /**
   * Blocked outranks the arithmetic: hours that exist cannot be spent on work
   * that is waiting for something else, so reporting "on track" off a capacity
   * sum would be the most misleading answer available.
   */
  it('says blocked when every open task is, however much capacity there is', () => {
    const goal = dated([
      leaf('a', { status: 'done' }),
      leaf('b', { status: 'blocked', blockedOn: 'waiting on the TA', estimateMin: 30 }),
    ]);
    expect(verdict(goal, hoursADay(8)).health).toBe('blocked');
  });

  it('refuses to forecast a goal with no confirmed deadline', () => {
    const goal = dated([leaf('a', { estimateMin: 60 })], { deadline: undefined, start: undefined, datesConfirmed: undefined });
    const v = verdict(goal, hoursADay(8));
    expect(v.health).toBe('no-forecast');
    expect(v.reason).toContain('No confirmed deadline');
  });

  it('refuses to forecast unconfirmed imported dates', () => {
    const goal = dated([leaf('a', { estimateMin: 60 })], { datesConfirmed: undefined });
    expect(verdict(goal, hoursADay(8)).health).toBe('no-forecast');
  });

  it('refuses to forecast past the horizon, where capacity has no answer', () => {
    const goal = dated([leaf('a', { estimateMin: 60 })], { deadline: '2028-01-01' });
    const v = verdict(goal, hoursADay(8));
    expect(v.health).toBe('no-forecast');
    expect(v.reason).toContain('too far out');
  });

  it('has nothing to forecast about a goal with no tasks', () => {
    expect(verdict(dated([]), hoursADay(8)).health).toBe('no-forecast');
  });

  it('calls a finished goal on track rather than forecasting nothing', () => {
    const v = verdict(dated([leaf('a', { status: 'done' })]), hoursADay(8));
    expect(v).toEqual({ health: 'on-track', reason: 'Every task is done' });
  });

  it('is at risk once the deadline has passed with work still open', () => {
    const goal = dated([leaf('a', { estimateMin: 30 }), leaf('b', { estimateMin: 30 })], { deadline: '2026-08-01' });
    const v = verdict(goal, hoursADay(8));
    expect(v.health).toBe('at-risk');
    expect(v.reason).toContain('2 tasks are still open');
  });

  it('gives every verdict a word and a reason', () => {
    expect(Object.values(HEALTH_WORD)).toEqual(['On track', 'Tight', 'At risk', 'Blocked', 'No forecast']);
  });

  /**
   * A brand-new account has no availability model at all. Summing it gives
   * zero free minutes, which reads as "nothing fits" — so before this, every
   * goal a first-time user created was At risk the moment it had a deadline.
   * That is missing data, not a risk signal, and it says so.
   */
  it('refuses to forecast against working hours that were never set', () => {
    const v = verdict(dated([leaf('a', { estimateMin: 60 })]), []);
    expect(v.health).toBe('no-forecast');
    expect(v.reason).toContain('No working hours set');
  });
});
