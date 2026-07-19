import { describe, it, expect } from 'vitest';
import type { Goal, PlanReview } from '../db/types';
import {
  weekOf, plannedLeaves, nextUp, carryOvers, paceStatus, attentionRank,
  weekRecap, pinnedDayCounts, planOpeningStep, PACE_THRESHOLD_PTS,
  projectAttention, milestoneWithin, deadlineBefore, hasUnplannedOpenLeafThisWeek,
  DUE_SOON_DAYS, MILESTONE_SOON_DAYS, focusSummary,
  nearestMeaningfulDate, nextOpenAction, attentionBadge, cardPrimaryAction,
  unplannedOpenLeaves,
} from './plan';

// 2026-07-15 is a Wednesday; its week is Mon 2026-07-13 … Sun 2026-07-19.
const TODAY = '2026-07-15';
const WEEK = '2026-07-13';
const LAST_WEEK = '2026-07-06';

function goal(over: Partial<Goal>): Goal {
  return { id: 'g1', title: 'Goal', start: '2026-01-01', deadline: '2026-12-31', nodes: [], ...over };
}

describe('planOpeningStep', () => {
  const pendingReview: PlanReview = {
    week: LAST_WEEK,
    entries: [{ nodeId: 'n1', goalId: 'g1', leafTitle: 'Leaf', goalTitle: 'Goal' }],
    reviewed: false,
  };

  it('opens recap only for a non-empty unreviewed snapshot', () => {
    expect(planOpeningStep(pendingReview)).toBe('recap');
    expect(planOpeningStep({ ...pendingReview, reviewed: true })).toBe('plan');
    expect(planOpeningStep({ ...pendingReview, entries: [] })).toBe('plan');
    expect(planOpeningStep(null)).toBe('plan');
  });
});

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

describe('projectAttention', () => {
  it('completed wins when completedAt is set', () => {
    const g = goal({ completedAt: '2026-07-10', nodes: [{ id: 'a', title: 'A', done: false }] });
    expect(projectAttention(g, TODAY)).toBe('completed');
  });

  it('ready-to-complete when all leaves done but not archived', () => {
    const g = goal({ nodes: [{ id: 'a', title: 'A', done: true }] });
    expect(projectAttention(g, TODAY)).toBe('ready-to-complete');
  });

  it('overdue on a past project deadline', () => {
    const g = goal({ start: '2026-06-01', deadline: '2026-07-01', nodes: [{ id: 'a', title: 'A', done: false }] });
    expect(projectAttention(g, TODAY)).toBe('overdue');
  });

  it('overdue on an incomplete scheduled leaf past its deadline', () => {
    const g = goal({ nodes: [{ id: 'a', title: 'A', done: false, start: '2026-06-01', deadline: '2026-07-01' }] });
    expect(projectAttention(g, TODAY)).toBe('overdue');
  });

  it('needs-breakdown for a Now project with no leaves', () => {
    expect(projectAttention(goal({ nodes: [] }), TODAY)).toBe('needs-breakdown');
  });

  it('behind when pace trails and nothing more urgent applies', () => {
    // Jan–Dec goal, 0% mid-July ⇒ paceStatus behind
    expect(projectAttention(goal({ nodes: [{ id: 'a', title: 'A', done: false }] }), TODAY)).toBe('behind');
  });

  it('due-soon when on pace with a deadline inside the window', () => {
    const g = goal({ start: '2026-07-01', deadline: '2026-07-25', nodes: [
      { id: 'a', title: 'A', done: true }, { id: 'b', title: 'B', done: false },
    ]});
    expect(paceStatus(g, TODAY)).toBe('on-pace'); // guard the fixture's premise
    expect(projectAttention(g, TODAY)).toBe('due-soon');
  });

  it('milestone-soon when a near milestone has nothing planned this week', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', done: true }, { id: 'b', title: 'B', done: true },
      { id: 'c', title: 'C', done: true }, { id: 'd', title: 'D', done: false },
    ], milestones: [{ id: 'm', title: 'M', date: '2026-07-20' }] });
    expect(projectAttention(g, TODAY)).toBe('milestone-soon');
  });

  it('milestone-soon yields once the week has an unfinished planned leaf', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', done: true }, { id: 'b', title: 'B', done: true },
      { id: 'c', title: 'C', done: true }, { id: 'd', title: 'D', done: false, plannedWeek: WEEK },
    ], milestones: [{ id: 'm', title: 'M', date: '2026-07-20' }] });
    expect(projectAttention(g, TODAY)).toBe('on-track');
  });

  it('not-planned for a Now project with an open, unplanned leaf', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', done: true }, { id: 'b', title: 'B', done: true },
      { id: 'c', title: 'C', done: true }, { id: 'd', title: 'D', done: false },
    ]});
    expect(projectAttention(g, TODAY)).toBe('not-planned');
  });

  it('on-track once the open leaf is planned this week', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', done: true }, { id: 'b', title: 'B', done: true },
      { id: 'c', title: 'C', done: true }, { id: 'd', title: 'D', done: false, plannedWeek: WEEK },
    ]});
    expect(projectAttention(g, TODAY)).toBe('on-track');
  });
});

describe('projectAttention — horizon gating', () => {
  const behindNodes = [{ id: 'a', title: 'A', done: false }] as Goal['nodes']; // Jan–Dec 0% ⇒ behind on Now
  const readyNodes = [
    { id: 'a', title: 'A', done: true }, { id: 'b', title: 'B', done: true },
    { id: 'c', title: 'C', done: true }, { id: 'd', title: 'D', done: false },
  ] as Goal['nodes'];

  it('suppresses active-work signals on Later and Someday', () => {
    expect(projectAttention(goal({ column: 0, nodes: behindNodes }), TODAY)).toBe('behind');
    expect(projectAttention(goal({ column: 1, nodes: behindNodes }), TODAY)).toBe('behind');
    expect(projectAttention(goal({ column: 2, nodes: behindNodes }), TODAY)).toBe('on-track');
    expect(projectAttention(goal({ column: 3, nodes: [] }), TODAY)).toBe('on-track'); // needs-breakdown suppressed
  });

  it('keeps factual/terminal signals on every horizon', () => {
    const over = goal({ column: 3, start: '2026-06-01', deadline: '2026-07-01', nodes: behindNodes });
    expect(projectAttention(over, TODAY)).toBe('overdue');
    const ready = goal({ column: 2, nodes: [{ id: 'a', title: 'A', done: true }] });
    expect(projectAttention(ready, TODAY)).toBe('ready-to-complete');
    const archived = goal({ column: 2, completedAt: '2026-07-01', nodes: behindNodes });
    expect(projectAttention(archived, TODAY)).toBe('completed');
  });

  it('not-planned is Now-only; Next with an unplanned open leaf is on-track', () => {
    expect(projectAttention(goal({ column: 0, nodes: readyNodes }), TODAY)).toBe('not-planned');
    expect(projectAttention(goal({ column: 1, nodes: readyNodes }), TODAY)).toBe('on-track');
  });
});

describe('shared predicates', () => {
  it('deadlineBefore is a strict past comparison', () => {
    expect(deadlineBefore('2026-07-14', TODAY)).toBe(true);
    expect(deadlineBefore('2026-07-15', TODAY)).toBe(false);
  });

  it('milestoneWithin is inclusive of the window edge', () => {
    const g = goal({ milestones: [{ id: 'm', title: 'M', date: '2026-07-29' }] }); // exactly +14
    expect(milestoneWithin(g, 14, TODAY)).toBe(true);
    expect(milestoneWithin(g, 13, TODAY)).toBe(false);
    expect(milestoneWithin(goal({}), 14, TODAY)).toBe(false);
  });

  it('hasUnplannedOpenLeafThisWeek needs an open, unplanned leaf', () => {
    expect(hasUnplannedOpenLeafThisWeek(goal({ nodes: [{ id: 'a', title: 'A', done: false }] }), TODAY)).toBe(true);
    expect(hasUnplannedOpenLeafThisWeek(goal({ nodes: [{ id: 'a', title: 'A', done: false, plannedWeek: WEEK }] }), TODAY)).toBe(false);
    expect(hasUnplannedOpenLeafThisWeek(goal({ nodes: [{ id: 'a', title: 'A', done: true }] }), TODAY)).toBe(false);
  });

  it('DUE_SOON_DAYS and MILESTONE_SOON_DAYS are 14', () => {
    expect(DUE_SOON_DAYS).toBe(14);
    expect(MILESTONE_SOON_DAYS).toBe(14);
  });
});

describe('lifecycle filtering', () => {
  const completed = goal({ id: 'c', completedAt: '2026-07-01', nodes: [
    { id: 'p', title: 'P', done: false, plannedWeek: WEEK },
    { id: 'old', title: 'Old', done: false, plannedWeek: LAST_WEEK },
    { id: 'free', title: 'Free', done: false },
  ]});
  const active = goal({ id: 'a', nodes: [
    { id: 'ap', title: 'AP', done: false, plannedWeek: WEEK },
  ]});

  it('plannedLeaves skips completed projects', () => {
    expect(plannedLeaves([completed, active], WEEK).map((l) => l.nodeId)).toEqual(['ap']);
  });

  it('nextUp skips completed projects', () => {
    expect(nextUp([completed, active], TODAY, 7).map((i) => i.nodeId)).toEqual(['ap']);
  });

  it('carryOvers skips completed projects', () => {
    expect(carryOvers([completed, active], TODAY)).toEqual([]);
  });
});

describe('focusSummary', () => {
  it('reports focus slots over active Now projects, excluding completed', () => {
    const goals = [
      goal({ id: 'n1', column: 0, nodes: [{ id: 'a', title: 'A', done: false }] }),
      goal({ id: 'n2', column: 0, nodes: [{ id: 'b', title: 'B', done: false }] }),
      goal({ id: 'done', column: 0, completedAt: '2026-07-01', nodes: [{ id: 'c', title: 'C', done: true }] }),
      goal({ id: 'next', column: 1, nodes: [{ id: 'd', title: 'D', done: false }] }),
    ];
    const fs = focusSummary(goals, TODAY);
    expect(fs.slots.used).toBe(2);
    expect(fs.slots.limit).toBe(3);
    expect(fs.slots.goalIds).toEqual(['n1', 'n2']);
  });

  it('needsFirstStep is Now-only', () => {
    const goals = [
      goal({ id: 'now-empty', column: 0, nodes: [] }),
      goal({ id: 'next-empty', column: 1, nodes: [] }),
    ];
    expect(focusSummary(goals, TODAY).needsFirstStep.goalIds).toEqual(['now-empty']);
  });

  it('behind matches projectAttention behind (gated to Now/Next)', () => {
    const behindNodes = [{ id: 'x', title: 'X', done: false }] as Goal['nodes'];
    const goals = [
      goal({ id: 'now-behind', column: 0, nodes: behindNodes }),
      goal({ id: 'later-behind', column: 2, nodes: behindNodes }),
    ];
    expect(focusSummary(goals, TODAY).behind.goalIds).toEqual(['now-behind']);
  });

  it('plannedRemaining counts open planned leaves this week and their projects', () => {
    const goals = [
      goal({ id: 'g1', column: 0, nodes: [
        { id: 'a', title: 'A', done: false, plannedWeek: WEEK },
        { id: 'b', title: 'B', done: true, plannedWeek: WEEK },
      ]}),
      goal({ id: 'g2', column: 0, nodes: [{ id: 'c', title: 'C', done: false, plannedWeek: WEEK }] }),
      goal({ id: 'done', column: 0, completedAt: '2026-07-01', nodes: [
        { id: 'd', title: 'D', done: false, plannedWeek: WEEK },
      ]}),
    ];
    const fs = focusSummary(goals, TODAY);
    expect(fs.plannedRemaining.count).toBe(2);
    expect(fs.plannedRemaining.goalIds).toEqual(['g1', 'g2']);
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

// ── Card derivations ──────────────────────────────────────────────────────────

describe('nearestMeaningfulDate', () => {
  it('leads with the soonest upcoming milestone before the deadline', () => {
    const g = goal({ deadline: '2026-12-31', milestones: [
      { id: 'm1', title: 'Late', date: '2026-10-01' },
      { id: 'm2', title: 'Soon', date: '2026-08-01' },
    ]});
    expect(nearestMeaningfulDate(g, TODAY)).toEqual({ date: '2026-08-01', kind: 'milestone', past: false });
  });

  it('ignores milestones that are past or at/after the deadline', () => {
    const g = goal({ deadline: '2026-08-01', milestones: [
      { id: 'm1', title: 'Past', date: '2026-06-01' },
      { id: 'm2', title: 'After deadline', date: '2026-09-01' },
    ]});
    expect(nearestMeaningfulDate(g, TODAY)).toEqual({ date: '2026-08-01', kind: 'deadline', past: false });
  });

  it('falls back to the deadline and flags it past when overdue', () => {
    expect(nearestMeaningfulDate(goal({ deadline: '2026-12-31' }), TODAY))
      .toEqual({ date: '2026-12-31', kind: 'deadline', past: false });
    expect(nearestMeaningfulDate(goal({ deadline: '2026-07-01' }), TODAY))
      .toEqual({ date: '2026-07-01', kind: 'deadline', past: true });
  });
});

describe('nextOpenAction', () => {
  it('prompts a breakdown when there are no leaves', () => {
    expect(nextOpenAction(goal({ nodes: [] }), TODAY))
      .toEqual({ kind: 'needs-breakdown', title: 'No steps yet — break the project into actions' });
  });

  it('reports completion when every leaf is done', () => {
    const g = goal({ nodes: [{ id: 'a', title: 'A', done: true }] });
    expect(nextOpenAction(g, TODAY)).toEqual({ kind: 'complete', title: 'All steps complete' });
  });

  it('prefers a leaf planned for this week over the first open leaf', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', done: false },
      { id: 'b', title: 'B', done: false, plannedWeek: WEEK },
    ]});
    expect(nextOpenAction(g, TODAY)).toEqual({ kind: 'planned', title: 'B' });
  });

  it('falls back to the first open leaf when nothing is planned this week', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', done: true },
      { id: 'b', title: 'B', done: false },
      { id: 'c', title: 'C', done: false },
    ]});
    expect(nextOpenAction(g, TODAY)).toEqual({ kind: 'open', title: 'B' });
  });
});

describe('attentionBadge', () => {
  const twoLeaves = (planned = false) => [
    { id: 'a', title: 'A', done: true },
    { id: 'b', title: 'B', done: false, ...(planned ? { plannedWeek: WEEK } : {}) },
  ];

  it('renders a warn "Behind N%" badge', () => {
    const b = attentionBadge(goal({ column: 0, nodes: [{ id: 'a', title: 'A', done: false }] }), TODAY);
    expect(b?.tone).toBe('warn');
    expect(b?.label).toMatch(/^Behind \d+%$/);
  });

  it('renders the not-planned badge for an unplanned Now project on pace', () => {
    const g = goal({ column: 0, nodes: twoLeaves() });
    expect(attentionBadge(g, TODAY)).toEqual({ label: 'Not planned this week', tone: 'plan' });
  });

  it('renders the needs-a-first-step badge', () => {
    expect(attentionBadge(goal({ column: 0, nodes: [] }), TODAY))
      .toEqual({ label: 'Needs a first step', tone: 'step' });
  });

  it('renders the ready-to-complete badge', () => {
    const g = goal({ column: 0, nodes: [{ id: 'a', title: 'A', done: true }] });
    expect(attentionBadge(g, TODAY)).toEqual({ label: 'Ready to complete', tone: 'accent' });
  });

  it('renders the overdue badge (warn-strong)', () => {
    const g = goal({ column: 0, deadline: '2026-07-01', nodes: [{ id: 'a', title: 'A', done: false }] });
    expect(attentionBadge(g, TODAY)).toEqual({ label: 'Overdue', tone: 'warn-strong' });
  });

  it('renders a "Milestone in Nd" badge', () => {
    const g = goal({ column: 1, deadline: '2026-12-31', nodes: twoLeaves(),
      milestones: [{ id: 'm', title: 'M', date: '2026-07-20' }] });
    expect(attentionBadge(g, TODAY)).toEqual({ label: 'Milestone in 5d', tone: 'warn' });
  });

  it('renders a "Due in Nd" badge', () => {
    const g = goal({ column: 0, start: '2026-07-01', deadline: '2026-07-25', nodes: twoLeaves() });
    expect(attentionBadge(g, TODAY)).toEqual({ label: 'Due in 10d', tone: 'warn' });
  });

  it('shows no badge for an on-track (gated) project', () => {
    const g = goal({ column: 2, nodes: [{ id: 'a', title: 'A', done: false }] });
    expect(attentionBadge(g, TODAY)).toBeNull();
  });
});

describe('unplannedOpenLeaves', () => {
  it('returns open leaves not committed to this week, skipping done and already-planned', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', done: false },                       // unplanned open → in
      { id: 'b', title: 'B', done: true },                        // done → out
      { id: 'c', title: 'C', done: false, plannedWeek: WEEK },    // planned this week → out
      { id: 'd', title: 'D', done: false, plannedWeek: LAST_WEEK }, // carry-over → in (available)
      { id: 'grp', title: 'G', children: [
        { id: 'e', title: 'E', done: false },                     // nested open → in
      ]},
    ]});
    expect(unplannedOpenLeaves(g, WEEK).map((n) => n.id)).toEqual(['a', 'd', 'e']);
  });

  it('is empty for a project with no leaves', () => {
    expect(unplannedOpenLeaves(goal({ nodes: [] }), WEEK)).toEqual([]);
  });
});

describe('cardPrimaryAction', () => {
  it('maps the verdict to a verb', () => {
    expect(cardPrimaryAction(goal({ column: 0, nodes: [] }), TODAY)).toBe('define');
    expect(cardPrimaryAction(goal({ column: 0, nodes: [{ id: 'a', title: 'A', done: true }] }), TODAY)).toBe('complete');
    expect(cardPrimaryAction(goal({ column: 0, nodes: [{ id: 'a', title: 'A', done: false }] }), TODAY)).toBe('plan');
  });

  it('gives Someday projects no plan nag, and completed projects none', () => {
    expect(cardPrimaryAction(goal({ column: 3, nodes: [{ id: 'a', title: 'A', done: false }] }), TODAY)).toBe('none');
    expect(cardPrimaryAction(goal({ column: 0, completedAt: '2026-07-01', nodes: [] }), TODAY)).toBe('none');
  });
});
