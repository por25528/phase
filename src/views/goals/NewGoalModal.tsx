import { useState, useRef, useEffect } from 'react';
import type { Goal } from '../../db/types';
import { Modal } from '../../components/Modal';
import { IconX } from '../../components/Icons';
import { DateField } from '../../components/DateField';
import { buildManualGoal, priorityToColumn, PRIORITY_WORDS } from '../../lib/goalImport';
import { projectDateError } from '../../lib/schedule';
import { fieldCls, labelCls, primaryBtn, ghostBtn } from './styles';

export function NewGoalModal({
  open,
  onClose,
  onAdd,
  columns,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (goal: Goal) => void;
  columns: readonly { id: string; label: string }[];
}) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<(typeof PRIORITY_WORDS)[number]>('now');
  const [start, setStart] = useState('');
  const [deadline, setDeadline] = useState('');
  const [subgoals, setSubgoals] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  // Reset the form each time it opens.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setPriority('now');
    setStart('');
    setDeadline('');
    setSubgoals([]);
    setDraft('');
    setNotes('');
    const t = setTimeout(() => titleRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  function commitDraft() {
    const v = draft.trim();
    if (!v) return;
    setSubgoals((s) => [...s, v]);
    setDraft('');
  }

  function submit() {
    const t = title.trim();
    if (!t || dateError) return;
    const pending = draft.trim();
    const goal = buildManualGoal({
      title: t,
      start: start || undefined,
      deadline: deadline || undefined,
      column: priorityToColumn(priority),
      notes,
      subgoalTitles: pending ? [...subgoals, pending] : subgoals,
    });
    onAdd(goal);
  }

  const dateError = projectDateError(start || undefined, deadline || undefined);

  return (
    <Modal open={open} onClose={onClose} title="New project">
      <div className="flex flex-col gap-[14px]">
        <div className="flex flex-col gap-[5px]">
          <label className={labelCls}>Title</label>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What do you want to make progress on?"
            className={`${fieldCls} w-full`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
            }}
          />
        </div>
        <div className="flex flex-wrap gap-[14px]">
          <div className="flex flex-col gap-[5px]">
            <label className={labelCls}>Horizon</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as (typeof PRIORITY_WORDS)[number])}
              className={fieldCls}
            >
              {PRIORITY_WORDS.map((w) => (
                <option key={w} value={w}>
                  {columns[PRIORITY_WORDS.indexOf(w)].label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-[5px]">
            <label className={labelCls}>Start</label>
            <DateField value={start} onCommit={setStart} ariaLabel="Start" placeholder="Start" className={fieldCls} />
          </div>
          <div className="flex flex-col gap-[5px]">
            <label className={labelCls}>Deadline</label>
            <DateField value={deadline} onCommit={setDeadline} ariaLabel="Deadline" placeholder="Deadline" className={fieldCls} />
          </div>
        </div>
        {dateError && <div className="text-compact text-warn">{dateError}</div>}

        <div className="flex flex-col gap-[6px]">
          <label className={labelCls}>First steps <span className="text-faint font-normal">(optional)</span></label>
          {subgoals.length > 0 && (
            <div className="flex flex-col gap-[4px]">
              {subgoals.map((s, i) => (
                <div key={i} className="flex items-center gap-[8px] text-body text-ink-soft">
                  <span className="text-faint">•</span>
                  <span className="flex-1 truncate">{s}</span>
                  <button
                    aria-label={`Remove ${s}`}
                    className="text-muted hover:text-warn inline-flex items-center"
                    onClick={() => setSubgoals((arr) => arr.filter((_, j) => j !== i))}
                  >
                    <IconX size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a step, press Enter…"
            className={`${fieldCls} w-full`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitDraft(); }
            }}
          />
        </div>

        <div className="flex flex-col gap-[5px]">
          <label className={labelCls}>Notes <span className="text-faint font-normal">(optional)</span></label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Strategy, links, blockers…"
            className={`${fieldCls} w-full resize-y leading-[1.5]`}
          />
        </div>

        <div className="flex items-center gap-[8px] mt-[2px]">
          <button className={primaryBtn} onClick={submit} disabled={!title.trim() || !!dateError}>
            Add project
          </button>
          <button className={ghostBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
