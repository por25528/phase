import { describe, expect, it } from 'vitest';
import type { Goal } from '../db/types';
import {
  checkpointDates,
  checkpointMarkers,
  checkpointWithin,
  milestonesToCheckpointNodes,
  nextCheckpoint,
} from './checkpoints';

const baseGoal: Goal = {
  id: 'g1',
  title: 'Project',
  nodes: [],
};

describe('checkpointDates', () => {
  it('collects dated checkpoints at any depth and ignores other nodes', () => {
    const goal: Goal = {
      ...baseGoal,
      nodes: [
        { id: 'root', title: 'Root checkpoint', checkpoint: true, deadline: '2026-08-05' },
        {
          id: 'group',
          title: 'Group',
          children: [
            { id: 'nested', title: 'Nested checkpoint', checkpoint: true, deadline: '2026-08-02' },
            { id: 'ordinary', title: 'Ordinary step', deadline: '2026-08-03' },
            { id: 'undated', title: 'Undated checkpoint', checkpoint: true },
          ],
        },
      ],
    };

    expect(checkpointDates(goal)).toEqual(['2026-08-05', '2026-08-02']);
  });
});

describe('checkpointMarkers', () => {
  it('pairs each checkpoint title and id with its date', () => {
    const goal: Goal = {
      ...baseGoal,
      nodes: [{
        id: 'group',
        title: 'Group',
        children: [
          { id: 'cp', title: 'Demo', checkpoint: true, deadline: '2026-08-05' },
          { id: 'ordinary', title: 'Ordinary', deadline: '2026-08-06' },
        ],
      }],
    };

    expect(checkpointMarkers(goal)).toEqual([{ id: 'cp', title: 'Demo', date: '2026-08-05' }]);
  });
});

describe('checkpointWithin', () => {
  it('is inclusive from today through today plus days, but not in the past', () => {
    expect(checkpointWithin({ ...baseGoal, nodes: [{ id: 'today', title: 'Today', checkpoint: true, deadline: '2026-08-01' }] }, 7, '2026-08-01')).toBe(true);
    expect(checkpointWithin({ ...baseGoal, nodes: [{ id: 'end', title: 'End', checkpoint: true, deadline: '2026-08-08' }] }, 7, '2026-08-01')).toBe(true);
    expect(checkpointWithin({ ...baseGoal, nodes: [{ id: 'past', title: 'Past', checkpoint: true, deadline: '2026-07-31' }] }, 7, '2026-08-01')).toBe(false);
  });

  it('ignores done checkpoints', () => {
    const goal: Goal = {
      ...baseGoal,
      nodes: [{ id: 'done', title: 'Already reached', checkpoint: true, done: true, deadline: '2026-08-03' }],
    };

    expect(checkpointWithin(goal, 7, '2026-08-01')).toBe(false);
  });
});

describe('nextCheckpoint', () => {
  it('returns the earliest open checkpoint on or after today', () => {
    const goal: Goal = {
      ...baseGoal,
      nodes: [
        { id: 'later', title: 'Later', checkpoint: true, deadline: '2026-08-05' },
        {
          id: 'group',
          title: 'Group',
          children: [
            { id: 'done', title: 'Done', checkpoint: true, done: true, deadline: '2026-08-02' },
            { id: 'earlier', title: 'Earlier', checkpoint: true, deadline: '2026-08-03' },
          ],
        },
        { id: 'past', title: 'Past', checkpoint: true, deadline: '2026-07-31' },
      ],
    };

    expect(nextCheckpoint(goal, '2026-08-01')).toEqual({ title: 'Earlier', date: '2026-08-03' });
    expect(nextCheckpoint({ ...baseGoal, nodes: [{ id: 'done', title: 'Done', checkpoint: true, done: true, deadline: '2026-08-02' }] }, '2026-08-01')).toBeNull();
  });
});

describe('milestonesToCheckpointNodes', () => {
  it('maps milestones to dated, open checkpoint leaves sorted by date', () => {
    const goal = {
      ...baseGoal,
      milestones: [
        { id: 'm2', title: 'Demo', date: '2026-08-10' },
        { id: 'm1', title: 'Exam', date: '2026-08-03' },
      ],
    } as Goal;

    expect(milestonesToCheckpointNodes(goal)).toEqual([
      { id: 'm1', title: 'Exam', checkpoint: true, done: false, start: '2026-08-03', deadline: '2026-08-03' },
      { id: 'm2', title: 'Demo', checkpoint: true, done: false, start: '2026-08-10', deadline: '2026-08-10' },
    ]);
  });

  it('returns no nodes when the goal has no milestones', () => {
    expect(milestonesToCheckpointNodes(baseGoal)).toEqual([]);
  });

  it('mints a fresh id when a milestone collides with a node in the tree', () => {
    const goal = {
      ...baseGoal,
      nodes: [{ id: 'x', title: 'Existing step', done: false }],
      milestones: [{ id: 'x', title: 'Marker', date: '2026-08-01' }],
    } as Goal;

    const [checkpoint] = milestonesToCheckpointNodes(goal);

    expect(checkpoint.id).not.toBe('x');
    expect(checkpoint).toMatchObject({ title: 'Marker', checkpoint: true });
  });
});
