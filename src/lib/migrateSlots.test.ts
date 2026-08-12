import { describe, it, expect } from 'vitest';
import type { AvailabilityWindow, Goal, Task } from '../db/types';
import { migrateSlots, describeMigration, type LegacyNode, type LegacyTask } from './migrateSlots';

/*
 * This suite speaks the PRE-`WorkBlock` shape on purpose.
 *
 * `migrateSlots` repairs data written when a leaf held one placement in
 * `plannedDay` + `plannedStartMin`; it runs before `migrateWorkBlocks` moves
 * that pair into `blocks`, and it is the only code left that may read those
 * fields. The fixtures and the assertions therefore go through the exported
 * legacy types rather than `GoalNode`/`Task` — which no longer have them, and
 * should not.
 */
type LegacyGoal = Omit<Goal, 'nodes'> & { nodes: LegacyNode[] };
const legacyNodes = (g: Goal): LegacyNode[] => g.nodes as LegacyNode[];
const legacyTasks = (t: Task[]): LegacyTask[] => t as LegacyTask[];

const WED = '2026-07-15';   // Wednesday, dow 2
const WEEK = '2026-07-13';
const WINDOWS: AvailabilityWindow[] = [{ dow: 2, startMin: 540, endMin: 1080 }];

const goal = (nodes: LegacyNode[], over: Partial<Goal> = {}): Goal =>
  ({ id: 'g1', title: 'Thesis', nodes, ...over } as LegacyGoal as Goal);

describe('migrateSlots', () => {
  it('places an open day-pinned step at the start of its window', () => {
    const g = goal([{ id: 'n1', title: 'Draft', plannedWeek: WEEK, plannedDay: WED, estimateMin: 90 }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(legacyNodes(goals[0])[0].plannedStartMin).toBe(540);
    expect(report.scheduledSteps).toBe(1);
  });

  it('stacks a second step after the first instead of overlapping it', () => {
    const g = goal([
      { id: 'n1', title: 'A', plannedWeek: WEEK, plannedDay: WED, estimateMin: 90 },
      { id: 'n2', title: 'B', plannedWeek: WEEK, plannedDay: WED, estimateMin: 60 },
    ]);
    const { goals } = migrateSlots([g], [], WINDOWS, true);
    expect(legacyNodes(goals[0]).map((n) => n.plannedStartMin)).toEqual([540, 630]);
  });

  /**
   * A week with no day is not the retired "Any day" bucket — it is current,
   * legal backlog, and `deferOpenWork` ("Push to next week") mints it on
   * purpose. Clearing it only looked harmless while the migration truly ran
   * once: `importStateFromFile` calls `resetSlotMigration()`, so every backup
   * restore replays it over present-day data. Defer a dozen carried-over steps,
   * export, import, relaunch — all twelve commitments were erased, and the
   * toast reported it as routine housekeeping.
   */
  it('keeps a week commitment that has no day yet — that is legal backlog', () => {
    const g = goal([{ id: 'n1', title: 'Draft', plannedWeek: WEEK }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0].plannedWeek).toBe(WEEK);
    expect(legacyNodes(goals[0])[0].plannedDay).toBeUndefined();
    expect(report.sidebarSteps).toBe(0);
  });

  it('is idempotent over its own output — a re-run must not erode commitments', () => {
    const g = goal([
      { id: 'n1', title: 'Deferred', plannedWeek: WEEK },
      { id: 'n2', title: 'Placed', plannedWeek: WEEK, plannedDay: WED, estimateMin: 60 },
    ]);
    const once = migrateSlots([g], [], WINDOWS, true);
    const twice = migrateSlots(once.goals, once.tasks, WINDOWS, true);
    expect(twice.goals).toEqual(once.goals);
    expect(twice.report.sidebarSteps).toBe(0);
  });

  // Malformed legacy shape (violates the db/types.ts invariant that
  // plannedStartMin never survives without plannedDay, but nothing at runtime
  // enforces that on data written before this migration existed). The stray
  // minute is dropped — but the week commitment beside it is legal and stays.
  it('drops a stray plannedStartMin but keeps the week it was committed to', () => {
    const g = goal([{ id: 'n1', title: 'Draft', plannedWeek: WEEK, plannedStartMin: 600, estimateMin: 30 }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0]).toEqual({ id: 'n1', title: 'Draft', plannedWeek: WEEK, estimateMin: 30 });
    expect(report.sidebarSteps).toBe(0);
  });

  it('returns a step that will not fit its day to the sidebar', () => {
    const g = goal([{ id: 'n1', title: 'Huge', plannedWeek: WEEK, plannedDay: WED, estimateMin: 600 }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0].plannedWeek).toBeUndefined();
    expect(legacyNodes(goals[0])[0].plannedStartMin).toBeUndefined();
    expect(report.sidebarSteps).toBe(1);
  });

  it('leaves done steps untouched', () => {
    const g = goal([{ id: 'n1', title: 'Done', status: 'done', plannedWeek: WEEK, plannedDay: WED }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0]).toEqual({ id: 'n1', title: 'Done', status: 'done', plannedWeek: WEEK, plannedDay: WED });
    expect(report.scheduledSteps).toBe(0);
  });

  it('leaves unplanned steps alone', () => {
    const g = goal([{ id: 'n1', title: 'Someday' }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0]).toEqual({ id: 'n1', title: 'Someday' });
    expect(report).toEqual({ scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, unpinnedTasks: 0 });
  });

  it('places an open dated task', () => {
    const t: Task = { id: 't1', title: 'Email', date: WED, done: false, goalId: null, estimateMin: 15 };
    const { tasks, report } = migrateSlots([], [t], WINDOWS, true);
    expect(legacyTasks(tasks)[0].startMin).toBe(540);
    expect(report.scheduledTasks).toBe(1);
  });

  it('keeps the date of a task that will not fit its day, only withholding startMin', () => {
    const t: Task = { id: 't1', title: 'Huge', date: WED, done: false, goalId: null, estimateMin: 600 };
    const { tasks, report } = migrateSlots([], [t], WINDOWS, true);
    // date is RETAINED — there is no task sidebar for a dateless task to land
    // in, unlike a step, which has the backlog rail. Only startMin is withheld,
    // which is legal backlog under the model (day without a start minute).
    expect(tasks[0]).toEqual({ id: 't1', title: 'Huge', date: WED, done: false, goalId: null, estimateMin: 600 });
    expect('startMin' in tasks[0]).toBe(false);
    expect(report.unpinnedTasks).toBe(1);
  });

  it('schedules steps before tasks, so steps win the earlier slots', () => {
    const g = goal([{ id: 'n1', title: 'Step', plannedWeek: WEEK, plannedDay: WED, estimateMin: 60 }]);
    const t: Task = { id: 't1', title: 'Task', date: WED, done: false, goalId: null, estimateMin: 60 };
    const { goals, tasks } = migrateSlots([g], [t], WINDOWS, true);
    expect(legacyNodes(goals[0])[0].plannedStartMin).toBe(540);
    expect(legacyTasks(tasks)[0].startMin).toBe(600);
  });

  it('sends a step to the sidebar when the day is off entirely', () => {
    const g = goal([{ id: 'n1', title: 'Sat', plannedWeek: WEEK, plannedDay: '2026-07-18', estimateMin: 30 }]);
    expect(migrateSlots([g], [], WINDOWS, true).report.sidebarSteps).toBe(1);
  });

  it('is idempotent — a second run changes nothing', () => {
    const g = goal([
      { id: 'n1', title: 'A', plannedWeek: WEEK, plannedDay: WED, estimateMin: 90 },
      { id: 'n2', title: 'B', plannedWeek: WEEK, plannedDay: WED, estimateMin: 60 },
    ]);
    const t: Task = { id: 't1', title: 'Email', date: WED, done: false, goalId: null, estimateMin: 15 };
    const first = migrateSlots([g], [t], WINDOWS, true);
    const second = migrateSlots(first.goals, first.tasks, WINDOWS, true);
    expect(second.goals).toEqual(first.goals);
    expect(second.tasks).toEqual(first.tasks);
    expect(second.report).toEqual({ scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, unpinnedTasks: 0 });
  });

  // Guards the span-registration branch: an item that ALREADY has both a day and
  // a start minute is skipped for PLACEMENT, but its span must still be registered
  // as occupied — otherwise the next item competing for that day is placed on top
  // of it, silently double-booking work the user already committed to.
  //
  // The idempotence test above does NOT pin this: there, every item is already
  // migrated, so nothing new is ever placed and a missing registration has no
  // observable effect. This test mixes an already-migrated item with a new one on
  // the same day, which is the only shape that exposes the bug.
  it('does not place new work on top of an already-migrated item', () => {
    const g = goal([
      // Already migrated, and occupies the entire 540..1080 window.
      { id: 'n1', title: 'Already placed', plannedWeek: WEEK, plannedDay: WED, plannedStartMin: 540, estimateMin: 540 },
      // Brand new, same day — there is no room left for it.
      { id: 'n2', title: 'New step', plannedWeek: WEEK, plannedDay: WED, estimateMin: 30 },
    ]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);

    expect(legacyNodes(goals[0])[0].plannedStartMin).toBe(540); // untouched
    expect(legacyNodes(goals[0])[1].plannedStartMin).toBeUndefined();
    expect(legacyNodes(goals[0])[1].plannedDay).toBeUndefined();
    expect(report.sidebarSteps).toBe(1);
    expect(report.scheduledSteps).toBe(0);
  });

  // Positive companion to the guard test above: proves not just that SOME span
  // was registered, but that it covers the already-migrated item's TRUE extent
  // (startMin..startMin+duration), not e.g. the whole day. A new item on the
  // same day must stack immediately after that true end.
  it('stacks a new step immediately after an already-migrated item\'s true end', () => {
    const g = goal([
      // Already migrated: occupies 540..630 (90 minutes), not the whole window.
      { id: 'n1', title: 'Already placed', plannedWeek: WEEK, plannedDay: WED, plannedStartMin: 540, estimateMin: 90 },
      { id: 'n2', title: 'New step', plannedWeek: WEEK, plannedDay: WED, estimateMin: 60 },
    ]);
    const { goals } = migrateSlots([g], [], WINDOWS, true);

    expect(legacyNodes(goals[0])[0].plannedStartMin).toBe(540); // untouched
    expect(legacyNodes(goals[0])[1].plannedStartMin).toBe(630); // stacks right after 540+90, not at 1440
  });

  it('does not place a new task on top of an already-migrated task', () => {
    const already: LegacyTask = {
      id: 't1', title: 'Already placed', date: WED, startMin: 540, done: false, goalId: null, estimateMin: 540,
    };
    const fresh: Task = { id: 't2', title: 'New task', date: WED, done: false, goalId: null, estimateMin: 30 };
    const { tasks, report } = migrateSlots([], [already as Task, fresh], WINDOWS, true);

    expect(legacyTasks(tasks)[0].startMin).toBe(540); // untouched
    expect(tasks[1].date).toBe(WED); // date is RETAINED — no room left in the 540..1080 window, but no sidebar to fall back to
    expect(legacyTasks(tasks)[1].startMin).toBeUndefined();
    expect(report.unpinnedTasks).toBe(1);
    expect(report.scheduledTasks).toBe(0);
  });

  // Task-side mirror of the step-side true-extent test above: proves the
  // registered span covers the already-migrated task's TRUE extent
  // (startMin..startMin+duration), not e.g. the whole day.
  it('stacks a new task immediately after an already-migrated task\'s true end', () => {
    const already: LegacyTask = {
      id: 't1', title: 'Already placed', date: WED, startMin: 540, done: false, goalId: null, estimateMin: 90,
    };
    const fresh: Task = { id: 't2', title: 'New task', date: WED, done: false, goalId: null, estimateMin: 60 };
    const { tasks } = migrateSlots([], [already as Task, fresh], WINDOWS, true);

    expect(legacyTasks(tasks)[0].startMin).toBe(540); // untouched
    expect(legacyTasks(tasks)[1].startMin).toBe(630); // stacks right after 540+90, not at 1440
  });

  // Finding 3 / mutation 2: legacy plannedWeek can drift from the week its
  // plannedDay actually falls in (e.g. hand-edited data, or the day moved
  // without the week following). The migration re-derives plannedWeek from
  // plannedDay on placement, silently repairing the drift.
  it('repairs a plannedWeek that disagrees with its plannedDay', () => {
    const DRIFTED_WEEK = '2026-07-06'; // a real Monday, but not WED's week
    const g = goal([{ id: 'n1', title: 'Drifted', plannedWeek: DRIFTED_WEEK, plannedDay: WED, estimateMin: 30 }]);
    const { goals } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0].plannedWeek).toBe(WEEK); // re-derived from plannedDay, not kept as-is
    expect(legacyNodes(goals[0])[0].plannedStartMin).toBe(540);
  });

  it('does not mutate its inputs', () => {
    const g = goal([{ id: 'n1', title: 'Draft', plannedWeek: WEEK, plannedDay: WED, estimateMin: 90 }]);
    const t: Task = { id: 't1', title: 'Email', date: WED, done: false, goalId: null, estimateMin: 15 };
    const goalSnapshot = structuredClone(g);
    const taskSnapshot = structuredClone(t);
    migrateSlots([g], [t], WINDOWS, true);
    expect(g).toEqual(goalSnapshot);
    expect(t).toEqual(taskSnapshot);
  });

  // An archived project's open leaf is placed normally — into its OWN occupancy
  // map — rather than cleared. Clearing would make `store.reopenGoal` (which is
  // documented as archiving's exact inverse: it only deletes completedAt) lossy,
  // stranding a reopened project's steps with no week/day/start. Placement is
  // uncounted in scheduledSteps/sidebarSteps: those counters drive a user-facing
  // toast, and an archived project's leaves are invisible until reopened.
  describe('archived projects', () => {
    it('places an archived project\'s open leaf with a real start minute, uncounted', () => {
      const g = goal(
        [{ id: 'n1', title: 'Leftover', plannedWeek: WEEK, plannedDay: WED, estimateMin: 30 }],
        { completedAt: '2026-06-01' },
      );
      const { goals, report } = migrateSlots([g], [], WINDOWS, true);
      expect(goals[0].nodes[0]).toEqual(
        { id: 'n1', title: 'Leftover', plannedWeek: WEEK, plannedDay: WED, plannedStartMin: 540, estimateMin: 30 },
      );
      expect(report).toEqual({ scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, unpinnedTasks: 0 });
    });

    it('returns an archived leaf that will not fit to the sidebar, uncounted', () => {
      const g = goal(
        [{ id: 'n1', title: 'Huge', plannedWeek: WEEK, plannedDay: WED, estimateMin: 600 }],
        { completedAt: '2026-06-01' },
      );
      const { goals, report } = migrateSlots([g], [], WINDOWS, true);
      expect(goals[0].nodes[0]).toEqual({ id: 'n1', title: 'Huge', estimateMin: 600 });
      expect(report).toEqual({ scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, unpinnedTasks: 0 });
    });

    it('does not let an archived leaf occupy a gap that a live commitment needs', () => {
      const archived = goal(
        [{ id: 'n1', title: 'Leftover', plannedWeek: WEEK, plannedDay: WED, plannedStartMin: 540, estimateMin: 540 }],
        { id: 'g-archived', completedAt: '2026-06-01' },
      );
      const live = goal(
        [{ id: 'n2', title: 'Live step', plannedWeek: WEEK, plannedDay: WED, estimateMin: 30 }],
        { id: 'g-live' },
      );
      const { goals, report } = migrateSlots([archived, live], [], WINDOWS, true);
      // The archived leaf's span is registered in its OWN map, not the live map —
      // the live step gets the earliest gap in the (empty) live window instead of
      // being pushed out, even though the archived leaf fills the entire window.
      expect(legacyNodes(goals[0])[0].plannedStartMin).toBe(540); // archived leaf untouched
      expect(legacyNodes(goals[1])[0].plannedStartMin).toBe(540); // live step unaffected
      expect(report.scheduledSteps).toBe(1);
      expect(report.sidebarSteps).toBe(0);
    });

    it('stacks a new archived leaf after another archived leaf, in the archived map only', () => {
      const g = goal(
        [
          { id: 'n1', title: 'Already placed', plannedWeek: WEEK, plannedDay: WED, plannedStartMin: 540, estimateMin: 90 },
          { id: 'n2', title: 'New archived leaf', plannedWeek: WEEK, plannedDay: WED, estimateMin: 60 },
        ],
        { completedAt: '2026-06-01' },
      );
      const { goals, report } = migrateSlots([g], [], WINDOWS, true);
      expect(legacyNodes(goals[0])[0].plannedStartMin).toBe(540); // untouched
      expect(legacyNodes(goals[0])[1].plannedStartMin).toBe(630); // stacks after the first's true end
      expect(report).toEqual({ scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, unpinnedTasks: 0 });
    });

    it('leaves a done leaf on an archived project untouched', () => {
      const g = goal(
        [{ id: 'n1', title: 'Finished', status: 'done', plannedWeek: WEEK, plannedDay: WED, plannedStartMin: 540 }],
        { completedAt: '2026-06-01' },
      );
      const { goals } = migrateSlots([g], [], WINDOWS, true);
      expect(goals[0].nodes[0]).toEqual(
        { id: 'n1', title: 'Finished', status: 'done', plannedWeek: WEEK, plannedDay: WED, plannedStartMin: 540 },
      );
    });
  });
});

describe('describeMigration', () => {
  it('returns null when nothing moved', () => {
    expect(describeMigration({ scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, unpinnedTasks: 0 })).toBeNull();
  });
  it('reports placements and returns together', () => {
    expect(describeMigration({ scheduledSteps: 2, scheduledTasks: 1, sidebarSteps: 1, unpinnedTasks: 0 }))
      .toBe('3 items placed on the calendar · 1 returned to the sidebar');
  });
  it('uses the singular for one item', () => {
    expect(describeMigration({ scheduledSteps: 1, scheduledTasks: 0, sidebarSteps: 0, unpinnedTasks: 0 }))
      .toBe('1 item placed on the calendar');
  });
  it('reports returns only, with no placed clause', () => {
    expect(describeMigration({ scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 3, unpinnedTasks: 0 }))
      .toBe('3 returned to the sidebar');
  });
  it('reports unpinned tasks with their own clause, distinct from sidebar returns', () => {
    expect(describeMigration({ scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, unpinnedTasks: 1 }))
      .toBe('1 task kept on its day, unscheduled');
  });
  it('reports all three clauses together when placements, returns, and unpins all occur', () => {
    expect(describeMigration({ scheduledSteps: 1, scheduledTasks: 0, sidebarSteps: 1, unpinnedTasks: 2 }))
      .toBe('1 item placed on the calendar · 1 returned to the sidebar · 2 tasks kept on their days, unscheduled');
  });
});
