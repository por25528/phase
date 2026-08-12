import { describe, expect, it } from 'vitest';
import type { Goal } from '../db/types';
import {
  activeProjectOptions,
  closeTaskCapture,
  requestTaskCapture,
  requestTaskCaptureForCommand,
} from './taskCapture';

function goal(id: string, title: string, completedAt?: string): Goal {
  return { id, title, nodes: [], completedAt };
}

describe('task capture host requests', () => {
  it('opens capture and advances its focus request', () => {
    expect(requestTaskCapture({ open: false, focusRequest: 0 })).toEqual({
      open: true,
      focusRequest: 1,
    });
  });

  it('advances focus without closing or replacing already-open state', () => {
    const openState = {
      open: true,
      focusRequest: 4,
      draftSentinel: 'keep the current draft',
    };

    expect(requestTaskCapture(openState)).toEqual({
      open: true,
      focusRequest: 5,
      draftSentinel: 'keep the current draft',
    });
  });

  it('closes without consuming the focus request', () => {
    expect(closeTaskCapture({ open: true, focusRequest: 3 })).toEqual({
      open: false,
      focusRequest: 3,
    });
  });


  it('does not open during deferred or failed hydration', () => {
    const closed = { open: false, focusRequest: 0 };

    expect(requestTaskCaptureForCommand(closed, 'loading', false)).toEqual(closed);
    expect(requestTaskCaptureForCommand(closed, 'error', false)).toEqual(closed);
  });

  it('opens only when ready and no other shared modal is open', () => {
    const closed = { open: false, focusRequest: 0 };

    expect(requestTaskCaptureForCommand(closed, 'ready', true)).toEqual(closed);
    expect(requestTaskCaptureForCommand(closed, 'ready', false)).toEqual({
      open: true,
      focusRequest: 1,
    });
  });

  it('opens while the project page is showing', () => {
    const closed = { open: false, focusRequest: 0 };

    expect(requestTaskCaptureForCommand(closed, 'ready', false)).toEqual({
      open: true,
      focusRequest: 1,
    });
  });

  it('still refocuses capture itself without opening another modal', () => {
    expect(requestTaskCaptureForCommand(
      { open: true, focusRequest: 2 },
      'error',
      true,
    )).toEqual({
      open: true,
      focusRequest: 3,
    });
  });
});

describe('task capture project context', () => {
  const goals = [
    goal('now', 'Now project'),
    goal('done', 'Completed project', '2026-07-20'),
    goal('next', 'Next project'),
  ];

  it('lists active projects in their existing order', () => {
    expect(activeProjectOptions(goals)).toEqual([
      { id: 'now', title: 'Now project' },
      { id: 'next', title: 'Next project' },
    ]);
  });
});
