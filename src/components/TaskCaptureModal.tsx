import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { todayStr } from '../lib/dates';
import {
  activeProjectOptions,
  createTaskCaptureDraft,
  resolveTaskCaptureDate,
  shouldRefocusTaskCaptureTitle,
  type TaskCaptureDateChoice,
} from '../lib/taskCapture';
import { useAppStore } from '../state/store';
import { Modal } from './Modal';
import { DateField } from './DateField';
import { dispatchTaskCapture } from './taskCaptureActions';

const fieldCls = 'bg-field border border-line-2 rounded-field px-[10px] py-[7px] text-body text-ink outline-none focus:border-accent';
const choiceCls = 'px-[12px] py-[6px] rounded-full text-ui font-semibold border';

export function TaskCaptureModal({
  open,
  onClose,
  focusRequest = 0,
  enabled,
}: {
  open: boolean;
  onClose: () => void;
  focusRequest?: number;
  enabled: boolean;
}) {
  const { goals, actions } = useAppStore();
  const [draft, setDraft] = useState(() => createTaskCaptureDraft(todayStr()));
  const titleRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const handledFocusRequestRef = useRef(focusRequest);
  const projects = useMemo(() => activeProjectOptions(goals), [goals]);
  const resolvedDate = resolveTaskCaptureDate(draft, todayStr());

  useEffect(() => {
    if (!open) return;
    setDraft(createTaskCaptureDraft(todayStr()));
    submittingRef.current = false;
    const timer = setTimeout(() => titleRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!shouldRefocusTaskCaptureTitle(
      open,
      focusRequest,
      handledFocusRequestRef.current,
    )) return;
    handledFocusRequestRef.current = focusRequest;
    titleRef.current?.focus();
  }, [open, focusRequest]);

  function chooseDate(dateChoice: TaskCaptureDateChoice) {
    setDraft((current) => ({ ...current, dateChoice }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    const dispatched = dispatchTaskCapture({
      enabled,
      draft,
      goals,
      today: todayStr(),
      actions,
    });
    if (!dispatched) {
      submittingRef.current = false;
      return;
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add task">
      <form className="flex flex-col gap-[16px]" onSubmit={submit}>
        <div className="flex flex-col gap-[5px]">
          <label htmlFor="task-capture-title" className="text-meta font-semibold text-ink-soft">
            Task
          </label>
          <input
            ref={titleRef}
            id="task-capture-title"
            aria-label="Task title"
            value={draft.title}
            onChange={(event) => setDraft((current) => ({
              ...current,
              title: event.target.value,
            }))}
            placeholder="What needs doing?"
            autoComplete="off"
            className={`${fieldCls} w-full`}
          />
        </div>

        <fieldset className="flex flex-col gap-[7px]">
          <legend className="text-meta font-semibold text-ink-soft mb-[7px]">When</legend>
          <div className="flex flex-wrap gap-[7px]">
            {([
              ['today', 'Today'],
              ['tomorrow', 'Tomorrow'],
              ['pick', 'Pick day'],
            ] as const).map(([choice, label]) => (
              <button
                key={choice}
                type="button"
                aria-pressed={draft.dateChoice === choice}
                onClick={() => chooseDate(choice)}
                className={`${choiceCls} ${
                  draft.dateChoice === choice
                    ? 'bg-ink text-paper border-ink'
                    : 'text-ink-soft border-line-2 hover:bg-hover'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {draft.dateChoice === 'pick' && (
            <DateField
              ariaLabel="Task date"
              value={draft.pickedDate}
              onCommit={(next) => setDraft((current) => ({
                ...current,
                pickedDate: next,
              }))}
              className={`${fieldCls} self-start`}
            />
          )}
        </fieldset>

        <div className="flex flex-col gap-[8px]">
          <button
            type="button"
            aria-pressed={draft.chooseProject}
            onClick={() => setDraft((current) => ({
              ...current,
              chooseProject: !current.chooseProject,
            }))}
            className={`${choiceCls} self-start ${
              draft.chooseProject
                ? 'bg-ink text-paper border-ink'
                : 'text-ink-soft border-line-2 hover:bg-hover'
            }`}
          >
            Choose goal
          </button>
          {draft.chooseProject && (
            <select
              aria-label="Goal"
              value={projects.some((project) => project.id === draft.goalId) ? draft.goalId : ''}
              onChange={(event) => setDraft((current) => ({
                ...current,
                goalId: event.target.value,
              }))}
              className={`${fieldCls} w-full`}
            >
              <option value="">No goal</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.title}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-[8px] mt-[2px]">
          <button
            type="submit"
            disabled={!enabled || !draft.title.trim() || !resolvedDate}
            className="px-[14px] py-[8px] rounded-field bg-ink text-paper text-body font-semibold hover:bg-ink-hover disabled:opacity-40 disabled:pointer-events-none"
          >
            Add task
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-[12px] py-[8px] rounded-field text-body text-ink-soft hover:bg-hover"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
