import { describe, expect, it } from 'vitest';
import { addActionFor } from './addAction';

describe('addActionFor', () => {
  it('creates a goal on the Goals board', () => {
    // The case that motivated this: `+ Add` used to capture a loose task here,
    // and a loose task does not appear on a board of goals — so the app's most
    // prominent button produced an invisible result.
    expect(addActionFor('goals', false).intent).toBe('goal');
  });

  it('creates a task inside an open goal', () => {
    expect(addActionFor('project', true).intent).toBe('node');
  });

  it('falls back to a loose task on a project page with no goal resolved', () => {
    expect(addActionFor('project', false).intent).toBe('task');
  });

  it('creates a task on Plan and Today', () => {
    expect(addActionFor('plan', false).intent).toBe('task');
    expect(addActionFor('today', false).intent).toBe('task');
  });

  it('names what pressing it will make', () => {
    // The label is the promise. "Add" beside a board of goals was the ambiguity.
    expect(addActionFor('goals', false).label).toBe('New goal');
    expect(addActionFor('project', true).label).toBe('Add task');
    expect(addActionFor('plan', false).label).toBe('Add');
  });

  it('always states the shortcut, whichever verb it resolves to', () => {
    for (const action of [
      addActionFor('goals', false),
      addActionFor('project', true),
      addActionFor('plan', false),
      addActionFor('today', false),
    ]) {
      expect(action.title).toContain('⌘N');
    }
  });

  it('is not affected by insideGoal anywhere but the project page', () => {
    // `openGoalId` outlives a view change in the store, so this must not leak.
    for (const view of ['goals', 'plan', 'today'] as const) {
      expect(addActionFor(view, true).intent).toBe(addActionFor(view, false).intent);
    }
  });
});
