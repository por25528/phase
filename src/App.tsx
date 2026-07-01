import { useEffect, useRef, useState } from 'react';
import { useAppStore, initStore } from './state/store';
import type { Goal } from './db/types';
import { Today } from './views/Today';
import { Goals } from './views/Goals';
import { Timeline } from './views/Timeline';
import { IconSun, IconTarget, IconBars } from './components/Icons';
import { GoalTree } from './components/GoalTree';
import { ProgressBar } from './components/ProgressBar';
import { goalPct } from './lib/pct';
import { fmtD } from './lib/dates';

function InlineEdit({
  value,
  className,
  onCommit,
  onCancel,
}: {
  value: string;
  className: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const escaped = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function commit() {
    const v = draft.trim();
    if (v) onCommit(v);
    else onCancel();
  }

  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      className={`${className} bg-transparent outline-none p-0 w-full min-w-0`}
      style={{ border: 'none', borderBottom: '1px solid #5D6B82' }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          escaped.current = false;
          commit();
        }
        if (e.key === 'Escape') {
          escaped.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!escaped.current) commit();
      }}
    />
  );
}

function DrawerBody({ goal: g, actions }: { goal: Goal; actions: ReturnType<typeof useAppStore>['actions'] }) {
  const addRootRef = useRef<HTMLInputElement>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const pct = Math.round(goalPct(g));
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
      <div className="text-[.78rem] text-muted mt-[4px] mb-[14px]">
        {fmtD(g.start)} → {fmtD(g.deadline)}
      </div>
      <div className="flex items-center gap-[11px]">
        <span className="font-disp text-[1.05rem] font-semibold tabular-nums min-w-[46px]">{pct}%</span>
        <ProgressBar pct={pct} />
      </div>
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
    </>
  );
}

export function App() {
  const { view, openGoalId, toast, pendingUndo, goals, actions } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    initStore();
  }, []);

  const openGoal = openGoalId ? goals.find((g) => g.id === openGoalId) : null;

  return (
    <>
      {/* Sidebar */}
      <aside
        className="w-[212px] flex-shrink-0 h-screen border-r border-line px-[14px] py-[22px] flex flex-col sticky top-0"
        style={{ maxWidth: '212px' }}
      >
        {/* Wordmark */}
        <div className="font-disp text-[1.32rem] font-semibold tracking-[-0.01em] px-[8px] pb-[2px]">
          Phase<em className="not-italic text-accent italic">.</em>
        </div>
        <div className="text-[.72rem] text-muted px-[8px] pb-[20px]">2026 · plan &amp; ship</div>

        {/* Nav */}
        <nav className="flex flex-col gap-[1px]">
          {(
            [
              ['today', 'Today', <IconSun key="sun" />],
              ['goals', 'Goals', <IconTarget key="target" />],
              ['timeline', 'Timeline', <IconBars key="bars" />],
            ] as const
          ).map(([key, label, icon]) => (
            <button
              key={key}
              onClick={() => actions.setView(key)}
              className={`flex items-center gap-[9px] w-full text-left px-[9px] py-[7px] rounded-[6px] text-[.9rem] font-[450] ${
                view === key
                  ? 'bg-accent-tint text-ink font-medium'
                  : 'text-ink-soft hover:bg-hover'
              }`}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {/* Footer IO */}
        <div className="mt-auto flex flex-col gap-[6px] pt-[14px] border-t border-line">
          <button
            onClick={() => actions.exportBackup()}
            className="text-[.78rem] text-muted px-[8px] py-[5px] rounded-[6px] text-left hover:bg-hover hover:text-ink-soft"
          >
            ↓ Export backup
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-[.78rem] text-muted px-[8px] py-[5px] rounded-[6px] text-left hover:bg-hover hover:text-ink-soft"
          >
            ↑ Import backup
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) actions.importBackup(f);
              e.target.value = '';
            }}
          />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 h-screen overflow-y-auto">
        <div className="max-w-[880px] mx-auto px-[40px] py-[42px] pb-[90px]">
          {view === 'today' && <Today />}
          {view === 'goals' && <Goals />}
          {view === 'timeline' && <Timeline />}
        </div>
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
