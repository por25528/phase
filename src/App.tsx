import { useEffect, useRef } from 'react';
import { useAppStore, initStore } from './state/store';
import { Today } from './views/Today';
import { Goals } from './views/Goals';
import { Timeline } from './views/Timeline';
import { IconSun, IconTarget, IconBars } from './components/Icons';

export function App() {
  const { view, openGoalId, toast, goals, actions } = useAppStore();
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
          {openGoal && (
            <>
              <div className="font-disp text-[1.3rem] font-semibold tracking-[-0.01em]">
                {openGoal.title}
              </div>
              <div className="text-[.78rem] text-muted mt-[4px] mb-[14px]">
                Goal details coming in Timeline round.
              </div>
            </>
          )}
        </div>
      </aside>

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
