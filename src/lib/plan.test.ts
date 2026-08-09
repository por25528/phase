import { describe, it, expect } from 'vitest';
import type { Goal, PlanReview, Session } from '../db/types';
import {
  weekOf, plannedLeaves, paceStatus, attentionRank,
  weekRecap, planOpeningStep, PACE_THRESHOLD_PTS,
  projectAttention, deadlineBefore, hasUnplannedOpenLeafThisWeek,
  DUE_SOON_DAYS, focusSummary,
  nearestMeaningfulDate, nextOpenAction, attentionBadge, cardPrimaryAction,
  unplannedOpenLeaves, groupPlannedByGoal, railTree,
  loggedTimeForWeek, formatLoggedMinutes, isFullyBlocked,
} from './plan';
import type { PlannedLeaf } from './plan';
import { CHECKPOINT_SOON_DAYS, checkpointWithin } from './checkpoints';
import { leafCount } from './board';
import { makeBlock } from './blocks';

// 2026-07-15 is a Wednesday; its week is Mon 2026-07-13 … Sun 2026-07-19.
const TODAY = '2026-07-15';
const WEEK = '2026-07-13';
const LAST_WEEK = '2026-07-06';

function goal(over: Partial<Goal>): Goal {
  return {
    id: 'g1',
    title: 'Goal',
    start: '2026-01-01',
    deadline: '2026-12-31',
    datesConfirmed: true,
    nodes: [],
    ...over,
  };
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
      { id: 'a', title: 'A', plannedWeek: WEEK },
      { id: 'b', title: 'B', status: 'done', plannedWeek: WEEK, blocks: [makeBlock('2026-07-14', 540, 60)] },
      { id: 'c', title: 'C', plannedWeek: LAST_WEEK },
      { id: 'd', title: 'D' },
    ]});
    const out = plannedLeaves([g], WEEK);
    expect(out.map((l) => l.nodeId)).toEqual(['b', 'a']);
    expect(out[0].done).toBe(true);
    expect(out[0].goalTitle).toBe('Goal');
  });

  it('carries estimateMin onto planned leaves', () => {
    const goals: Goal[] = [{
      id: 'g1', title: 'G', nodes: [
        { id: 'a', title: 'A', plannedWeek: '2026-07-27', estimateMin: 45 },
        { id: 'b', title: 'B', plannedWeek: '2026-07-27' },
      ],
    }];
    const out = plannedLeaves(goals, '2026-07-27');
    expect(out.find((l) => l.nodeId === 'a')?.estimateMin).toBe(45);
    expect(out.find((l) => l.nodeId === 'b')?.estimateMin).toBeUndefined();
  });

  /**
   * `weekCapacity` operates on `PlannedLeaf`, which has no `status` field at
   * all — this projection is WHERE it gets dropped. That is the actual
   * guarantee behind "blocked-but-scheduled work still books time": it holds
   * because capacity structurally cannot see status, not because of a branch
   * inside `weekCapacity` that happens not to check it. A test that instead
   * fed `weekCapacity` two `PlannedLeaf` fixtures — one meant to represent
   * "blocked", one "open" — would be comparing two structurally identical
   * objects and could never fail, even if `weekCapacity` grew a status-aware
   * branch tomorrow. Asserting the drop here, at the projection boundary, is
   * the only place the claim is actually falsifiable.
   */
  it('drops status at the GoalNode → PlannedLeaf boundary', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'blocked', plannedWeek: WEEK, estimateMin: 60, blocks: [makeBlock('2026-07-14', 600, 60)] },
      { id: 'b', title: 'B', status: 'doing', plannedWeek: WEEK, estimateMin: 30, blocks: [makeBlock('2026-07-15', 540, 30)] },
    ] });
    const out = plannedLeaves([g], WEEK);

    const blocked = out.find((l) => l.nodeId === 'a')!;
    const doing = out.find((l) => l.nodeId === 'b')!;
    expect(blocked).not.toHaveProperty('status');
    expect(doing).not.toHaveProperty('status');

    // The fields capacity DOES read all survive the projection.
    expect(blocked.estimateMin).toBe(60);
    expect(blocked.plannedWeek).toBe(WEEK);
    expect(blocked.blocks).toEqual([
      expect.objectContaining({ date: '2026-07-14', startMin: 600 }),
    ]);
    expect(blocked.done).toBe(false);
  });
});

describe('paceStatus', () => {
  it('zero leaves → needs-breakdown', () => {
    expect(paceStatus(goal({ nodes: [] }), TODAY)).toBe('needs-breakdown');
  });

  /**
   * `children: []` is a LEAF, not an empty container.
   *
   * `removeNode` splices a child out and leaves the array behind, so this is
   * exactly the shape a step has after you delete its last subtask.
   * `leafCount`, `nodePct`, `walkLeaves` and `firstOpenLeaf` all read it as a
   * leaf; only `hasLeaf` disagreed, and this test used to assert the
   * disagreement. The user-visible symptom was a board card showing "Next · C"
   * and a "Needs a first step" badge at the same time, above the very step it
   * claimed was missing, while the drawer beside it counted "0/1 done".
   */
  it('treats a childless container as the leaf every other reader sees', () => {
    const g = goal({ nodes: [{ id: 'c', title: 'C', children: [] }] });
    expect(paceStatus(g, TODAY)).not.toBe('needs-breakdown');
    expect(leafCount(g.nodes)).toEqual({ total: 1, done: 0 });
  });

  it('all leaves done → complete, never needs-breakdown', () => {
    const g = goal({ nodes: [{ id: 'a', title: 'A', status: 'done' }] });
    expect(paceStatus(g, TODAY)).toBe('complete');
  });

  it('behind when actual trails expected by >= threshold', () => {
    // Goal runs 2026-01-01 → 2026-12-31; mid-July expected ≈ 53%. 0% done → behind.
    const g = goal({ nodes: [{ id: 'a', title: 'A' }] });
    expect(paceStatus(g, TODAY)).toBe('behind');
  });

  it('quiet-ahead when actual leads expected by >= threshold', () => {
    // 1 of 1 leaves… all done would be complete, so use 3 of 4 done = 75% vs ~53%.
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'done' },
      { id: 'b', title: 'B', status: 'done' },
      { id: 'c', title: 'C', status: 'done' },
      { id: 'd', title: 'D' },
    ]});
    expect(paceStatus(g, TODAY)).toBe('quiet-ahead');
  });

  it('threshold constant is 10', () => {
    expect(PACE_THRESHOLD_PTS).toBe(10);
  });

  it('does not derive pace or behind attention from unconfirmed legacy dates', () => {
    const g = goal({
      datesConfirmed: undefined,
      nodes: [{ id: 'a', title: 'A' }],
    });

    expect(paceStatus(g, TODAY)).toBe('no-schedule');
    expect(projectAttention(g, TODAY)).not.toBe('behind');
    expect(attentionBadge(g, TODAY)).toEqual({ label: 'Dates unconfirmed', tone: 'step' });
  });
});

describe('attentionRank', () => {
  it('overdue leaves → behind → due soon → board order; complete goals dropped', () => {
    const overdue = goal({ id: 'over', title: 'Overdue', nodes: [
      { id: 'o1', title: 'O1', start: '2026-06-01', deadline: '2026-06-10' },
    ]});
    const behind = goal({ id: 'beh', title: 'Behind', nodes: [{ id: 'b1', title: 'B1' }] });
    const dueSoon = goal({ id: 'due', title: 'Due soon', start: TODAY, deadline: '2026-07-20', nodes: [
      { id: 'd1', title: 'D1' },
    ]});
    const done = goal({ id: 'done', title: 'Done', nodes: [{ id: 'x', title: 'X', status: 'done' }] });
    // Board order deliberately different from attention order:
    const out = attentionRank([done, dueSoon, behind, overdue], TODAY);
    expect(out.map((g) => g.id)).toEqual(['over', 'beh', 'due']);
  });
});

describe('projectAttention', () => {
  it('completed wins when completedAt is set', () => {
    const g = goal({ completedAt: '2026-07-10', nodes: [{ id: 'a', title: 'A' }] });
    expect(projectAttention(g, TODAY)).toBe('completed');
  });

  it('ready-to-complete when all leaves done but not archived', () => {
    const g = goal({ nodes: [{ id: 'a', title: 'A', status: 'done' }] });
    expect(projectAttention(g, TODAY)).toBe('ready-to-complete');
  });

  it('overdue on a past project deadline', () => {
    const g = goal({ start: '2026-06-01', deadline: '2026-07-01', nodes: [{ id: 'a', title: 'A' }] });
    expect(projectAttention(g, TODAY)).toBe('overdue');
  });

  it('overdue on an incomplete scheduled leaf past its deadline', () => {
    const g = goal({
      datesConfirmed: undefined,
      nodes: [{ id: 'a', title: 'A', start: '2026-06-01', deadline: '2026-07-01' }],
    });
    expect(projectAttention(g, TODAY)).toBe('overdue');
  });

  it('does not treat an unconfirmed project deadline as overdue', () => {
    const g = goal({
      datesConfirmed: undefined,
      start: '2026-06-01',
      deadline: '2026-07-01',
      nodes: [{ id: 'a', title: 'A' }],
    });

    expect(projectAttention(g, TODAY)).not.toBe('overdue');
  });

  it('needs-breakdown for a Now project with no leaves', () => {
    expect(projectAttention(goal({ nodes: [] }), TODAY)).toBe('needs-breakdown');
  });

  it('behind when pace trails and nothing more urgent applies', () => {
    // Jan–Dec goal, 0% mid-July ⇒ paceStatus behind
    expect(projectAttention(goal({ nodes: [{ id: 'a', title: 'A' }] }), TODAY)).toBe('behind');
  });

  it('due-soon when on pace with a deadline inside the window', () => {
    const g = goal({ start: '2026-07-01', deadline: '2026-07-25', nodes: [
      { id: 'a', title: 'A', status: 'done' }, { id: 'b', title: 'B' },
    ]});
    expect(paceStatus(g, TODAY)).toBe('on-pace'); // guard the fixture's premise
    expect(projectAttention(g, TODAY)).toBe('due-soon');
  });

  it('does not derive due-soon from an unconfirmed project deadline', () => {
    const g = goal({
      datesConfirmed: undefined,
      start: '2026-07-01',
      deadline: '2026-07-25',
      nodes: [
        { id: 'a', title: 'A', status: 'done' },
        { id: 'b', title: 'B', plannedWeek: WEEK },
      ],
    });

    expect(projectAttention(g, TODAY)).toBe('on-track');
  });

  it('checkpoint-soon when a near checkpoint has nothing planned this week', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'done' }, { id: 'b', title: 'B', status: 'done' },
      { id: 'c', title: 'C', status: 'done' },
      { id: 'd', title: 'Checkpoint', checkpoint: true, start: '2026-07-20', deadline: '2026-07-20' },
    ] });
    expect(projectAttention(g, TODAY)).toBe('checkpoint-soon');
  });

  it('a done near checkpoint does not produce checkpoint-soon', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'done' }, { id: 'b', title: 'B', status: 'done' },
      { id: 'c', title: 'C', status: 'done' },
      { id: 'd', title: 'Checkpoint', status: 'done', checkpoint: true, start: '2026-07-20', deadline: '2026-07-20' },
    ] });
    expect(projectAttention(g, TODAY)).not.toBe('checkpoint-soon');
    expect(attentionBadge(g, TODAY)?.label).not.toContain('Checkpoint');
  });

  it('checkpoint-soon yields once the week has an unfinished planned leaf', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'done' }, { id: 'b', title: 'B', status: 'done' },
      { id: 'c', title: 'C', status: 'done' },
      { id: 'd', title: 'Checkpoint', checkpoint: true, start: '2026-07-20', deadline: '2026-07-20', plannedWeek: WEEK },
    ] });
    expect(projectAttention(g, TODAY)).toBe('on-track');
  });

  it('not-planned for a Now project with an open, unplanned leaf', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'done' }, { id: 'b', title: 'B', status: 'done' },
      { id: 'c', title: 'C', status: 'done' }, { id: 'd', title: 'D' },
    ]});
    expect(projectAttention(g, TODAY)).toBe('not-planned');
  });

  it('on-track once the open leaf is planned this week', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'done' }, { id: 'b', title: 'B', status: 'done' },
      { id: 'c', title: 'C', status: 'done' }, { id: 'd', title: 'D', plannedWeek: WEEK },
    ]});
    expect(projectAttention(g, TODAY)).toBe('on-track');
  });
});

describe('projectAttention — horizon gating', () => {
  const behindNodes = [{ id: 'a', title: 'A' }] as Goal['nodes']; // Jan–Dec 0% ⇒ behind on Now
  const readyNodes = [
    { id: 'a', title: 'A', status: 'done' }, { id: 'b', title: 'B', status: 'done' },
    { id: 'c', title: 'C', status: 'done' }, { id: 'd', title: 'D' },
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
    const ready = goal({ column: 2, nodes: [{ id: 'a', title: 'A', status: 'done' }] });
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

  it('checkpointWithin is inclusive of the window edge', () => {
    const g = goal({ nodes: [{ id: 'cp', title: 'Checkpoint', checkpoint: true, start: '2026-07-29', deadline: '2026-07-29' }] }); // exactly +14
    expect(checkpointWithin(g, 14, TODAY)).toBe(true);
    expect(checkpointWithin(g, 13, TODAY)).toBe(false);
    expect(checkpointWithin(goal({}), 14, TODAY)).toBe(false);
  });

  it('hasUnplannedOpenLeafThisWeek needs an open, unplanned leaf', () => {
    expect(hasUnplannedOpenLeafThisWeek(goal({ nodes: [{ id: 'a', title: 'A' }] }), TODAY)).toBe(true);
    expect(hasUnplannedOpenLeafThisWeek(goal({ nodes: [{ id: 'a', title: 'A', plannedWeek: WEEK }] }), TODAY)).toBe(false);
    expect(hasUnplannedOpenLeafThisWeek(goal({ nodes: [{ id: 'a', title: 'A', status: 'done' }] }), TODAY)).toBe(false);
  });

  it('DUE_SOON_DAYS and CHECKPOINT_SOON_DAYS are 14', () => {
    expect(DUE_SOON_DAYS).toBe(14);
    expect(CHECKPOINT_SOON_DAYS).toBe(14);
  });
});

describe('lifecycle filtering', () => {
  const completed = goal({ id: 'c', completedAt: '2026-07-01', nodes: [
    { id: 'p', title: 'P', plannedWeek: WEEK },
    { id: 'old', title: 'Old', plannedWeek: LAST_WEEK },
    { id: 'free', title: 'Free' },
  ]});
  const active = goal({ id: 'a', nodes: [
    { id: 'ap', title: 'AP', plannedWeek: WEEK },
  ]});

  it('plannedLeaves skips completed projects', () => {
    expect(plannedLeaves([completed, active], WEEK).map((l) => l.nodeId)).toEqual(['ap']);
  });

});

describe('focusSummary', () => {
  it('reports focus slots over active Now projects, excluding completed', () => {
    const goals = [
      goal({ id: 'n1', column: 0, nodes: [{ id: 'a', title: 'A' }] }),
      goal({ id: 'n2', column: 0, nodes: [{ id: 'b', title: 'B' }] }),
      goal({ id: 'done', column: 0, completedAt: '2026-07-01', nodes: [{ id: 'c', title: 'C', status: 'done' }] }),
      goal({ id: 'next', column: 1, nodes: [{ id: 'd', title: 'D' }] }),
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
    const behindNodes = [{ id: 'x', title: 'X' }] as Goal['nodes'];
    const goals = [
      goal({ id: 'now-behind', column: 0, nodes: behindNodes }),
      goal({ id: 'later-behind', column: 2, nodes: behindNodes }),
    ];
    expect(focusSummary(goals, TODAY).behind.goalIds).toEqual(['now-behind']);
  });

  /**
   * `blocked` follows the same PLANNING_HORIZONS gate as `needsFirstStep` and
   * `behind` just above — a parked project must not be loud in the Focus bar
   * when `cardPrimaryAction` withholds 'unblock' for it and `backlogGroups`
   * drops its rows. Without the gate, a Later project with every open leaf
   * blocked would still show up here and spotlight on click.
   */
  it('blocked is gated to Now/Next — a parked, fully-blocked project stays out', () => {
    const blockedNodes = [{ id: 'x', title: 'X', status: 'blocked' as const }];
    const goals = [
      goal({ id: 'now-blocked', column: 0, nodes: blockedNodes }),
      goal({ id: 'later-blocked', column: 2, nodes: blockedNodes }),
    ];
    expect(focusSummary(goals, TODAY).blocked).toEqual({ count: 1, goalIds: ['now-blocked'] });
  });

  it('plannedRemaining counts open planned leaves this week and their projects', () => {
    const goals = [
      goal({ id: 'g1', column: 0, nodes: [
        { id: 'a', title: 'A', plannedWeek: WEEK },
        { id: 'b', title: 'B', status: 'done', plannedWeek: WEEK },
      ]}),
      goal({ id: 'g2', column: 0, nodes: [{ id: 'c', title: 'C', plannedWeek: WEEK }] }),
      goal({ id: 'done', column: 0, completedAt: '2026-07-01', nodes: [
        { id: 'd', title: 'D', plannedWeek: WEEK },
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
      { id: 'a', title: 'A', status: 'done' },
      { id: 'b', title: 'B' },
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
    const g = goal({ nodes: [{ id: 'b', title: 'B', plannedWeek: WEEK }] });
    expect(weekRecap(review, [g]).planned).toBe(1);
  });
});

// ── Card derivations ──────────────────────────────────────────────────────────

describe('nearestMeaningfulDate', () => {
  it('leads with the soonest upcoming checkpoint before the deadline', () => {
    const g = goal({ deadline: '2026-12-31', nodes: [
      { id: 'm1', title: 'Late', checkpoint: true, start: '2026-10-01', deadline: '2026-10-01' },
      { id: 'm2', title: 'Soon', checkpoint: true, start: '2026-08-01', deadline: '2026-08-01' },
    ]});
    expect(nearestMeaningfulDate(g, TODAY)).toEqual({ date: '2026-08-01', kind: 'checkpoint', past: false });
  });

  it('ignores checkpoints that are past or at/after the deadline', () => {
    const g = goal({ deadline: '2026-08-01', nodes: [
      { id: 'm1', title: 'Past', checkpoint: true, start: '2026-06-01', deadline: '2026-06-01' },
      { id: 'm2', title: 'After deadline', checkpoint: true, start: '2026-09-01', deadline: '2026-09-01' },
    ]});
    expect(nearestMeaningfulDate(g, TODAY)).toEqual({ date: '2026-08-01', kind: 'deadline', past: false });
  });

  it('falls back to the deadline and flags it past when overdue', () => {
    expect(nearestMeaningfulDate(goal({ deadline: '2026-12-31' }), TODAY))
      .toEqual({ date: '2026-12-31', kind: 'deadline', past: false });
    expect(nearestMeaningfulDate(goal({ deadline: '2026-07-01' }), TODAY))
      .toEqual({ date: '2026-07-01', kind: 'deadline', past: true });
  });

  it('uses an upcoming checkpoint but never a legacy deadline when dates are unconfirmed', () => {
    const legacy = goal({
      datesConfirmed: undefined,
      deadline: '2026-12-31',
      nodes: [{ id: 'm', title: 'Checkpoint', checkpoint: true, start: '2026-08-01', deadline: '2026-08-01' }],
    });

    expect(nearestMeaningfulDate(legacy, TODAY))
      .toEqual({ date: '2026-08-01', kind: 'checkpoint', past: false });
    expect(nearestMeaningfulDate({ ...legacy, nodes: [] }, TODAY)).toBeNull();
  });

  it('keeps checkpoints eligible when the project has no deadline', () => {
    const g = goal({
      deadline: undefined,
      datesConfirmed: true,
      nodes: [{ id: 'm', title: 'Checkpoint', checkpoint: true, start: '2026-08-01', deadline: '2026-08-01' }],
    });
    expect(nearestMeaningfulDate(g, TODAY))
      .toEqual({ date: '2026-08-01', kind: 'checkpoint', past: false });
  });

  it('uses a confirmed partial deadline as the checkpoint boundary and fallback', () => {
    const g = goal({
      start: undefined,
      deadline: '2026-08-01',
      datesConfirmed: true,
      nodes: [{ id: 'm', title: 'Later checkpoint', checkpoint: true, start: '2026-09-01', deadline: '2026-09-01' }],
    });
    expect(nearestMeaningfulDate(g, TODAY))
      .toEqual({ date: '2026-08-01', kind: 'deadline', past: false });
  });
});

describe('nextOpenAction', () => {
  it('prompts a breakdown when there are no leaves', () => {
    expect(nextOpenAction(goal({ nodes: [] }), TODAY))
      .toEqual({ kind: 'needs-breakdown', title: 'No tasks yet — break the goal into actions' });
  });

  it('reports completion when every leaf is done', () => {
    const g = goal({ nodes: [{ id: 'a', title: 'A', status: 'done' }] });
    expect(nextOpenAction(g, TODAY)).toEqual({ kind: 'complete', title: 'All tasks complete' });
  });

  it('prefers a leaf planned for this week over the first open leaf', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B', plannedWeek: WEEK },
    ]});
    expect(nextOpenAction(g, TODAY)).toEqual({ kind: 'planned', title: 'B' });
  });

  it('falls back to the first open leaf when nothing is planned this week', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'done' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
    ]});
    expect(nextOpenAction(g, TODAY)).toEqual({ kind: 'open', title: 'B' });
  });

  it('prefers a doing leaf over an earlier todo leaf', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B', status: 'doing' },
    ]});
    expect(nextOpenAction(g, TODAY)).toEqual({ kind: 'open', title: 'B' });
  });

  it('never names a blocked leaf', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'blocked' },
      { id: 'b', title: 'B' },
    ]});
    expect(nextOpenAction(g, TODAY)).toEqual({ kind: 'open', title: 'B' });
  });

  it('names the all-blocked verdict, not a step, when every open leaf is blocked', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'blocked' },
      { id: 'b', title: 'B', status: 'blocked' },
    ]});
    expect(nextOpenAction(g, TODAY)).toEqual({ kind: 'open', title: 'All open tasks are blocked' });
  });

  it('still prefers a leaf planned for this week even when a doing leaf exists', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'doing' },
      { id: 'b', title: 'B', plannedWeek: WEEK },
    ]});
    expect(nextOpenAction(g, TODAY)).toEqual({ kind: 'planned', title: 'B' });
  });
});

describe('attentionBadge', () => {
  const twoLeaves = (planned = false) => [
    { id: 'a', title: 'A', status: 'done' as const },
    { id: 'b', title: 'B', ...(planned ? { plannedWeek: WEEK } : {}) },
  ];

  // C-12: the board built its own "Behind 44%" while Today and the Timeline
  // said "44 pts behind" for the same project. One wording now, in points,
  // with the arithmetic in the tooltip.
  it('renders the behind-pace badge in points, never as a percentage', () => {
    const b = attentionBadge(goal({ column: 0, nodes: [{ id: 'a', title: 'A' }] }), TODAY);
    expect(b?.tone).toBe('warn');
    expect(b?.label).toMatch(/^\d+ pts behind pace$/);
    expect(b?.label).not.toContain('%');
    expect(b?.hint).toMatch(/^\d+% done, \d+% expected by today$/);
  });

  it('renders the not-planned badge for an unplanned Now project on pace', () => {
    const g = goal({ column: 0, nodes: twoLeaves() });
    expect(attentionBadge(g, TODAY)).toEqual({ label: 'Not planned this week', tone: 'plan' });
  });

  it('renders the needs-a-first-step badge', () => {
    expect(attentionBadge(goal({ column: 0, nodes: [] }), TODAY))
      .toEqual({ label: 'Needs a first task', tone: 'step' });
  });

  it('renders the ready-to-complete badge', () => {
    const g = goal({ column: 0, nodes: [{ id: 'a', title: 'A', status: 'done' }] });
    expect(attentionBadge(g, TODAY)).toEqual({ label: 'Ready to complete', tone: 'accent' });
  });

  it('renders the overdue badge (warn-strong)', () => {
    const g = goal({ column: 0, deadline: '2026-07-01', nodes: [{ id: 'a', title: 'A' }] });
    expect(attentionBadge(g, TODAY)).toEqual({ label: 'Overdue', tone: 'warn-strong' });
  });

  it('preserves an overdue leaf badge when project dates are unconfirmed', () => {
    const g = goal({
      datesConfirmed: undefined,
      nodes: [
        { id: 'a', title: 'A', start: '2026-06-01', deadline: '2026-07-01' },
      ],
    });

    expect(projectAttention(g, TODAY)).toBe('overdue');
    expect(attentionBadge(g, TODAY)).toEqual({ label: 'Overdue', tone: 'warn-strong' });
  });

  it('renders a "Checkpoint in Nd" badge', () => {
    const g = goal({ column: 1, deadline: '2026-12-31', nodes: [
      { id: 'a', title: 'A', status: 'done' },
      { id: 'm', title: 'M', checkpoint: true, start: '2026-07-20', deadline: '2026-07-20' },
    ] });
    expect(attentionBadge(g, TODAY)).toEqual({ label: 'Checkpoint in 5d', tone: 'warn' });
  });

  it('renders a "Due in Nd" badge', () => {
    const g = goal({ column: 0, start: '2026-07-01', deadline: '2026-07-25', nodes: twoLeaves() });
    expect(attentionBadge(g, TODAY)).toEqual({ label: 'Due in 10d', tone: 'warn' });
  });

  it('shows no badge for an on-track (gated) project', () => {
    const g = goal({ column: 2, nodes: [{ id: 'a', title: 'A' }] });
    expect(attentionBadge(g, TODAY)).toBeNull();
  });
});

describe('groupPlannedByGoal', () => {
  const leaf = (nodeId: string, goalId: string, goalTitle: string): PlannedLeaf => ({
    goalId, goalTitle, nodeId, title: nodeId, done: false, plannedWeek: WEEK, blocks: [],
  });

  it('groups leaves by project, preserving first-seen order within and across groups', () => {
    const groups = groupPlannedByGoal([
      leaf('a', 'g1', 'One'),
      leaf('b', 'g2', 'Two'),
      leaf('c', 'g1', 'One'),
    ]);
    expect(groups.map((g) => g.goalId)).toEqual(['g1', 'g2']);
    expect(groups[0].leaves.map((l) => l.nodeId)).toEqual(['a', 'c']);
    expect(groups[1].leaves.map((l) => l.nodeId)).toEqual(['b']);
    expect(groups[0].goalTitle).toBe('One');
  });

  it('is empty for no leaves', () => {
    expect(groupPlannedByGoal([])).toEqual([]);
  });
});

describe('unplannedOpenLeaves', () => {
  it('returns open leaves not genuinely placed on the grid this week, skipping done and placed', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A' },                       // unplanned open → in
      { id: 'b', title: 'B', status: 'done' },                        // done → out
      { id: 'c', title: 'C', plannedWeek: WEEK },    // committed, no day → in (backlog)
      { id: 'd', title: 'D', plannedWeek: LAST_WEEK }, // carry-over → in (available)
      { id: 'placed', title: 'Placed', plannedWeek: WEEK, blocks: [makeBlock('2026-07-14', 600, 60)] },                                                            // on the grid → out
      { id: 'grp', title: 'G', children: [
        { id: 'e', title: 'E' },                     // nested open → in
      ]},
    ]});
    expect(unplannedOpenLeaves(g, WEEK).map((n) => n.id)).toEqual(['a', 'c', 'd', 'e']);
  });

  it('is empty for a project with no leaves', () => {
    expect(unplannedOpenLeaves(goal({ nodes: [] }), WEEK)).toEqual([]);
  });

  it('regression: a leaf committed to this week with no plannedDay is backlog, not invisible', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', plannedWeek: WEEK }, // no plannedDay
    ]});
    expect(unplannedOpenLeaves(g, WEEK).map((n) => n.id)).toEqual(['a']);
  });

  it('a leaf placed on a day and start minute this week is not backlog', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', plannedWeek: WEEK, blocks: [makeBlock('2026-07-14', 540, 60)] },
    ]});
    expect(unplannedOpenLeaves(g, WEEK).map((n) => n.id)).toEqual([]);
  });

  it('a leaf planned to a different week is still backlog (carry-over)', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', plannedWeek: LAST_WEEK },
    ]});
    expect(unplannedOpenLeaves(g, WEEK).map((n) => n.id)).toEqual(['a']);
  });

  it('a done leaf is never backlog, even with no plannedDay', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'done', plannedWeek: WEEK },
    ]});
    expect(unplannedOpenLeaves(g, WEEK)).toEqual([]);
  });

  /**
   * A week commitment with no sitting is backlog, not invisible — the state
   * that replaced "a day with no start minute", which could no longer be
   * written once a placement carried its own date.
   */
  it('a leaf committed to the week but never placed is backlog', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', plannedWeek: WEEK },
    ]});
    expect(unplannedOpenLeaves(g, WEEK).map((n) => n.id)).toEqual(['a']);
  });
});

describe('railTree', () => {
  it('keeps flat open leaves, dropping done and grid-placed ones', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B', status: 'done' },                        // done → out
      { id: 'c', title: 'C', plannedWeek: WEEK },    // committed, no day → in (backlog)
      { id: 'd', title: 'D', plannedWeek: LAST_WEEK }, // carry-over → in
      { id: 'placed', title: 'Placed', plannedWeek: WEEK, blocks: [makeBlock('2026-07-14', 600, 60)] },                                                            // on the grid → out
    ]});
    const tree = railTree(g, WEEK);
    expect(tree.map((n) => n.id)).toEqual(['a', 'c', 'd']);
    expect(tree.every((n) => n.isLeaf)).toBe(true);
  });

  it('regression: a leaf committed to this week with no plannedDay is backlog, not invisible', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', plannedWeek: WEEK },
    ]});
    expect(railTree(g, WEEK).map((n) => n.id)).toEqual(['a']);
  });

  it('a leaf placed on a day and start minute this week is not backlog', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', plannedWeek: WEEK, blocks: [makeBlock('2026-07-14', 540, 60)] },
    ]});
    expect(railTree(g, WEEK)).toEqual([]);
  });

  it('a leaf planned to a different week is still backlog (carry-over)', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', plannedWeek: LAST_WEEK },
    ]});
    expect(railTree(g, WEEK).map((n) => n.id)).toEqual(['a']);
  });

  it('a done leaf is never backlog, even with no plannedDay', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'done', plannedWeek: WEEK },
    ]});
    expect(railTree(g, WEEK)).toEqual([]);
  });

  it('a leaf committed to the week but never placed is backlog', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', plannedWeek: WEEK },
    ]});
    expect(railTree(g, WEEK).map((n) => n.id)).toEqual(['a']);
  });

  it('keeps containers as sub-headings with their open leaves nested', () => {
    const g = goal({ nodes: [
      { id: 'grp', title: 'Subgoal', children: [
        { id: 'x', title: 'X' },
        { id: 'y', title: 'Y', status: 'done' },                     // done → out of the group
      ]},
      { id: 'z', title: 'Z' },
    ]});
    const tree = railTree(g, WEEK);
    expect(tree.map((n) => n.id)).toEqual(['grp', 'z']);
    const grp = tree[0];
    expect(grp.isLeaf).toBe(false);
    expect(grp.children.map((n) => n.id)).toEqual(['x']);
  });

  it('drops a container whose descendants are all done or placed on the grid', () => {
    const g = goal({ nodes: [
      { id: 'grp', title: 'Subgoal', children: [
        { id: 'x', title: 'X', status: 'done' },
        { id: 'y', title: 'Y', plannedWeek: WEEK, blocks: [makeBlock('2026-07-14', 600, 60)] },
      ]},
    ]});
    expect(railTree(g, WEEK)).toEqual([]);
  });

  it('nests deeply, preserving structure', () => {
    const g = goal({ nodes: [
      { id: 'outer', title: 'Outer', children: [
        { id: 'inner', title: 'Inner', children: [
          { id: 'leaf', title: 'Leaf' },
        ]},
      ]},
    ]});
    const tree = railTree(g, WEEK);
    expect(tree[0].id).toBe('outer');
    expect(tree[0].children[0].id).toBe('inner');
    expect(tree[0].children[0].children[0].id).toBe('leaf');
    expect(tree[0].children[0].children[0].isLeaf).toBe(true);
  });

  it('is empty for a project with no leaves', () => {
    expect(railTree(goal({ nodes: [] }), WEEK)).toEqual([]);
  });
});

describe('cardPrimaryAction', () => {
  it('maps the verdict to a verb', () => {
    expect(cardPrimaryAction(goal({ column: 0, nodes: [] }), TODAY)).toBe('define');
    expect(cardPrimaryAction(goal({ column: 0, nodes: [{ id: 'a', title: 'A', status: 'done' }] }), TODAY)).toBe('complete');
    expect(cardPrimaryAction(goal({ column: 0, nodes: [{ id: 'a', title: 'A' }] }), TODAY)).toBe('plan');
  });

  it('gives Someday projects no plan nag, and completed projects none', () => {
    expect(cardPrimaryAction(goal({ column: 3, nodes: [{ id: 'a', title: 'A' }] }), TODAY)).toBe('none');
    expect(cardPrimaryAction(goal({ column: 0, completedAt: '2026-07-01', nodes: [] }), TODAY)).toBe('none');
  });

  /**
   * The rail draws from Now and Next only, and this is the button that expects
   * to find a row there. Offering it on a Later card gave `planNextStepFor`
   * nothing to reveal, so it navigated to the calendar and stopped.
   */
  it('offers Next but not Later — it must not point at a rail row that is absent', () => {
    const open = [{ id: 'a', title: 'A' }];
    expect(cardPrimaryAction(goal({ column: 1, nodes: open }), TODAY)).toBe('plan');
    expect(cardPrimaryAction(goal({ column: 2, nodes: open }), TODAY)).toBe('none');
  });

  /**
   * A deferred project is silent, not half-silent. `projectAttention` already
   * collapses every active-work verdict to 'on-track' above the planning
   * horizons, so 'define' never reached a Later card either — the only verb it
   * could produce was 'plan', which is the one now withdrawn. What remains is
   * Open project, which is the honest next move: promote it, then plan it.
   */
  it('gives a deferred project no verb at all', () => {
    expect(cardPrimaryAction(goal({ column: 2, nodes: [] }), TODAY)).toBe('none');
    expect(cardPrimaryAction(goal({ column: 3, nodes: [] }), TODAY)).toBe('none');
  });

  // Still reachable above the horizons: a project that is genuinely finished
  // can be closed from its card wherever it was parked.
  it('still offers Complete on a deferred project that is done', () => {
    const done = [{ id: 'a', title: 'A', status: 'done' as const }];
    expect(cardPrimaryAction(goal({ column: 2, nodes: done }), TODAY)).toBe('complete');
  });
});

describe('isFullyBlocked', () => {
  it('is false for a project with zero open leaves', () => {
    expect(isFullyBlocked(goal({ nodes: [{ id: 'a', title: 'A', status: 'done' }] }))).toBe(false);
  });

  it('is false for a project with no leaves at all', () => {
    expect(isFullyBlocked(goal({ nodes: [] }))).toBe(false);
  });

  it('is false when one open leaf is workable, even if others are blocked', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'blocked' },
      { id: 'b', title: 'B' },
    ] });
    expect(isFullyBlocked(g)).toBe(false);
  });

  it('is true when every open leaf is blocked', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'blocked' },
      { id: 'b', title: 'B', status: 'blocked' },
      { id: 'c', title: 'C', status: 'done' },
    ] });
    expect(isFullyBlocked(g)).toBe(true);
  });
});

describe('a project whose only open work is blocked', () => {
  const blocked = (): Goal => ({ id: 'g', title: 'G', column: 0, nodes: [
    { id: 'a', title: 'A', status: 'blocked', blockedOn: 'the grader' },
    { id: 'b', title: 'B', status: 'done' },
  ] });

  it('offers unblock, not plan', () => {
    expect(cardPrimaryAction(blocked(), TODAY)).toBe('unblock');
  });

  it('still offers plan when something is workable', () => {
    const g = blocked();
    g.nodes.push({ id: 'c', title: 'C' });
    expect(cardPrimaryAction(g, TODAY)).toBe('plan');
  });

  /**
   * Horizon gating and the blocked check are two INDEPENDENT reasons to
   * withhold 'plan', not alternatives — a parked project must stay quiet even
   * when it is also fully blocked. The horizon tests above and the blocked
   * tests above are each single-variable, so a refactor that inverted the
   * branch order (checked isFullyBlocked first and returned 'unblock' for a
   * parked-but-blocked project) would pass every existing test in this file.
   * Only a fixture that is BOTH parked AND fully blocked exercises the
   * composition.
   */
  it('stays quiet on a parked project even when it is also fully blocked', () => {
    const g = blocked();
    g.column = 2; // parked: past PLANNING_HORIZONS
    expect(cardPrimaryAction(g, TODAY)).toBe('none');
  });

  it('counts as a blocked project in the focus summary', () => {
    expect(focusSummary([blocked()], TODAY).blocked).toEqual({ count: 1, goalIds: ['g'] });
  });
});

describe('loggedTimeForWeek', () => {
  function session(date: string, minutes: number): Session {
    return { id: `s-${date}-${minutes}`, goalId: null, date, minutes, note: '' };
  }

  it('sums minutes and counts sessions inside the week, ignoring others', () => {
    const sessions = [
      session('2026-07-13', 60),   // Mon of WEEK
      session('2026-07-19', 45),   // Sun of WEEK
      session('2026-07-12', 30),   // day before the week
      session('2026-07-20', 90),   // day after the week
      session('2026-07-15', 0),    // zero-minute log ignored
      session('not-a-date', 25),   // invalid date ignored
    ];

    expect(loggedTimeForWeek(sessions, WEEK)).toEqual({ minutes: 105, sessions: 2 });
  });

  it('returns an empty summary for an invalid week', () => {
    expect(loggedTimeForWeek([session('2026-07-13', 60)], 'nope')).toEqual({ minutes: 0, sessions: 0 });
  });
});

describe('formatLoggedMinutes', () => {
  it('renders compact hour/minute durations', () => {
    expect(formatLoggedMinutes(0)).toBe('0m');
    expect(formatLoggedMinutes(45)).toBe('45m');
    expect(formatLoggedMinutes(60)).toBe('1h');
    expect(formatLoggedMinutes(200)).toBe('3h 20m');
  });
});
