# Phase 2 — Calendar, Study Tracking & Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** `2026-07-02-phase-development-plan.md` (same folder) should land first — it finishes half-built features (timeline zoom, date editing, drag, pace, overdue rollover, store tests). This plan is independent of it except Task 9 there (store tests) must add `sessions` to its db mock once Task 3 here lands.

**Goal:** Add a month calendar view, a study-session log, per-goal notes + next-action surfacing, global keyboard shortcuts, and a usability/aesthetic polish pass — so one app tracks study, goals/sub-goals, the startup project, and habits.

**Architecture:** Same as Phase 1: pure tested helpers in `src/lib`, all mutations through `src/state/store.ts` actions → Dexie. Calendar is a 4th view; study sessions are a new Dexie table (schema v3). No new dependencies.

**Tech Stack:** React 19, TypeScript, Tailwind v3.4, Dexie 4, Vitest (node env).

## Global Constraints

- **Locked visual identity — never restyle:** bg `#FCFCFB`, ink `#1A1A1A`, ONE slate accent `#5D6B82` (only active nav / today-line & today-cell marker / deadline flags / goal tags / milestone ◆), graphite `#2C2C2A` fills, hairlines `#ECEBE7`, ~7px radius, NO drop shadows, Inter + Fraunces (`font-disp`), delete-hover `#b4453a`. Premium = interaction quality, not decoration.
- Habits/tasks/sessions NEVER move a goal % — `goalId` is context only. Milestones never enter `pct` roll-up.
- Dates are `'YYYY-MM-DD'` strings; months are `'YYYY-MM'`. Compare lexicographically.
- Pure logic → `src/lib` with TDD. UI verified manually in `npm run dev`. Keep keyboard a11y + `prefers-reduced-motion`.
- Destructive actions must `scheduleUndo`. Run `npm test` before every commit.

**Task order:** 1 → 2 (calendar); 3 (sessions); 4, 5, 6 independent after that.

---

### Task 1: Calendar month-grid helpers (pure lib, TDD)

**Files:**
- Create: `src/lib/calendar.ts`
- Test: `src/lib/calendar.test.ts`

**Interfaces:**
- Consumes: `parseD`, `pad`, `MO` from `./dates`.
- Produces: `ymOf(date: string): string` (`'2026-07-02'→'2026-07'`), `shiftYm(ym: string, n: number): string`, `ymLabel(ym: string): string` (`'2026-07'→'July 2026'`), `monthGrid(ym: string): string[][]` — Sunday-start weeks of ISO dates covering the month, padded with adjacent-month days.

- [ ] **Step 1: Write failing tests** — `src/lib/calendar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ymOf, shiftYm, ymLabel, monthGrid } from './calendar';

describe('ym helpers', () => {
  it('ymOf strips the day', () => expect(ymOf('2026-07-02')).toBe('2026-07'));
  it('shiftYm crosses year boundaries', () => {
    expect(shiftYm('2026-01', -1)).toBe('2025-12');
    expect(shiftYm('2026-12', 1)).toBe('2027-01');
    expect(shiftYm('2026-07', 0)).toBe('2026-07');
  });
  it('ymLabel is human month + year', () => expect(ymLabel('2026-07')).toBe('July 2026'));
});

describe('monthGrid', () => {
  it('July 2026 starts Sun Jun 28 and ends Sat Aug 1 (5 rows)', () => {
    const g = monthGrid('2026-07');
    expect(g).toHaveLength(5);
    expect(g[0][0]).toBe('2026-06-28');
    expect(g[0][3]).toBe('2026-07-01'); // Jul 1 2026 is a Wednesday
    expect(g[4][6]).toBe('2026-08-01');
    g.forEach(w => expect(w).toHaveLength(7));
  });
  it('Feb 2026 fits in 4 rows (Feb 1 is a Sunday, 28 days)', () => {
    const g = monthGrid('2026-02');
    expect(g).toHaveLength(4);
    expect(g[0][0]).toBe('2026-02-01');
    expect(g[3][6]).toBe('2026-02-28');
  });
});
```

- [ ] **Step 2: `npm test`** — new tests FAIL (module missing).
- [ ] **Step 3: Implement** — `src/lib/calendar.ts`:

```ts
import { pad, MO } from './dates';

const FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function ymOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftYm(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function ymLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${FULL[m - 1]} ${y}`;
}

export function monthGrid(ym: string): string[][] {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const cur = new Date(first);
  cur.setDate(cur.getDate() - cur.getDay()); // back to Sunday
  const last = new Date(y, m, 0);
  const weeks: string[][] = [];
  while (cur <= last) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}
```

(`MO` import only if used; drop it if the linter complains — `FULL` covers labels.)
- [ ] **Step 4: `npm test`** — ALL PASS. **Step 5: Commit** — `git commit -m "feat(calendar): pure month-grid helpers + tests"`

---

### Task 2: Calendar view

**Files:**
- Create: `src/views/Calendar.tsx`
- Modify: `src/state/store.ts` (`ViewName`), `src/App.tsx` (nav + view mount), `src/components/Icons.tsx`

**Interfaces:**
- Consumes: Task 1 helpers; `actions.setSelDate`, `actions.setView`, `actions.openDrawer`.
- Produces: `'calendar'` added to `ViewName`; clicking a day jumps to Today view for that date.

- [ ] **Step 1: Store.** `store.ts:15`: `export type ViewName = 'today' | 'goals' | 'timeline' | 'calendar';`
- [ ] **Step 2: Icon.** Append to `Icons.tsx` (match existing 15×15, stroke-current style of the other icons):

```tsx
export function IconCalendar() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="12" rx="2" />
      <path d="M1.5 6h13M5 1v3M11 1v3" />
    </svg>
  );
}
```

- [ ] **Step 3: View.** `src/views/Calendar.tsx`:

```tsx
import { useState } from 'react';
import { useAppStore } from '../state/store';
import { todayStr, fmtD } from '../lib/dates';
import { ymOf, shiftYm, ymLabel, monthGrid } from '../lib/calendar';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Calendar() {
  const { goals, tasks, habits, actions } = useAppStore();
  const today = todayStr();
  const [ym, setYm] = useState(ymOf(today));
  const weeks = monthGrid(ym);

  // date → items lookups (small data, recompute per render is fine)
  const deadlines = new Map<string, { id: string; title: string }[]>();
  const milestones = new Map<string, string[]>();
  goals.forEach(g => {
    deadlines.set(g.deadline, [...(deadlines.get(g.deadline) ?? []), { id: g.id, title: g.title }]);
    (g.milestones ?? []).forEach(m =>
      milestones.set(m.date, [...(milestones.get(m.date) ?? []), m.title]));
  });
  const tasksOn = (d: string) => tasks.filter(t => t.date === d);
  const habitHits = (d: string) => habits.filter(h => h.checkins.includes(d)).length;

  function openDay(d: string) {
    actions.setSelDate(d);
    actions.setView('today');
  }

  return (
    <div>
      <h1 className="font-disp text-[1.74rem] font-semibold tracking-[-0.015em] mb-[3px]">Calendar</h1>
      <p className="text-muted text-[.86rem] mb-[22px]">
        Deadlines, milestones, tasks and habit hits at a glance. Click a day to plan it.
      </p>

      {/* Month navigator */}
      <div className="flex items-center gap-[8px] mb-[10px]">
        <button type="button" onClick={() => setYm(shiftYm(ym, -1))} aria-label="Previous month"
          className="px-[9px] py-[4px] rounded-[6px] border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover">‹</button>
        <span className="font-disp text-[1.04rem] font-medium min-w-[150px] text-center">{ymLabel(ym)}</span>
        <button type="button" onClick={() => setYm(shiftYm(ym, 1))} aria-label="Next month"
          className="px-[9px] py-[4px] rounded-[6px] border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover">›</button>
        {ym !== ymOf(today) && (
          <button type="button" onClick={() => setYm(ymOf(today))}
            className="px-[9px] py-[4px] rounded-[6px] border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover">
            This month
          </button>
        )}
      </div>

      <div className="border border-line rounded-[10px] overflow-hidden bg-panel">
        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-line bg-bg">
          {DOW.map(d => (
            <div key={d} className="px-[8px] py-[7px] text-[.68rem] tracking-[.1em] uppercase text-muted font-semibold">
              {d}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className={`grid grid-cols-7${wi < weeks.length - 1 ? ' border-b border-line' : ''}`}>
            {week.map((d, di) => {
              const inMonth = ymOf(d) === ym;
              const isToday = d === today;
              const dts = tasksOn(d);
              const dls = deadlines.get(d) ?? [];
              const mss = milestones.get(d) ?? [];
              const hits = habitHits(d);
              const dayNum = Number(d.slice(8));
              return (
                <button type="button" key={d} onClick={() => openDay(d)}
                  aria-label={`Open ${fmtD(d)}`}
                  className={`relative text-left align-top min-h-[96px] px-[7px] py-[5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint hover:bg-hover transition-colors duration-100${
                    di > 0 ? ' border-l border-line' : ''}${inMonth ? '' : ' opacity-45'}`}>
                  <span className={`text-[.74rem] tabular-nums font-medium ${
                    isToday
                      ? 'inline-grid place-items-center w-[20px] h-[20px] rounded-full bg-accent text-white'
                      : 'text-muted'}`}>
                    {dayNum}
                  </span>
                  <div className="mt-[3px] flex flex-col gap-[2px]">
                    {dls.map(g => (
                      <span key={g.id} className="text-[.68rem] text-accent font-medium truncate leading-[1.3]">⚑ {g.title}</span>
                    ))}
                    {mss.map((t, i) => (
                      <span key={i} className="text-[.68rem] text-accent truncate leading-[1.3]">◆ {t}</span>
                    ))}
                    {dts.slice(0, 3).map(t => (
                      <span key={t.id} className={`text-[.68rem] truncate leading-[1.3] ${
                        t.done ? 'line-through text-faint' : 'text-ink-soft'}`}>· {t.title}</span>
                    ))}
                    {dts.length > 3 && (
                      <span className="text-[.66rem] text-faint">+{dts.length - 3} more</span>
                    )}
                  </div>
                  {hits > 0 && (
                    <div className="absolute bottom-[5px] left-[7px] flex gap-[3px]" aria-label={`${hits} habit check-ins`}>
                      {Array.from({ length: Math.min(hits, 5) }, (_, i) => (
                        <span key={i} className="w-[5px] h-[5px] rounded-full bg-fill inline-block" />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p className="text-[.76rem] text-muted mt-[10px]">
        ⚑ deadline · ◆ milestone · dots are habit check-ins. Click a day to open it in Today.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Mount.** In `App.tsx`: import `Calendar` + `IconCalendar`; add `['calendar', 'Calendar', <IconCalendar key="cal" />]` to the nav array (after timeline); add `{view === 'calendar' && <Calendar />}` in `<main>`.
- [ ] **Step 5: Verify** — `npm run dev`: navigate months across year boundary; today has the accent disc; deadlines/milestones/tasks/habit dots appear on right days; clicking a day lands on Today with that date selected; `npm run build` clean.
- [ ] **Step 6: Commit** — `git commit -m "feat(calendar): month view with deadlines, milestones, tasks, habit dots"`

---

### Task 3: Study session log (new data concept, Dexie v3)

**Files:**
- Modify: `src/db/types.ts`, `src/db/db.ts`, `src/state/store.ts`
- Create: `src/lib/sessions.ts`, `src/lib/sessions.test.ts`
- Modify: `src/views/Today.tsx` (new "Study log" section), `src/App.tsx` (drawer weekly total)

**Interfaces:**
- Produces: `Session { id, goalId: string | null, date: string, minutes: number, note: string }`; `AppState.sessions: Session[]`; actions `addSession(goalId, date, minutes, note?)`, `removeSession(sessionId)`; lib `minutesOn(sessions, date, goalId?)`, `minutesThisWeek(sessions, today, goalId?)`, `fmtMinutes(mins): string`.
- Sessions are context/logging only — they never affect goal %.

- [ ] **Step 1: Failing lib tests** — `src/lib/sessions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { minutesOn, minutesThisWeek, fmtMinutes } from './sessions';
import type { Session } from '../db/types';

const S = (date: string, minutes: number, goalId: string | null = 'g1'): Session =>
  ({ id: date + minutes, goalId, date, minutes, note: '' });

describe('sessions math', () => {
  it('minutesOn sums a single day, optionally per goal', () => {
    const s = [S('2026-07-02', 30), S('2026-07-02', 45, 'g2'), S('2026-07-01', 60)];
    expect(minutesOn(s, '2026-07-02')).toBe(75);
    expect(minutesOn(s, '2026-07-02', 'g1')).toBe(30);
  });
  it('minutesThisWeek sums the Sun–Sat week containing today', () => {
    // 2026-07-02 is a Thursday → week is Jun 28 – Jul 4
    const s = [S('2026-06-28', 10), S('2026-07-04', 20), S('2026-07-05', 99), S('2026-06-27', 99)];
    expect(minutesThisWeek(s, '2026-07-02')).toBe(30);
  });
  it('fmtMinutes renders h/m compactly', () => {
    expect(fmtMinutes(45)).toBe('45m');
    expect(fmtMinutes(60)).toBe('1h');
    expect(fmtMinutes(200)).toBe('3h 20m');
  });
});
```

- [ ] **Step 2: `npm test`** — FAIL. **Step 3: Implement** — `src/lib/sessions.ts`:

```ts
import type { Session } from '../db/types';
import { weekDates } from './dates';

export function minutesOn(sessions: Session[], date: string, goalId?: string): number {
  return sessions
    .filter(s => s.date === date && (goalId === undefined || s.goalId === goalId))
    .reduce((sum, s) => sum + s.minutes, 0);
}

export function minutesThisWeek(sessions: Session[], today: string, goalId?: string): number {
  const week = new Set(weekDates(today));
  return sessions
    .filter(s => week.has(s.date) && (goalId === undefined || s.goalId === goalId))
    .reduce((sum, s) => sum + s.minutes, 0);
}

export function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
```

- [ ] **Step 4: `npm test`** — PASS. Commit — `git commit -m "feat(sessions): pure session math helpers + tests"`
- [ ] **Step 5: Types + DB.** `types.ts`: add

```ts
export interface Session {
  id: string;
  goalId: string | null; // tag FOR CONTEXT ONLY — never moves a %
  date: string;          // 'YYYY-MM-DD'
  minutes: number;
  note: string;
}
```

and `sessions: Session[]` to `AppState`. `db.ts`: add `sessions!: Table<Session, string>;`, a v3 schema block (`this.version(3).stores({ goals: 'id', habits: 'id', tasks: 'id', settings: 'key', sessions: 'id' });`), `sessions: []` in `buildSeed()`, load `db.sessions.toArray()` in `loadState` (include in the empty-check and bulkPut), persist `sessions` in `persist()`, and `sessions: raw.sessions ?? []` in `importStateFromFile`. `exportState` already spreads `AppState` so it picks sessions up automatically.
- [ ] **Step 6: Store.** `store.ts`: add `sessions: []` to the initial state and `AppState` flows through automatically; add actions after the Tasks block:

```ts
// Sessions — study/work log, context only
addSession(goalId: string | null, date: string, minutes: number, note = '') {
  if (minutes <= 0) return;
  const session: Session = { id: uid(), goalId, date, minutes, note };
  setAndPersist({ sessions: [...state.sessions, session] });
},

removeSession(sessionId: string) {
  const s = state.sessions.find((x) => x.id === sessionId);
  const label = s ? `Deleted ${s.minutes}m log · Undo` : 'Deleted log · Undo';
  const snapshot = state.sessions.slice();
  scheduleUndo(label, () => setAndPersist({ sessions: snapshot }));
  setAndPersist({ sessions: state.sessions.filter((x) => x.id !== sessionId) });
},
```

(Import the `Session` type; ensure `setAndPersist` persists sessions — extend its `persist({...})` call and `exportBackup`/`importBackup` to include `sessions`.)
- [ ] **Step 7: Today view section.** Between the Habits block and the Tasks `SectionLabel` in `Today.tsx`, add a "Study log" section for the **selected date**: `const daySessions = sessions.filter(s => s.date === selDate);`

```tsx
<SectionLabel>Study log</SectionLabel>
{daySessions.length === 0 && (
  <div className="text-faint text-[.85rem] italic py-[6px]">Nothing logged for {rel.toLowerCase()} yet.</div>
)}
{daySessions.map(s => {
  const goal = s.goalId ? goals.find(g => g.id === s.goalId) : null;
  return (
    <div key={s.id} className="flex items-center gap-[10px] p-[6px] rounded-[6px] hover:bg-hover group">
      <span className="text-[.8rem] font-semibold tabular-nums text-ink min-w-[52px]">{fmtMinutes(s.minutes)}</span>
      <span className="flex-1 text-[.88rem] text-ink-soft">{s.note || 'Session'}</span>
      {goal && <Tag label={goal.title} />}
      <button type="button" onClick={() => actions.removeSession(s.id)} aria-label="Remove session"
        className="text-faint text-[.8rem] hover:text-[#b4453a] opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
    </div>
  );
})}
{daySessions.length > 0 && (
  <div className="text-[.74rem] text-muted mt-[4px] px-[6px] tabular-nums">
    {fmtMinutes(minutesOn(sessions, selDate))} total · {fmtMinutes(minutesThisWeek(sessions, today))} this week
  </div>
)}
{/* add row: minutes stepper-free number input + note + goal select, Enter submits */}
<div className="flex items-center gap-[8px] mt-[8px]">
  <input type="number" min={1} max={600} value={logMins} onChange={e => setLogMins(e.target.value)}
    aria-label="Minutes" placeholder="min"
    className="w-[64px] border border-line-2 rounded-[6px] px-[6px] py-[4px] text-[.82rem] bg-panel text-ink tabular-nums" />
  <input className="ghost-in" placeholder="What did you work on?" aria-label="Session note"
    onKeyDown={e => {
      if (e.key === 'Enter') {
        const mins = parseInt(logMins, 10);
        if (mins > 0) {
          actions.addSession(logGoalId || null, selDate, mins, (e.target as HTMLInputElement).value.trim());
          (e.target as HTMLInputElement).value = '';
        }
      }
    }} />
  <select className="border border-line-2 rounded-[6px] px-[6px] py-[4px] text-[.78rem] bg-panel text-ink-soft"
    value={logGoalId} onChange={e => setLogGoalId(e.target.value)} aria-label="Tag session to a goal">
    <option value="">no goal</option>
    {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
  </select>
</div>
```

with component state `const [logMins, setLogMins] = useState('30'); const [logGoalId, setLogGoalId] = useState('');` and imports `minutesOn, minutesThisWeek, fmtMinutes` from `../lib/sessions`. Pull `sessions` from `useAppStore()`.
- [ ] **Step 8: Drawer weekly total.** In `DrawerBody` (App.tsx), under the pace line from Phase 1 Task 4, add:

```tsx
{weekMins > 0 && (
  <div className="text-[.74rem] text-muted mt-[2px] tabular-nums">
    {fmtMinutes(weekMins)} logged this week
  </div>
)}
```

with `const weekMins = minutesThisWeek(sessions, todayStr(), g.id);` (`sessions` from `useAppStore()` in `App()`, passed down or read in `DrawerBody` via the hook).
- [ ] **Step 9: Verify** — fresh profile gets v3 upgrade cleanly (existing data intact, sessions empty); log sessions on several days; totals correct; export → import round-trips sessions; undo restores a deleted log. `npm test` all pass.
- [ ] **Step 10: Commit** — `git commit -m "feat(sessions): study log — Dexie v3, store actions, Today section, drawer weekly total"`

---

### Task 4: Goal notes + next-action surfacing

**Files:**
- Modify: `src/db/types.ts` (`notes?: string` on `Goal`), `src/state/store.ts`, `src/App.tsx` (drawer), `src/views/Goals.tsx` (card), `src/lib/tree.ts` + `src/lib/tree.test.ts`

**Interfaces:**
- Produces: `firstOpenLeaf(nodes: GoalNode[]): GoalNode | null` (depth-first first not-done leaf); `actions.setGoalNotes(goalId, notes)`.

- [ ] **Step 1: TDD helper.** Test (append to `tree.test.ts`): first open leaf is depth-first (`[container[leafDone, leafOpenA], leafOpenB]` → `leafOpenA`); all-done tree → `null`; empty → `null`. Implement in `tree.ts`:

```ts
export function firstOpenLeaf(nodes: GoalNode[]): GoalNode | null {
  for (const n of nodes) {
    if (n.children && n.children.length) {
      const hit = firstOpenLeaf(n.children);
      if (hit) return hit;
    } else if (!n.done) {
      return n;
    }
  }
  return null;
}
```

Run `npm test` (fail → pass). Commit — `git commit -m "feat(tree): firstOpenLeaf helper + tests"`
- [ ] **Step 2: Store action.**

```ts
setGoalNotes(goalId: string, notes: string) {
  const goals = state.goals.map((g) => (g.id === goalId ? { ...g, notes } : g));
  setAndPersist({ goals });
},
```

(`types.ts`: add `notes?: string` to `Goal`. Export/import need no change — notes ride along in the goal object.)
- [ ] **Step 3: Drawer notes.** In `DrawerBody`, after `MilestonesSection`, add a Notes block: same uppercase section label style as Milestones, then

```tsx
<textarea
  defaultValue={g.notes ?? ''}
  key={g.id}
  placeholder="Working notes — strategy, links, blockers…"
  aria-label="Goal notes"
  rows={5}
  onBlur={(e) => { if (e.target.value !== (g.notes ?? '')) actions.setGoalNotes(g.id, e.target.value); }}
  className="w-full mt-[6px] border border-line-2 rounded-[7px] bg-transparent px-[9px] py-[7px] text-[.85rem] leading-[1.5] text-ink placeholder:text-faint outline-none focus-visible:border-accent resize-y"
/>
```

(commit on blur — no keystroke persistence churn; `key={g.id}` resets the draft when switching goals).
- [ ] **Step 4: Next action.** In `Goals.tsx` goal-card header area (under the title/progress row — match existing muted metadata styling) and in `DrawerBody` (under the pace/session lines):

```tsx
const next = firstOpenLeaf(g.nodes);
...
{next && (
  <div className="text-[.76rem] text-muted truncate">
    Next: <span className="text-ink-soft">{next.title}</span>
  </div>
)}
```

- [ ] **Step 5: Verify** — notes survive reload + export/import; next-action updates when ticking leaves; all-done goal shows no Next line. `npm test`, `npm run build`.
- [ ] **Step 6: Commit** — `git commit -m "feat(goals): per-goal notes + next-action surfacing"`

---

### Task 5: Global keyboard shortcuts

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `actions.setView`, `actions.closeDrawer`, `actions.goToToday`.

- [ ] **Step 1: Implement.** In `App()` add one effect:

```tsx
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
    if (e.key === '4') actions.setView('calendar');
    if (e.key === 't') { actions.setView('today'); actions.goToToday(); }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [actions]);
```

Add a muted hint line at the bottom of the sidebar footer: `<div className="text-[.68rem] text-faint px-[8px] pt-[8px]">1–4 switch views · t today · esc closes</div>`.
- [ ] **Step 2: Verify** — shortcuts work; typing "1" in any input does NOT switch views; Esc first blurs inputs, then closes drawer.
- [ ] **Step 3: Commit** — `git commit -m "feat(shell): global keyboard shortcuts (1-4, t, esc)"`

---

### Task 6: Usability & aesthetic polish pass (locked identity — refine, don't decorate)

**Files:**
- Modify: `src/views/Today.tsx`, `src/App.tsx`, `src/views/Goals.tsx`

Concrete fixes only — each is a small independent edit; verify in `npm run dev` after each:

- [ ] **6a. Today header reflects the selected day** (bug: header always shows the real today). `Today.tsx:425-431`: replace `new Date().toLocaleDateString(...)` with `parseD(selDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })`, and when `!isToday` append a muted ` · viewing another day` span so it's obvious you're browsing.
- [ ] **6b. Dynamic year in sidebar.** `App.tsx:247`: `2026 · plan & ship` → `` {`${new Date().getFullYear()} · plan & ship`} ``.
- [ ] **6c. Drawer deadline countdown.** In `DrawerBody` dates row (Phase 1 Task 3 made them inputs), append a muted chip after the deadline input: `<span className="text-[.72rem] text-muted tabular-nums">{daysLeftLabel(g.deadline)}</span>` — move `daysLeftLabel` from `Timeline.tsx` into `src/lib/dates.ts` (export it; update the Timeline import) so both use one copy.
- [ ] **6d. Drawer focus management.** When the drawer opens, focus its close button (`useEffect` on `openGoalId` + a ref); on close, focus returns naturally. Keyboard users currently tab through the page behind the scrim.
- [ ] **6e. Empty-state consistency.** Give Timeline and Calendar the same voice as Today/Goals empty states (one italic faint line + a concrete next step, e.g. "Add a goal to see it on your year — Goals › + goal").
- [ ] **6f. Section rhythm on Today.** With Study log added the page is long: wrap Habits, Study log, and Tasks each with the existing `SectionLabel` spacing and confirm consistent `mt` rhythm (SectionLabel already handles this — just verify no double margins).
- [ ] **Verify + commit** — `git commit -m "polish(ui): selected-day header, dynamic year, deadline chip, drawer focus, empty states"`

---

## Backlog (not planned — pull in only when wanted)

- Study-minutes shown per calendar day cell; weekly review view (hit-rates, minutes, % moved).
- Recurring tasks; drag tasks between calendar days.
- Archive completed goals; PWA/offline install; mobile touch pass.

## Self-Review (done at authoring time)

- Every user ask maps to a task: calendar → 1+2, study tracking → 3, goal/sub-goal + startup project tracking → 4 (notes/next-action; core tree already shipped), habit tracker already live (dots surfaced in calendar → 2), usability → 5+6, aesthetics → 6 within the locked identity.
- Types consistent: `Session` (Task 3) used by lib/store/UI with the same shape; `firstOpenLeaf` (Task 4) matches `GoalNode` leaf-XOR-container invariant; `ViewName` union extended once (Task 2) and used by Task 5.
- No placeholders. Code written against files as of commit `f4a1469`; if Phase 1 landed first, line anchors shift but the named insertion points (DrawerBody, nav array, Tasks SectionLabel) are unambiguous.
