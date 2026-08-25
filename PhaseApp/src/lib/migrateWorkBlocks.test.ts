import { describe, expect, it } from 'vitest';
import type { Goal, GoalNode, Task } from '../db/types';
import { makeBlock } from './blocks';
import { migrateWorkBlocks } from './migrateWorkBlocks';

/** The pre-`WorkBlock` shape, which is the whole input to this migration. */
type LegacyNode = GoalNode & { plannedDay?: string; plannedStartMin?: number };
type LegacyTask = Task & { startMin?: number };

const goal = (nodes: LegacyNode[], over: Partial<Goal> = {}): Goal =>
  ({ id: 'g', title: 'Thesis', nodes: nodes as GoalNode[], ...over });

const run = (nodes: LegacyNode[], tasks: LegacyTask[] = []) =>
  migrateWorkBlocks([goal(nodes)], tasks as Task[]);

describe('migrateWorkBlocks', () => {
  it('turns the one placement a leaf could hold into a sitting', () => {
    const { goals, report } = run([{
      id: 'n1', title: 'Draft', plannedWeek: '2026-07-13',
      plannedDay: '2026-07-15', plannedStartMin: 540, estimateMin: 90,
    }]);

    expect(goals[0].nodes[0].blocks).toEqual([
      expect.objectContaining({ date: '2026-07-15', startMin: 540, minutes: 90 }),
    ]);
    expect(report.nodes).toBe(1);
  });

  /**
   * The height it was already being DRAWN at. A migration that changed how long
   * something looked would be moving the user's day while claiming to reshape a
   * field.
   */
  it('sizes the sitting exactly as the grid was already drawing it', () => {
    const { goals } = run([{
      id: 'n1', title: 'Draft', plannedWeek: '2026-07-13',
      plannedDay: '2026-07-15', plannedStartMin: 540, // no estimate ⇒ the default slot
    }]);
    expect(goals[0].nodes[0].blocks?.[0].minutes).toBe(60);
  });

  it('leaves the week commitment alone — it is a different fact', () => {
    const { goals } = run([{
      id: 'n1', title: 'Draft', plannedWeek: '2026-07-13',
      plannedDay: '2026-07-15', plannedStartMin: 540,
    }]);
    expect(goals[0].nodes[0].plannedWeek).toBe('2026-07-13');
  });

  /**
   * Inventing a time is how a migration silently moves someone's Tuesday, and
   * dropping the day outright would lose a commitment the rail was listing. The
   * week is the nearest true thing, and the rail lists it either way.
   */
  it('degrades a day with no time to a week commitment rather than guessing an hour', () => {
    const { goals, report } = run([{ id: 'n1', title: 'Draft', plannedDay: '2026-07-15' }]);
    const n = goals[0].nodes[0];

    expect(n.blocks).toBeUndefined();
    expect(n.plannedWeek).toBe('2026-07-13');
    expect(report.nodes).toBe(0);
  });

  it('strips the legacy fields, so nothing can read them by accident', () => {
    const { goals } = run([{
      id: 'n1', title: 'Draft', plannedWeek: '2026-07-13',
      plannedDay: '2026-07-15', plannedStartMin: 540,
    }]);
    const n = goals[0].nodes[0] as LegacyNode;
    expect('plannedDay' in n).toBe(false);
    expect('plannedStartMin' in n).toBe(false);
  });

  it('descends into containers, which never held a placement of their own', () => {
    const { goals } = run([{
      id: 'area', title: 'Mechanics', children: [{
        id: 'n1', title: 'Draft', plannedWeek: '2026-07-13',
        plannedDay: '2026-07-15', plannedStartMin: 540,
      } as GoalNode],
    }]);
    expect(goals[0].nodes[0].children?.[0].blocks).toHaveLength(1);
  });

  it('moves a task’s placement too, and keeps its day commitment', () => {
    const { tasks, report } = run([], [{
      id: 't1', title: 'Email', date: '2026-07-15', startMin: 600,
      done: false, goalId: null, estimateMin: 30,
    }]);

    expect(tasks[0].blocks).toEqual([
      expect.objectContaining({ date: '2026-07-15', startMin: 600, minutes: 30 }),
    ]);
    expect(tasks[0].date).toBe('2026-07-15');
    expect(report.tasks).toBe(1);
  });

  /**
   * `⌘N` with `@friday` produces exactly this: a commitment with no time. It
   * has to survive, or every captured task loses the day it was captured for.
   */
  it('leaves a dated task with no time exactly as it is', () => {
    const { tasks, report } = run([], [{
      id: 't1', title: 'Email', date: '2026-07-15', done: false, goalId: null,
    }]);
    expect(tasks[0]).toMatchObject({ date: '2026-07-15' });
    expect(tasks[0].blocks).toBeUndefined();
    expect(report.tasks).toBe(0);
  });

  /**
   * Idempotent by construction, which is what lets it run on every launch with
   * no done-flag and no snapshot behind it.
   */
  it('leaves an already-migrated row alone, however often it runs', () => {
    const already = makeBlock('2026-07-15', 540, 90);
    const once = run([{ id: 'n1', title: 'Draft', blocks: [already] }]);
    const twice = migrateWorkBlocks(once.goals, once.tasks);

    expect(twice.goals[0].nodes[0].blocks).toEqual([already]);
    expect(twice.report.nodes).toBe(0);
  });

  it('does not mutate the goals it was handed', () => {
    const nodes: LegacyNode[] = [{
      id: 'n1', title: 'Draft', plannedWeek: '2026-07-13',
      plannedDay: '2026-07-15', plannedStartMin: 540,
    }];
    const input = goal(nodes);
    migrateWorkBlocks([input], []);
    expect((input.nodes[0] as LegacyNode).plannedDay).toBe('2026-07-15');
  });
});
