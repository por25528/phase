import { describe, it, expect } from 'vitest';
import type { Goal, GoalNode, Task } from '../db/types';
import {
  backlogGroups, BACKLOG_CAP, capBacklog, deferredProjectCount, dueChip, LOOSE_GROUP_KEY,
} from './backlog';
import type { BacklogGroup } from './backlog';

const WEEK = '2026-07-13';
const TODAY = '2026-07-15';

function goal(over: Partial<Goal> = {}): Goal {
  return { id: 'g1', title: 'Thesis', nodes: [], ...over };
}
function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Email', done: false, goalId: null, ...over } as Task;
}

describe('backlogGroups', () => {
  it('includes an open step that is not planned at all', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft' }] });
    expect(backlogGroups([g], [], WEEK, TODAY)).toEqual([
      { goalId: 'g1', goalTitle: 'Thesis', pct: 0, items: [{ kind: 'step', id: 'n1', goalId: 'g1', title: 'Draft' }] },
    ]);
  });

  it('includes a step committed to this week but not placed on a day', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: WEEK }] });
    expect(backlogGroups([g], [], WEEK, TODAY)[0].items.map((i) => i.id)).toEqual(['n1']);
  });

  it('includes a step with a day but no start minute — it is not on the grid', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: WEEK, plannedDay: TODAY }] });
    expect(backlogGroups([g], [], WEEK, TODAY)[0].items.map((i) => i.id)).toEqual(['n1']);
  });

  it('excludes a step genuinely placed on the grid this week', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: WEEK, plannedDay: TODAY, plannedStartMin: 600 }] });
    expect(backlogGroups([g], [], WEEK, TODAY)).toEqual([]);
  });

  it('excludes done steps and archived projects', () => {
    const done = goal({ nodes: [{ id: 'n1', title: 'Done', done: true }] });
    const archived = goal({ id: 'g2', completedAt: '2026-07-01', nodes: [{ id: 'n2', title: 'Old' }] });
    expect(backlogGroups([done, archived], [], WEEK, TODAY)).toEqual([]);
  });

  it('includes a dateless task under Loose tasks', () => {
    expect(backlogGroups([], [task()], WEEK, TODAY)).toEqual([
      { goalId: null, goalTitle: 'Loose tasks', pct: 0, items: [{ kind: 'task', id: 't1', goalId: null, title: 'Email' }] },
    ]);
  });

  it('includes a task with a date but no start minute', () => {
    expect(backlogGroups([], [task({ date: TODAY })], WEEK, TODAY)[0].items.map((i) => i.id)).toEqual(['t1']);
  });

  it('excludes a task placed on the grid, and a done task', () => {
    const placed = task({ id: 't1', date: TODAY, startMin: 600 });
    const finished = task({ id: 't2', done: true });
    expect(backlogGroups([], [placed, finished], WEEK, TODAY)).toEqual([]);
  });

  /**
   * The rail is what you plan a week from, so it draws from the horizons that
   * mean "I am doing this": Now and Next. Four parked reading lists put 63 rows
   * in a 249px column, and since each project shows only its first three, the
   * shortlist for the work in progress sat below four shortlists for work the
   * user had explicitly deferred.
   */
  describe('planning horizons', () => {
    const step = (over: Partial<GoalNode> = {}): GoalNode => ({ id: 'n1', title: 'Draft', ...over });

    it('lists Now and Next', () => {
      const now = goal({ id: 'g1', title: 'Now', column: 0, nodes: [step()] });
      const next = goal({ id: 'g2', title: 'Next', column: 1, nodes: [step({ id: 'n2' })] });
      expect(backlogGroups([now, next], [], WEEK, TODAY).map((g) => g.goalId)).toEqual(['g1', 'g2']);
    });

    it('leaves out a Later or Someday project entirely', () => {
      const later = goal({ id: 'g3', title: 'Later', column: 2, nodes: [step()] });
      const someday = goal({ id: 'g4', title: 'Someday', column: 3, nodes: [step({ id: 'n2' })] });
      expect(backlogGroups([later, someday], [], WEEK, TODAY)).toEqual([]);
    });

    it('treats a missing column as Now — no project is hidden by omission', () => {
      expect(backlogGroups([goal({ nodes: [step()] })], [], WEEK, TODAY)).toHaveLength(1);
    });

    /**
     * `weekCapacity` bills every week-committed item to "Xh to place". Hiding
     * one because its project was later deferred would leave a figure in the
     * header with no row beside it to act on — the exact contradiction the
     * planned/backlog split was introduced to remove.
     */
    it('keeps a deferred project’s step once it is committed to a week', () => {
      const later = goal({
        id: 'g3', title: 'Later', column: 2,
        nodes: [step({ plannedWeek: WEEK }), step({ id: 'n2', title: 'Untouched' })],
      });
      const groups = backlogGroups([later], [], WEEK, TODAY);
      expect(groups).toHaveLength(1);
      expect(groups[0].items.map((i) => i.id)).toEqual(['n1']);
    });

    /**
     * `countOpenCarryOver` counts steps whose planned week has passed and
     * offers to push them to next week. That button names a count, so every
     * item it moves has to be one the rail can show.
     */
    it('keeps a deferred project’s carry-over from a past week', () => {
      const later = goal({
        id: 'g3', title: 'Later', column: 2, nodes: [step({ plannedWeek: '2026-07-06' })],
      });
      expect(backlogGroups([later], [], WEEK, TODAY)[0].items.map((i) => i.id)).toEqual(['n1']);
    });

    it('keeps a deferred project’s dated task, and drops its undated one', () => {
      const later = goal({ id: 'g3', title: 'Later', column: 2, nodes: [] });
      const dated = task({ id: 't1', goalId: 'g3', date: TODAY });
      const undated = task({ id: 't2', goalId: 'g3' });
      const groups = backlogGroups([later], [dated, undated], WEEK, TODAY);
      expect(groups.map((g) => g.goalId)).toEqual(['g3']);
      expect(groups[0].items.map((i) => i.id)).toEqual(['t1']);
    });

    /**
     * Falling through to the Loose bucket is what happens to a task whose
     * project has no bucket at all (archived, or already complete). Reusing it
     * for deferred work would strip the project heading off and re-file the row
     * at the BOTTOM of the rail — more prominent than where it started, under a
     * heading saying it belongs to nothing.
     */
    it('drops a deferred project’s undated task rather than demoting it to Loose', () => {
      const later = goal({ id: 'g3', title: 'Later', column: 2, nodes: [] });
      expect(backlogGroups([later], [task({ id: 't2', goalId: 'g3' })], WEEK, TODAY)).toEqual([]);
    });

    /**
     * What the empty rail says. "Nothing left to plan" is true of a placed week
     * and false of a deferred board, and the two look identical from the rail —
     * so the empty state has to be able to tell them apart.
     */
    describe('deferredProjectCount', () => {
      it('counts parked projects holding uncommitted open work', () => {
        const later = goal({ id: 'g3', column: 2, nodes: [step()] });
        const someday = goal({ id: 'g4', column: 3, nodes: [step({ id: 'n2' })] });
        expect(deferredProjectCount([later, someday], TODAY)).toBe(2);
      });

      it('ignores Now and Next — those are already in the rail', () => {
        expect(deferredProjectCount([goal({ column: 1, nodes: [step()] })], TODAY)).toBe(0);
      });

      it('ignores a parked project whose work is done, or already committed', () => {
        const finished = goal({ id: 'g3', column: 2, nodes: [step({ done: true })] });
        const committed = goal({ id: 'g4', column: 3, nodes: [step({ id: 'n2', plannedWeek: WEEK })] });
        expect(deferredProjectCount([finished, committed], TODAY)).toBe(0);
      });

      it('ignores archived projects, matching what the rail drops', () => {
        const archived = goal({ id: 'g3', column: 2, completedAt: '2026-07-01', nodes: [step()] });
        expect(deferredProjectCount([archived], TODAY)).toBe(0);
      });
    });
  });

  it('files a task under its project when it has one', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft' }] });
    const groups = backlogGroups([g], [task({ goalId: 'g1' })], WEEK, TODAY);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.kind)).toEqual(['step', 'task']);
  });

  it('puts Loose tasks last', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft' }] });
    const groups = backlogGroups([g], [task()], WEEK, TODAY);
    expect(groups.map((x) => x.goalId)).toEqual(['g1', null]);
  });

  it('carries the estimate through when one is usable', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', estimateMin: 90 }] });
    expect(backlogGroups([g], [], WEEK, TODAY)[0].items[0].estimateMin).toBe(90);
  });

  it('omits an unusable estimate rather than passing it through', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', estimateMin: 0 }] });
    expect('estimateMin' in backlogGroups([g], [], WEEK, TODAY)[0].items[0]).toBe(false);
  });

  it('drops a project that has nothing left to plan', () => {
    const empty = goal({ id: 'g2', title: 'Empty', nodes: [] });
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft' }] });
    expect(backlogGroups([g, empty], [], WEEK, TODAY).map((x) => x.goalId)).toEqual(['g1']);
  });
});

function group(goalId: string | null, count: number): BacklogGroup {
  return {
    goalId,
    goalTitle: goalId ?? 'Loose tasks',
    pct: 0,
    items: Array.from({ length: count }, (_, i) => ({
      kind: 'step' as const,
      id: `${goalId ?? 'loose'}-${i}`,
      goalId,
      title: `Step ${i}`,
    })),
  };
}

describe('capBacklog', () => {
  it('leaves a group shorter than the cap whole and not expandable', () => {
    const [g] = capBacklog([group('g1', 3)], new Set());
    expect(g.shown).toHaveLength(3);
    expect(g.hidden).toBe(0);
    expect(g.expandable).toBe(false);
  });

  it('caps a long group and reports how many are hidden', () => {
    const [g] = capBacklog([group('g1', 24)], new Set());
    expect(g.shown).toHaveLength(BACKLOG_CAP);
    expect(g.hidden).toBe(24 - BACKLOG_CAP);
    expect(g.expandable).toBe(true);
  });

  it('keeps the first items in order — the rail is the top of the project', () => {
    const [g] = capBacklog([group('g1', 24)], new Set());
    expect(g.shown.map((i) => i.id)).toEqual(
      Array.from({ length: BACKLOG_CAP }, (_, i) => `g1-${i}`),
    );
  });

  it('shows everything for an expanded group, and it stays expandable', () => {
    // `expandable` must NOT be derived from `hidden`: once expanded, hidden is
    // 0, and a component reading only `hidden` would drop the "Show less" row
    // the instant you expanded — leaving no way back.
    const [g] = capBacklog([group('g1', 24)], new Set(['g1']));
    expect(g.shown).toHaveLength(24);
    expect(g.hidden).toBe(0);
    expect(g.expandable).toBe(true);
  });

  it('expands one group without touching its siblings', () => {
    const [a, b] = capBacklog([group('g1', 24), group('g2', 24)], new Set(['g1']));
    expect(a.shown).toHaveLength(24);
    expect(b.shown).toHaveLength(BACKLOG_CAP);
  });

  it('keys the loose group so it can be expanded like any other', () => {
    const [g] = capBacklog([group(null, 24)], new Set([LOOSE_GROUP_KEY]));
    expect(g.key).toBe(LOOSE_GROUP_KEY);
    expect(g.shown).toHaveLength(24);
  });

  it('ignores an expanded key that matches no group', () => {
    const [g] = capBacklog([group('g1', 24)], new Set(['nope']));
    expect(g.shown).toHaveLength(BACKLOG_CAP);
  });

  it('leaves items intact so the caller can still count the true total', () => {
    // The "To plan" count must report every unplanned item, not the visible
    // subset — that number is the honest signal of over-commitment.
    const capped = capBacklog([group('g1', 24), group('g2', 7)], new Set());
    expect(capped.reduce((sum, g) => sum + g.items.length, 0)).toBe(31);
  });
});

/**
 * The rail carried no dates and each group was in raw tree order. With the
 * per-project cap at three, a pset due tomorrow sitting eighth in its project
 * was simply not on screen — and nothing on the three rows that WERE on screen
 * said which of them mattered. For someone holding five deadlines at once that
 * is the whole job of the rail, undone.
 */
describe('urgency in the rail', () => {
  it('puts the nearest deadline at the top of its project', () => {
    const g = goal({
      nodes: [
        { id: 'n1', title: 'Pset 1', deadline: '2026-08-30' },
        { id: 'n2', title: 'Pset 2' },
        { id: 'n3', title: 'Pset 3', deadline: '2026-07-16' },
      ],
    });
    expect(backlogGroups([g], [], WEEK, TODAY)[0].items.map((i) => i.id))
      .toEqual(['n3', 'n1', 'n2']);
  });

  it('survives the cap — the urgent item is one of the three shown', () => {
    const nodes: GoalNode[] = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, title: `Step ${i}` }));
    nodes[7].deadline = '2026-07-16'; // last in tree order, first in urgency
    const [group] = capBacklog(backlogGroups([goal({ nodes })], [], WEEK, TODAY), new Set());
    expect(group.shown.map((i) => i.id)).toContain('n7');
  });

  it('leaves an undated project in tree order — the rail is still its top', () => {
    const nodes = Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, title: `Step ${i}` }));
    expect(backlogGroups([goal({ nodes })], [], WEEK, TODAY)[0].items.map((i) => i.id))
      .toEqual(['n0', 'n1', 'n2', 'n3']);
  });

  it('carries a task’s committed day as its due date', () => {
    const t = task({ id: 't1', date: '2026-07-16' });
    expect(backlogGroups([], [t], WEEK, TODAY)[0].items[0].due).toBe('2026-07-16');
  });

  it('sorts loose tasks by date too, undated last', () => {
    const tasks = [
      task({ id: 'late', date: '2026-08-01' }),
      task({ id: 'none' }),
      task({ id: 'soon', date: '2026-07-14' }),
    ];
    expect(backlogGroups([], tasks, WEEK, TODAY)[0].items.map((i) => i.id))
      .toEqual(['soon', 'late', 'none']);
  });
});

describe('dueChip', () => {
  it('calls out anything already past', () => {
    expect(dueChip('2026-07-14', TODAY)).toEqual({ text: 'overdue', overdue: true });
  });

  it('names today as today rather than a date', () => {
    expect(dueChip(TODAY, TODAY)).toEqual({ text: 'today', overdue: false });
  });

  it('shows a date inside the next week', () => {
    expect(dueChip('2026-07-20', TODAY)?.overdue).toBe(false);
    expect(dueChip('2026-07-20', TODAY)?.text).toBeTruthy();
  });

  it('stays quiet further out — a date on every row hides the urgent ones', () => {
    expect(dueChip('2026-07-23', TODAY)).toBeNull();
    expect(dueChip(undefined, TODAY)).toBeNull();
  });
});

/**
 * A date only reorders the rail if `dueChip` will also SHOW it.
 *
 * Sorting on every date regardless meant a final submission due next January
 * jumped over the four steps you actually do first, displaying no date at all —
 * the project order scrambled with nothing on screen to explain it. And
 * `planNextStepFor` reads `items[0]`, so the board card's "Plan next step" then
 * pointed at a deadline five months out.
 */
describe('urgency reordering matches what the row can show', () => {
  it('leaves a far-future deadline in tree order', () => {
    const g = goal({
      nodes: [
        { id: 'n1', title: 'Step 1' },
        { id: 'n2', title: 'Step 2' },
        { id: 'far', title: 'Final submission', deadline: '2027-01-01' },
      ],
    });
    expect(backlogGroups([g], [], WEEK, TODAY)[0].items.map((i) => i.id))
      .toEqual(['n1', 'n2', 'far']);
  });

  it('still promotes anything inside the chip horizon', () => {
    const g = goal({
      nodes: [
        { id: 'n1', title: 'Step 1' },
        { id: 'soon', title: 'Pset', deadline: '2026-07-18' }, // 3 days out
        { id: 'far', title: 'Final', deadline: '2027-01-01' },
      ],
    });
    expect(backlogGroups([g], [], WEEK, TODAY)[0].items.map((i) => i.id))
      .toEqual(['soon', 'n1', 'far']);
  });

  it('every row it promotes carries a chip explaining why', () => {
    const g = goal({
      nodes: [
        { id: 'n1', title: 'Step 1' },
        { id: 'overdue', title: 'Late pset', deadline: '2026-07-10' },
        { id: 'soon', title: 'Next pset', deadline: '2026-07-18' },
      ],
    });
    const items = backlogGroups([g], [], WEEK, TODAY)[0].items;
    // Anything ahead of the undated tree-order block must have a visible chip.
    const firstUndated = items.findIndex((i) => dueChip(i.due, TODAY) === null);
    expect(firstUndated).toBe(2);
    expect(items.slice(0, firstUndated).every((i) => dueChip(i.due, TODAY) !== null)).toBe(true);
  });
});
