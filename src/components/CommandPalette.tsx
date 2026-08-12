import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { modalRegistry } from '../lib/modalRegistry';
import { IconChevronRight, IconSearch } from './Icons';
import { buildSearchIndex, searchEntries, type SearchEntry, type SearchHit, type SearchKind } from '../lib/search';
import {
  actionsFor,
  commandModeQuery,
  matchCommands,
  type Command,
  type ObjectAction,
  type ObjectActionId,
} from '../lib/commands';
import { cardPrimaryAction } from '../lib/plan';
import { todayStr } from '../lib/dates';
import type { Goal, Habit, Task } from '../db/types';

/**
 * One input that finds AND acts.
 *
 * The old version called itself a command palette and held three navigation
 * rows. Everything else it returned was an object that opened a location, so a
 * person who typed "complete" or "schedule" learned that the keyboard route did
 * not exist — which is worse than having no palette, because they stop looking.
 *
 * Three things are in the list now: commands (`>` shows only those), objects,
 * and — one level in, on a chosen object — the verbs for it. The footer says so.
 */
const KIND_LABEL: Record<SearchKind, string> = {
  project: 'GOAL',
  step: 'TASK',
  task: 'TASK',
  habit: 'HABIT',
};

type Row =
  | { type: 'command'; command: Command }
  | { type: 'hit'; hit: SearchHit }
  | { type: 'action'; action: ObjectAction };

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
  onCommand,
  onObjectAction,
}: {
  open: boolean;
  onClose: () => void;
  goals: Goal[];
  tasks: Task[];
  habits: Habit[];
  /** Runs a registry command by id. The handlers need the store, so they live in App. */
  onCommand: (id: string) => void;
  onObjectAction: (entry: SearchEntry, action: ObjectActionId) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  /** The object whose verbs are showing. Null is the ordinary find-and-go list. */
  const [subject, setSubject] = useState<SearchEntry | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const modalId = useId();

  // Rebuilding the index per render is fine at this scale (one pass over the
  // in-memory store) and keeps results correct after any edit.
  const index = useMemo(
    () => (open ? buildSearchIndex(goals, tasks, habits) : []),
    [open, goals, tasks, habits],
  );

  const rows: Row[] = useMemo(() => {
    if (subject) {
      const goal = subject.kind === 'project'
        ? goals.find((g) => g.id === subject.goalId)
        : undefined;
      const verdict = goal ? cardPrimaryAction(goal, todayStr()) : undefined;
      return actionsFor(subject, verdict).map((action) => ({ type: 'action' as const, action }));
    }
    const commandOnly = commandModeQuery(query);
    if (commandOnly !== null) {
      return matchCommands(commandOnly).map((command) => ({ type: 'command' as const, command }));
    }
    const trimmed = query.trim();
    const commands = matchCommands(trimmed).map((command) => ({ type: 'command' as const, command }));
    if (!trimmed) return commands;
    // Objects first: with something typed, the thing you named is more likely
    // to be what you meant than a verb that happens to share its letters.
    const hits = searchEntries(index, trimmed).map((hit) => ({ type: 'hit' as const, hit }));
    return [...hits, ...commands];
  }, [query, index, subject, goals]);

  // Any change to the result set invalidates the cursor.
  useEffect(() => setActive(0), [query, subject]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setSubject(null);
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
    if (row.type === 'command') {
      onCommand(row.command.id);
      onClose();
      return;
    }
    if (row.type === 'action') {
      if (subject) onObjectAction(subject, row.action.id);
      onClose();
      return;
    }
    /*
     * Enter on an object runs its DEFAULT verb — open — rather than dropping
     * into the submenu.
     *
     * Finding a thing and going to it is the overwhelming majority of what this
     * input is used for, and making that two keypresses to expose five verbs
     * would tax the common case to advertise the rare one. `→` opens the verbs
     * instead, and the footer says so, which is the same trade a file manager
     * makes with Enter and the context menu.
     */
    onObjectAction(row.hit.entry, 'open');
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // Escape closes in layers: the verb list first, the palette second.
      if (subject) setSubject(null);
      else onClose();
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
    if (e.key === 'ArrowRight' && !subject) {
      const row = rows[active];
      if (row?.type !== 'hit') return;
      e.preventDefault();
      setSubject(row.hit.entry);
      return;
    }
    if (e.key === 'ArrowLeft' && subject) {
      e.preventDefault();
      setSubject(null);
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
     * App's global handler as 'close-drawer', closing the goal page while the
     * palette stayed open.
     */
    if (e.key === 'Tab') e.preventDefault();
  }

  const rowCls = (isActive: boolean) =>
    `w-full text-left px-[16px] py-[9px] flex items-center gap-[10px] ${
      isActive ? 'bg-hover-deep' : 'hover:bg-hover'
    }`;

  return (
    <div
      className="scrim fixed inset-0 z-[65] px-[16px] pt-[12vh] pb-[24px]"
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
          <span className="text-faint inline-flex"><IconSearch size={16} /></span>
          {/* The chosen object stays on screen as a chip while its verbs show,
              so the list of verbs is never floating free of what it acts on. */}
          {subject && (
            <span className="flex-none max-w-[220px] truncate px-[8px] py-[3px] rounded-field bg-hover-deep text-ui text-ink-soft">
              {subject.title}
            </span>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            // readOnly, NOT disabled. A disabled input takes no keydown and
            // holds no focus, so opening the verb list would leave the arrows,
            // Enter and Escape with nowhere to land — the list would be
            // unreachable by the keyboard that opened it.
            readOnly={subject !== null}
            placeholder={subject ? 'Pick an action…' : 'Search, or type > for commands…'}
            aria-label="Search goals, tasks and habits, or run a command"
            // `combobox` is what makes the rest of this mean anything: without
            // it the listbox below is never announced, and `aria-activedescendant`
            // has no widget to move a virtual cursor within.
            role="combobox"
            aria-expanded
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls={`${modalId}-results`}
            aria-activedescendant={rows[active] ? `${modalId}-row-${active}` : undefined}
            className="flex-1 min-w-0 bg-transparent text-title text-ink placeholder:text-faint outline-none read-only:cursor-default"
          />
          <kbd className="font-mono text-kbd tracking-[.04em] text-muted border border-line-2 rounded-[4px] px-[4px] py-[1px]">
            ESC
          </kbd>
        </div>

        <div
          ref={listRef}
          id={`${modalId}-results`}
          role="listbox"
          aria-label={subject ? 'Actions' : 'Results'}
          className="max-h-[46vh] overflow-y-auto py-[6px]"
        >
          {rows.length === 0 ? (
            <p className="px-[16px] py-[18px] text-body text-muted">
              Nothing matches “{query.replace(/^>/, '').trim()}”.
            </p>
          ) : (
            rows.map((row, i) => {
              const isActive = i === active;
              const common = {
                id: `${modalId}-row-${i}`,
                role: 'option' as const,
                'aria-selected': isActive,
                'data-active': isActive,
                tabIndex: -1,
                className: rowCls(isActive),
                onMouseMove: () => setActive(i),
                onClick: () => run(row),
              };

              if (row.type === 'command') {
                return (
                  <button key={`c-${row.command.id}`} type="button" {...common}>
                    <span className="flex-1 min-w-0 truncate text-lead text-ink-soft">
                      {row.command.label}
                    </span>
                    {row.command.hint && (
                      <kbd className="font-mono text-kbd text-muted border border-line-2 rounded-[4px] px-[4px] py-[1px]">
                        {row.command.hint}
                      </kbd>
                    )}
                  </button>
                );
              }

              if (row.type === 'action') {
                return (
                  <button key={`a-${row.action.id}`} type="button" {...common}>
                    <span className="flex-1 min-w-0 truncate text-lead text-ink-soft">
                      {row.action.label}
                    </span>
                  </button>
                );
              }

              const { entry, titleMatches, snippet } = row.hit;
              return (
                <button key={`${entry.kind}-${entry.id}`} type="button" {...common}>
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
                    {snippet !== undefined && (
                      <span className="block truncate text-compact text-muted mt-[1px]">
                        {snippet}
                      </span>
                    )}
                  </span>
                  <span className="flex-none font-mono text-tiny tracking-[.1em] text-muted">
                    {KIND_LABEL[entry.kind]}
                  </span>
                  <span className="flex-none text-faint inline-flex" aria-hidden="true">
                    <IconChevronRight size={12} />
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-[14px] px-[16px] py-[8px] border-t border-line font-mono text-tiny tracking-[.08em] text-muted">
          <span>↑↓ MOVE</span>
          {subject ? (
            <>
              <span>↵ RUN</span>
              <span>← BACK</span>
            </>
          ) : (
            <>
              <span>↵ OPEN</span>
              <span>→ ACTIONS</span>
              <span>&gt; COMMANDS</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
