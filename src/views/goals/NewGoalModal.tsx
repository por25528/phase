import { useState, useRef, useEffect } from 'react';
import type { Goal } from '../../db/types';
import { Modal } from '../../components/Modal';
import { DatePopover } from '../../components/DatePopover';
import { uid } from '../../lib/tree';
import { GOAL_TYPE_WORD, inferGoalType, type GoalType } from '../../lib/goalType';
import { todayStr } from '../../lib/dates';
import { SegmentedControl, type SegmentedOption } from '../../components/SegmentedControl';
import {
  fieldCls, primaryBtn, ghostBtn,
  dialogBar, dialogBody, dialogLine, dialogLineKey, dialogLineValue,
} from '../../components/dialogStyles';
import { captionLabel } from '../../components/sectionLabel';

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
    /*
      The Instrument frame. `verb` puts `Create` in the rule at the top and
      leaves the title free to be the NAME of the thing — see `Modal`.
    */
    <Modal open={open} onClose={onClose} title="New goal" verb="Create">
      {/*
        A real <form>, so Enter commits from anywhere in it. It used to be wired
        by hand to the title input alone, which meant the key that creates a goal
        worked in one of the three places a person could be standing.
        `DatePopover`'s trigger and its day cells are `type="button"`, so Enter
        inside the picker opens it or takes the day under the cursor rather than
        creating the goal — that is the correct precedence, not a gap.
      */}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {/*
          Three labelled lines, not three stacked label-over-field groups.

          The keys are `aria-hidden` and every control names itself, exactly as
          `TaskPage`'s `PropertyLine` does it — a visible key repeated into the
          accessible name is a label announced twice. Which is also why the
          title input keeps `What do you want to finish?` as its accessible
          name while the key reads `Finish`: a 104px mono column cannot hold a
          sentence, but the sentence is still the better thing for a screen
          reader to hear, and nothing forces the two to be the same string.
        */}
        <div className={dialogBody}>
          <div className={dialogLine}>
            <span className={`${dialogLineKey} ${captionLabel}`} aria-hidden="true">Finish</span>
            <span className={dialogLineValue}>
              <input
                ref={titleRef}
                id="goal-title"
                aria-label="What do you want to finish?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                /* `e.g.` earns its four characters: "Physics Final" alone is a
                   plausible real answer, which is the worst kind of placeholder —
                   faint ink makes it look unfilled, and the prefix makes it read
                   as a specimen rather than as something already typed. */
                placeholder="e.g. Physics Final"
                className={fieldCls}
              />
            </span>
          </div>

          <div className={dialogLine}>
            {/* No `(optional)` on the key any more: the key column is a
                register of what a goal HAS, and every line but the first is
                optional by construction — a deadline nobody set reads
                "No deadline", which says it without spending a second voice
                on the label. */}
            <span className={`${dialogLineKey} ${captionLabel}`} aria-hidden="true">Deadline</span>
            <span className={dialogLineValue}>
              <DatePopover
                value={deadline}
                today={todayStr()}
                onCommit={setDeadline}
                ariaLabel="Deadline"
                placeholder="No deadline"
                size="field"
              />
            </span>
          </div>

          <div className={dialogLine}>
            {/* The guess is visible and editable, never applied silently. A
                default only has to be reasonable; a hidden inference has to be
                right. Laid out rather than collapsed, it also shows what it
                chose OVER. */}
            <span className={`${dialogLineKey} ${captionLabel}`} aria-hidden="true">Type</span>
            <span className={dialogLineValue}>
              <SegmentedControl
                name="goal-type"
                label="Type"
                value={type}
                options={TYPES}
                onChange={setChosenType}
              />
            </span>
          </div>
        </div>

        <div className={dialogBar}>
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          {/* The verb the rule at the top of the dialog promised. */}
          <button type="submit" className={primaryBtn} disabled={!title.trim()}>
            Create goal
          </button>
        </div>
      </form>
    </Modal>
  );
}
