import { useEffect, useRef, useState } from 'react';
import { useAppStore, initStore, VIEW_LABELS } from './state/store';
import { Goals } from './views/Goals';
import { Timeline } from './views/Timeline';
import { Plan } from './views/Plan';
import { Project } from './views/Project';
import { TaskCaptureModal } from './components/TaskCaptureModal';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { useLocalDate } from './hooks/useLocalDate';
import { CommandPalette } from './components/CommandPalette';
import { HeaderMenu, HeaderMenuItem } from './components/HeaderMenu';
import {
  resolveAppKeyCommand,
  shouldConsumePaletteShortcut,
  shouldConsumeTaskCaptureShortcut,
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
const THEME_LABEL: Record<Theme, string> = { system: 'SYSTEM', light: 'LIGHT', dark: 'DARK' };

// The nav, in the order the number keys 1–3 select them (see lib/appKeyboard).
// The board is labelled "Projects" because every string on it says project.
const NAV_TABS = [
  ['plan', VIEW_LABELS.plan],
  ['goals', VIEW_LABELS.goals],
  ['timeline', VIEW_LABELS.timeline],
] as const;

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function App() {
  const { view, toast, pendingUndo, goals, tasks, habits, hydration, secondTab, persistFailed, theme, actions } = useAppStore();
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
      // Escape on the project page goes back to the board. `close-drawer` is
      // the command's historical name; the drawer it referred to is gone.
      if (shouldLeaveProjectPage(command, view, modalRegistry.hasOpenModal())) actions.closeProject();
      // View/navigation shortcuts must not fire underneath an open dialog — inside
      // a dialog, 1–7 mean "plan this step on that weekday", not "switch view".
      if (modalRegistry.hasOpenModal()) return;
      if (command === 'view-plan') actions.setView('plan');
      if (command === 'view-goals') actions.setView('goals');
      if (command === 'view-timeline') actions.setView('timeline');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, hydration, showShortcuts, view]);

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
          <span aria-hidden="true">⌕</span>
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
          <span aria-hidden="true">＋</span>
          <span className="hidden sm:inline">Task</span>
          <kbd className="hidden sm:inline font-mono text-kbd tracking-[.04em] text-paper/70 border border-paper/25 rounded-[4px] px-[4px] py-[1px]">⌘N</kbd>
        </button>

        {/* Utilities: inline on wide screens, folded into ⋯ below lg. */}
        <div className="hidden lg:flex items-center gap-[16px] font-mono text-meta tracking-[.06em] text-muted flex-none">
          <button
            type="button"
            onClick={() => setShowShortcuts(true)}
            aria-label="Keyboard shortcuts (?)"
            title="Keyboard shortcuts (?)"
            className="w-[24px] h-[24px] grid place-items-center rounded-full border border-line-2 text-compact hover:text-ink hover:border-muted"
          >
            ?
          </button>
          <button
            onClick={() => actions.setTheme(NEXT_THEME[theme])}
            aria-label={`Theme: ${THEME_LABEL[theme]}${theme === 'system' ? ` (${effectiveTheme})` : ''} — switch to ${THEME_LABEL[NEXT_THEME[theme]]}`}
            title={`Theme: ${THEME_LABEL[theme]}`}
            className="flex items-center gap-[6px] min-h-[24px] px-[2px] rounded-[6px] hover:text-ink"
          >
            {effectiveTheme === 'dark' ? <MoonIcon /> : <SunIcon />}
            <span>{THEME_LABEL[theme]}</span>
          </button>
          <button onClick={() => actions.exportBackup()} disabled={hydration !== 'ready'} className="inline-flex items-center min-h-[24px] px-[2px] rounded-[6px] hover:text-ink disabled:opacity-40 disabled:pointer-events-none">↓ EXPORT</button>
          <button onClick={() => fileInputRef.current?.click()} disabled={hydration !== 'ready'} className="inline-flex items-center min-h-[24px] px-[2px] rounded-[6px] hover:text-ink disabled:opacity-40 disabled:pointer-events-none">↑ IMPORT</button>
        </div>

        <HeaderMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <HeaderMenuItem onClick={() => actions.setTheme(NEXT_THEME[theme])}>
            {effectiveTheme === 'dark' ? <MoonIcon /> : <SunIcon />}
            Theme: {THEME_LABEL[theme]}
          </HeaderMenuItem>
          <HeaderMenuItem onClick={() => setShowShortcuts(true)}>
            <span aria-hidden="true" className="w-[14px] text-center">?</span>
            Keyboard shortcuts
          </HeaderMenuItem>
          <HeaderMenuItem onClick={() => actions.exportBackup()} disabled={hydration !== 'ready'}>
            <span aria-hidden="true" className="w-[14px] text-center">↓</span>
            Export backup
          </HeaderMenuItem>
          <HeaderMenuItem onClick={() => fileInputRef.current?.click()} disabled={hydration !== 'ready'}>
            <span aria-hidden="true" className="w-[14px] text-center">↑</span>
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
            if (f && window.confirm('Importing a backup replaces everything currently in Phase. Continue?')) {
              actions.importBackup(f);
            }
            e.target.value = '';
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
        ) : view === 'plan' ? (
          <div className="w-full px-[16px] sm:px-[36px] py-[24px]">
            <Plan />
          </div>
        ) : view === 'timeline' ? (
          <div className="w-full px-[16px] sm:px-[36px] py-[32px]">
            <Timeline />
          </div>
        ) : view === 'project' ? (
          <div className="w-full px-[16px] sm:px-[36px] py-[28px] pb-[90px]">
            <Project />
          </div>
        ) : (
          <div className="max-w-[1280px] mx-auto px-[16px] sm:px-[36px] py-[42px] pb-[90px]">
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

      <TaskCaptureModal
        open={taskCapture.open}
        focusRequest={taskCapture.focusRequest}
        enabled={hydration === 'ready'}
        onClose={() => setTaskCapture((current) => closeTaskCapture(current))}
      />
      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        goals={goals}
        tasks={tasks}
        habits={habits}
        onOpenGoal={actions.openProject}
        onSetView={actions.setView}
        onReveal={actions.revealInPlan}
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
