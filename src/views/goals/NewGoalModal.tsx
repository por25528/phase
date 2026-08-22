import { useState, useRef, useEffect } from 'react';
import type { Goal } from '../../db/types';
import { Modal } from '../../components/Modal';
import { DatePopover } from '../../components/DatePopover';
import { uid } from '../../lib/tree';
import { GOAL_TYPE_WORD, inferGoalType, type GoalType } from '../../lib/goalType';
import { todayStr } from '../../lib/dates';
import { SegmentedControl, type SegmentedOption } from '../../components/SegmentedControl';
import { fieldCls, labelCls, primaryBtn, ghostBtn, dialogFooter } from '../../components/dialogStyles';

const TYPES: readonly SegmentedOption<GoalType>[] = (
  ['study', 'project', 'general'] as const
).map((t) => ({ value: t, label: GOAL_TYPE_WORD[t] }));

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
 *
 * The deadline is PICKED, not typed. `projectDateError` used to guard this
 * form; a grid cannot emit a malformed date and this dialog never sets `start`,
 * so the check and its error paragraph were unreachable and are gone.
 * `projectDateError` itself still guards `setGoalDates`, which is where an
 * imported or hand-edited date actually arrives.
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

  function submit() {
    const t = title.trim();
    if (!t) return;
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
      {/*
        A real <form>, so Enter commits from anywhere in it. It used to be wired
        by hand to the title input alone, which meant the key that creates a goal
        worked in one of the three places a person could be standing.
        `DatePopover`'s trigger and its day cells are `type="button"`, so Enter
        inside the picker opens it or takes the day under the cursor rather than
        creating the goal — that is the correct precedence, not a gap.
      */}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="flex flex-col gap-[14px]">
          <div className="flex flex-col gap-[5px]">
            <label className={labelCls} htmlFor="goal-title">What do you want to finish?</label>
            <input
              ref={titleRef}
              id="goal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              /* `e.g.` earns its four characters: "Physics Final" alone is a
                 plausible real answer, which is the worst kind of placeholder —
                 faint ink makes it look unfilled, and the prefix makes it read
                 as a specimen rather than as something already typed. */
              placeholder="e.g. Physics Final"
              className={fieldCls}
            />
          </div>

          {/* Two equal columns, not `flex-wrap`. The date was 86px and the
              select was as wide as the word inside it, so the row under a
              full-width title ended in a ragged 200px of nothing. */}
          <div className="grid grid-cols-2 gap-[14px]">
            <div className="flex flex-col gap-[5px]">
              {/* A <span>: `DatePopover` names itself with `ariaLabel`, and a
                  <label> pointing at no control is a label in markup only. */}
              <span className={labelCls}>Deadline <span className="text-faint font-normal">(optional)</span></span>
              <DatePopover
                value={deadline}
                today={todayStr()}
                onCommit={setDeadline}
                ariaLabel="Deadline"
                placeholder="No deadline"
                size="field"
              />
            </div>
            <div className="flex flex-col gap-[5px]">
              {/* The guess is visible and editable, never applied silently. A
                  default only has to be reasonable; a hidden inference has to be
                  right. Laid out rather than collapsed, it also shows what it
                  chose OVER. */}
              <span className={labelCls}>Type</span>
              <SegmentedControl
                name="goal-type"
                label="Type"
                value={type}
                options={TYPES}
                onChange={setChosenType}
              />
            </div>
          </div>
        </div>

        <div className={dialogFooter}>
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          {/* The verb the dialog's own title promised. */}
          <button type="submit" className={primaryBtn} disabled={!title.trim()}>
            Create goal
          </button>
        </div>
      </form>
    </Modal>
  );
}
