import { describe, it, expect } from 'vitest';
import { expectedTimeFor } from './expectedTime';
import type { WorkRef } from './expectedTime';
import { loggedForNode } from './actuals';
import type { Goal, Session, Task } from '../db/types';

const day = '2026-07-28';

function session(over: Partial<Session> = {}): Session {
  return { id: 's', goalId: 'g1', date: day, minutes: 60, note: '', ...over };
}

let sessionSeq = 0;
/** Log one positive session against a nodeId, with a unique row id. */
function log(nodeId: string, minutes: number): Session {
  return session({ id: `s${sessionSeq++}`, nodeId, minutes });
}

describe('expectedTimeFor', () => {
  it('returns a high-confidence interquartile range from five comparable completed items', () => {
    const goal: Goal = {
      id: 'cs', title: '6.120',
      nodes: [
        { id: 'n0', title: 'Problem set 1', status: 'done' },
        { id: 'n1', title: 'Problem set 2', status: 'done' },
        { id: 'n2', title: 'Problem set 3', status: 'done' },
        { id: 'n3', title: 'Problem set 4', status: 'done' },
        { id: 'n4', title: 'Problem set 5', status: 'done' },
        { id: 'next', title: 'Problem set 6' },
      ],
    };
    const sessions = [
      log('n0', 101), log('n1', 102), log('n2', 103), log('n3', 104), log('n4', 105),
    ];
    // p25 of [101..105] is 102 → 100 outward; p75 is 104 → 105 outward.
    expect(expectedTimeFor({ kind: 'step', id: 'next', goalId: 'cs' }, { goals: [goal], tasks: [], sessions }))
      .toEqual({ kind: 'history', lowMin: 100, highMin: 105, confidence: 'high', sampleCount: 5 });
  });

  it('returns a wider medium-confidence range from two to four comparable completed items', () => {
    const goal: Goal = {
      id: 'bio', title: '7.02',
      nodes: [
        { id: 'n0', title: 'Lab 2', status: 'done' },
        { id: 'n1', title: 'Lab 5', status: 'done' },
        { id: 'next', title: 'Lab 7' },
      ],
    };
    const sessions = [log('n0', 47), log('n1', 103)];
    // Observed 47..103, rounded outward → 45..105.
    expect(expectedTimeFor({ kind: 'step', id: 'next', goalId: 'bio' }, { goals: [goal], tasks: [], sessions }))
      .toEqual({ kind: 'history', lowMin: 45, highMin: 105, confidence: 'medium', sampleCount: 2 });
  });

  it('sums multiple sessions for one completed item before treating it as one sample', () => {
    const goal: Goal = {
      id: 'cs', title: '6.121',
      nodes: [
        { id: 'a', title: 'Problem set 3', status: 'done' },
        { id: 'b', title: 'Problem set 4', status: 'done' },
        { id: 'next', title: 'Problem set 5' },
      ],
    };
    const sessions = [
      log('a', 45), log('a', 30), log('a', 15), // one item, 90 minutes total
      log('b', 50),
    ];
    // Two completed items, not four rows: 50..90 observed, outward-rounded is unchanged.
    expect(expectedTimeFor({ kind: 'step', id: 'next', goalId: 'cs' }, { goals: [goal], tasks: [], sessions }))
      .toEqual({ kind: 'history', lowMin: 50, highMin: 90, confidence: 'medium', sampleCount: 2 });
  });

  it('ignores unfinished items, dangling sessions, other goals, and non-comparable titles', () => {
    const cs: Goal = {
      id: 'cs', title: 'Algorithms',
      nodes: [
        { id: 'done1', title: 'Problem set 1', status: 'done' },
        { id: 'quiet', title: 'Problem set 0', status: 'done' },   // done but never timed
        { id: 'open', title: 'Problem set 2', status: 'doing' },   // unfinished
        { id: 'lab', title: 'Lab 2', status: 'done' },              // different work kind
        { id: 'next', title: 'Problem set 3' },
      ],
    };
    const chem: Goal = { id: 'chem', title: '5.03', nodes: [{ id: 'other', title: 'Problem set 9', status: 'done' }] };
    const sessions = [
      log('done1', 60),
      log('open', 120),
      log('lab', 60),
      log('other', 300),
      // A session pointing at a step that no longer exists resolves nowhere.
      session({ id: `s${sessionSeq++}`, nodeId: 'deleted-step', minutes: 240 }),
    ];
    // Only `done1` is a usable comparable sample; one sample is not enough, so
    // the honest answer is the starter, not a range built on rejected rows.
    expect(expectedTimeFor({ kind: 'step', id: 'next', goalId: 'cs' }, { goals: [cs, chem], tasks: [], sessions }))
      .toEqual({ kind: 'starter', minutes: 30 });
  });

  it('returns a planned estimate when fewer than two comparable samples exist', () => {
    const goal: Goal = {
      id: 'cs', title: 'Algorithms',
      nodes: [
        { id: 'done', title: 'Problem set 1', status: 'done' },
        { id: 'zero', title: 'Review 2', estimateMin: 45 },
        { id: 'next', title: 'Problem set 3', estimateMin: 90 },
      ],
    };
    const oneSample = { goals: [goal], tasks: [], sessions: [log('done', 60)] };
    expect(expectedTimeFor({ kind: 'step', id: 'next', goalId: 'cs' }, oneSample))
      .toEqual({ kind: 'estimate', minutes: 90 });
    // No history at all still falls back to the target's own estimate.
    expect(expectedTimeFor({ kind: 'step', id: 'zero', goalId: 'cs' }, { goals: [goal], tasks: [], sessions: [] }))
      .toEqual({ kind: 'estimate', minutes: 45 });
  });

  it('returns a 30 minute starter when history and estimate are both absent', () => {
    const goal: Goal = { id: 'cs', title: 'Algorithms', nodes: [{ id: 'next', title: 'Reading ch 5' }] };
    expect(expectedTimeFor({ kind: 'step', id: 'next', goalId: 'cs' }, { goals: [goal], tasks: [], sessions: [] }))
      .toEqual({ kind: 'starter', minutes: 30 });
  });

  it('learns from completed loose tasks that share a work kind and no goal', () => {
    const tasks: Task[] = [
      { id: 't1', title: 'Reading ch 3', done: true, goalId: null },
      { id: 't2', title: 'Reading ch 4', done: true, goalId: null },
      { id: 't3', title: 'Reading ch 5', done: false, goalId: null, estimateMin: 40 },
    ];
    const sessions = [
      session({ id: `s${sessionSeq++}`, goalId: null, taskId: 't1', minutes: 35 }),
      session({ id: `s${sessionSeq++}`, goalId: null, taskId: 't2', minutes: 55 }),
    ];
    expect(expectedTimeFor({ kind: 'task', id: 't3', goalId: null }, { goals: [], tasks, sessions }))
      .toEqual({ kind: 'history', lowMin: 35, highMin: 55, confidence: 'medium', sampleCount: 2 });
  });

  it('requires exact normalized-title equality for generic titles', () => {
    const goal: Goal = {
      id: 'cs', title: 'Thesis',
      nodes: [
        { id: 'a', title: 'Write conclusion', status: 'done' },
        { id: 'b', title: 'Write conclusion', status: 'done' },
        { id: 'next', title: 'Write introduction', estimateMin: 40 },
      ],
    };
    const sessions = [log('a', 80), log('b', 120)];
    // A generic title matches only its exact normalized equal, never the whole
    // goal, so `Write introduction` learns nothing from two `Write conclusion`s.
    expect(expectedTimeFor({ kind: 'step', id: 'next', goalId: 'cs' }, { goals: [goal], tasks: [], sessions }))
      .toEqual({ kind: 'estimate', minutes: 40 });
  });

  it('treats a dangling ref as having no history at all', () => {
    const goal: Goal = { id: 'cs', title: 'Algorithms', nodes: [{ id: 'n0', title: 'Problem set 1', status: 'done' }] };
    const ref: WorkRef = { kind: 'step', id: 'nope', goalId: 'cs' };
    expect(expectedTimeFor(ref, { goals: [goal], tasks: [], sessions: [log('n0', 60)] }))
      .toEqual({ kind: 'starter', minutes: 30 });
  });
});

describe('low-focus sessions', () => {
  const physics: Goal = {
    id: 'g1', title: 'Physics 201',
    nodes: [
      { id: 'n1', title: 'Lab 1', status: 'done' },
      { id: 'n2', title: 'Lab 2', status: 'done' },
      { id: 'n3', title: 'Lab 3' },
    ],
  };

  it('are not evidence about how long work takes', () => {
    const ordinary: Session[] = [log('n1', 40), log('n2', 45)];
    const withSlog: Session[] = [
      ...ordinary,
      session({ id: `s${sessionSeq++}`, nodeId: 'n2', minutes: 90, focus: 'low' }),
    ];

    const target: WorkRef = { kind: 'step', id: 'n3', goalId: 'g1' };
    const before = expectedTimeFor(target, { goals: [physics], tasks: [], sessions: ordinary });
    const after = expectedTimeFor(target, { goals: [physics], tasks: [], sessions: withSlog });

    // The 90-minute slog in a loud room must not teach Phase that a lab takes 90.
    expect(after).toEqual(before);
  });

  it('still count as time actually spent', () => {
    const sessions: Session[] = [
      session({ id: `s${sessionSeq++}`, nodeId: 'n1', minutes: 90, focus: 'low' }),
    ];
    expect(loggedForNode(sessions, 'n1')).toBe(90);
  });
});