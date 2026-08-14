import { describe, it, expect } from 'vitest';
import {
  loggedForNode, loggedForTask, loggedForItemOn, compareEstimate, projectCalibration,
  weekEffort, describeCalibration, MIN_CALIBRATION_SAMPLES,
} from './actuals';
import type { Goal, Session, Task } from '../db/types';

const session = (over: Partial<Session> = {}): Session => ({
  id: 's1', goalId: 'g1', date: '2026-07-28', minutes: 60, note: '', ...over,
});

/** A project whose leaves are all done, estimated and logged — the happy path. */
function calibratedProject(pairs: [estimate: number, actual: number][]): {
  goal: Goal;
  sessions: Session[];
} {
  const goal: Goal = {
    id: 'g1',
    title: '6.5840',
    nodes: pairs.map(([estimateMin], i) => ({
      id: `n${i}`, title: `Step ${i}`, status: 'done' as const, estimateMin,
    })),
  };
  const sessions = pairs.map(([, actual], i) =>
    session({ id: `s${i}`, nodeId: `n${i}`, minutes: actual }));
  return { goal, sessions };
}

describe('loggedForNode / loggedForTask', () => {
  it('sums every session against the node', () => {
    const sessions = [
      session({ id: 'a', nodeId: 'n1', minutes: 45 }),
      session({ id: 'b', nodeId: 'n1', minutes: 30 }),
      session({ id: 'c', nodeId: 'other', minutes: 90 }),
    ];
    expect(loggedForNode(sessions, 'n1')).toBe(75);
  });

  it('ignores project-level sessions that name no node', () => {
    // A session with only a goalId is time against the project as a whole —
    // real, but not attributable to any one estimate.
    expect(loggedForNode([session({ minutes: 60 })], 'n1')).toBe(0);
  });

  it('keeps node and task ledgers separate', () => {
    const sessions = [
      session({ id: 'a', nodeId: 'x', minutes: 30 }),
      session({ id: 'b', taskId: 'x', minutes: 45 }),
    ];
    expect(loggedForNode(sessions, 'x')).toBe(30);
    expect(loggedForTask(sessions, 'x')).toBe(45);
  });

  it('is zero for an empty ledger', () => {
    expect(loggedForNode([], 'n1')).toBe(0);
  });

  it('does not double-count a session carrying both ids', () => {
    // The two are documented as mutually exclusive and `logSession` writes only
    // one, but imported sessions are not sanitised. Charging the same minutes
    // to a step AND a task would inflate both ledgers.
    const both = [session({ id: 'a', nodeId: 'x', taskId: 'x', minutes: 60 })];
    expect(loggedForNode(both, 'x')).toBe(60);
    expect(loggedForTask(both, 'x')).toBe(0);
  });
});

describe('compareEstimate', () => {
  it('reports the ratio of actual to estimated', () => {
    expect(compareEstimate(90, 135)).toEqual({ estimateMin: 90, actualMin: 135, ratio: 1.5 });
  });

  it('is null without an estimate — there is nothing to compare against', () => {
    expect(compareEstimate(undefined, 135)).toBeNull();
  });

  it('is null without logged time, rather than reporting a 0× ratio', () => {
    expect(compareEstimate(90, 0)).toBeNull();
  });

  it('is null for an unusable estimate, matching normalizeEstimate', () => {
    expect(compareEstimate(0, 60)).toBeNull();
    expect(compareEstimate(-30, 60)).toBeNull();
    expect(compareEstimate(Number.NaN, 60)).toBeNull();
  });
});

describe('projectCalibration', () => {
  it('needs a minimum sample before saying anything', () => {
    const { goal, sessions } = calibratedProject(
      Array.from({ length: MIN_CALIBRATION_SAMPLES - 1 }, () => [60, 90] as [number, number]),
    );
    expect(projectCalibration(goal, sessions)).toBeNull();
  });

  it('reports once there is enough history', () => {
    const { goal, sessions } = calibratedProject(
      Array.from({ length: MIN_CALIBRATION_SAMPLES }, () => [60, 90] as [number, number]),
    );
    expect(projectCalibration(goal, sessions)).toEqual({
      samples: MIN_CALIBRATION_SAMPLES,
      ratio: 1.5,
    });
  });

  /*
   * Weighted by minutes, not averaged per step.
   *
   * A mean of per-step ratios would let a 5-minute step that took 15 (ratio 3)
   * outweigh a 3-hour step that landed exactly. The user's question is "if I
   * budget six hours, what will it really cost", which is about totals.
   */
  it('weights by total minutes rather than averaging per-step ratios', () => {
    const { goal, sessions } = calibratedProject([
      [5, 15],   // ratio 3
      [180, 180], // ratio 1
      [60, 60],
      [60, 60],
      [60, 60],
    ]);
    const c = projectCalibration(goal, sessions)!;
    // Σ actual 375 ÷ Σ estimated 365. A per-step mean would be ~1.4.
    expect(c.ratio).toBeCloseTo(375 / 365, 5);
  });

  it('ignores steps that are not complete', () => {
    const { goal, sessions } = calibratedProject(
      Array.from({ length: MIN_CALIBRATION_SAMPLES }, () => [60, 90] as [number, number]),
    );
    delete goal.nodes[0].status;
    // Work in progress has not yet revealed how long it takes; counting it
    // would make every active project look under-estimated.
    expect(projectCalibration(goal, sessions)).toBeNull();
  });

  it('ignores steps with an estimate but no logged time', () => {
    const { goal, sessions } = calibratedProject(
      Array.from({ length: MIN_CALIBRATION_SAMPLES }, () => [60, 90] as [number, number]),
    );
    const withoutOne = sessions.filter((s) => s.nodeId !== 'n0');
    expect(projectCalibration(goal, withoutOne)).toBeNull();
  });

  it('walks nested containers', () => {
    const goal: Goal = {
      id: 'g1',
      title: 'Nested',
      nodes: [{
        id: 'c1', title: 'Container',
        children: Array.from({ length: MIN_CALIBRATION_SAMPLES }, (_, i) => ({
          id: `n${i}`, title: `S${i}`, status: 'done' as const, estimateMin: 60,
        })),
      }],
    };
    const sessions = Array.from({ length: MIN_CALIBRATION_SAMPLES }, (_, i) =>
      session({ id: `s${i}`, nodeId: `n${i}`, minutes: 30 }));
    expect(projectCalibration(goal, sessions)?.ratio).toBe(0.5);
  });

  it('is null for a project with no history at all', () => {
    expect(projectCalibration({ id: 'g', title: 'Empty', nodes: [] }, [])).toBeNull();
  });
});

describe('weekEffort', () => {
  const WEEK = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'];

  const goals: Goal[] = [{
    id: 'g1', title: 'P',
    nodes: [
      { id: 'n1', title: 'A', status: 'done', estimateMin: 60 },
      { id: 'n2', title: 'B', estimateMin: 30 },
    ],
  }];
  const tasks: Task[] = [
    { id: 't1', title: 'T', done: false, goalId: null, estimateMin: 15 },
  ];

  it('totals logged minutes and the estimates of what was worked on', () => {
    const sessions = [
      session({ id: 'a', nodeId: 'n1', minutes: 90, date: '2026-07-28' }),
      session({ id: 'b', taskId: 't1', minutes: 20, date: '2026-07-30' }),
    ];
    expect(weekEffort(goals, tasks, sessions, WEEK)).toEqual({
      estimatedMin: 75, // 60 + 15
      loggedMin: 110,
    });
  });

  it('counts an estimate once however many sessions touched it', () => {
    const sessions = [
      session({ id: 'a', nodeId: 'n1', minutes: 45, date: '2026-07-28' }),
      session({ id: 'b', nodeId: 'n1', minutes: 45, date: '2026-07-29' }),
    ];
    // Two sittings on one step is 90 minutes of actual against ONE 60-minute
    // estimate — double-counting the estimate would hide the overrun.
    expect(weekEffort(goals, tasks, sessions, WEEK)).toEqual({
      estimatedMin: 60,
      loggedMin: 90,
    });
  });

  it('excludes sessions outside the week', () => {
    const sessions = [session({ id: 'a', nodeId: 'n1', minutes: 90, date: '2026-08-03' })];
    expect(weekEffort(goals, tasks, sessions, WEEK)).toEqual({ estimatedMin: 0, loggedMin: 0 });
  });

  it('counts unfinished work — the recap asks what the week cost, not what it finished', () => {
    const sessions = [session({ id: 'a', nodeId: 'n2', minutes: 40, date: '2026-07-28' })];
    expect(weekEffort(goals, tasks, sessions, WEEK)).toEqual({ estimatedMin: 30, loggedMin: 40 });
  });

  it('counts logged time against work carrying no estimate', () => {
    const bare: Goal[] = [{ id: 'g2', title: 'Q', nodes: [{ id: 'x', title: 'X', status: 'done' }] }];
    const sessions = [session({ id: 'a', nodeId: 'x', minutes: 50, date: '2026-07-28' })];
    // The time was real. Reporting 0 estimated against 50 logged is honest;
    // silently dropping the session would understate the week.
    expect(weekEffort(bare, [], sessions, WEEK)).toEqual({ estimatedMin: 0, loggedMin: 50 });
  });

  it('is empty for a week with no sessions', () => {
    expect(weekEffort(goals, tasks, [], WEEK)).toEqual({ estimatedMin: 0, loggedMin: 0 });
  });

  /*
   * Both sides of the comparison must describe the same work.
   */
  it('drops a session whose step no longer exists', () => {
    const sessions = [
      session({ id: 'a', nodeId: 'n1', minutes: 60, date: '2026-07-28' }),
      session({ id: 'b', nodeId: 'deleted-step', minutes: 120, date: '2026-07-28' }),
    ];
    // The orphan used to add 120 to loggedMin and nothing to estimatedMin, so
    // the recap read "estimated at 1h and took 3h — 3.0× longer than planned"
    // for work the user could no longer see or clear.
    expect(weekEffort(goals, tasks, sessions, WEEK)).toEqual({
      estimatedMin: 60, loggedMin: 60,
    });
  });

  it('drops a session carrying neither id', () => {
    const sessions = [session({ id: 'a', minutes: 90, date: '2026-07-28' })];
    expect(weekEffort(goals, tasks, sessions, WEEK)).toEqual({ estimatedMin: 0, loggedMin: 0 });
  });

  it('drops work whose logged time spans a week boundary', () => {
    const sessions = [
      session({ id: 'a', nodeId: 'n1', minutes: 30, date: '2026-07-28' }),
      session({ id: 'b', nodeId: 'n1', minutes: 30, date: '2026-08-05' }),
    ];
    // Counting the whole 60m estimate against only this week's 30m reported
    // "estimated at 1h and took 30m — quicker than planned", and the following
    // week said exactly the same thing.
    expect(weekEffort(goals, tasks, sessions, WEEK)).toEqual({
      estimatedMin: 0, loggedMin: 0,
    });
  });

  it('counts an item once when a hand-edited session carries both ids', () => {
    const sessions = [
      session({ id: 'a', nodeId: 'n1', taskId: 't1', minutes: 45, date: '2026-07-28' }),
    ];
    // nodeId wins, so 45 minutes is charged to one estimate rather than to the
    // step's 60 AND the task's 15.
    expect(weekEffort(goals, tasks, sessions, WEEK)).toEqual({
      estimatedMin: 60, loggedMin: 45,
    });
  });
});

describe('describeCalibration', () => {
  it('says nothing without a calibration', () => {
    expect(describeCalibration(null)).toBeNull();
  });

  it('calls out estimates that run short', () => {
    expect(describeCalibration({ samples: 8, ratio: 1.5 })).toBe('estimates run about 1.5× short');
  });

  it('calls out work that lands early', () => {
    expect(describeCalibration({ samples: 8, ratio: 0.6 })).toBe(
      'work lands in about 60% of the estimate',
    );
  });

  // A project running 8% over is noise, not a finding. Announcing it trains
  // the user to ignore the line.
  it('treats a near-1 ratio as about right', () => {
    expect(describeCalibration({ samples: 8, ratio: 1.05 })).toBe('estimates are about right');
    expect(describeCalibration({ samples: 8, ratio: 0.92 })).toBe('estimates are about right');
  });
});

describe('loggedForItemOn', () => {
  const step = { kind: 'step' as const, id: 'n1' };
  const task = { kind: 'task' as const, id: 't1' };

  it('sums only the sessions logged on that date', () => {
    const sessions = [
      session({ id: 'a', nodeId: 'n1', date: '2026-07-28', minutes: 30 }),
      session({ id: 'b', nodeId: 'n1', date: '2026-07-28', minutes: 15 }),
      session({ id: 'c', nodeId: 'n1', date: '2026-07-27', minutes: 90 }),
    ];
    expect(loggedForItemOn(sessions, step, '2026-07-28')).toBe(45);
  });

  it('counts a task session that carries no nodeId', () => {
    const sessions = [session({ id: 'a', taskId: 't1', date: '2026-07-28', minutes: 20 })];
    expect(loggedForItemOn(sessions, task, '2026-07-28')).toBe(20);
  });

  /**
   * The two ids are documented as mutually exclusive and `logSession` writes
   * only one, but `importStateFromFile` does not sanitise sessions. Without the
   * precedence rule a hand-edited backup would charge the same minutes twice.
   */
  it('charges a session carrying both ids to the node only', () => {
    const sessions = [
      session({ id: 'a', nodeId: 'n1', taskId: 't1', date: '2026-07-28', minutes: 60 }),
    ];
    expect(loggedForItemOn(sessions, step, '2026-07-28')).toBe(60);
    expect(loggedForItemOn(sessions, task, '2026-07-28')).toBe(0);
  });

  it('is zero when nothing was logged, or nothing on that day', () => {
    expect(loggedForItemOn([], step, '2026-07-28')).toBe(0);
    expect(loggedForItemOn(
      [session({ id: 'a', nodeId: 'n1', date: '2026-07-01', minutes: 60 })],
      step,
      '2026-07-28',
    )).toBe(0);
  });
});
