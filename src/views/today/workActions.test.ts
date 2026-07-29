import { describe, expect, it, vi } from 'vitest';
import type { DailyWorkItem } from '../../lib/dailyWork';
import {
  dispatchQuickAdd,
  rescheduleTaskToPickedDate,
  runTaskCarryOverAction,
  scheduleSuggestionForToday,
  toggleDailyWorkItem,
} from './workActions';

function item(overrides: Partial<DailyWorkItem> = {}): DailyWorkItem {
  return {
    key: 'task:t1',
    kind: 'task',
    id: 't1',
    title: 'Call supplier',
    goalId: null,
    due: false,
    done: false,
    editable: true,
    source: 'carry-over',
    scheduledDate: '2026-07-22',
    ...overrides,
  };
}

describe('dispatchQuickAdd', () => {
  it('routes goals and habits through their existing actions', () => {
    const actions = {
      addGoal: vi.fn(),
      addHabit: vi.fn(),
      addTask: vi.fn(),
    };
    const getToday = vi.fn(() => '2026-07-23');

    expect(dispatchQuickAdd('goal', '  Launch  ', actions, getToday)).toBe(true);
    expect(dispatchQuickAdd('habit', '  Walk  ', actions, getToday)).toBe(true);

    expect(actions.addGoal).toHaveBeenCalledWith('Launch');
    expect(actions.addHabit).toHaveBeenCalledWith('Walk', 'daily', 4);
    expect(getToday).not.toHaveBeenCalled();
  });

  it('adds a task for today and rejects blank input', () => {
    const actions = {
      addGoal: vi.fn(),
      addHabit: vi.fn(),
      addTask: vi.fn(),
    };
    const getToday = vi.fn(() => '2026-07-23');

    expect(dispatchQuickAdd('task', '  Send draft  ', actions, getToday)).toBe(true);
    expect(dispatchQuickAdd('task', '   ', actions, getToday)).toBe(false);

    expect(actions.addTask).toHaveBeenCalledTimes(1);
    expect(actions.addTask).toHaveBeenCalledWith('Send draft', '2026-07-23');
    expect(getToday).toHaveBeenCalledTimes(1);
  });
});

describe('daily work actions', () => {
  it('dispatches task and step toggles but keeps archived completion read-only', () => {
    const actions = {
      toggleTask: vi.fn(),
      toggleLeaf: vi.fn(),
    };

    expect(toggleDailyWorkItem(item(), actions)).toBe(true);
    expect(toggleDailyWorkItem(item({
      key: 'step:s1',
      kind: 'step',
      id: 's1',
      goalId: 'g1',
    }), actions)).toBe(true);
    expect(toggleDailyWorkItem(item({
      key: 'step:archived',
      kind: 'step',
      id: 'archived',
      goalId: 'g2',
      editable: false,
      done: true,
      source: 'completed-today',
    }), actions)).toBe(false);

    expect(actions.toggleTask).toHaveBeenCalledWith('t1');
    expect(actions.toggleLeaf).toHaveBeenCalledTimes(1);
    expect(actions.toggleLeaf).toHaveBeenCalledWith('s1');
  });

  it('routes Today, Tomorrow, and Delete task decisions to the right action', () => {
    const actions = {
      rescheduleTask: vi.fn(),
      removeTask: vi.fn(),
    };
    const task = item();

    expect(runTaskCarryOverAction('today', task, '2026-07-23', actions)).toBe(true);
    expect(runTaskCarryOverAction('tomorrow', task, '2026-07-23', actions)).toBe(true);
    expect(runTaskCarryOverAction('delete', task, '2026-07-23', actions)).toBe(true);

    expect(actions.rescheduleTask).toHaveBeenNthCalledWith(1, 't1', '2026-07-23');
    expect(actions.rescheduleTask).toHaveBeenNthCalledWith(2, 't1', '2026-07-24');
    expect(actions.removeTask).toHaveBeenCalledWith('t1');
  });

  it('accepts a valid picked date and ignores malformed dates', () => {
    const actions = { rescheduleTask: vi.fn() };
    const task = item();

    expect(rescheduleTaskToPickedDate(task, 'not-a-date', actions)).toBe(false);
    expect(rescheduleTaskToPickedDate(task, '2026-08-02', actions)).toBe(true);

    expect(actions.rescheduleTask).toHaveBeenCalledTimes(1);
    expect(actions.rescheduleTask).toHaveBeenCalledWith('t1', '2026-08-02');
  });

  it('accepts a suggestion for today, aiming at the start of the day', () => {
    const actions = { scheduleNode: vi.fn() };
    const suggestion = item({
      key: 'step:s1',
      kind: 'step',
      id: 's1',
      goalId: 'g1',
      source: 'suggested',
    });

    expect(scheduleSuggestionForToday(suggestion, '2026-07-23', actions)).toBe(true);
    expect(actions.scheduleNode).toHaveBeenCalledWith('g1', 's1', '2026-07-23', 0);
  });
});
