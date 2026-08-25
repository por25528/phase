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
      nodes: [{ id: 'step', title: 'Existing step' }],
      milestones: [
        { id: 'm2', title: 'Demo', date: '2026-08-10' },
        { id: 'm1', title: 'Exam', date: '2026-08-03' },
      ],
    };

    const result = migrateCheckpoints([goal]);

    expect(result.goals[0].nodes).toEqual([
      { id: 'step', title: 'Existing step' },
      {
        id: 'm1',
        title: 'Exam',
        checkpoint: true,
        start: '2026-08-03',
        deadline: '2026-08-03',
      },
      {
        id: 'm2',
        title: 'Demo',
        checkpoint: true,
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
        { id: 'first', title: 'First' },
        { id: 'second', title: 'Second' },
      ],
      milestones: [{ id: 'm1', title: 'Marker', date: '2026-08-01' }],
    };

    const result = migrateCheckpoints([goal]);

    expect(result.goals[0].nodes.map((node) => node.id)).toEqual(['first', 'second', 'm1']);
  });

  it('keeps existing node ids when a milestone id collides', () => {
    const goal: LegacyGoal = {
      id: 'g1',
      title: 'Project',
      nodes: [{ id: 'x', title: 'Existing step' }],
      milestones: [{ id: 'x', title: 'Marker', date: '2026-08-01' }],
    };

    const result = migrateCheckpoints([goal]);
    const nodes = result.goals[0].nodes;

    expect(nodes[0].id).toBe('x');
    expect(nodes[1]).toMatchObject({ title: 'Marker', checkpoint: true });
    expect(nodes[1].id).not.toBe('x');
    expect(new Set(nodes.map((node) => node.id)).size).toBe(2);

    expect(migrateCheckpoints(result.goals).goals).toEqual(result.goals);
  });

  it('is idempotent', () => {
    const goal: LegacyGoal = {
      id: 'g1',
      title: 'Project',
      nodes: [{ id: 'step', title: 'Step' }],
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

  it('removes an explicitly empty milestones field', () => {
    const goal: LegacyGoal = {
      id: 'g1', title: 'Project', nodes: [], milestones: [],
    };

    const result = migrateCheckpoints([goal]);

    expect(result.goals[0]).not.toHaveProperty('milestones');
    expect(result.goals[0]).not.toBe(goal);
    expect(result.report).toEqual({ goalsMigrated: 1, checkpointsCreated: 0 });
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
