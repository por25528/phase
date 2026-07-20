import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import type { Goal } from '../db/types';
import { GoalTree } from './GoalTree';
import { ProgressBar } from './ProgressBar';
import { InlineEdit } from './InlineEdit';
import { SubtaskAiModal } from './SubtaskAiModal';
import { firstOpenLeaf } from '../lib/tree';
import { goalPct } from '../lib/pct';
import { leafCount } from '../lib/board';
import { expectedPct, behindPaceBy } from '../lib/timeline';
import { todayStr, daysLeftLabel, fmtD } from '../lib/dates';
import { plannedLeaves, weekOf, paceStatus } from '../lib/plan';

// Shared uppercase section label — Steps / Milestones / Notes all use it so the
// two columns read as one system.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[.7rem] font-[550] uppercase tracking-[0.08em] text-muted mb-[9px]">
      {children}
    </div>
  );
}

function Dot() {
  return <span className="text-faint-2" aria-hidden="true">·</span>;
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

// ── Header ────────────────────────────────────────────────────────────────────
// Title, dates, and the progress strip — the always-visible summary that anchors
// the window while the body below scrolls.
function DrawerHeader({
  goal: g,
  actions,
}: {
  goal: Goal;
  actions: ReturnType<typeof useAppStore>['actions'];
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const today = todayStr();
  const pct = Math.round(goalPct(g));
  const expected = Math.round(expectedPct(g.start, g.deadline, today));
  const behind = Math.round(behindPaceBy(pct, g.start, g.deadline, today));
  const pace = paceStatus(g, today);
  const wk = plannedLeaves([g], weekOf(today));
  const wkDone = wk.filter((l) => l.done).length;
  const next = firstOpenLeaf(g.nodes);
  const isCompleted = !!g.completedAt;

  const paceLine =
    pace === 'behind'
      ? `${behind} pts behind pace · expected ${expected}% by today`
      : pace === 'needs-breakdown'
        ? `define next step · expected ${expected}% by today`
        : pace === 'complete'
          ? 'every step done — ready to complete'
          : `on pace · expected ${expected}% by today`;

  return (
    <div className="flex-none px-[30px] pt-[26px] pb-[18px] border-b border-line">
      {/* Title + dates (right padding leaves room for the ✕) */}
      <div className="pr-[40px]">
        {editingTitle ? (
          <InlineEdit
            value={g.title}
            className="font-disp text-[1.4rem] font-semibold tracking-[-0.01em]"
            onCommit={(v) => { actions.renameGoal(g.id, v); setEditingTitle(false); }}
            onCancel={() => setEditingTitle(false)}
          />
        ) : (
          <div
            className="font-disp text-[1.4rem] font-semibold tracking-[-0.01em] cursor-text hover:text-ink-hover w-fit"
            onClick={() => setEditingTitle(true)}
            title="Click to rename"
          >
            {g.title}
          </div>
        )}
        <div className="flex items-center gap-[6px] mt-[9px]">
          <input type="date" value={g.start} aria-label="Start date"
            onChange={(e) => { if (e.target.value) actions.setGoalDates(g.id, e.target.value, g.deadline); }}
            className="rounded-[5px] border border-line-2 px-[5px] py-[2px] text-[.72rem] text-ink bg-transparent outline-none" />
          <span className="text-[.78rem] text-muted">→</span>
          <input type="date" value={g.deadline} aria-label="Deadline"
            onChange={(e) => { if (e.target.value) actions.setGoalDates(g.id, g.start, e.target.value); }}
            className="rounded-[5px] border border-line-2 px-[5px] py-[2px] text-[.72rem] text-ink bg-transparent outline-none" />
          <span className="text-[.72rem] text-muted tabular-nums">{daysLeftLabel(g.deadline)}</span>
        </div>
      </div>

      {/* Progress */}
      <div className="mt-[16px] flex items-center gap-[11px]">
        <span className="font-disp text-[1.15rem] font-semibold tabular-nums min-w-[50px]">{pct}%</span>
        <ProgressBar pct={pct} />
      </div>
      <div className="mt-[7px] flex flex-wrap items-center gap-x-[10px] gap-y-[3px] text-[.75rem] text-muted tabular-nums">
        <span className={pace === 'behind' ? 'text-warn' : ''}>{paceLine}</span>
        {wk.length > 0 && (<><Dot /><span>{wkDone}/{wk.length} planned this week</span></>)}
        {next && !isCompleted && (
          <><Dot /><span className="truncate max-w-[320px] text-ink-soft">Next: {next.title}</span></>
        )}
      </div>

      {/* Completion lifecycle (spec §2.5). A completed project is frozen for
          structural edits (store guards enforce it); metadata stays editable. */}
      {isCompleted ? (
        <div className="flex items-center gap-[10px] mt-[16px] px-[11px] py-[9px] rounded-card border border-line bg-hover">
          <span className="text-accent text-[.9rem]" aria-hidden="true">✓</span>
          <span className="text-[.8rem] text-ink-soft flex-1">Completed {fmtD(g.completedAt!)}</span>
          <button
            onClick={() => actions.reopenGoal(g.id)}
            className="text-[.78rem] font-semibold text-ink-soft px-[10px] py-[5px] rounded-[8px] border border-line-2 hover:bg-panel"
          >
            Reopen project
          </button>
        </div>
      ) : pace === 'complete' ? (
        <button
          onClick={() => actions.completeGoal(g.id)}
          className="mt-[16px] text-[.82rem] font-semibold text-accent-contrast bg-accent px-[15px] py-[8px] rounded-field hover:bg-accent-deep"
        >
          Complete project
        </button>
      ) : null}
    </div>
  );
}

// ── Steps column (the working area) ───────────────────────────────────────────
function StepsSection({
  goal: g,
  actions,
  focusNodeId,
}: {
  goal: Goal;
  actions: ReturnType<typeof useAppStore>['actions'];
  focusNodeId?: string | null;
}) {
  const addRootRef = useRef<HTMLInputElement>(null);
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const isCompleted = !!g.completedAt;
  const hasSteps = g.nodes.length > 0;
  const { total, done } = leafCount(g.nodes);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-[9px]">
        <div className="text-[.7rem] font-[550] uppercase tracking-[0.08em] text-muted">Steps</div>
        {total > 0 && (
          <span className="font-mono text-[.68rem] text-faint tabular-nums">{done}/{total} done</span>
        )}
      </div>

      {!hasSteps && (
        <div className="rounded-card border border-dashed border-line-2 px-[14px] py-[16px] text-center mb-[8px]">
          <div className="text-[.82rem] text-ink-soft">No steps yet</div>
          <div className="text-[.74rem] text-muted mt-[3px] leading-[1.5]">
            Break this project into the actions that move it forward.
          </div>
        </div>
      )}

      <div className={isCompleted ? 'opacity-70 pointer-events-none' : ''} aria-disabled={isCompleted}>
        <GoalTree nodes={g.nodes} />
      </div>

      {!isCompleted && (
        <div className="mt-[4px] px-[6px] py-[2px]">
          <input
            ref={addRootRef}
            className="ghost-in w-full text-[.85rem]"
            placeholder={hasSteps ? '+ add step…' : '+ add the first step…'}
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
          <button
            type="button"
            onClick={() => setSubtaskOpen(true)}
            className="mt-[8px] text-[.78rem] font-medium text-accent-deep hover:bg-accent-tint px-[8px] py-[5px] rounded-[7px] -ml-[1px]"
          >
            ✦ Break a step into daily tasks with AI
          </button>
        </div>
      )}

      <SubtaskAiModal
        open={subtaskOpen}
        onClose={() => setSubtaskOpen(false)}
        goal={g}
        defaultStepId={focusNodeId}
        actions={actions}
      />
    </section>
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
        aria-label="Goal notes"
        rows={6}
        onBlur={(e) => { if (e.target.value !== (g.notes ?? '')) actions.setGoalNotes(g.id, e.target.value); }}
        className="w-full border border-line-2 rounded-[7px] bg-transparent px-[9px] py-[7px] text-[.85rem] leading-[1.5] text-ink placeholder:text-faint outline-none focus-visible:border-accent resize-y"
      />
    </div>
  );
}

interface GoalDrawerProps {
  goal: Goal | null;
  actions: ReturnType<typeof useAppStore>['actions'];
  focusNodeId?: string | null;
}

export function GoalDrawer({ goal, actions, focusNodeId }: GoalDrawerProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = goal != null;

  // Open behaviour: focus the close button, lock background scroll, and trap Tab
  // inside the dialog (Escape is handled globally in App → closeDrawer).
  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Node focus (Q10 / T8): once the drawer is open and the tree has rendered
  // (ancestors were expanded in openDrawer), scroll the row into view and pulse
  // it. Done via the DOM so the shared GoalTree needs no focus-aware prop.
  useEffect(() => {
    if (!open || !focusNodeId) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => {
      const row = document.querySelector<HTMLElement>(
        `#drawerBody [data-node-id="${CSS.escape(focusNodeId)}"]`,
      );
      if (!row) return;
      row.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      if (!reduced && typeof row.animate === 'function') {
        row.animate(
          [
            { boxShadow: '0 0 0 2px rgb(var(--c-accent))', borderRadius: '6px' },
            { boxShadow: '0 0 0 2px rgba(0,0,0,0)', borderRadius: '6px' },
          ],
          { duration: 1400, easing: 'ease-out' },
        );
      }
    }, 70); // let expand/fade-in settle before measuring
    return () => clearTimeout(t);
  }, [open, focusNodeId]);

  return (
    <div
      className={`fixed inset-0 z-50 grid place-items-center px-[16px] py-[24px] bg-[rgba(20,20,18,0.28)] transition-opacity duration-[180ms] ${
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      onClick={() => actions.closeDrawer()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={goal ? `${goal.title} — project` : 'Project'}
        className={`relative w-full max-w-[960px] max-h-[88vh] flex flex-col bg-panel border border-line-2 rounded-card shadow-card transition-[opacity,transform] duration-[200ms] ease-out ${
          open ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-[8px] scale-[.985] pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeBtnRef}
          aria-label="Close goal drawer"
          className="absolute top-[16px] right-[18px] z-10 text-muted text-[18px] px-[8px] py-[4px] rounded-[6px] hover:bg-hover"
          onClick={() => actions.closeDrawer()}
        >
          ✕
        </button>

        {goal && (
          <>
            <DrawerHeader goal={goal} actions={actions} />
            <div id="drawerBody" className="flex-1 min-h-0 overflow-y-auto px-[30px] py-[24px]">
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-[30px] md:gap-[34px]">
                <StepsSection goal={goal} actions={actions} focusNodeId={focusNodeId} />
                <div className="flex flex-col gap-[26px]">
                  <MilestonesSection goal={goal} actions={actions} />
                  <NotesSection goal={goal} actions={actions} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
