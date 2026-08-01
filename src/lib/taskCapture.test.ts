import { describe, expect, it } from 'vitest';
import type { Goal } from '../db/types';
import {
  activeProjectOptions,
  buildTaskCaptureSubmission,
  closeTaskCapture,
  createTaskCaptureDraft,
  requestTaskCapture,
  requestTaskCaptureForCommand,
  resolveTaskCaptureDate,
  shouldRefocusTaskCaptureTitle,
} from './taskCapture';

const TODAY = '2026-07-23';

function goal(id: string, title: string, completedAt?: string): Goal {
  return { id, title, nodes: [], completedAt };
}

describe('task capture draft', () => {
  it('starts fresh on Today without project context', () => {
    expect(createTaskCaptureDraft(TODAY)).toEqual({
      title: '',
      dateChoice: 'today',
      pickedDate: TODAY,
      chooseProject: false,
      goalId: '',
    });
  });

  it('resolves Today, Tomorrow, and valid picked dates', () => {
    const draft = createTaskCaptureDraft(TODAY);

    expect(resolveTaskCaptureDate(draft, TODAY)).toBe(TODAY);
    expect(resolveTaskCaptureDate({ ...draft, dateChoice: 'tomorrow' }, TODAY)).toBe('2026-07-24');
    expect(resolveTaskCaptureDate({
      ...draft,
      dateChoice: 'pick',
      pickedDate: '2026-08-04',
    }, TODAY)).toBe('2026-08-04');
  });

  it('rejects empty and invalid picked dates', () => {
    const draft = createTaskCaptureDraft(TODAY);

    expect(resolveTaskCaptureDate({ ...draft, dateChoice: 'pick', pickedDate: '' }, TODAY)).toBeNull();
    expect(resolveTaskCaptureDate({
      ...draft,
      dateChoice: 'pick',
      pickedDate: '2026-02-30',
    }, TODAY)).toBeNull();
  });
});

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

  it('refocuses only for an unhandled request while capture is open', () => {
    expect(shouldRefocusTaskCaptureTitle(true, 5, 4)).toBe(true);
    expect(shouldRefocusTaskCaptureTitle(true, 5, 5)).toBe(false);
    expect(shouldRefocusTaskCaptureTitle(false, 5, 4)).toBe(false);
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

  it('trims a valid submission and includes an available selected project', () => {
    expect(buildTaskCaptureSubmission({
      ...createTaskCaptureDraft(TODAY),
      title: '  Send outline  ',
      dateChoice: 'tomorrow',
      chooseProject: true,
      goalId: 'next',
    }, goals, TODAY)).toEqual({
      title: 'Send outline',
      date: '2026-07-24',
      goalId: 'next',
    });
  });

  it('submits safely without project context when selection is unavailable or disabled', () => {
    const draft = {
      ...createTaskCaptureDraft(TODAY),
      title: 'Send outline',
      chooseProject: true,
      goalId: 'done',
    };

    expect(buildTaskCaptureSubmission(draft, goals, TODAY)?.goalId).toBeNull();
    expect(buildTaskCaptureSubmission({
      ...draft,
      chooseProject: false,
      goalId: 'now',
    }, goals, TODAY)?.goalId).toBeNull();
  });

  it('rejects blank titles and invalid dates', () => {
    const draft = createTaskCaptureDraft(TODAY);

    expect(buildTaskCaptureSubmission({ ...draft, title: '   ' }, goals, TODAY)).toBeNull();
    expect(buildTaskCaptureSubmission({
      ...draft,
      title: 'Send outline',
      dateChoice: 'pick',
      pickedDate: '',
    }, goals, TODAY)).toBeNull();
  });
});
