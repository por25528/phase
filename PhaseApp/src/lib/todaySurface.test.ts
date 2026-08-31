import { describe, expect, it } from 'vitest';
import type { Goal, GoalNode } from '../db/types';
import type { DailyWorkItem, DailyWorkSections } from './dailyWork';
import type { BacklogGroup, BacklogItem } from './backlog';
import {
  MAX_ATTENTION, MAX_CARRY_OVER, attentionItems, carriedFrom, carryOverRows, nowFocus, surfaceReason,
  MAX_LOOSE, looseRows,
} from './todaySurface';

const TODAY = '2026-08-12';

const item = (over: Partial<DailyWorkItem>): DailyWorkItem => ({
  key: over.id ?? 'k',
  kind: 'step',
  id: 'n',
  title: 'n',
  goalId: 'g',
  due: false,
  done: false,
  editable: true,
  source: 'this-week',
  ...over,
});

describe('nowFocus', () => {
  it('leads with the block the clock is inside', () => {
    const focus = nowFocus([
      item({ id: 'morning', startMin: 540, estimateMin: 60 }),
      item({ id: 'afternoon', startMin: 840, estimateMin: 60 }),
    ], 870);
    expect(focus).toMatchObject({ current: true, item: { id: 'afternoon' } });
  });

  it('leads with the next one to start when nothing is running', () => {
    const focus = nowFocus([
      item({ id: 'morning', startMin: 540, estimateMin: 60 }),
      item({ id: 'afternoon', startMin: 840, estimateMin: 60 }),
    ], 700);
    expect(focus).toMatchObject({ current: false, item: { id: 'afternoon' } });
  });

  /**
   * A day with nothing on the calendar still has work in it, so answering
   * "nothing" would be false. Items arrive in bucket precedence, so the first
   * untimed one is the most urgent.
   */
  it('falls back to the first untimed commitment once the timed day is behind you', () => {
    const focus = nowFocus([
      item({ id: 'morning', startMin: 540, estimateMin: 60 }),
      item({ id: 'loose' }),
    ], 1200);
    expect(focus).toMatchObject({ current: false, item: { id: 'loose' } });
  });

  it('ignores what is already done', () => {
    expect(nowFocus([item({ id: 'a', startMin: 540, done: true })], 550)).toBeNull();
  });

  it('has nothing to say about an empty day', () => {
    expect(nowFocus([], 600)).toBeNull();
  });

  /**
   * Without an estimate the block's length is unknown. Assuming an hour is
   * fine for deciding whether NOW is inside it, and the surface never prints
   * that hour — inventing a duration nobody typed is what the unestimated
   * count exists to prevent.
   */
  it('assumes an hour for an unestimated block rather than treating it as instant', () => {
    expect(nowFocus([item({ id: 'a', startMin: 600 })], 630)).toMatchObject({ current: true });
  });
});

describe('attentionItems', () => {
  const sections = (over: Partial<DailyWorkSections> = {}): DailyWorkSections => ({
    commitments: [], carryOvers: [], completedToday: [], ...over,
  });

  const leaf = (id: string, over: Partial<GoalNode> = {}): GoalNode => ({ id, title: id, ...over });

  const goal = (id: string, over: Partial<Goal> = {}): Goal => ({
    id,
    title: id,
    start: TODAY,
    deadline: '2026-08-24',
    datesConfirmed: true,
    nodes: [leaf('a', { estimateMin: 60 })],
    ...over,
  });

  const attention = (goals: Goal[], s = sections()) => attentionItems(goals, s, TODAY);

  it('says nothing at all on a quiet day', () => {
    expect(attention([goal('fine')])).toEqual([]);
  });

  /**
   * Carry-overs are rows on the page now. A count in the exceptions region
   * beside the rows themselves is the same fact stated twice, and its click
   * had nowhere to go but Plan.
   */
  it('leaves slipped work to the section that lists it', () => {
    const s = sections({ carryOvers: [item({ id: 'x' }), item({ id: 'y' })] });
    expect(attention([goal('fine')], s)).toEqual([]);
  });

  it('gives every exception a goal to open', () => {
    const stuck = goal('Stuck', {
      nodes: [leaf('a', { status: 'blocked', blockedOn: 'waiting on the TA' })],
    });
    expect(attention([stuck]).every((a) => a.goalId !== undefined)).toBe(true);
  });

  it('reports a fully-blocked goal and nothing else', () => {
    const stuck = goal('Stuck', {
      nodes: [leaf('a', { status: 'blocked', blockedOn: 'waiting on the TA' })],
    });
    const out = attention([stuck]);
    expect(out.map((a) => a.kind)).toEqual(['blocked']);
    expect(out[0]!.text).toBe('Stuck has nothing that can be started');
  });

  /**
   * `at-risk` came from `goalHealth`, which compared the work remaining against
   * the free hours before a deadline. There are no free hours, so there is no
   * arithmetic left that could call a goal doomed — and a surface that guessed
   * would be inventing the forecast the app deliberately stopped making.
   */
  it('says nothing about a goal that will not fit before its deadline', () => {
    const doomed = goal('Physics Final', { nodes: [leaf('a', { estimateMin: 100_000 })] });
    expect(attention([doomed])).toEqual([]);
  });

  it('lands the row on the first blocked task, so opening it goes somewhere', () => {
    const stuck = goal('Stuck', {
      nodes: [leaf('a', { status: 'blocked', blockedOn: 'waiting on the TA' })],
    });
    expect(attention([stuck])[0]).toMatchObject({ kind: 'blocked', nodeId: 'a' });
  });

  it('ignores a completed goal, which has no exceptions left', () => {
    const archived = goal('Archived', {
      completedAt: TODAY,
      nodes: [leaf('a', { status: 'blocked' })],
    });
    expect(attention([archived])).toEqual([]);
  });

  /**
   * Three is the point. A warning region that always has something in it is a
   * region people learn to skip, which is worse than not having one.
   */
  it('never shows more than three, however bad the week is', () => {
    const stuck = (id: string) => goal(id, { nodes: [leaf('a', { status: 'blocked' })] });
    const out = attention([stuck('a'), stuck('b'), stuck('c'), stuck('d')]);
    expect(out).toHaveLength(MAX_ATTENTION);
    expect(out[0].kind).toBe('blocked');
  });
});

describe('surfaceReason', () => {
  const at = (source: DailyWorkItem['source']) => surfaceReason(item({ source }));

  it('names the door each row came through', () => {
    expect(at('due')).toBe('Due today');
    expect(at('this-week')).toBe('This week');
    expect(at('carry-over')).toBe('Carried over');
  });

  /**
   * A block at 14:00 shows 14:00. A chip beside it reading "placed today" is a
   * word for a fact already on screen.
   */
  it('says nothing where the row already says it', () => {
    expect(at('pinned-today')).toBeNull();
    expect(at('task-today')).toBeNull();
  });
});

describe('carriedFrom', () => {
  const task = (date: string) => item({ kind: 'task', source: 'carry-over', scheduledDate: date });
  const step = (week: string) => item({ kind: 'step', source: 'carry-over', plannedWeek: week });

  it('counts days for anything inside a week', () => {
    expect(carriedFrom(task('2026-08-11'), TODAY)).toBe('Yesterday');
    expect(carriedFrom(task('2026-08-09'), TODAY)).toBe('3d ago');
  });

  /**
   * A step's date is a WEEK commitment and is only ever accurate to the week.
   * Reporting "9d ago" about it would be a precision the stored value does not
   * have, so the phrasing changes at the 7-day boundary rather than tapering.
   */
  it('counts weeks beyond seven days', () => {
    expect(carriedFrom(step('2026-08-03'), TODAY)).toBe('Last week');
    expect(carriedFrom(step('2026-07-20'), TODAY)).toBe('3w ago');
  });

  it('reads a task from its date and a step from its planned week', () => {
    expect(carriedFrom(task('2026-08-10'), TODAY)).toBe('2d ago');
    expect(carriedFrom(step('2026-08-10'), TODAY)).toBe('2d ago');
  });

  it('says nothing for an item carrying no date at all', () => {
    expect(carriedFrom(item({ source: 'carry-over' }), TODAY)).toBeNull();
  });
});

describe('carryOverRows', () => {
  const task = (id: string, date: string) =>
    item({ id, key: `task:${id}`, kind: 'task', source: 'carry-over', scheduledDate: date });
  const step = (id: string, week: string) =>
    item({ id, key: `step:${id}`, kind: 'step', source: 'carry-over', plannedWeek: week });

  /** The thing that slipped furthest has waited longest — `slippedWork`'s rule. */
  it('orders oldest first across both kinds', () => {
    const out = carryOverRows([
      task('recent', '2026-08-11'),
      step('old', '2026-07-27'),
      task('middle', '2026-08-05'),
    ], TODAY);
    expect(out.rows.map((r) => r.id)).toEqual(['old', 'middle', 'recent']);
    expect(out.overflow).toBe(0);
  });

  it('caps the list and reports what it withheld', () => {
    const many = Array.from({ length: 8 }, (_, i) => task(`t${i}`, `2026-08-0${i + 1}`));
    const out = carryOverRows(many, TODAY);
    expect(out.rows).toHaveLength(MAX_CARRY_OVER);
    expect(out.overflow).toBe(3);
  });

  it('drops anything already finished', () => {
    const out = carryOverRows([
      task('done', '2026-08-01'),
      task('open', '2026-08-02'),
    ].map((r) => (r.id === 'done' ? { ...r, done: true } : r)), TODAY);
    expect(out.rows.map((r) => r.id)).toEqual(['open']);
  });

  it('is empty and silent when nothing slipped', () => {
    expect(carryOverRows([], TODAY)).toEqual({ rows: [], overflow: 0 });
  });

  /**
   * The row Now is already showing is on screen. Listing it here as well would
   * be the same task twice, and counting it as withheld would claim the page is
   * hiding something it is not.
   */
  it('leaves out a row already on screen, and never counts it as withheld', () => {
    const many = Array.from(
      { length: MAX_CARRY_OVER + 2 },
      (_, i) => task(`t${i}`, `2026-08-0${i + 1}`),
    );
    const out = carryOverRows(many, TODAY, new Set(['task:t0']));
    expect(out.rows.map((r) => r.id)).not.toContain('t0');
    expect(out.rows).toHaveLength(MAX_CARRY_OVER);
    expect(out.overflow).toBe(1);
  });
});

describe('looseRows', () => {
  const loose = (id: string, over: Partial<BacklogItem> = {}): BacklogItem =>
    ({ kind: 'task', id, goalId: null, title: id, ...over });
  const group = (items: BacklogItem[]): BacklogGroup =>
    ({ goalId: null, goalTitle: 'Loose tasks', pct: 0, items });
  const projectGroup: BacklogGroup = {
    goalId: 'g1', goalTitle: 'Thesis', pct: 0,
    items: [{ kind: 'step', id: 's1', goalId: 'g1', title: 's1' }],
  };

  it('lists the undated loose bucket and nothing from any project', () => {
    const out = looseRows([projectGroup, group([loose('a'), loose('b')])]);
    expect(out.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(out.overflow).toBe(0);
  });

  /**
   * A dated task already reaches the page through its date — a commitment
   * today, a carry-over when it slipped, another day's page when it is ahead.
   * Listing it here as well would say the same task twice, or surface work the
   * user filed on a future day.
   */
  it('leaves dated tasks to the sections their dates already reach', () => {
    const out = looseRows([group([loose('dated', { due: '2026-08-14' }), loose('open')])]);
    expect(out.rows.map((r) => r.id)).toEqual(['open']);
  });

  it('caps the list and reports what it withheld', () => {
    const many = Array.from({ length: MAX_LOOSE + 3 }, (_, i) => loose(`t${i}`));
    const out = looseRows([group(many)]);
    expect(out.rows).toHaveLength(MAX_LOOSE);
    expect(out.overflow).toBe(3);
  });

  it('leaves out a row already on screen, and never counts it as withheld', () => {
    const many = Array.from({ length: MAX_LOOSE + 1 }, (_, i) => loose(`t${i}`));
    const out = looseRows([group(many)], new Set(['task:t0']));
    expect(out.rows.map((r) => r.id)).not.toContain('t0');
    expect(out.rows).toHaveLength(MAX_LOOSE);
    expect(out.overflow).toBe(0);
  });

  it('is empty and silent when no loose bucket exists', () => {
    expect(looseRows([projectGroup])).toEqual({ rows: [], overflow: 0 });
  });
});
