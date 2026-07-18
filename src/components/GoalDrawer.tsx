import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import type { Goal } from '../db/types';
import { GoalTree } from './GoalTree';
import { ProgressBar } from './ProgressBar';
import { InlineEdit } from './InlineEdit';
import { firstOpenLeaf } from '../lib/tree';
import { goalPct } from '../lib/pct';
import { expectedPct, behindPaceBy } from '../lib/timeline';
import { todayStr, daysLeftLabel } from '../lib/dates';
import { plannedLeaves, weekOf, paceStatus } from '../lib/plan';

function MilestonesSection({
  goal: g,
  actions,
}: {
  goal: Goal;
  actions: ReturnType<typeof useAppStore>['actions'];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(g.start || todayStr());
  const newTitleRef = useRef<HTMLInputElement>(null);

  const sorted = [...(g.milestones ?? [])].sort((a, b) => a.date.localeCompare(b.date));

  function submitNew() {
    const t = newTitle.trim();
    if (!t) return;
    actions.addMilestone(g.id, t, newDate || todayStr());
    setNewTitle('');
    setNewDate(g.start || todayStr());
    newTitleRef.current?.focus();
  }

  return (
    <div className="mt-[22px]">
      <div className="text-[.72rem] font-[550] uppercase tracking-[0.07em] text-muted mb-[8px]">
        Milestones
      </div>

      {sorted.length === 0 && (
        <div className="text-[.78rem] text-faint mb-[6px] px-[2px]">No milestones yet — add one below.</div>
      )}

      {sorted.map((m) => (
        <div
          key={m.id}
          className="group flex items-center gap-[6px] py-[4px] px-[2px] rounded-[5px] hover:bg-hover"
        >
          <span className="text-[.72rem] text-accent mt-[1px]">◆</span>
          <div className="flex-1 min-w-0 text-[.85rem]">
            {editingId === m.id ? (
              <InlineEdit
                value={m.title}
                className="text-[.85rem]"
                onCommit={(v) => { actions.updateMilestone(g.id, m.id, { title: v }); setEditingId(null); }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <span
                className="cursor-default"
                onClick={() => setEditingId(m.id)}
              >
                {m.title}
              </span>
            )}
          </div>
          <input
            type="date"
            value={m.date}
            onChange={(e) => actions.updateMilestone(g.id, m.id, { date: e.target.value })}
            className="rounded-[5px] border border-line-2 px-[5px] py-[2px] text-[.72rem] text-ink bg-transparent outline-none"
          />
          <button
            onClick={() => actions.removeMilestone(g.id, m.id)}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[.8rem] text-muted hover:text-ink px-[3px] rounded transition-opacity duration-[120ms]"
            tabIndex={0}
            aria-label="Delete milestone"
          >
            ✕
          </button>
        </div>
      ))}

      {/* Add row */}
      <div className="flex items-center gap-[6px] mt-[6px] px-[2px]">
        <span className="text-[.72rem] text-faint mt-[1px]">◆</span>
        <input
          ref={newTitleRef}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Milestone title…"
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-[.85rem] text-ink placeholder:text-faint"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitNew(); } }}
        />
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          className="rounded-[5px] border border-line-2 px-[5px] py-[2px] text-[.72rem] text-ink bg-transparent outline-none"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitNew(); } }}
        />
        <button
          onClick={submitNew}
          className="text-[.78rem] text-ink-soft px-[7px] py-[3px] rounded-[5px] border border-line-2 hover:bg-hover disabled:opacity-40"
          disabled={!newTitle.trim()}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function DrawerBody({ goal: g, actions }: { goal: Goal; actions: ReturnType<typeof useAppStore>['actions'] }) {
  const addRootRef = useRef<HTMLInputElement>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const today = todayStr();
  const pct = Math.round(goalPct(g));
  const expected = Math.round(expectedPct(g.start, g.deadline, today));
  const behind = Math.round(behindPaceBy(pct, g.start, g.deadline, today));
  const pace = paceStatus(g, today);
  const wk = plannedLeaves([g], weekOf(today));
  const wkDone = wk.filter((l) => l.done).length;
  const next = firstOpenLeaf(g.nodes);
  return (
    <>
      <div className="mb-[4px]">
        {editingTitle ? (
          <InlineEdit
            value={g.title}
            className="font-disp text-[1.3rem] font-semibold tracking-[-0.01em]"
            onCommit={(v) => { actions.renameGoal(g.id, v); setEditingTitle(false); }}
            onCancel={() => setEditingTitle(false)}
          />
        ) : (
          <div
            className="font-disp text-[1.3rem] font-semibold tracking-[-0.01em] cursor-default"
            onClick={() => setEditingTitle(true)}
          >
            {g.title}
          </div>
        )}
      </div>
      <div className="flex items-center gap-[6px] mt-[4px] mb-[14px]">
        <input type="date" value={g.start} aria-label="Start date"
          onChange={(e) => { if (e.target.value) actions.setGoalDates(g.id, e.target.value, g.deadline); }}
          className="rounded-[5px] border border-line-2 px-[5px] py-[2px] text-[.72rem] text-ink bg-transparent outline-none" />
        <span className="text-[.78rem] text-muted">→</span>
        <input type="date" value={g.deadline} aria-label="Deadline"
          onChange={(e) => { if (e.target.value) actions.setGoalDates(g.id, g.start, e.target.value); }}
          className="rounded-[5px] border border-line-2 px-[5px] py-[2px] text-[.72rem] text-ink bg-transparent outline-none" />
        <span className="text-[.72rem] text-muted tabular-nums">{daysLeftLabel(g.deadline)}</span>
      </div>
      <div className="flex items-center gap-[11px]">
        <span className="font-disp text-[1.05rem] font-semibold tabular-nums min-w-[46px]">{pct}%</span>
        <ProgressBar pct={pct} />
      </div>
      <div className="text-[.74rem] text-muted mt-[6px] tabular-nums">
        {pace === 'behind'
          ? `${behind} pts behind pace · expected ${expected}% by today`
          : pace === 'needs-breakdown'
            ? `define next step · expected ${expected}% by today`
            : pace === 'complete'
              ? 'complete'
              : `on pace · expected ${expected}% by today`}
      </div>
      {wk.length > 0 && (
        <div className="text-[.74rem] text-muted mt-[2px] tabular-nums">
          {wkDone}/{wk.length} planned this week
        </div>
      )}
      {next && (
        <div className="text-[.76rem] text-muted truncate mt-[2px]">
          Next: <span className="text-ink-soft">{next.title}</span>
        </div>
      )}
      <div className="mt-[14px]">
        <GoalTree nodes={g.nodes} />
      </div>
      <div className="px-[6px] py-[2px]">
        <input
          ref={addRootRef}
          className="ghost-in w-full text-[.85rem]"
          placeholder="+ add sub-goal…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && addRootRef.current) {
              const v = addRootRef.current.value.trim();
              if (v) {
                actions.addRootNode(g.id, v);
                addRootRef.current.value = '';
              }
            }
          }}
        />
      </div>
      <MilestonesSection goal={g} actions={actions} />

      <div className="mt-[22px]">
        <div className="text-[.72rem] font-[550] uppercase tracking-[0.07em] text-muted mb-[8px]">
          Notes
        </div>
        <textarea
          defaultValue={g.notes ?? ''}
          key={g.id}
          placeholder="Working notes — strategy, links, blockers…"
          aria-label="Goal notes"
          rows={5}
          onBlur={(e) => { if (e.target.value !== (g.notes ?? '')) actions.setGoalNotes(g.id, e.target.value); }}
          className="w-full mt-[6px] border border-line-2 rounded-[7px] bg-transparent px-[9px] py-[7px] text-[.85rem] leading-[1.5] text-ink placeholder:text-faint outline-none focus-visible:border-accent resize-y"
        />
      </div>
    </>
  );
}

interface GoalDrawerProps {
  goal: Goal | null;
  actions: ReturnType<typeof useAppStore>['actions'];
}

export function GoalDrawer({ goal, actions }: GoalDrawerProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const open = goal != null;

  useEffect(() => {
    if (open) closeBtnRef.current?.focus();
  }, [open]);

  return (
    <>
      {/* Drawer scrim */}
      <div
        className={`fixed inset-0 bg-[rgba(20,20,18,0.18)] z-40 transition-opacity duration-[180ms] ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => actions.closeDrawer()}
      />

      {/* Drawer */}
      <aside
        className={`fixed top-0 right-0 h-screen w-[420px] max-w-[90vw] bg-panel border-l border-line-2 z-50 overflow-y-auto px-[26px] pt-[28px] pb-[60px] transition-transform duration-[200ms] ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <button
          ref={closeBtnRef}
          aria-label="Close goal drawer"
          className="absolute top-[18px] right-[20px] text-muted text-[18px] px-[8px] py-[4px] rounded-[6px] hover:bg-hover"
          onClick={() => actions.closeDrawer()}
        >
          ✕
        </button>
        <div id="drawerBody">
          {goal && <DrawerBody goal={goal} actions={actions} />}
        </div>
      </aside>
    </>
  );
}
