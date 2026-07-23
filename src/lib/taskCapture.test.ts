import { describe, expect, it } from 'vitest';
import type { Goal } from '../db/types';
import {
  activeProjectOptions,
  buildTaskCaptureSubmission,
  createTaskCaptureDraft,
  resolveTaskCaptureDate,
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
