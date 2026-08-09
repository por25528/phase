import { useState, useRef, useEffect } from 'react';
import type { Goal } from '../../db/types';
import { Modal } from '../../components/Modal';
import { DateField } from '../../components/DateField';
import { uid } from '../../lib/tree';
import { GOAL_TYPE_WORD, inferGoalType, type GoalType } from '../../lib/goalType';
import { projectDateError } from '../../lib/schedule';
import { fieldCls, labelCls, primaryBtn, ghostBtn } from './styles';

const TYPES: GoalType[] = ['study', 'project', 'general'];

/**
 * Two fields, and one of them is optional.
 *
 * What this replaced asked for a title, a horizon, a start date, a deadline, a
 * list of first tasks and a notes body — six decisions before the goal existed.
 * Horizon is a portfolio commitment nobody can make about a thing they have not
 * created yet; notes are ceremony at a moment when there is nothing to note;
 * and "first tasks" as a flat repeated input undersells the decomposition the
 * workspace does properly, two seconds later.
 *
 * So: a title, a deadline if there is one, and a type that is guessed from the
 * title and shown as a control rather than applied silently. Enter creates the
 * goal and opens it. Everything else is a thing to do INSIDE a real workspace,
 * where the user can see what they are doing it to.
 */
export function NewGoalModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (goal: Goal) => void;
}) {
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  /** Null until the user picks one, so the inference stays live while typing. */
  const [chosenType, setChosenType] = useState<GoalType | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDeadline('');
    setChosenType(null);
    const t = setTimeout(() => titleRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const type = chosenType ?? inferGoalType(title);
  const dateError = projectDateError(undefined, deadline || undefined);

  function submit() {
    const t = title.trim();
    if (!t || dateError) return;
    onAdd({
      id: uid(),
      title: t,
      type,
      nodes: [],
      // Now, without asking. A goal you are creating right now is one you are
      // thinking about right now, and the board's own drag is the cheap,
      // visible way to say otherwise — unlike a select in a dialog, which asks
      // for the answer at the moment it is least knowable.
      column: 0,
      // A deadline typed here is one the user just typed, so it needs no
      // review; `datesConfirmed` exists for IMPORTED dates nobody has seen.
      ...(deadline ? { deadline, datesConfirmed: true } : {}),
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="New goal">
      <div className="flex flex-col gap-[14px]">
        <div className="flex flex-col gap-[5px]">
          <label className={labelCls} htmlFor="goal-title">What do you want to finish?</label>
          <input
            ref={titleRef}
            id="goal-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Physics Final"
            className={`${fieldCls} w-full`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
            }}
          />
        </div>

        <div className="flex flex-wrap gap-[14px]">
          <div className="flex flex-col gap-[5px]">
            <label className={labelCls}>Deadline <span className="text-faint font-normal">(optional)</span></label>
            <DateField value={deadline} onCommit={setDeadline} ariaLabel="Deadline" placeholder="No deadline" className={fieldCls} />
          </div>
          <div className="flex flex-col gap-[5px]">
            {/* The guess is visible and editable, never applied silently. A
                default only has to be reasonable; a hidden inference has to be
                right. */}
            <label className={labelCls} htmlFor="goal-type">Type</label>
            <select
              id="goal-type"
              value={type}
              onChange={(e) => setChosenType(e.target.value as GoalType)}
              className={fieldCls}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>{GOAL_TYPE_WORD[t]}</option>
              ))}
            </select>
          </div>
        </div>
        {dateError && <div className="text-compact text-warn">{dateError}</div>}

        <div className="flex items-center gap-[8px] mt-[2px]">
          <button className={primaryBtn} onClick={submit} disabled={!title.trim() || !!dateError}>
            Create
          </button>
          <button className={ghostBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
