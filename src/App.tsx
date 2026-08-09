import { useEffect, useRef, useState } from 'react';
import { useAppStore, initStore, VIEW_LABELS } from './state/store';
import { Today } from './views/Today';
import { Goals } from './views/Goals';
import { Plan } from './views/Plan';
import { Project } from './views/Project';
import { QuickAdd } from './components/QuickAdd';
import { ConfirmImportModal } from './components/ConfirmImportModal';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { useLocalDate } from './hooks/useLocalDate';
import { addDays, todayStr } from './lib/dates';
import type { SearchEntry } from './lib/search';
import type { ObjectActionId } from './lib/commands';
import { CommandPalette } from './components/CommandPalette';
import { HeaderMenu, HeaderMenuItem } from './components/HeaderMenu';
import {
  IconArrowDown,
  IconArrowUp,
  IconBackspace,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSun,
} from './components/Icons';
import {
  resolveAppKeyCommand,
  shouldConsumePaletteShortcut,
  shouldConsumeTaskCaptureShortcut,
  shouldCloseStepPanel,
  shouldLeaveProjectPage,
} from './lib/appKeyboard';
import { modalRegistry } from './lib/modalRegistry';
import {
  closeTaskCapture,
  requestTaskCaptureForCommand,
  type TaskCaptureHostState,
} from './lib/taskCapture';
import {
  type Theme,
  resolveTheme,
  readStoredTheme,
  systemPrefersDark,
  applyTheme,
} from './lib/theme';

// Header toggle cycles System → Light → Dark → System.
const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

// The nav, in the order the number keys select them (see lib/appKeyboard).
//
// Two destinations, not three. Timeline was a full global destination for a
// presentation of goal dates people opened weekly, sitting at the same weight
// as the surfaces they work in daily; it is a view mode inside Goals now.
const NAV_TABS = [
  ['today', VIEW_LABELS.today],
  ['plan', VIEW_LABELS.plan],
  ['goals', VIEW_LABELS.goals],
] as const;

export function App() {
  const { view, toast, pendingUndo, goals, tasks, habits, hydration, secondTab, persistFailed, theme, openStepId, actions } = useAppStore();
  useLocalDate(hydration === 'ready' ? actions.ensureWeekRollover : undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sysDark, setSysDark] = useState(() => systemPrefersDark());
  const [taskCapture, setTaskCapture] = useState<TaskCaptureHostState>({
    open: false,
    focusRequest: 0,
  });
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Held between "a file was picked" and "the user typed REPLACE". The File is
  // captured here, so the input can be reset immediately and stay re-pickable.
  const [pendingImport, setPendingImport] = useState<File | null>(null);

  const reclaimSpace = () => {
    void actions.reclaimSpace()
      .then((result) => {
        if ('deferred' in result) {
          actions.showToast('Reclaim deferred — try again after the Undo window expires');
          return;
        }
        const { count, bytes } = result;
        actions.showToast(`Reclaimed ${count} asset${count === 1 ? '' : 's'} (${bytes} bytes freed)`);
      })
      .catch(() => actions.showToast('Could not reclaim space.'));
  };

  const openTaskCapture = () => setTaskCapture((current) => requestTaskCaptureForCommand(
    current,
    hydration,
    modalRegistry.hasOpenModal(),
  ));

  useEffect(() => {
    initStore();
  }, []);

  // Live-follow the OS theme: keep the effective-icon in sync, and when the
  // preference is `system` re-apply so the palette flips without a reload.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      setSysDark(e.matches);
      if (readStoredTheme() === 'system') applyTheme(resolveTheme('system', e.matches));
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const effectiveTheme = resolveTheme(theme, sysDark);
  const isNavItemActive = (key: (typeof NAV_TABS)[number][0]): boolean =>
    view === key || (view === 'project' && key === 'goals');

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      // Both chords are claimed by the browser (⌘N new window, Ctrl+K address
      // bar), so they need suppressing before anything else looks at them.
      if (shouldConsumeTaskCaptureShortcut(e) || shouldConsumePaletteShortcut(e)) {
        e.preventDefault();
      }
      const command = resolveAppKeyCommand(e);
      // While the cheat sheet is up it owns the keyboard: ? or Esc dismiss it,
      // everything else is swallowed so nothing fires behind the overlay.
      if (showShortcuts) {
        if (command === 'toggle-shortcuts' || command === 'close-drawer') {
          setShowShortcuts(false);
        }
        return;
      }
      if (command === 'toggle-shortcuts') {
        setShowShortcuts(true);
        return;
      }
      // Search is reachable from every surface, including over an open drawer —
      // that is the whole point of a palette.
      if (command === 'open-palette') {
        if (hydration === 'ready') setPaletteOpen((was) => !was);
        return;
      }
      if (command === 'undo') {
        actions.undoLastDelete();
        return;
      }
      if (command === 'capture-task') {
        openTaskCapture();
        return;
      }
      if (command === 'blur-target') {
        (e.target as HTMLElement).blur();
        return;
      }
      // Escape precedence: open modal -> step panel -> project page.
      if (shouldCloseStepPanel(command, view, modalRegistry.hasOpenModal(), openStepId !== null)) {
        actions.closeStep();
        return;
      }
      // Escape on the project page goes back to the board. `close-drawer` is
      // the command's historical name; the drawer it referred to is gone.
      if (shouldLeaveProjectPage(command, view, modalRegistry.hasOpenModal(), openStepId !== null)) actions.closeProject();
      // View/navigation shortcuts must not fire underneath an open dialog — inside
      // a dialog, 1–7 mean "plan this step on that weekday", not "switch view".
      if (modalRegistry.hasOpenModal()) return;
      if (command === 'view-today') actions.setView('today');
      if (command === 'view-plan') actions.setView('plan');
      if (command === 'view-goals') actions.setView('goals');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, hydration, openStepId, showShortcuts, view]);


  /**
   * The palette's verbs, resolved against the app shell.
   *
   * They live here rather than in the palette because most of them are things
   * only App can do — open the file picker, raise the cheat sheet, cycle the
   * theme — and because the registry that names them (`lib/commands.ts`) has to
   * stay free of the store to be testable.
   */
  function runPaletteCommand(id: string): void {
    switch (id) {
      case 'add-task': openTaskCapture(); return;
      case 'new-goal': actions.setGoalModal('new'); return;
      case 'import-goal': actions.setGoalModal('import'); return;
      case 'nav-today': actions.setView('today'); return;
      case 'nav-plan': actions.setView('plan'); return;
      case 'nav-goals': actions.setGoalsMode('board'); actions.setView('goals'); return;
      case 'nav-timeline': actions.setGoalsMode('timeline'); actions.setView('goals'); return;
      case 'theme': actions.setTheme(NEXT_THEME[theme]); return;
      case 'shortcuts': setShowShortcuts(true); return;
      case 'export': void actions.exportBackup(); return;
      case 'import': fileInputRef.current?.click(); return;
      case 'reclaim': reclaimSpace(); return;
    }
  }

  /**
   * A verb applied to something the palette found.
   *
   * Search used to be navigation-only: every result opened a location and left
   * the user to find the control. `aimMin: 0` on the two scheduling verbs means
   * "the earliest gap that fits", the same rule `replanNode` uses — the palette
   * is not the place to choose an hour, and the store refuses with a toast when
   * the day has no room.
   */
  function runObjectAction(entry: SearchEntry, action: ObjectActionId): void {
    const isNode = entry.kind === 'step' && entry.goalId !== null && entry.nodeId !== undefined;
    const day = action === 'schedule-tomorrow' ? addDays(todayStr(), 1) : todayStr();

    switch (action) {
      case 'open':
        if (entry.kind === 'project' && entry.goalId) actions.openProject(entry.goalId);
        else if (isNode) actions.openProject(entry.goalId!, entry.nodeId);
        else actions.revealInPlan(entry.kind === 'habit' ? 'habit' : 'task', entry.id);
        return;
      case 'complete':
      case 'reopen':
        if (isNode) actions.toggleLeaf(entry.nodeId!);
        else if (entry.kind === 'task') actions.toggleTask(entry.id);
        return;
      case 'schedule-today':
      case 'schedule-tomorrow':
        if (isNode) actions.scheduleNode(entry.goalId!, entry.nodeId!, day, 0);
        else if (entry.kind === 'task') actions.scheduleTask(entry.id, day, 0);
        return;
      case 'unschedule':
        if (isNode) actions.unscheduleNode(entry.goalId!, entry.nodeId!);
        else if (entry.kind === 'task') actions.unscheduleTask(entry.id);
        return;
    }
  }

  return (
    <>
      {/* Top bar. Every flex child is min-w-0 so nothing can force the document
          wider than the viewport — that overflow is what broke mobile.

          `overflow-x-clip`, NOT `overflow-hidden`. The guard only ever needed
          the horizontal axis, but `overflow: hidden` cannot apply to one axis
          alone: per CSS, a non-`visible` value on one axis computes the other
          from `visible` to `auto`, making the header a scroll container
          vertically too. That clipped the ⋯ menu — which is absolutely
          positioned below the bar — to a ~7px sliver, and since the inline
          utility cluster is `hidden lg:flex` and neither has a shortcut, Export
          and Import backup had NO reachable entry point at all under 1024px.
          `clip` is the one overflow value that does not infect the other axis,
          so the horizontal protection stays and the menu escapes. */}
      <header className="sticky top-0 z-30 bg-bg border-b border-line flex items-center gap-[12px] lg:gap-[30px] px-[16px] sm:px-[36px] py-[13px] overflow-x-clip">
        <div className="flex items-baseline gap-[10px] flex-none">
          <span className="font-disp text-wordmark font-[650] tracking-[-0.01em]">
            Phase<span className="text-accent">.</span>
          </span>
        </div>
        {/* Primary nav. Below md it moves to the bottom bar for thumb reach. */}
        <nav aria-label="Views" className="hidden md:flex gap-[4px] min-w-0">
          {NAV_TABS.map(([key, label], i) => {
            const active = isNavItemActive(key);
            return (
              <button
                key={key}
                onClick={() => actions.setView(key)}
                aria-current={active ? 'page' : undefined}
                title={`${label} (${i + 1})`}
                className={`px-[14px] py-[6px] rounded-full text-body whitespace-nowrap ${
                  active
                    ? 'bg-ink text-paper font-semibold'
                    : 'text-ink-soft font-medium hover:bg-hover-deep'
                }`}
              >
                {label}
              </button>
            );
          })}
        </nav>
        <div className="flex-1 min-w-0" />

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          disabled={hydration !== 'ready'}
          aria-label="Search (⌘K)"
          title="Search (⌘K)"
          className="flex-none flex items-center gap-[7px] rounded-field border border-line-2 text-muted text-ui px-[9px] sm:pl-[10px] sm:pr-[8px] py-[6px] hover:text-ink hover:border-muted disabled:opacity-40 disabled:pointer-events-none"
        >
          <IconSearch />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden sm:inline font-mono text-kbd tracking-[.04em] border border-line-2 rounded-[4px] px-[4px] py-[1px]">⌘K</kbd>
        </button>

        <button
          type="button"
          onClick={openTaskCapture}
          disabled={hydration !== 'ready'}
          aria-label="Add a task (⌘N)"
          title="Add a task (⌘N)"
          className="flex-none flex items-center gap-[7px] rounded-field bg-ink text-paper text-ui font-semibold px-[9px] sm:pl-[12px] sm:pr-[10px] py-[6px] hover:bg-ink-hover disabled:opacity-40 disabled:pointer-events-none"
        >
          <IconPlus />
          <span className="hidden sm:inline">Add</span>
          <kbd className="hidden sm:inline font-mono text-kbd tracking-[.04em] text-paper/70 border border-paper/25 rounded-[4px] px-[4px] py-[1px]">⌘N</kbd>
        </button>

        <HeaderMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <HeaderMenuItem onClick={() => actions.setTheme(NEXT_THEME[theme])}>
            {effectiveTheme === 'dark' ? <IconMoon /> : <IconSun />}
            Theme: {THEME_LABEL[theme]}
          </HeaderMenuItem>
          <HeaderMenuItem onClick={() => setShowShortcuts(true)}>
            {/* Stays a character: `?` is ASCII, it is in the font, and it is the
                literal key you press. The 14px box keeps it in the icon gutter. */}
            <span aria-hidden="true" className="w-[14px] text-center">?</span>
            Keyboard shortcuts
          </HeaderMenuItem>
          <HeaderMenuItem onClick={() => actions.exportBackup()} disabled={hydration !== 'ready'}>
            <IconArrowDown />
            Export backup
          </HeaderMenuItem>
          <HeaderMenuItem onClick={reclaimSpace} disabled={hydration !== 'ready'}>
            <IconBackspace />
            Reclaim space
          </HeaderMenuItem>
          <HeaderMenuItem onClick={() => fileInputRef.current?.click()} disabled={hydration !== 'ready'}>
            <IconArrowUp />
            Import backup
          </HeaderMenuItem>
        </HeaderMenu>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Reset unconditionally, and BEFORE the modal resolves: picking the
            // same file twice must fire `change` again, and the File object is
            // already captured in state by then.
            e.target.value = '';
            if (f) setPendingImport(f);
          }}
        />
      </header>

      {/* The banner has to state the consequence, not just the situation.
          Writes from this tab are now blocked (see setAndPersist) rather than
          allowed to rewrite the whole database from a stale snapshot, so what
          the user needs to know is that anything typed here is not being kept. */}
      {secondTab && (
        <div role="alert" className="bg-warn-tint text-warn text-ui px-[16px] sm:px-[36px] py-[7px] border-b border-line">
          Phase is open in another tab, which owns your data. <strong className="font-semibold">Changes made
          here are not saved</strong> — switch to the other tab, or close it and reload this one.
        </div>
      )}

      {/* A failed write is the one condition that can silently cost a whole
          session, so it latches here rather than passing through as a toast.
          Export is offered inline because that is the only recovery, and the
          toast that used to say so was gone in 1.9 seconds. */}
      {persistFailed && (
        <div
          role="alert"
          className="bg-warn-tint text-warn text-ui px-[16px] sm:px-[36px] py-[7px] border-b border-line flex flex-wrap items-center gap-x-[8px] gap-y-[2px]"
        >
          <span>
            Phase couldn’t save to this device. Your work is here but only in this tab — closing it loses
            everything since the last successful save.
          </span>
          <button
            type="button"
            onClick={() => actions.exportBackup()}
            disabled={hydration !== 'ready'}
            className="font-semibold underline hover:no-underline min-h-[24px] inline-flex items-center"
          >
            Export a backup
          </button>
        </div>
      )}

      {/* Main */}
      {/* Bottom padding clears the mobile tab bar; it is absent from md up. */}
      <main className="flex-1 min-w-0 pb-[60px] md:pb-0">
        {hydration === 'error' ? (
          <div className="max-w-[520px] mx-auto mt-[80px] px-[24px] text-center">
            <div className="font-disp text-h1 font-semibold mb-[10px]">
              Phase can’t reach its local database
            </div>
            <p className="text-lead text-muted leading-[1.6] mb-[18px]">
              Your data lives in this browser’s storage (IndexedDB) and nothing has been
              deleted — but it can’t be opened right now. This usually means private
              browsing, blocked site data, or a full disk.
            </p>
            <button
              className="text-body font-semibold text-paper bg-ink px-[14px] py-[8px] rounded-field hover:bg-ink-hover"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        ) : hydration === 'loading' ? (
          // A slow IndexedDB open used to render a blank page under a populated
          // header, which reads as breakage rather than as waiting.
          <div role="status" className="max-w-[420px] mx-auto mt-[100px] px-[24px] text-center">
            <div className="text-lead text-muted">Opening your local database…</div>
          </div>
        ) : view === 'today' ? (
          <div className="w-full px-[16px] sm:px-[36px] py-[28px]">
            <Today />
          </div>
        ) : view === 'plan' ? (
          <div className="w-full px-[16px] sm:px-[36px] py-[24px]">
            <Plan />
          </div>
        ) : view === 'project' ? (
          <div className="w-full px-[16px] sm:px-[36px] py-[28px] pb-[90px]">
            <Project />
          </div>
        ) : (
          // Full-bleed on purpose: Goals owns its own measure, because the
          // timeline it now contains needs the whole viewport to scroll a
          // semester across, and the board does not.
          <div className="w-full px-[16px] sm:px-[36px] py-[42px] pb-[90px]">
            <Goals />
          </div>
        )}
      </main>

      {/* Bottom tab bar — the primary nav below md, where the header row could
          not fit without pushing the document wider than the viewport. */}
      <nav
        aria-label="Views"
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-bg border-t border-line flex"
      >
        {NAV_TABS.map(([key, label]) => {
          const active = isNavItemActive(key);
          return (
            <button
              key={key}
              onClick={() => actions.setView(key)}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 min-w-0 py-[10px] text-compact truncate ${
                active ? 'text-ink font-semibold' : 'text-muted font-medium'
              }`}
            >
              {label}
              <span
                aria-hidden="true"
                className={`block mx-auto mt-[4px] h-[2px] w-[18px] rounded-full ${
                  active ? 'bg-accent' : 'bg-transparent'
                }`}
              />
            </button>
          );
        })}
      </nav>

      <QuickAdd
        open={taskCapture.open}
        focusRequest={taskCapture.focusRequest}
        enabled={hydration === 'ready'}
        onClose={() => setTaskCapture((current) => closeTaskCapture(current))}
      />
      <ConfirmImportModal
        open={pendingImport !== null}
        fileName={pendingImport?.name ?? ''}
        onCancel={() => setPendingImport(null)}
        onConfirm={() => {
          if (pendingImport) actions.importBackup(pendingImport);
          setPendingImport(null);
        }}
      />
      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        goals={goals}
        tasks={tasks}
        habits={habits}
        onCommand={runPaletteCommand}
        onObjectAction={runObjectAction}
      />

      {/* Undo toast */}
      <div
        role="status"
        aria-live="polite"
        className={`fixed bottom-[20px] left-1/2 -translate-x-1/2 bg-ink text-paper px-[16px] py-[9px] rounded-field text-body z-[60] transition-all duration-[220ms] flex items-center gap-[12px] whitespace-nowrap ${
          pendingUndo
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-[20px] pointer-events-none'
        }`}
      >
        <span>{pendingUndo?.label}</span>
        <button
          className="font-semibold underline hover:no-underline min-h-[24px] px-[4px] inline-flex items-center focus-visible:outline-paper focus-visible:outline-offset-2 focus-visible:rounded-[4px]"
          onClick={() => actions.undoLastDelete()}
          tabIndex={pendingUndo ? 0 : -1}
        >
          Undo
        </button>
      </div>

      {/* Toast.
          Sits above the undo toast whenever one is armed, instead of on top of
          it. Both are bottom-centred at the same z-index, so a refusal raised
          inside the 5s undo window (delete a task, then try to schedule
          something that doesn't fit) rendered the two messages superimposed and
          neither was legible. `bottom` is part of the existing `transition-all`,
          so it slides rather than jumps when the undo toast retires. */}
      <div
        role="status"
        aria-live="polite"
        className={`fixed left-1/2 -translate-x-1/2 bg-ink text-paper px-[16px] py-[9px] rounded-field text-body z-[60] transition-all duration-[220ms] ${
          pendingUndo ? 'bottom-[68px]' : 'bottom-[20px]'
        } ${
          toast
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-[20px] pointer-events-none'
        }`}
      >
        {toast}
      </div>
    </>
  );
}
