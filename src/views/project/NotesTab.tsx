import { useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import type { Goal } from '../../db/types';
import { DateField } from '../../components/DateField';
import { InlineEdit } from '../../components/InlineEdit';
import { todayStr } from '../../lib/dates';

// Shared uppercase section label — Steps / Milestones / Notes all use it so the
// two columns read as one system.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-meta font-[550] uppercase tracking-[0.08em] text-muted mb-[9px]">
      {children}
    </div>
  );
}

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
    <div>
      <SectionLabel>Milestones</SectionLabel>

      {sorted.length === 0 && (
        <div className="text-ui text-muted mb-[6px] px-[2px]">No milestones yet — add one below.</div>
      )}

      {sorted.map((m) => (
        <div
          key={m.id}
          className="group flex items-center gap-[6px] py-[4px] px-[2px] rounded-[6px] hover:bg-hover"
        >
          <span className="text-meta text-accent mt-[1px]">◆</span>
          <div className="flex-1 min-w-0 text-body">
            {editingId === m.id ? (
              <InlineEdit
                value={m.title}
                className="text-body"
                onCommit={(v) => { actions.updateMilestone(g.id, m.id, { title: v }); setEditingId(null); }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              // A real button, not a click-handling span: renaming a
              // milestone was mouse-only, with no keyboard route at all.
              <button
                type="button"
                className="text-left rounded-[4px]"
                onClick={() => setEditingId(m.id)}
                aria-label={`Rename milestone "${m.title}"`}
              >
                {m.title}
              </button>
            )}
          </div>
          <DateField
            value={m.date}
            ariaLabel={`Date for milestone "${m.title}"`}
            onCommit={(next) => { if (next) actions.updateMilestone(g.id, m.id, { date: next }); }}
          />
          <button
            onClick={() => actions.removeMilestone(g.id, m.id)}
            className="quiet-control text-ui text-muted hover:text-ink rounded-[4px] hover:bg-hover"
            tabIndex={0}
            aria-label="Delete milestone"
          >
            ✕
          </button>
        </div>
      ))}

      {/* Add row */}
      <div className="flex items-center gap-[6px] mt-[6px] px-[2px]">
        <span className="text-meta text-faint mt-[1px]">◆</span>
        <input
          ref={newTitleRef}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Milestone title…"
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-body min-h-[24px] text-ink placeholder:text-faint"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitNew(); } }}
        />
        <DateField
          value={newDate}
          ariaLabel="New milestone date"
          onCommit={setNewDate}
        />
        <button
          onClick={submitNew}
          className="text-ui text-ink-soft px-[7px] py-[3px] min-h-[24px] inline-flex items-center rounded-[6px] border border-line-2 hover:bg-hover disabled:opacity-40"
          disabled={!newTitle.trim()}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Notes ─────────────────────────────────────────────────────────────────────
function NotesSection({
  goal: g,
  actions,
}: {
  goal: Goal;
  actions: ReturnType<typeof useAppStore>['actions'];
}) {
  return (
    <div>
      <SectionLabel>Notes</SectionLabel>
      <textarea
        defaultValue={g.notes ?? ''}
        key={g.id}
        placeholder="Working notes — strategy, links, blockers…"
        aria-label="Project notes"
        rows={6}
        onBlur={(e) => { if (e.target.value !== (g.notes ?? '')) actions.setGoalNotes(g.id, e.target.value); }}
        className="w-full border border-line-2 rounded-[6px] bg-transparent px-[9px] py-[7px] text-body leading-[1.5] text-ink placeholder:text-faint outline-none focus-visible:border-accent resize-y"
      />
    </div>
  );
}

export function NotesTab({
  goal,
  actions,
}: {
  goal: Goal;
  actions: ReturnType<typeof useAppStore>['actions'];
}) {
  return (
    <div className="flex flex-col gap-[26px] max-w-[720px]">
      <MilestonesSection goal={goal} actions={actions} />
      <NotesSection goal={goal} actions={actions} />
    </div>
  );
}
