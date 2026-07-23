import { describe, expect, it } from 'vitest';
import type { Goal } from '../db/types';
import { createTaskCaptureDraft } from '../lib/taskCapture';
import { dispatchTaskCapture } from './taskCaptureActions';

const TODAY = '2026-07-23';
const goals: Goal[] = [{ id: 'goal-1', title: 'Launch', nodes: [] }];

function harness() {
  const calls: string[] = [];
  return {
    calls,
    actions: {
      addTask: (title: string, date: string, goalId: string | null) => {
        calls.push(`add:${title}:${date}:${goalId ?? 'none'}`);
      },
      showToast: (message: string) => {
        calls.push(`toast:${message}`);
      },
    },
  };
}

describe('dispatchTaskCapture', () => {
  const draft = {
    ...createTaskCaptureDraft(TODAY),
    title: '  Send brief  ',
    chooseProject: true,
    goalId: 'goal-1',
  };

  it('does not call the persistence action while hydration disables capture', () => {
    const { calls, actions } = harness();

    expect(dispatchTaskCapture({
      enabled: false,
      draft,
      goals,
      today: TODAY,
      actions,
    })).toBe(false);
    expect(calls).toEqual([]);
  });

  it('adds and announces a valid task when capture is ready', () => {
    const { calls, actions } = harness();

    expect(dispatchTaskCapture({
      enabled: true,
      draft,
      goals,
      today: TODAY,
      actions,
    })).toBe(true);
    expect(calls).toEqual([
      'add:Send brief:2026-07-23:goal-1',
      'toast:Task added',
    ]);
  });
});
