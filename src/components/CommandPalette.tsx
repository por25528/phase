import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { modalRegistry } from '../lib/modalRegistry';
import { buildSearchIndex, searchEntries, type SearchEntry, type SearchHit, type SearchKind } from '../lib/search';
import type { Goal, Habit, Task } from '../db/types';
import type { ViewName } from '../state/store';

// One input that both finds and acts (the Linear ⌘K pattern). Navigation verbs
// share the list with search results, so nothing needs a separate surface.
interface NavCommand {
  id: string;
  label: string;
  view: ViewName;
  key: string;
}

const NAV_COMMANDS: NavCommand[] = [
  { id: 'nav-plan', label: 'Go to Plan', view: 'plan', key: '1' },
  { id: 'nav-goals', label: 'Go to Projects', view: 'goals', key: '2' },
  { id: 'nav-timeline', label: 'Go to Timeline', view: 'timeline', key: '3' },
];

const KIND_LABEL: Record<SearchKind, string> = {
  project: 'PROJECT',
  step: 'STEP',
  task: 'TASK',
  habit: 'HABIT',
};

type Row =
  | { type: 'nav'; command: NavCommand }
  | { type: 'hit'; hit: SearchHit };

// Bold the characters the query actually matched, so a fuzzy hit explains itself.
function Highlighted({ title, matches }: { title: string; matches: number[] }) {
  if (matches.length === 0) return <>{title}</>;
  const hit = new Set(matches);
  const runs: { text: string; on: boolean }[] = [];
  for (let i = 0; i < title.length; i += 1) {
    const on = hit.has(i);
    const last = runs[runs.length - 1];
    if (last && last.on === on) last.text += title[i];
    else runs.push({ text: title[i], on });
  }
  return (
    <>
      {runs.map((run, i) =>
        run.on
          ? <b key={i} className="font-semibold text-ink">{run.text}</b>
          : <span key={i}>{run.text}</span>,
      )}
    </>
  );
}

export function CommandPalette({
  open,
  onClose,
  goals,
  tasks,
  habits,
  onOpenGoal,
  onSetView,
  onReveal,
}: {
  open: boolean;
  onClose: () => void;
  goals: Goal[];
  tasks: Task[];
  habits: Habit[];
  onOpenGoal: (goalId: string, nodeId?: string) => void;
  onSetView: (view: ViewName) => void;
  /** Take the user to a task/habit on the Plan view and highlight it. */
  onReveal: (kind: 'task' | 'habit', id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const modalId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Rebuilding the index per render is fine at this scale (one pass over the
  // in-memory store) and keeps results correct after any edit.
  const index = useMemo(
    () => (open ? buildSearchIndex(goals, tasks, habits) : []),
    [open, goals, tasks, habits],
  );

  const rows: Row[] = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return NAV_COMMANDS.map((command) => ({ type: 'nav' as const, command }));

    const hits = searchEntries(index, trimmed).map((hit) => ({ type: 'hit' as const, hit }));
    const lower = trimmed.toLowerCase();
    const navs = NAV_COMMANDS
      .filter((c) => c.label.toLowerCase().includes(lower) || c.view.startsWith(lower))
      .map((command) => ({ type: 'nav' as const, command }));
    return [...hits, ...navs];
  }, [query, index]);

  // Any change to the result set invalidates the cursor.
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const unregister = modalRegistry.register(modalId);
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus after paint so the input exists.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      unregister();
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, [open, modalId]);

  // Keep the cursor row scrolled into view during keyboard traversal.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  function run(row: Row) {
    if (row.type === 'nav') {
      onSetView(row.command.view);
      onClose();
      return;
    }
    const entry: SearchEntry = row.hit.entry;
    if (entry.kind === 'project') {
      onOpenGoal(entry.goalId!);
    } else if (entry.kind === 'step') {
      onOpenGoal(entry.goalId!, entry.nodeId);
    } else {
      // Tasks and habits have no drawer of their own; the calendar is where
      // they are scheduled and completed. Switching view is not enough on its
      // own — a task scheduled three weeks out, or one sitting behind the
      // backlog's "+N more" cap, is nowhere on the week that happens to be
      // showing, so landing on Plan looked exactly like Enter doing nothing.
      // `onReveal` moves the week, opens whatever is hiding the row, and marks
      // it.
      onReveal(entry.kind === 'habit' ? 'habit' : 'task', entry.id);
    }
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => (rows.length === 0 ? 0 : (i + 1) % rows.length));
      return;
    }
    if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => (rows.length === 0 ? 0 : (i - 1 + rows.length) % rows.length));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (row) run(row);
      return;
    }
    /*
     * The palette is a single-input dialog: every result row is `tabIndex={-1}`
     * and driven by `aria-activedescendant`, so there is nothing else inside to
     * Tab to. Without this, one Tab left the dialog entirely and landed on the
     * header buttons behind the scrim — and from there Escape was resolved by
     * App's global handler as 'close-drawer', closing the Project page while
     * the palette stayed open. Swallowing Tab is the whole trap this needs;
     * `Modal` cycles because it holds several controls; the Project page is not
     * a dialog, so it has no comparable trap.
     */
    if (e.key === 'Tab') e.preventDefault();
  }

  return (
    <div
      className="fixed inset-0 z-[65] bg-[rgba(20,20,18,0.28)] px-[16px] pt-[12vh] pb-[24px]"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="w-full max-w-[560px] mx-auto bg-panel border border-line-2 rounded-card shadow-card overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-[10px] px-[16px] py-[13px] border-b border-line">
          <span aria-hidden="true" className="text-faint text-lead">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search projects, steps, tasks and habits…"
            aria-label="Search projects, steps, tasks and habits"
            // `combobox` is what makes the rest of this mean anything: without
            // it the listbox below is never announced, and `aria-activedescendant`
            // has no widget to move a virtual cursor within.
            role="combobox"
            aria-expanded
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls={`${modalId}-results`}
            aria-activedescendant={rows[active] ? `${modalId}-row-${active}` : undefined}
            className="flex-1 min-w-0 bg-transparent text-title text-ink placeholder:text-faint outline-none"
          />
          <kbd className="font-mono text-kbd tracking-[.04em] text-muted border border-line-2 rounded-[4px] px-[4px] py-[1px]">
            ESC
          </kbd>
        </div>

        <div
          ref={listRef}
          id={`${modalId}-results`}
          role="listbox"
          aria-label="Results"
          className="max-h-[46vh] overflow-y-auto py-[6px]"
        >
          {rows.length === 0 ? (
            <p className="px-[16px] py-[18px] text-body text-muted">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            rows.map((row, i) => {
              const isActive = i === active;
              const rowCls = `w-full text-left px-[16px] py-[9px] flex items-center gap-[10px] ${
                isActive ? 'bg-hover-deep' : 'hover:bg-hover'
              }`;
              if (row.type === 'nav') {
                return (
                  <button
                    key={row.command.id}
                    id={`${modalId}-row-${i}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    tabIndex={-1}
                    className={rowCls}
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(row)}
                  >
                    <span className="flex-1 min-w-0 truncate text-lead text-ink-soft">
                      {row.command.label}
                    </span>
                    <kbd className="font-mono text-kbd text-muted border border-line-2 rounded-[4px] px-[4px] py-[1px]">
                      {row.command.key}
                    </kbd>
                  </button>
                );
              }
              const { entry, titleMatches } = row.hit;
              return (
                <button
                  key={`${entry.kind}-${entry.id}`}
                  id={`${modalId}-row-${i}`}
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive}
                  tabIndex={-1}
                  className={rowCls}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(row)}
                >
                  <span className="flex-1 min-w-0">
                    <span
                      className={`block truncate text-lead ${
                        entry.done ? 'line-through text-faint' : 'text-ink-soft'
                      }`}
                    >
                      <Highlighted title={entry.title} matches={titleMatches} />
                    </span>
                    {entry.context && (
                      <span className="block truncate text-compact text-muted mt-[1px]">
                        {entry.context}
                        {entry.archived && ' · archived'}
                      </span>
                    )}
                  </span>
                  <span className="flex-none font-mono text-tiny tracking-[.1em] text-muted">
                    {KIND_LABEL[entry.kind]}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-[14px] px-[16px] py-[8px] border-t border-line font-mono text-tiny tracking-[.08em] text-muted">
          <span>↑↓ MOVE</span>
          <span>↵ OPEN</span>
          <span>ESC CLOSE</span>
        </div>
      </div>
    </div>
  );
}
