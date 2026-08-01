import { describe, expect, it } from 'vitest';
import type { Goal } from '../db/types';
import { migrateCheckpoints } from './migrateCheckpoints';

type LegacyGoal = Goal & {
  milestones: { id: string; title: string; date: string }[];
};

describe('migrateCheckpoints', () => {
  it('converts every milestone into an open dated root checkpoint', () => {
    const goal: LegacyGoal = {
      id: 'g1',
      title: 'Project',
      nodes: [{ id: 'step', title: 'Existing step', done: false }],
      milestones: [
        { id: 'm2', title: 'Demo', date: '2026-08-10' },
        { id: 'm1', title: 'Exam', date: '2026-08-03' },
      ],
    };

    const result = migrateCheckpoints([goal]);

    expect(result.goals[0].nodes).toEqual([
      { id: 'step', title: 'Existing step', done: false },
      {
        id: 'm1',
        title: 'Exam',
        checkpoint: true,
        done: false,
        start: '2026-08-03',
        deadline: '2026-08-03',
      },
      {
        id: 'm2',
        title: 'Demo',
        checkpoint: true,
        done: false,
        start: '2026-08-10',
        deadline: '2026-08-10',
      },
    ]);
    expect(result.goals[0]).not.toHaveProperty('milestones');
  });

  it('appends checkpoints after existing roots without changing their positions', () => {
    const goal: LegacyGoal = {
      id: 'g1',
      title: 'Project',
      nodes: [
        { id: 'first', title: 'First', done: false },
        { id: 'second', title: 'Second', done: false },
      ],
      milestones: [{ id: 'm1', title: 'Marker', date: '2026-08-01' }],
    };

    const result = migrateCheckpoints([goal]);

    expect(result.goals[0].nodes.map((node) => node.id)).toEqual(['first', 'second', 'm1']);
  });

  it('is idempotent', () => {
    const goal: LegacyGoal = {
      id: 'g1',
      title: 'Project',
      nodes: [{ id: 'step', title: 'Step', done: false }],
      milestones: [{ id: 'm1', title: 'Marker', date: '2026-08-01' }],
    };

    const once = migrateCheckpoints([goal]);
    const twice = migrateCheckpoints(once.goals);

    expect(twice.goals).toEqual(once.goals);
    expect(twice.report).toEqual({ goalsMigrated: 0, checkpointsCreated: 0 });
  });

  it('returns a goal with no milestones unchanged by identity', () => {
    const goal: Goal = { id: 'g1', title: 'Project', nodes: [] };
    const goals = [goal];

    const result = migrateCheckpoints(goals);

    expect(result.goals).toBe(goals);
    expect(result.goals[0]).toBe(goal);
    expect(result.report).toEqual({ goalsMigrated: 0, checkpointsCreated: 0 });
  });

  it('reports migrated goals and created checkpoints', () => {
    const goals: LegacyGoal[] = [
      {
        id: 'g1',
        title: 'One',
        nodes: [],
        milestones: [
          { id: 'm1', title: 'First', date: '2026-08-01' },
          { id: 'm2', title: 'Second', date: '2026-08-02' },
        ],
      },
      {
        id: 'g2',
        title: 'Two',
        nodes: [],
        milestones: [{ id: 'm3', title: 'Third', date: '2026-08-03' }],
      },
    ];

    expect(migrateCheckpoints(goals).report).toEqual({
      goalsMigrated: 2,
      checkpointsCreated: 3,
    });
  });
});
