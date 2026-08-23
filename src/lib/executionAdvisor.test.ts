import { describe, it, expect } from 'vitest';
import { executionAdvice, MAX_ALTERNATIVES, type ExecutionAdviceInput } from './executionAdvisor';
import { buildDailyWork } from './dailyWork';
import { nowFocus } from './todaySurface';
import { proposalRows } from './todayPlan';
import { weekDates } from './dates';
import type { Goal, Task } from '../db/types';
import type { Demand } from './demand';

const today = '2026-08-12'; // a Wednesday
const week = weekDates(today)[0];

/** A window on every weekday, so free time exists wherever the test needs it. */

function input(over: Partial<ExecutionAdviceInput> = {}): ExecutionAdviceInput {
  return {
    goals: [],
    tasks: [],
    sessions: [],
    blocks: [],
    placedOn: () => [],
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

  it('returns at most MAX_ALTERNATIVES unique alternatives', () => {
    const tasks = [1, 2, 3, 4, 5, 6].map((n) => task({ id: `t${n}`, title: `Task ${n}`, date: today }));
    const advice = executionAdvice(input({ tasks }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.alternatives.length).toBe(MAX_ALTERNATIVES);
    expect(MAX_ALTERNATIVES).toBe(3);
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
    // Canonical order: four university steps, then the startup one.
    const goals = [uni('ga', 'Algorithms'), uni('gb', 'Biology'), uni('gc', 'Chemistry'), uni('gd', 'Drama'), startup];
    const advice = executionAdvice(input({ goals }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.key).toBe('step:ga-n');
    expect(advice.alternatives[0].key).toBe('step:gb-n');
    expect(advice.alternatives[1].key).toBe('step:gc-n');
    // The LAST alternative skips the fourth university step for the other life.
    expect(advice.alternatives[2].key).toBe('step:gs-n');
    expect(advice.alternatives[2].lifeId).toBe('life-startup');
  });

  /*
   * There is no `needs-hours` verdict left to preserve. It said "Phase doesn't
   * know when you work", and nothing asks. A day booked solid still refuses —
   * that is the offer's own `none`, and it leaves the pool empty rather than
   * raising a verdict of its own.
   */
  it('is clear rather than needs-hours when every day inside the horizon is booked solid', () => {
    const g = goal({
      id: 'g1', title: 'Algorithms',
      nodes: [{ id: 'n1', title: 'Problem set 4', estimateMin: 60 }],
    });
    const advice = executionAdvice(input({
      goals: [g],
      placedOn: () => [{ startMin: 0, endMin: 1440 }],
    }));
    expect(advice).toEqual({ kind: 'clear' });
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

describe('the focus lens', () => {
  /**
   * Two free-time candidates: one long, one short, in that canonical order.
   *
   * They are two GOALS and not two leaves of one, because `todayPlan` offers
   * the first item of each group and never a project's queue — one goal here
   * would contribute one candidate and the lens would have nothing to choose
   * between.
   */
  function twoSizes(): Goal[] {
    return [
      goal({
        id: 'g1', title: 'Physics 201',
        nodes: [{ id: 'n1', title: 'Lab report', estimateMin: 45 }],
      }),
      goal({
        id: 'g2', title: 'Advising',
        nodes: [{ id: 'n2', title: 'Reply to Dr. Chen', estimateMin: 10 }],
      }),
    ];
  }

  it('changes nothing when no level is given, so Today is untouched', () => {
    const withoutLens = executionAdvice(input({ goals: twoSizes() }));
    const withHigh = executionAdvice(input({ goals: twoSizes(), timeLevel: 'high' }));
    expect(withoutLens).toEqual(withHigh);
  });

  it('offers the first SHORT candidate at low, without re-ordering the queue', () => {
    const advice = executionAdvice(input({ goals: twoSizes(), timeLevel: 'low' }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.title).toBe('Reply to Dr. Chen');
    expect(advice.beyondWindow).toBeUndefined();
  });

  it('offers the queue head at medium, where the long one clears the cap', () => {
    const advice = executionAdvice(input({ goals: twoSizes(), timeLevel: 'medium' }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.title).toBe('Lab report');
  });

  it('never hides a commitment, however long it is', () => {
    const g = goal({
      id: 'g1', title: 'History 340',
      nodes: [{
        id: 'n1', title: 'Seminar prep', plannedWeek: week, estimateMin: 90,
        blocks: [{ id: 'b1', date: today, startMin: 540, minutes: 90 }],
      }],
    });
    const advice = executionAdvice(input({
      goals: [g], timeLevel: 'low', now: { date: today, minute: 570 },
    }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.title).toBe('Seminar prep');
    expect(advice.primary.reason).toBe('scheduled-now');
  });

  it('flags beyondWindow and still offers the real head when the lens empties', () => {
    const g = goal({
      id: 'g1', title: 'Dissertation',
      nodes: [{ id: 'n1', title: 'Thesis chapter 2', estimateMin: 120 }],
    });
    const advice = executionAdvice(input({ goals: [g], timeLevel: 'low' }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.title).toBe('Thesis chapter 2');
    expect(advice.beyondWindow).toBe(true);
    // It offers the head, not a consolation list.
    expect(advice.alternatives).toEqual([]);
  });

  it('says clear rather than beyondWindow when there was nothing to begin with', () => {
    const advice = executionAdvice(input({ timeLevel: 'low' }));
    expect(advice.kind).toBe('clear');
  });
});

describe('the focus dial', () => {
  /** Two untagged free-time candidates, the same pool `twoSizes` builds, untagged. */
  function baseInput(): ExecutionAdviceInput {
    return input({
      goals: [
        goal({
          id: 'g1', title: 'Physics 201',
          nodes: [{ id: 'n1', title: 'Lab report', estimateMin: 45 }],
        }),
        goal({
          id: 'g2', title: 'Advising',
          nodes: [{ id: 'n2', title: 'Reply to Dr. Chen', estimateMin: 10 }],
        }),
      ],
    });
  }

  /** One discretionary free-time candidate, tagged with the given demand. */
  function taggedInput(demand: Demand): ExecutionAdviceInput {
    return input({
      goals: [
        goal({
          id: 'g1', title: 'Physics 201',
          nodes: [{ id: 'n1', title: 'Lab report', estimateMin: 45, demand }],
        }),
      ],
    });
  }

  /** A deep commitment: a block on the calendar right now, tagged deep. */
  function committedDeepInput(): ExecutionAdviceInput {
    return input({
      goals: [
        goal({
          id: 'g1', title: 'History 340',
          nodes: [{
            id: 'n1', title: 'Seminar prep', demand: 'deep', plannedWeek: week, estimateMin: 90,
            blocks: [{ id: 'b1', date: today, startMin: 540, minutes: 90 }],
          }],
        }),
      ],
      now: { date: today, minute: 570 },
    });
  }

  /** Untagged discretionary work, all of it long — the window's problem alone. */
  function longUntaggedInput(): ExecutionAdviceInput {
    return input({
      goals: [
        goal({
          id: 'g1', title: 'Dissertation',
          nodes: [{ id: 'n1', title: 'Thesis chapter 2', estimateMin: 120 }],
        }),
      ],
    });
  }

  it('changes membership and never order', () => {
    const withoutDial = executionAdvice(baseInput());
    const withDial = executionAdvice({ ...baseInput(), focusLevel: 'high' });
    expect(withDial.kind).toBe('work');
    if (withDial.kind !== 'work' || withoutDial.kind !== 'work') return;
    expect(withDial.primary.key).toBe(withoutDial.primary.key);
  });

  it('does nothing at all on an untagged database', () => {
    const untouched = executionAdvice(baseInput());
    for (const level of ['low', 'medium', 'high'] as const) {
      expect(executionAdvice({ ...baseInput(), focusLevel: level })).toEqual(untouched);
    }
  });

  it('drops a deep discretionary item at Low', () => {
    const input = taggedInput('deep');
    const advice = executionAdvice({ ...input, focusLevel: 'low' });
    if (advice.kind !== 'work') throw new Error('expected work');
    expect(advice.beyondFocus).toBe(true);
  });

  it('keeps a deep COMMITMENT at Low', () => {
    const advice = executionAdvice({ ...committedDeepInput(), focusLevel: 'low' });
    if (advice.kind !== 'work') throw new Error('expected work');
    expect(advice.beyondFocus).toBeUndefined();
  });

  it('blames the window, not focus, when time emptied the queue first', () => {
    const advice = executionAdvice({ ...longUntaggedInput(), timeLevel: 'low', focusLevel: 'low' });
    if (advice.kind !== 'work') throw new Error('expected work');
    expect(advice.beyondWindow).toBe(true);
    expect(advice.beyondFocus).toBeUndefined();
  });
});
