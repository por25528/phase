import { useEffect, useRef, useState } from 'react';
import { useAppStore, initStore } from './state/store';
import { Today } from './views/Today';
import { Goals } from './views/Goals';
import { Timeline } from './views/Timeline';
import { GoalDrawer } from './components/GoalDrawer';
import { TaskCaptureModal } from './components/TaskCaptureModal';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { useLocalDate } from './hooks/useLocalDate';
import {
  resolveAppKeyCommand,
  shouldConsumeTaskCaptureShortcut,
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
  const { view, openGoalId, drawerFocusNodeId, toast, pendingUndo, goals, hydration, secondTab, theme, actions } = useAppStore();
  useLocalDate(hydration === 'ready' ? actions.ensureWeekRollover : undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sysDark, setSysDark] = useState(() => systemPrefersDark());
  const [taskCapture, setTaskCapture] = useState<TaskCaptureHostState>({
    open: false,
    focusRequest: 0,
  });
  const [showShortcuts, setShowShortcuts] = useState(false);

  const openTaskCapture = () => setTaskCapture((current) => requestTaskCaptureForCommand(
    current,
    hydration,
    modalRegistry.hasOpenModal(),
    openGoalId !== null,
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

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (shouldConsumeTaskCaptureShortcut(e)) e.preventDefault();
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
      if (command === 'capture-task') {
        openTaskCapture();
        return;
      }
      if (command === 'blur-target') {
        (e.target as HTMLElement).blur();
        return;
      }
      if (command === 'close-drawer') actions.closeDrawer();
      if (command === 'view-today') actions.setView('today');
      if (command === 'view-goals') actions.setView('goals');
      if (command === 'view-timeline') actions.setView('timeline');
      if (command === 'go-today') {
        actions.setView('today');
        actions.goToToday();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, hydration, openGoalId, showShortcuts]);

  const openGoal = openGoalId ? goals.find((g) => g.id === openGoalId) : null;

  return (
    <>
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-bg border-b border-line flex items-center gap-[30px] px-[16px] sm:px-[36px] py-[13px]">
        <div className="flex items-baseline gap-[10px]">
          <span className="font-disp text-[1.5rem] font-[650] tracking-[-0.01em]">
            Phase<span className="text-accent">.</span>
          </span>
        </div>
        <nav className="flex gap-[4px]" title="Keyboard: 1–3 switch views · T today · ⌘N add task · ? shortcuts · Esc closes">
          {(
            [
              ['today', 'Today'],
              ['goals', 'Goals'],
              ['timeline', 'Timeline'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => actions.setView(key)}
              aria-current={view === key ? 'page' : undefined}
              className={`px-[14px] py-[6px] rounded-full text-[.86rem] ${
                view === key
                  ? 'bg-ink text-paper font-semibold'
                  : 'text-ink-soft font-medium hover:bg-hover-deep'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <button
          type="button"
          onClick={openTaskCapture}
          disabled={hydration !== 'ready'}
          title="Add a task (⌘N)"
          className="flex items-center gap-[7px] rounded-field bg-ink text-paper text-[.8rem] font-semibold pl-[12px] pr-[10px] py-[6px] hover:bg-ink-hover disabled:opacity-40 disabled:pointer-events-none"
        >
          <span aria-hidden="true">＋</span>
          Task
          <kbd className="font-mono text-[.62rem] tracking-[.04em] text-paper/70 border border-paper/25 rounded-[4px] px-[4px] py-[1px]">⌘N</kbd>
        </button>
        <div className="flex items-center gap-[16px] font-mono text-[.72rem] tracking-[.06em] text-muted">
          <button
            type="button"
            onClick={() => setShowShortcuts(true)}
            aria-label="Keyboard shortcuts (?)"
            title="Keyboard shortcuts (?)"
            className="w-[24px] h-[24px] grid place-items-center rounded-full border border-line-2 text-[.78rem] hover:text-ink hover:border-muted"
          >
            ?
          </button>
          <button
            onClick={() => actions.setTheme(NEXT_THEME[theme])}
            aria-label={`Theme: ${THEME_LABEL[theme]}${theme === 'system' ? ` (${effectiveTheme})` : ''} — switch to ${THEME_LABEL[NEXT_THEME[theme]]}`}
            title={`Theme: ${THEME_LABEL[theme]}`}
            className="flex items-center gap-[6px] hover:text-ink"
          >
            {effectiveTheme === 'dark' ? <MoonIcon /> : <SunIcon />}
            <span className="hidden sm:inline">{THEME_LABEL[theme]}</span>
          </button>
          <button onClick={() => actions.exportBackup()} disabled={hydration !== 'ready'} className="hover:text-ink disabled:opacity-40 disabled:pointer-events-none">↓ EXPORT</button>
          <button onClick={() => fileInputRef.current?.click()} disabled={hydration !== 'ready'} className="hover:text-ink disabled:opacity-40 disabled:pointer-events-none">↑ IMPORT</button>
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
        </div>
      </header>

      {secondTab && (
        <div className="bg-warn-tint text-warn text-[.8rem] px-[16px] sm:px-[36px] py-[7px] border-b border-line">
          Phase is already open in another tab. Edits from two tabs overwrite each other — keep just one open.
        </div>
      )}

      {/* Main */}
      <main className="flex-1 min-w-0">
        {hydration === 'error' ? (
          <div className="max-w-[520px] mx-auto mt-[80px] px-[24px] text-center">
            <div className="font-disp text-[1.3rem] font-semibold mb-[10px]">
              Phase can’t reach its local database
            </div>
            <p className="text-[.9rem] text-muted leading-[1.6] mb-[18px]">
              Your data lives in this browser’s storage (IndexedDB) and nothing has been
              deleted — but it can’t be opened right now. This usually means private
              browsing, blocked site data, or a full disk.
            </p>
            <button
              className="text-[.84rem] font-semibold text-paper bg-ink px-[14px] py-[8px] rounded-field hover:bg-ink-hover"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        ) : hydration === 'loading' ? null : view === 'today' ? (
          <div className="max-w-[1280px] mx-auto px-[16px] sm:px-[36px] pb-[40px]">
            <Today />
          </div>
        ) : view === 'timeline' ? (
          <div className="w-full px-[16px] sm:px-[36px] py-[32px]">
            <Timeline />
          </div>
        ) : (
          <div className="max-w-[1280px] mx-auto px-[16px] sm:px-[36px] py-[42px] pb-[90px]">
            <Goals />
          </div>
        )}
      </main>

      <GoalDrawer goal={openGoal ?? null} actions={actions} focusNodeId={drawerFocusNodeId} />
      <TaskCaptureModal
        open={taskCapture.open}
        focusRequest={taskCapture.focusRequest}
        enabled={hydration === 'ready'}
        onClose={() => setTaskCapture((current) => closeTaskCapture(current))}
      />
      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* Undo toast */}
      <div
        role="status"
        aria-live="polite"
        className={`fixed bottom-[20px] left-1/2 -translate-x-1/2 bg-ink text-paper px-[16px] py-[9px] rounded-[8px] text-[.84rem] z-[60] transition-all duration-[220ms] flex items-center gap-[12px] whitespace-nowrap ${
          pendingUndo
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-[20px] pointer-events-none'
        }`}
      >
        <span>{pendingUndo?.label}</span>
        <button
          className="font-semibold underline hover:no-underline focus-visible:outline-paper focus-visible:outline-offset-2 focus-visible:rounded-[2px]"
          onClick={() => actions.undoLastDelete()}
          tabIndex={pendingUndo ? 0 : -1}
        >
          Undo
        </button>
      </div>

      {/* Toast */}
      <div
        role="status"
        aria-live="polite"
        className={`fixed bottom-[20px] left-1/2 -translate-x-1/2 bg-ink text-paper px-[16px] py-[9px] rounded-[8px] text-[.84rem] z-[60] transition-all duration-[220ms] ${
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
