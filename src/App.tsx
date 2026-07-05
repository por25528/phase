import { useEffect, useRef, useState } from 'react';
import { useAppStore, initStore } from './state/store';
import type { Goal } from './db/types';
import { Today } from './views/Today';
import { Goals } from './views/Goals';
import { Timeline } from './views/Timeline';
import { GoalTree } from './components/GoalTree';
import { ProgressBar } from './components/ProgressBar';
import { InlineEdit } from './components/InlineEdit';
import { firstOpenLeaf } from './lib/tree';
import { goalPct } from './lib/pct';
import { expectedPct, behindPaceBy } from './lib/timeline';
import { todayStr, daysLeftLabel } from './lib/dates';
import { minutesThisWeek, fmtMinutes } from './lib/sessions';

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
  const { sessions } = useAppStore();
  const addRootRef = useRef<HTMLInputElement>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const pct = Math.round(goalPct(g));
  const expected = Math.round(expectedPct(g.start, g.deadline, todayStr()));
  const behind = Math.round(behindPaceBy(pct, g.start, g.deadline, todayStr()));
  const weekMins = minutesThisWeek(sessions, todayStr(), g.id);
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
        {behind > 0
          ? `${behind} pts behind pace · expected ${expected}% by today`
          : `on pace · expected ${expected}% by today`}
      </div>
      {weekMins > 0 && (
        <div className="text-[.74rem] text-muted mt-[2px] tabular-nums">
          {fmtMinutes(weekMins)} logged this week
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

export function App() {
  const { view, openGoalId, toast, pendingUndo, goals, hydration, secondTab, actions } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    initStore();
  }, []);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) {
        if (e.key === 'Escape') el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { actions.closeDrawer(); return; }
      if (e.key === '1') actions.setView('today');
      if (e.key === '2') actions.setView('goals');
      if (e.key === '3') actions.setView('timeline');
      if (e.key === 't') { actions.setView('today'); actions.goToToday(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);

  useEffect(() => {
    if (openGoalId) closeBtnRef.current?.focus();
  }, [openGoalId]);

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
        <nav className="flex gap-[4px]" title="Keyboard: 1–3 switch views · T jumps to today · Esc closes">
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
        <div className="flex gap-[16px] font-mono text-[.72rem] tracking-[.06em] text-muted">
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

      {/* Drawer scrim */}
      <div
        className={`fixed inset-0 bg-[rgba(20,20,18,0.18)] z-40 transition-opacity duration-[180ms] ${
          openGoalId ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => actions.closeDrawer()}
      />

      {/* Drawer */}
      <aside
        className={`fixed top-0 right-0 h-screen w-[420px] max-w-[90vw] bg-panel border-l border-line-2 z-50 overflow-y-auto px-[26px] pt-[28px] pb-[60px] transition-transform duration-[200ms] ease-in-out ${
          openGoalId ? 'translate-x-0' : 'translate-x-full'
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
          {openGoal && <DrawerBody goal={openGoal} actions={actions} />}
        </div>
      </aside>

      {/* Undo toast */}
      <div
        role="status"
        aria-live="polite"
        className={`fixed bottom-[20px] left-1/2 -translate-x-1/2 bg-ink text-white px-[16px] py-[9px] rounded-[8px] text-[.84rem] z-[60] transition-all duration-[220ms] flex items-center gap-[12px] whitespace-nowrap ${
          pendingUndo
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-[20px] pointer-events-none'
        }`}
      >
        <span>{pendingUndo?.label}</span>
        <button
          className="font-semibold underline hover:no-underline focus-visible:outline-white focus-visible:outline-offset-2 focus-visible:rounded-[2px]"
          onClick={() => actions.undoLastDelete()}
          tabIndex={pendingUndo ? 0 : -1}
        >
          Undo
        </button>
      </div>

      {/* Toast */}
      <div
        className={`fixed bottom-[20px] left-1/2 -translate-x-1/2 bg-ink text-white px-[16px] py-[9px] rounded-[8px] text-[.84rem] z-[60] transition-all duration-[220ms] ${
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
