import { describe, it, expect } from 'vitest';
import { executionAdvice, type ExecutionAdviceInput } from './executionAdvisor';
import { buildDailyWork } from './dailyWork';
import { nowFocus } from './todaySurface';
import { proposalRows } from './todayPlan';
import { weekDates } from './dates';
import type { AvailabilityWindow, Goal, Task } from '../db/types';

const today = '2026-08-12'; // a Wednesday
const week = weekDates(today)[0];

/** A window on every weekday, so free time exists wherever the test needs it. */
const allWeek: AvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
  dow, startMin: 540, endMin: 1020,
}));

function input(over: Partial<ExecutionAdviceInput> = {}): ExecutionAdviceInput {
  return {
    goals: [],
    tasks: [],
    sessions: [],
    availability: allWeek,
    blocks: [],
    allDayBlocks: true,
    today,
    week,
    now: { date: today, minute: 600 },
    ...over,
  };
}

function goal(over: Partial<Goal> & Pick<Goal, 'id' | 'title' | 'nodes'>): Goal {
  return { ...over };
}

function task(over: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return { done: false, goalId: null, ...over };
}

describe('executionAdvice', () => {
  it('uses the current scheduled item as primary', () => {
    const g = goal({
      id: 'g1', title: 'Algorithms',
      nodes: [{
        id: 'n1', title: 'Problem set 4', plannedWeek: week, estimateMin: 60,
        blocks: [{ id: 'b1', date: today, startMin: 540, minutes: 60 }],
      }],
    });
    const advice = executionAdvice(input({ goals: [g], now: { date: today, minute: 570 } }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.key).toBe('step:n1');
    expect(advice.primary.reason).toBe('scheduled-now');
  });

  it('uses the next scheduled item when nothing is running', () => {
    const g = goal({
      id: 'g1', title: 'Algorithms',
      nodes: [{
        id: 'n1', title: 'Problem set 4', plannedWeek: week, estimateMin: 60,
        blocks: [{ id: 'b1', date: today, startMin: 900, minutes: 60 }],
      }],
    });
    const advice = executionAdvice(input({ goals: [g], now: { date: today, minute: 600 } }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.key).toBe('step:n1');
    expect(advice.primary.reason).toBe('scheduled-next');
  });

  it('uses the first untimed commitment when the day has no timed work', () => {
    const t = task({ id: 't1', title: 'Email advisor', date: today });
    const advice = executionAdvice(input({ tasks: [t] }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.key).toBe('task:t1');
    expect(advice.primary.reason).toBe('committed-today');
  });

  it('uses the first todayPlan offer when the day has no commitments', () => {
    const g = goal({
      id: 'g1', title: 'Algorithms',
      nodes: [{ id: 'n1', title: 'Problem set 4', estimateMin: 60 }],
    });
    const advice = executionAdvice(input({ goals: [g] }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    const rows = proposalRows([g], [], week, today);
    expect(advice.primary.key).toBe(rows[0].key);
    expect(advice.primary.reason).toBe('free-time');
  });

  it('returns at most two unique alternatives', () => {
    const tasks = [1, 2, 3, 4, 5].map((n) => task({ id: `t${n}`, title: `Task ${n}`, date: today }));
    const advice = executionAdvice(input({ tasks }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.alternatives.length).toBe(2);
    const keys = [advice.primary.key, ...advice.alternatives.map((a) => a.key)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('may diversify a quiet alternative by life without changing the primary', () => {
    const uni = (id: string, title: string): Goal => goal({
      id, title, lifeId: 'life-uni',
      nodes: [{ id: `${id}-n`, title: `${title} step`, deadline: today, start: today }],
    });
    const startup = goal({
      id: 'gs', title: 'Startup', lifeId: 'life-startup',
      nodes: [{ id: 'gs-n', title: 'Pitch deck', deadline: today, start: today }],
    });
    // Canonical order: three university steps, then the startup one.
    const goals = [uni('ga', 'Algorithms'), uni('gb', 'Biology'), uni('gc', 'Chemistry'), startup];
    const advice = executionAdvice(input({ goals }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.key).toBe('step:ga-n');
    expect(advice.alternatives[0].key).toBe('step:gb-n');
    // Alternative two skips the third university step for the other life.
    expect(advice.alternatives[1].key).toBe('step:gs-n');
    expect(advice.alternatives[1].lifeId).toBe('life-startup');
  });

  it('preserves the no-hours verdict instead of inventing a zero-minute plan', () => {
    const g = goal({
      id: 'g1', title: 'Algorithms',
      nodes: [{ id: 'n1', title: 'Problem set 4', estimateMin: 60 }],
    });
    const advice = executionAdvice(input({ goals: [g], availability: [] }));
    expect(advice).toEqual({ kind: 'needs-hours' });
  });

  it('returns clear when there is nothing to do at all', () => {
    const advice = executionAdvice(input());
    expect(advice).toEqual({ kind: 'clear' });
  });

  it('never recommends blocked, completed, archived, or non-planning-horizon work', () => {
    const blocked = goal({
      id: 'gb', title: 'Blocked course',
      nodes: [{ id: 'nb', title: 'Waiting on grader', status: 'blocked', blockedOn: 'TA', deadline: today, start: today }],
    });
    const archived = goal({
      id: 'gx', title: 'Old course', completedAt: '2026-06-01',
      nodes: [{ id: 'nx', title: 'Final exam', deadline: today, start: today }],
    });
    const parked = goal({
      id: 'gp', title: 'Someday reading', column: 3,
      nodes: [{ id: 'np', title: 'Read the dragon book' }],
    });
    const fine = goal({
      id: 'gf', title: 'Algorithms',
      nodes: [
        { id: 'nf', title: 'Problem set 4', estimateMin: 60 },
        { id: 'nd', title: 'Done already', status: 'done', doneAt: today },
      ],
    });
    const advice = executionAdvice(input({ goals: [blocked, archived, parked, fine] }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    const keys = [advice.primary.key, ...advice.alternatives.map((a) => a.key)];
    expect(keys).toContain('step:nf');
    for (const bad of ['step:nb', 'step:nx', 'step:np', 'step:nd']) {
      expect(keys).not.toContain(bad);
    }
  });

  it('returns the same primary key as nowFocus or proposalRows for the same input', () => {
    // With commitments: agree with nowFocus.
    const t = task({ id: 't1', title: 'Email advisor', date: today });
    const committed = executionAdvice(input({ tasks: [t] }));
    const sections = buildDailyWork([], [t], today);
    const focus = nowFocus(sections.commitments, 600);
    expect(committed.kind).toBe('work');
    if (committed.kind === 'work') expect(committed.primary.key).toBe(focus!.item.key);

    // Without commitments: agree with proposalRows.
    const g = goal({ id: 'g1', title: 'Algorithms', nodes: [{ id: 'n1', title: 'Problem set 4' }] });
    const offered = executionAdvice(input({ goals: [g] }));
    const rows = proposalRows([g], [], week, today);
    expect(offered.kind).toBe('work');
    if (offered.kind === 'work') expect(offered.primary.key).toBe(rows[0].key);
  });

  it('attaches expected-time evidence without letting it change the order', () => {
    const g = goal({
      id: 'g1', title: 'Algorithms',
      nodes: [
        { id: 'a', title: 'Problem set 1', status: 'done' },
        { id: 'b', title: 'Problem set 2', status: 'done' },
        { id: 'n1', title: 'Problem set 3', deadline: today, start: today },
      ],
    });
    const sessions = [
      { id: 's1', goalId: 'g1', date: today, minutes: 50, note: '', nodeId: 'a' },
      { id: 's2', goalId: 'g1', date: today, minutes: 90, note: '', nodeId: 'b' },
    ];
    const advice = executionAdvice(input({ goals: [g], sessions }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.expected).toEqual({
      kind: 'history', lowMin: 50, highMin: 90, confidence: 'medium', sampleCount: 2,
    });
  });
});
