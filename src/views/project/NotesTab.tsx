import { useAppStore } from '../../state/store';
import type { Goal } from '../../db/types';
import { NoteEditor } from '../../components/NoteEditor';
import { useNoteDraft } from '../../components/useNoteDraft';
import { sectionLabel } from '../../components/sectionLabel';

// Shared section label so the goal page's sections read as one system. Sentence
// case, UI face: a letter-spaced all-caps mono eyebrow over every group is a
// second typeface doing a job a weight already does.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mb-[9px] ${sectionLabel}`}>
      {children}
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
  const draft = useNoteDraft(goal.id, goal.notes ?? '', (id, markdown) =>
    actions.setGoalNotes(id, markdown),
  );

  return (
    <div className="flex flex-col max-w-[720px]">
      <div onBlur={draft.onBlur}>
        <SectionLabel>Notes</SectionLabel>
        <NoteEditor
          docKey={goal.id}
          value={draft.value}
          onChange={draft.onChange}
          placeholder="Working notes — strategy, links, blockers…"
          ariaLabel="Goal notes"
        />
      </div>
    </div>
  );
}
