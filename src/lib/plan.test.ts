import { describe, it, expect } from 'vitest';
import type { Goal, PlanReview } from '../db/types';
import {
  weekOf, plannedLeaves, nextUp, carryOvers, paceStatus, attentionRank,
  weekRecap, pinnedDayCounts, PACE_THRESHOLD_PTS,
} from './plan';

// 2026-07-15 is a Wednesday; its week is Mon 2026-07-13 … Sun 2026-07-19.
const TODAY = '2026-07-15';
const WEEK = '2026-07-13';
const LAST_WEEK = '2026-07-06';

function goal(over: Partial<Goal>): Goal {
  return { id: 'g1', title: 'Goal', start: '2026-01-01', deadline: '2026-12-31', nodes: [], ...over };
}

describe('weekOf', () => {
  it('is the Monday of the week', () => {
    expect(weekOf(TODAY)).toBe(WEEK);
    expect(weekOf('2026-07-19')).toBe(WEEK); // Sunday → preceding Monday
  });
});

describe('plannedLeaves', () => {
  it('collects planned leaves (done and not) for the week, day-pinned first', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', done: false, plannedWeek: WEEK },
      { id: 'b', title: 'B', done: true, plannedWeek: WEEK, plannedDay: '2026-07-14' },
      { id: 'c', title: 'C', done: false, plannedWeek: LAST_WEEK },
      { id: 'd', title: 'D', done: false },
    ]});
    const out = plannedLeaves([g], WEEK);
    expect(out.map((l) => l.nodeId)).toEqual(['b', 'a']);
    expect(out[0].done).toBe(true);
    expect(out[0].goalTitle).toBe('Goal');
  });
});

describe('nextUp', () => {
  const goals: Goal[] = [
    goal({ id: 'g1', title: 'First', column: 0, nodes: [
      { id: 'today', title: 'Pinned today', done: false, plannedWeek: WEEK, plannedDay: TODAY },
      { id: 'friday', title: 'Pinned Friday', done: false, plannedWeek: WEEK, plannedDay: '2026-07-17' },
      { id: 'pool', title: 'Week pool', done: false, plannedWeek: WEEK },
      { id: 'carry', title: 'Old plan', done: false, plannedWeek: LAST_WEEK },
      { id: 'free', title: 'Never planned', done: false },
      { id: 'futs', title: 'Starts later', done: false, start: '2026-08-01', deadline: '2026-08-10' },
    ]}),
    goal({ id: 'g2', title: 'Second', column: 1, nodes: [
      { id: 'free2', title: 'Second next', done: false },
    ]}),
  ];

  it('orders pinned-today → week pool → suggestions', () => {
    const out = nextUp(goals, TODAY, 7);
    expect(out.map((i) => i.nodeId)).toEqual(['today', 'pool', 'free', 'free2']);
    expect(out[0].tier).toBe('pinned-today');
    expect(out[1].tier).toBe('week');
    expect(out[2].tier).toBe('suggested');
  });

  it('hides future-day pins entirely and never re-suggests any planned leaf', () => {
    const ids = nextUp(goals, TODAY, 7).map((i) => i.nodeId);
    expect(ids).not.toContain('friday'); // hidden until Friday
    expect(ids).not.toContain('carry');  // carry-over, separate section
  });

  it('excludes future-start leaves from suggestions', () => {
    const ids = nextUp(goals, TODAY, 7).map((i) => i.nodeId);
    expect(ids).not.toContain('futs');
  });

  it('a past-day pin this week is still shown as a week commitment', () => {
    const g = goal({ nodes: [
      { id: 'mon', title: 'Slipped Monday pin', done: false, plannedWeek: WEEK, plannedDay: '2026-07-13' },
    ]});
    const out = nextUp([g], TODAY, 7);
    expect(out[0].nodeId).toBe('mon');
    expect(out[0].tier).toBe('week');
  });

  it('limit bounds suggestions only, never commitments', () => {
    const many = goal({ nodes: (Array.from({ length: 9 }, (_, i) => (
      { id: `p${i}`, title: `P${i}`, done: false, plannedWeek: WEEK }
    )) as Goal['nodes']).concat([{ id: 's1', title: 'S1', done: false }]) });
    const out = nextUp([many], TODAY, 3);
    expect(out.filter((i) => i.tier === 'week')).toHaveLength(9); // all commitments
    expect(out.filter((i) => i.tier === 'suggested').length).toBeLessThanOrEqual(3);
  });
});

describe('carryOvers', () => {
  it('returns unchecked leaves planned for past weeks only', () => {
    const g = goal({ nodes: [
      { id: 'old', title: 'Old', done: false, plannedWeek: LAST_WEEK },
      { id: 'olddone', title: 'Old done', done: true, plannedWeek: LAST_WEEK },
      { id: 'now', title: 'Now', done: false, plannedWeek: WEEK },
    ]});
    expect(carryOvers([g], TODAY).map((l) => l.nodeId)).toEqual(['old']);
  });
});

describe('paceStatus', () => {
  it('zero leaves → needs-breakdown', () => {
    expect(paceStatus(goal({ nodes: [] }), TODAY)).toBe('needs-breakdown');
    expect(paceStatus(goal({ nodes: [{ id: 'c', title: 'C', children: [] }] }), TODAY)).toBe('needs-breakdown');
  });

  it('all leaves done → complete, never needs-breakdown', () => {
    const g = goal({ nodes: [{ id: 'a', title: 'A', done: true }] });
    expect(paceStatus(g, TODAY)).toBe('complete');
  });

  it('behind when actual trails expected by >= threshold', () => {
    // Goal runs 2026-01-01 → 2026-12-31; mid-July expected ≈ 53%. 0% done → behind.
    const g = goal({ nodes: [{ id: 'a', title: 'A', done: false }] });
    expect(paceStatus(g, TODAY)).toBe('behind');
  });

  it('quiet-ahead when actual leads expected by >= threshold', () => {
    // 1 of 1 leaves… all done would be complete, so use 3 of 4 done = 75% vs ~53%.
    const g = goal({ nodes: [
      { id: 'a', title: 'A', done: true },
      { id: 'b', title: 'B', done: true },
      { id: 'c', title: 'C', done: true },
      { id: 'd', title: 'D', done: false },
    ]});
    expect(paceStatus(g, TODAY)).toBe('quiet-ahead');
  });

  it('threshold constant is 10', () => {
    expect(PACE_THRESHOLD_PTS).toBe(10);
  });
});

describe('attentionRank', () => {
  it('overdue leaves → behind → due soon → board order; complete goals dropped', () => {
    const overdue = goal({ id: 'over', title: 'Overdue', nodes: [
      { id: 'o1', title: 'O1', done: false, start: '2026-06-01', deadline: '2026-06-10' },
    ]});
    const behind = goal({ id: 'beh', title: 'Behind', nodes: [{ id: 'b1', title: 'B1', done: false }] });
    const dueSoon = goal({ id: 'due', title: 'Due soon', start: TODAY, deadline: '2026-07-20', nodes: [
      { id: 'd1', title: 'D1', done: false },
    ]});
    const done = goal({ id: 'done', title: 'Done', nodes: [{ id: 'x', title: 'X', done: true }] });
    // Board order deliberately different from attention order:
    const out = attentionRank([done, dueSoon, behind, overdue], TODAY);
    expect(out.map((g) => g.id)).toEqual(['over', 'beh', 'due']);
  });
});

describe('weekRecap', () => {
  it('joins immutable entries against live nodes; deleted nodes count as removed', () => {
    const review: PlanReview = {
      week: LAST_WEEK,
      reviewed: false,
      entries: [
        { nodeId: 'a', goalId: 'g1', leafTitle: 'A', goalTitle: 'Goal' },
        { nodeId: 'b', goalId: 'g1', leafTitle: 'B', goalTitle: 'Goal' },
        { nodeId: 'gone', goalId: 'g1', leafTitle: 'Gone', goalTitle: 'Goal' },
      ],
    };
    const g = goal({ nodes: [
      { id: 'a', title: 'A', done: true },
      { id: 'b', title: 'B', done: false },
    ]});
    const r = weekRecap(review, [g]);
    expect(r.planned).toBe(3);
    expect(r.nowComplete.map((e) => e.nodeId)).toEqual(['a']);
    expect(r.unfinished.map((e) => e.nodeId)).toEqual(['b']);
    expect(r.removed.map((e) => e.nodeId)).toEqual(['gone']);
  });

  it('triage cannot change the denominator (entries are the source)', () => {
    const review: PlanReview = {
      week: LAST_WEEK, reviewed: false,
      entries: [{ nodeId: 'b', goalId: 'g1', leafTitle: 'B', goalTitle: 'Goal' }],
    };
    // 'b' was replanned to this week — recap still counts it against last week's plan
    const g = goal({ nodes: [{ id: 'b', title: 'B', done: false, plannedWeek: WEEK }] });
    expect(weekRecap(review, [g]).planned).toBe(1);
  });
});

describe('pinnedDayCounts', () => {
  it('counts unchecked day-pinned leaves per day', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', done: false, plannedWeek: WEEK, plannedDay: TODAY },
      { id: 'b', title: 'B', done: false, plannedWeek: WEEK, plannedDay: TODAY },
      { id: 'c', title: 'C', done: true, plannedWeek: WEEK, plannedDay: TODAY },
    ]});
    expect(pinnedDayCounts([g]).get(TODAY)).toBe(2);
  });
});
