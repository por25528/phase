import { describe, expect, it } from 'vitest';
import type { GoalNode } from '../db/types';
import { metaPlacement } from './rowMeta';

const TODAY = '2026-08-16';
const leaf = (extra: Partial<GoalNode> = {}): GoalNode => ({ id: 'a', title: 'a', ...extra });

describe('metaPlacement', () => {
  it('is "inline" for a leaf carrying nothing to say', () => {
    expect(metaPlacement(leaf(), TODAY)).toBe('inline');
  });

  it('is "below" for a leaf committed to a week', () => {
    expect(metaPlacement(leaf({ plannedWeek: '2026-08-10' }), TODAY)).toBe('below');
  });

  it('is "below" for a leaf with a deadline', () => {
    expect(metaPlacement(leaf({ deadline: '2026-08-20' }), TODAY)).toBe('below');
  });

  it('is "below" for a leaf with a placed sitting', () => {
    const n = leaf({ blocks: [{ id: 'b1', date: '2026-08-18', startMin: 540, minutes: 60 }] });
    expect(metaPlacement(n, TODAY)).toBe('below');
  });

  it('is "below" for a leaf with an estimate and nothing else', () => {
    expect(metaPlacement(leaf({ estimateMin: 45 }), TODAY)).toBe('below');
  });

  it('is "below" for a leaf whose demand is SET on the node', () => {
    expect(metaPlacement(leaf({ demand: 'deep' }), TODAY)).toBe('below');
  });

  it('is "below" for a blocked leaf that names its reason', () => {
    expect(metaPlacement(leaf({ status: 'blocked', blockedOn: 'waiting on Sam' }), TODAY)).toBe('below');
  });

  it('is "inline" for a blocked leaf with no reason typed', () => {
    expect(metaPlacement(leaf({ status: 'blocked' }), TODAY)).toBe('inline');
  });

  // scheduleCell returns null for a done leaf (rowSchedule.ts:65) — a finished
  // task's schedule is history. The estimate is not, so it still earns line 2.
  it('is "inline" for a DONE leaf whose only metadata was its schedule', () => {
    expect(metaPlacement(leaf({ status: 'done', plannedWeek: '2026-08-10' }), TODAY)).toBe('inline');
  });

  it('is "below" for a DONE leaf that still carries an estimate', () => {
    expect(metaPlacement(leaf({ status: 'done', estimateMin: 30 }), TODAY)).toBe('below');
  });
});
