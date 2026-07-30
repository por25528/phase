import { describe, it, expect } from 'vitest';
import type { Goal, Task } from '../db/types';
import { backlogGroups, BACKLOG_CAP, capBacklog, LOOSE_GROUP_KEY } from './backlog';
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
    expect(g.shown.map((i) => i.id)).toEqual(['g1-0', 'g1-1', 'g1-2', 'g1-3', 'g1-4']);
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
