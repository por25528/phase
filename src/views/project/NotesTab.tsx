import { useAppStore } from '../../state/store';
import type { Goal } from '../../db/types';

// Shared uppercase section label so the project page's sections read as one system.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-meta font-[550] uppercase tracking-[0.08em] text-muted mb-[9px]">
      {children}
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
    <div className="flex flex-col max-w-[720px]">
      <NotesSection goal={goal} actions={actions} />
    </div>
  );
}
