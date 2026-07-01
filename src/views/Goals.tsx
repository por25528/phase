import { useState, useRef, useEffect } from 'react';
import type { GoalNode } from '../db/types';
import { useAppStore } from '../state/store';
import { ProgressBar } from '../components/ProgressBar';
import { GoalTree } from '../components/GoalTree';
import { goalPct } from '../lib/pct';
import { fmtD, todayStr, parseD } from '../lib/dates';

function leafCount(nodes: GoalNode[]): { total: number; done: number } {
  let total = 0, done = 0;
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      const sub = leafCount(n.children);
      total += sub.total;
      done += sub.done;
    } else {
      total++;
      if (n.done) done++;
    }
  }
  return { total, done };
}

function daysLeft(deadline: string): number {
  const today = parseD(todayStr());
  const dl = parseD(deadline);
  return Math.ceil((dl.getTime() - today.getTime()) / 86_400_000);
}

function InlineEdit({
  value,
  className,
  onCommit,
  onCancel,
}: {
  value: string;
  className: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const escaped = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function commit() {
    const v = draft.trim();
    if (v) onCommit(v);
    else onCancel();
  }

  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      className={`${className} bg-transparent outline-none p-0 min-w-0`}
      style={{ border: 'none', borderBottom: '1px solid #5D6B82' }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          escaped.current = false;
          commit();
        }
        if (e.key === 'Escape') {
          escaped.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!escaped.current) commit();
      }}
    />
  );
}

function NewGoalForm({
  onAdd,
  onCancel,
}: {
  onAdd: (title: string, deadline: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('2026-12-31');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function submit() {
    const t = title.trim();
    if (!t) return;
    onAdd(t, deadline);
  }

  return (
    <div className="mt-[22px] p-[12px] rounded-[7px] border border-line-2 bg-panel flex flex-col gap-[8px]">
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Goal name"
        className="w-full bg-transparent border-none outline-none text-[.9rem] text-ink placeholder:text-faint"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <input
        type="date"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
        className="w-full rounded-[6px] border border-line-2 px-[8px] py-[4px] text-[.78rem] text-ink bg-transparent outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="flex items-center gap-[8px]">
        <button
          className="text-[.82rem] text-ink px-[9px] py-[5px] rounded-[6px] border border-line-2 hover:bg-hover"
          onClick={submit}
        >
          Add
        </button>
        <button
          className="text-[.82rem] text-muted px-[9px] py-[5px] rounded-[6px] hover:bg-hover"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function Goals() {
  const { goals, actions } = useAppStore();
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showNewGoal, setShowNewGoal] = useState(false);

  useEffect(() => {
    if (!deleteConfirmId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDeleteConfirmId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteConfirmId]);

  return (
    <div>
      <h1 className="font-disp text-[1.74rem] font-semibold tracking-[-0.015em] mb-[3px]">Goals</h1>
      <p className="text-muted text-[.86rem] mb-[30px]">
        Each goal is a tree. Tick the leaves; the percentage rolls up on its own.
      </p>

      {goals.length === 0 && (
        <p className="text-muted text-[.84rem] mb-[22px]">
          No goals yet. Add your first one below.
        </p>
      )}

      {goals.map((g) => {
        const pct = Math.round(goalPct(g));
        const leaves = leafCount(g.nodes);
        const days = daysLeft(g.deadline);

        return (
          <div key={g.id} className="py-[18px] pb-[8px] border-b border-line group">
            {/* Header row */}
            <div className="flex items-center gap-[8px]">
              <div className="flex-1 min-w-0">
                {editingGoalId === g.id ? (
                  <InlineEdit
                    value={g.title}
                    className="font-disp text-[1.18rem] font-semibold tracking-[-0.01em] w-full"
                    onCommit={(v) => { actions.renameGoal(g.id, v); setEditingGoalId(null); }}
                    onCancel={() => setEditingGoalId(null)}
                  />
                ) : (
                  <span
                    className="font-disp text-[1.18rem] font-semibold tracking-[-0.01em] cursor-default"
                    onClick={() => setEditingGoalId(g.id)}
                  >
                    {g.title}
                  </span>
                )}
              </div>

              {/* Dates + days left */}
              <div className="flex items-center gap-[5px] text-[.76rem] text-muted whitespace-nowrap flex-shrink-0">
                <span>{fmtD(g.start)} → {fmtD(g.deadline)}</span>
                <span className="text-[.72rem] opacity-70">
                  · {days < 0 ? 'overdue' : `${days}d left`}
                </span>
              </div>

              {/* Delete button or two-step confirm */}
              {deleteConfirmId === g.id ? (
                <div className="flex items-center gap-[6px] text-[.78rem] text-muted flex-shrink-0 ml-[4px]">
                  <span>Delete goal?</span>
                  <button
                    className="text-ink font-medium hover:text-muted"
                    onClick={() => { actions.removeGoal(g.id); setDeleteConfirmId(null); }}
                  >
                    Delete
                  </button>
                  <span className="text-faint">·</span>
                  <button className="hover:text-ink" onClick={() => setDeleteConfirmId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={`Delete goal: ${g.title}`}
                  className="text-faint text-[.8rem] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity ml-[4px] flex-shrink-0"
                  onClick={() => setDeleteConfirmId(g.id)}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Progress row */}
            <div className="flex items-center gap-[11px] mt-[10px] mb-[6px]">
              <span className="font-disp text-[1.05rem] font-semibold tabular-nums min-w-[46px]">
                {pct}%
              </span>
              <span className="text-[.76rem] text-muted tabular-nums whitespace-nowrap">
                {leaves.done}/{leaves.total} done
              </span>
              <ProgressBar pct={pct} />
            </div>

            <GoalTree nodes={g.nodes} />
            <AddRootInput onAdd={(title) => actions.addRootNode(g.id, title)} />
          </div>
        );
      })}

      {showNewGoal ? (
        <NewGoalForm
          onAdd={(title, deadline) => {
            actions.addGoal(title, deadline);
            setShowNewGoal(false);
          }}
          onCancel={() => setShowNewGoal(false)}
        />
      ) : (
        <button
          className="text-[.82rem] text-muted px-[9px] py-[5px] rounded-[6px] border border-line-2 hover:bg-hover mt-[22px]"
          onClick={() => setShowNewGoal(true)}
        >
          + new goal
        </button>
      )}
    </div>
  );
}

function AddRootInput({ onAdd }: { onAdd: (title: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="px-[6px] py-[2px]">
      <input
        ref={ref}
        className="ghost-in w-full text-[.85rem]"
        placeholder="+ add sub-goal…"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && ref.current) {
            const v = ref.current.value.trim();
            if (v) {
              onAdd(v);
              ref.current.value = '';
            }
          }
        }}
      />
    </div>
  );
}
