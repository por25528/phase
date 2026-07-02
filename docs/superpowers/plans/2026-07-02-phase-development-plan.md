# Phase Development Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the half-built features (timeline zoom, goal date editing, pace indicators, milestone markers, bar drag/resize), add overdue-task rollover, and harden persistence/tests — turning Phase into a complete personal life-planner.

**Architecture:** Vite + React 19 + TS app; custom `useSyncExternalStore` store (`src/state/store.ts`) with full action surface already persisting to Dexie (IndexedDB). All new date math goes in pure, tested helpers in `src/lib/timeline.ts`; views only consume helpers + store actions. Several store actions (`setZoom`, `setGoalDates`, milestone CRUD) and tested helpers (`moveSpan`, `resizeStart/End`, `snapDelta`, `expectedPct`, `behindPaceBy`) already exist with **zero UI** — most tasks just wire UI to them.

**Tech Stack:** React 19, TypeScript, Tailwind v3.4, Dexie 4, dnd-kit (vertical lists only), Vitest (node env, pure-lib tests).

## Global Constraints

- **Locked visual identity — never restyle:** bg `#FCFCFB`, ink `#1A1A1A`, ONE slate accent `#5D6B82` (only active nav / today-line / deadline flags / goal tags / milestone ◆), graphite `#2C2C2A` progress fills, hairlines `#ECEBE7`, ~7px radius, NO drop shadows, Inter (UI) + Fraunces (`font-disp` titles), delete-hover muted brick `#b4453a`.
- Habits/tasks are SEPARATE from goal progress — `goalId` tags are context only, never move a %.
- Milestones are markers only — never enter `pct` roll-up.
- % roll-up = equal-weight average of DIRECT children per level (leaf = 0/100). Keep `src/lib/pct.ts` tested.
- Pure logic → `src/lib` with Vitest tests (TDD). UI components: no test infra exists — verify manually in `npm run dev`, keep keyboard a11y (roving focus, aria-*, focus-visible) and `prefers-reduced-motion` support.
- All data mutations go through store `actions` + `setAndPersist`. Destructive actions must `scheduleUndo`.
- Run `npm test` before every commit (68 tests passing today).
- Dates are `'YYYY-MM-DD'` strings everywhere; compare lexicographically.

**Task dependency order:** 1 → 2 → (4, 5, 6); 3, 7, 8 independent; 9 last.

---

### Task 1: Zoom window date-math helpers (pure lib, TDD)

**Files:**
- Modify: `src/lib/timeline.ts`
- Test: `src/lib/timeline.test.ts` (append)

**Interfaces:**
- Consumes: `parseD`, `pad`, `MO` from `src/lib/dates.ts`; existing `daysBetween` in `timeline.ts`.
- Produces: `DateWindow {start, end}` (inclusive ISO strings), `zoomWindow(zoom: ZoomLevel, today: string): DateWindow`, `windowDays(win): number`, `windowFrac(date: string, win): number` (unclamped; 0 at win.start, 1 at day after win.end), `windowSegments(zoom, win): {label: string; days: number}[]`.

- [ ] **Step 1: Write failing tests** — append to `src/lib/timeline.test.ts`:

```ts
import { zoomWindow, windowDays, windowFrac, windowSegments } from './timeline';

describe('zoomWindow', () => {
  it('year spans Jan 1 – Dec 31 of today year', () => {
    expect(zoomWindow('year', '2026-07-02')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });
  it('quarter spans the current quarter', () => {
    expect(zoomWindow('quarter', '2026-07-02')).toEqual({ start: '2026-07-01', end: '2026-09-30' });
    expect(zoomWindow('quarter', '2026-01-15')).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(zoomWindow('quarter', '2026-12-31')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  });
  it('month spans the current month', () => {
    expect(zoomWindow('month', '2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
});

describe('windowDays / windowFrac', () => {
  const july = { start: '2026-07-01', end: '2026-07-31' };
  it('counts inclusive days', () => {
    expect(windowDays(july)).toBe(31);
    expect(windowDays(zoomWindow('year', '2026-07-02'))).toBe(365);
  });
  it('frac is 0 at start, 1 at day after end, negative before', () => {
    expect(windowFrac('2026-07-01', july)).toBe(0);
    expect(windowFrac('2026-08-01', july)).toBe(1);
    expect(windowFrac('2026-06-30', july)).toBeLessThan(0);
    expect(windowFrac('2026-07-17', july)).toBeCloseTo(16 / 31);
  });
});

describe('windowSegments', () => {
  it('year → 12 month segments summing to 365', () => {
    const segs = windowSegments('year', zoomWindow('year', '2026-07-02'));
    expect(segs).toHaveLength(12);
    expect(segs[0]).toEqual({ label: 'Jan', days: 31 });
    expect(segs.reduce((s, x) => s + x.days, 0)).toBe(365);
  });
  it('quarter → 3 month segments', () => {
    expect(windowSegments('quarter', zoomWindow('quarter', '2026-07-02'))).toEqual([
      { label: 'Jul', days: 31 }, { label: 'Aug', days: 31 }, { label: 'Sep', days: 30 },
    ]);
  });
  it('month → weekly segments', () => {
    expect(windowSegments('month', zoomWindow('month', '2026-07-02'))).toEqual([
      { label: 'W1', days: 7 }, { label: 'W2', days: 7 }, { label: 'W3', days: 7 },
      { label: 'W4', days: 7 }, { label: 'W5', days: 3 },
    ]);
  });
});
```

- [ ] **Step 2: Run `npm test`** — expect the new tests to FAIL (functions not exported).
- [ ] **Step 3: Implement** — append to `src/lib/timeline.ts` (add imports `parseD, pad, MO` from `./dates`, `type { ZoomLevel }` from `../db/types`):

```ts
export interface DateWindow { start: string; end: string } // both inclusive

function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function zoomWindow(zoom: ZoomLevel, today: string): DateWindow {
  const d = parseD(today);
  const y = d.getFullYear();
  if (zoom === 'year') return { start: `${y}-01-01`, end: `${y}-12-31` };
  if (zoom === 'quarter') {
    const q = Math.floor(d.getMonth() / 3) * 3;
    return { start: iso(new Date(y, q, 1)), end: iso(new Date(y, q + 3, 0)) };
  }
  return { start: iso(new Date(y, d.getMonth(), 1)), end: iso(new Date(y, d.getMonth() + 1, 0)) };
}

export function windowDays(win: DateWindow): number {
  return daysBetween(win.start, win.end) + 1;
}

export function windowFrac(date: string, win: DateWindow): number {
  return daysBetween(win.start, date) / windowDays(win);
}

export interface Segment { label: string; days: number }

export function windowSegments(zoom: ZoomLevel, win: DateWindow): Segment[] {
  if (zoom === 'month') {
    const total = windowDays(win);
    const segs: Segment[] = [];
    for (let done = 0, w = 1; done < total; w++) {
      const days = Math.min(7, total - done);
      segs.push({ label: `W${w}`, days });
      done += days;
    }
    return segs;
  }
  const startD = parseD(win.start);
  const count = zoom === 'year' ? 12 : 3;
  const segs: Segment[] = [];
  for (let k = 0; k < count; k++) {
    const first = new Date(startD.getFullYear(), startD.getMonth() + k, 1);
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    segs.push({ label: MO[first.getMonth()], days });
  }
  return segs;
}
```

- [ ] **Step 4: Run `npm test`** — expect ALL PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(timeline): zoom window helpers (zoomWindow/windowFrac/windowSegments)"`

---

### Task 2: Wire zoom into the Timeline view

**Files:**
- Modify: `src/views/Timeline.tsx`

**Interfaces:**
- Consumes: Task 1 helpers; existing `state.zoom` + `actions.setZoom(z)` (`store.ts:281-284`, already persists via settings table).
- Produces: Timeline renders any `DateWindow`; row layout unchanged for Tasks 5/6.

- [ ] **Step 1: Implement.** In `Timeline.tsx`:
  - Replace imports: drop `DAYS`, `MO`, `yearFrac`; add `zoomWindow, windowDays, windowFrac, windowSegments` from `../lib/timeline` and `ZoomLevel` type.
  - Compute at top of component:

```tsx
const { goals, zoom, actions } = useAppStore();
const win = zoomWindow(zoom, todayStr());
const segs = windowSegments(zoom, win);
const tf = windowFrac(todayStr(), win) * 100;
```

  - Add a segmented control between the subtitle `<p>` and the board `<div>` (styled like the AddHabitForm daily/weekly toggle — active = `bg-accent-tint text-ink`):

```tsx
<div className="flex justify-end mb-[10px]">
  <div className="flex border border-line-2 rounded-[6px] overflow-hidden text-[.78rem] font-medium">
    {(['year', 'quarter', 'month'] as ZoomLevel[]).map(z => (
      <button key={z} type="button" onClick={() => actions.setZoom(z)} aria-pressed={zoom === z}
        className={`px-[12px] py-[4px] transition-colors duration-100 ${
          zoom === z ? 'bg-accent-tint text-ink' : 'text-ink-soft hover:bg-hover'}`}>
        {z[0].toUpperCase() + z.slice(1)}
      </button>
    ))}
  </div>
</div>
```

  - Header + grid lines: replace both `DAYS.map((d, m) => ...)` loops with `segs.map((s, m) => ...)` using `style={{ flex: `${s.days} 0 0` }}` and label `{s.label}`; keep the quarter-emphasis border (`QUARTER_MONTHS.has(m)`) **only when `zoom === 'year'`**, else plain `border-line`.
  - Per-goal bar math — replace `yearFrac` lines:

```tsx
const sf = windowFrac(g.start, win) * 100;
const ef = windowFrac(g.deadline, win) * 100;
const out = ef < 0 || sf > 100;               // goal entirely outside window
const left = Math.max(0, Math.min(100, sf));
const right = Math.max(0, Math.min(100, ef));
const w = Math.max(right - left, 2);
```

  - When `out`, render instead of the bar button a muted marker in the plot area: `<span className="absolute top-1/2 -translate-y-1/2 text-[.72rem] text-faint" style={{ left: ef < 0 ? '8px' : undefined, right: sf > 100 ? '8px' : undefined }}>{ef < 0 ? '‹ earlier' : 'later ›'}</span>` — clicking the lane label area is not required; the goal stays reachable via Goals view.
  - Deadline flag: render only when `0 <= ef && ef <= 100` (use `ef` for `left`).
  - Bar button uses `left: ${left}%`, `width: ${w}%`; everything else (tooltips, drawer open, fill) unchanged.
- [ ] **Step 2: Verify** — `npm test` (all pass, no TS errors via `npm run build`), then `npm run dev`: switch Year/Quarter/Month; bars clamp; today-line correct in each zoom; zoom persists across reload.
- [ ] **Step 3: Commit** — `git commit -m "feat(timeline): year/quarter/month zoom control wired to zoom state"`

---

### Task 3: Editable goal dates in the drawer

**Files:**
- Modify: `src/App.tsx` (DrawerBody, the read-only dates block at ~`App.tsx:195-197`)

**Interfaces:**
- Consumes: `actions.setGoalDates(goalId, start, deadline)` (`store.ts:287-299` — already clamps inverted spans + schedules undo).

- [ ] **Step 1: Implement.** Replace:

```tsx
<div className="text-[.78rem] text-muted mt-[4px] mb-[14px]">
  {fmtD(g.start)} → {fmtD(g.deadline)}
</div>
```

with (same input styling as MilestonesSection date inputs):

```tsx
<div className="flex items-center gap-[6px] mt-[4px] mb-[14px]">
  <input type="date" value={g.start} aria-label="Start date"
    onChange={(e) => { if (e.target.value) actions.setGoalDates(g.id, e.target.value, g.deadline); }}
    className="rounded-[5px] border border-line-2 px-[5px] py-[2px] text-[.72rem] text-ink bg-transparent outline-none" />
  <span className="text-[.78rem] text-muted">→</span>
  <input type="date" value={g.deadline} aria-label="Deadline"
    onChange={(e) => { if (e.target.value) actions.setGoalDates(g.id, g.start, e.target.value); }}
    className="rounded-[5px] border border-line-2 px-[5px] py-[2px] text-[.72rem] text-ink bg-transparent outline-none" />
</div>
```

- [ ] **Step 2: Verify** — `npm run dev`: open a goal from Timeline; change dates → bar moves; pick start after deadline → span auto-swaps (clamp); undo toast restores.
- [ ] **Step 3: Commit** — `git commit -m "feat(drawer): editable start/deadline dates via setGoalDates"`

---

### Task 4: Pace indicators (drawer + timeline tooltip)

**Files:**
- Modify: `src/App.tsx` (DrawerBody), `src/views/Timeline.tsx` (bar tooltip)

**Interfaces:**
- Consumes: `expectedPct(start, deadline, today)`, `behindPaceBy(actualPct, start, deadline, today)` from `src/lib/timeline.ts` (already tested, unused). Muted text only — no new colors.

- [ ] **Step 1: Drawer.** In DrawerBody (imports: add `expectedPct, behindPaceBy` from `./lib/timeline`, `todayStr` from `./lib/dates`):

```tsx
const expected = Math.round(expectedPct(g.start, g.deadline, todayStr()));
const behind = Math.round(behindPaceBy(pct, g.start, g.deadline, todayStr()));
```

Under the progress-bar row (`flex items-center gap-[11px]` div), add:

```tsx
<div className="text-[.74rem] text-muted mt-[6px] tabular-nums">
  {behind > 0
    ? `${behind} pts behind pace · expected ${expected}% by today`
    : `on pace · expected ${expected}% by today`}
</div>
```

- [ ] **Step 2: Timeline tooltip.** In the bar tooltip block (after the `daysLeftLabel` line), add the same line computed from `barGoal` (`Math.round(goalPct(barGoal))` as actual).
- [ ] **Step 3: Verify** — `npm run dev`: a 0% goal past its midpoint shows "behind pace"; a finished goal shows "on pace".
- [ ] **Step 4: Commit** — `git commit -m "feat(pace): expected-% and behind-pace readouts in drawer and timeline tooltip"`

---

### Task 5: Milestone ◆ markers on timeline bars

**Files:**
- Modify: `src/views/Timeline.tsx`

**Interfaces:**
- Consumes: `g.milestones` (`Milestone {id, title, date}`), `windowFrac`, existing fixed-tooltip pattern (`TipPos`).

- [ ] **Step 1: Implement.** Add state `const [msTip, setMsTip] = useState<{x: number; y: number; text: string} | null>(null);`. Inside each goal row's plot area (sibling of the bar button, after the deadline flag):

```tsx
{(g.milestones ?? []).map((m) => {
  const mf = windowFrac(m.date, win) * 100;
  if (mf < 0 || mf > 100) return null;
  return (
    <span key={m.id}
      className="absolute top-[3px] -translate-x-1/2 text-accent text-[.58rem] leading-none z-[4] cursor-default select-none"
      style={{ left: `${mf}%` }}
      onMouseEnter={(e) => setMsTip({ x: e.clientX, y: e.clientY, text: `${m.title} · ${fmtD(m.date)}` })}
      onMouseLeave={() => setMsTip(null)}
    >◆</span>
  );
})}
```

And render the tooltip alongside the existing flag tooltip:

```tsx
{msTip && (
  <div className="fixed z-[50] pointer-events-none bg-panel border border-line-2 rounded-[6px] px-[8px] py-[5px] select-none"
    style={{ left: msTip.x + 10, top: msTip.y - 38 }}>
    <span className="text-[.72rem] text-muted whitespace-nowrap">{msTip.text}</span>
  </div>
)}
```

- [ ] **Step 2: Verify** — `npm run dev`: add milestones in the drawer → ◆ appears at the right date in every zoom; hover shows title · date; markers never affect the % fill.
- [ ] **Step 3: Commit** — `git commit -m "feat(timeline): milestone markers with hover tooltip"`

---

### Task 6: Drag to move / resize goal bars

**Files:**
- Modify: `src/views/Timeline.tsx`

**Interfaces:**
- Consumes: `moveSpan`, `resizeStart`, `resizeEnd`, `snapDelta` from `src/lib/timeline.ts` (tested, unused); `actions.setGoalDates` (clamps + schedules undo → every drag is undoable). Raw pointer events, NOT dnd-kit (dnd-kit is list-reorder; this is continuous horizontal date math).

- [ ] **Step 1: Implement.** Component-level state/refs in `Timeline()`:

```tsx
type Drag = { goalId: string; mode: 'move' | 'start' | 'end'; originX: number; pxPerDay: number;
  orig: { start: string; deadline: string }; preview: { start: string; deadline: string }; moved: boolean };
const [drag, setDrag] = useState<Drag | null>(null);
const suppressClick = useRef(false);
const total = windowDays(win);
```

Per-goal, render from preview during drag:

```tsx
const span = drag?.goalId === g.id ? drag.preview : { start: g.start, deadline: g.deadline };
// use span.start/span.deadline in the sf/ef math from Task 2
```

Bar button: add `touch-none` class, two edge-cursor spans as first children:

```tsx
<span className="absolute inset-y-0 left-0 w-[8px] cursor-ew-resize" aria-hidden="true" />
<span className="absolute inset-y-0 right-0 w-[8px] cursor-ew-resize" aria-hidden="true" />
```

Handlers on the bar button:

```tsx
onPointerDown={(e) => {
  if (e.button !== 0) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const plotW = e.currentTarget.parentElement!.getBoundingClientRect().width;
  const off = e.clientX - rect.left;
  const mode = off < 8 ? 'start' : off > rect.width - 8 ? 'end' : 'move';
  e.currentTarget.setPointerCapture(e.pointerId);
  setDrag({ goalId: g.id, mode, originX: e.clientX, pxPerDay: plotW / total,
    orig: { start: g.start, deadline: g.deadline },
    preview: { start: g.start, deadline: g.deadline }, moved: false });
}}
onPointerMove={(e) => {
  if (!drag || drag.goalId !== g.id) return;
  const delta = snapDelta((e.clientX - drag.originX) / drag.pxPerDay, e.shiftKey ? 'week' : 'day');
  const preview =
    drag.mode === 'move' ? moveSpan(drag.orig.start, drag.orig.deadline, delta)
    : drag.mode === 'start' ? resizeStart(drag.orig.start, drag.orig.deadline, delta)
    : resizeEnd(drag.orig.start, drag.orig.deadline, delta);
  setDrag({ ...drag, preview, moved: drag.moved || Math.abs(e.clientX - drag.originX) > 3 });
}}
onPointerUp={() => {
  if (!drag || drag.goalId !== g.id) return;
  if (drag.moved) {
    suppressClick.current = true;
    if (drag.preview.start !== drag.orig.start || drag.preview.deadline !== drag.orig.deadline) {
      actions.setGoalDates(g.id, drag.preview.start, drag.preview.deadline);
    }
  }
  setDrag(null);
}}
onClick={() => {
  if (suppressClick.current) { suppressClick.current = false; return; }
  actions.openDrawer(g.id);
}}
onKeyDown={(e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 7 : 1);
  const next = e.altKey ? resizeEnd(g.start, g.deadline, d) : moveSpan(g.start, g.deadline, d);
  actions.setGoalDates(g.id, next.start, next.deadline);
}}
```

Update the bar `aria-label` to append: `". Arrow keys move by day, Shift for weeks, Alt+arrows adjust deadline."` Add `cursor-grab active:cursor-grabbing` to the bar class (replacing `cursor-pointer`).

- [ ] **Step 2: Verify** — `npm run dev`: drag middle → whole span moves snapped to days (Shift = weeks); drag edges → resize, never inverting; plain click still opens drawer; every commit shows undo toast; focused bar responds to arrow keys; works in all three zooms (finer pxPerDay in month zoom).
- [ ] **Step 3: Run `npm test`** — all pass. **Commit** — `git commit -m "feat(timeline): drag to move/resize goal spans with snap, keyboard, and undo"`

---

### Task 7: Overdue tasks — roll over to today

**Files:**
- Modify: `src/state/store.ts` (one action), `src/views/Today.tsx`

**Interfaces:**
- Produces: `actions.moveTaskToDate(taskId: string, date: string): void`.

- [ ] **Step 1: Store action.** In the Tasks block of `actions` (after `removeTask`):

```ts
moveTaskToDate(taskId: string, date: string) {
  const tasks = state.tasks.map((t) => (t.id === taskId ? { ...t, date } : t));
  setAndPersist({ tasks });
},
```

- [ ] **Step 2: Today view.** In `Today()` add `const overdue = tasks.filter(t => !t.done && t.date < today);` (ISO strings compare lexicographically). Insert directly after the day-navigator `</div>` and before the `{dayTasks.length === 0 && ...}` empty state:

```tsx
{isToday && overdue.length > 0 && (
  <div className="mb-[14px] border border-line rounded-[7px] px-[10px] py-[8px] bg-panel">
    <div className="text-[.72rem] font-[550] uppercase tracking-[.07em] text-muted mb-[4px]">Overdue</div>
    {overdue.map(t => {
      const goal = t.goalId ? goals.find(g => g.id === t.goalId) : null;
      return (
        <div key={t.id} className="flex items-center gap-[10px] py-[4px] group">
          <TodayCheckbox checked={t.done} onToggle={() => actions.toggleTask(t.id)}
            ariaLabel={`Mark "${t.title}" done`} />
          <span className="flex-1 text-[.88rem] text-ink-soft">{t.title}</span>
          <span className="text-[.72rem] text-muted tabular-nums">{fmtD(t.date)}</span>
          {goal && <Tag label={goal.title} />}
          <button type="button" onClick={() => actions.moveTaskToDate(t.id, today)}
            className="text-[.76rem] text-ink-soft px-[7px] py-[2px] rounded-[5px] border border-line-2 hover:bg-hover">
            → today
          </button>
          <button type="button" onClick={() => actions.removeTask(t.id)}
            aria-label={`Remove task "${t.title}"`}
            className="text-faint text-[.8rem] hover:text-[#b4453a] opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 3: Verify** — `npm run dev`: create an undone task on a past date (‹ nav) → return to today → it appears in Overdue; "→ today" moves it into today's list; done past tasks never appear.
- [ ] **Step 4: Commit** — `git commit -m "feat(today): overdue section with move-to-today rollover"`

---

### Task 8: Persistence-failure surfacing + error boundary

**Files:**
- Modify: `src/state/store.ts` (`setAndPersist`, ~line 57), `src/main.tsx`
- Create: `src/components/ErrorBoundary.tsx`

- [ ] **Step 1: Surface save failures.** `setAndPersist` currently fire-and-forgets `persist()`. Change its last line to:

```ts
persist({ goals: next.goals, habits: next.habits, tasks: next.tasks }).catch(() => {
  actions.showToast('Saving failed — export a backup now');
});
```

- [ ] **Step 2: Error boundary.** Create `src/components/ErrorBoundary.tsx`:

```tsx
import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen w-full grid place-items-center">
        <div className="border border-line rounded-[7px] bg-panel px-[26px] py-[22px] max-w-[420px]">
          <div className="font-disp text-[1.2rem] font-semibold mb-[6px]">Something broke.</div>
          <p className="text-[.86rem] text-muted mb-[14px]">
            Your data is safe in the browser database. Reload to continue; if it repeats, export a backup from the sidebar.
          </p>
          <button className="px-[12px] py-[5px] rounded-[6px] border border-line-2 text-[.82rem] text-ink hover:bg-hover"
            onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
```

- [ ] **Step 3: Wrap the app.** `src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
```

- [ ] **Step 4: Verify** — `npm run build` clean; temporarily `throw new Error('x')` in `Today()` → boundary panel renders, Reload works; revert the throw.
- [ ] **Step 5: Commit** — `git commit -m "feat(hardening): save-failure toast + top-level error boundary"`

---

### Task 9: Store action tests (mocked Dexie)

**Files:**
- Create: `src/state/store.test.ts`

**Interfaces:**
- Consumes: entire `actions` surface + `getState()` from `store.ts`; mocks the whole `../db/db` module so no IndexedDB is needed (vitest env stays `node`). Uses `vi.resetModules()` + dynamic import so each test gets a fresh module-level store.

- [ ] **Step 1: Write tests** (they run against existing behavior, so write → run → pass → commit):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/db', () => ({
  loadState: vi.fn(async () => ({ goals: [], habits: [], tasks: [] })),
  loadZoom: vi.fn(async () => 'year'),
  saveZoom: vi.fn(async () => {}),
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
}));

async function freshStore() {
  vi.resetModules();
  return await import('./store');
}

describe('store actions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('addGoal → addRootNode → toggleLeaf round-trip', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('Ship it', '2026-12-31');
    const gid = getState().goals[0].id;
    actions.addRootNode(gid, 'Step 1');
    const nid = getState().goals[0].nodes[0].id;
    expect(getState().goals[0].nodes[0].done).toBe(false);
    actions.toggleLeaf(nid);
    expect(getState().goals[0].nodes[0].done).toBe(true);
  });

  it('addChild converts a leaf into a container (done removed, parent expanded)', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    const gid = getState().goals[0].id;
    actions.addRootNode(gid, 'leaf');
    const nid = getState().goals[0].nodes[0].id;
    actions.addChild(nid, 'child');
    const node = getState().goals[0].nodes[0];
    expect(node.done).toBeUndefined();
    expect(node.children).toHaveLength(1);
    expect(getState().expanded.has(nid)).toBe(true);
  });

  it('removeGoal schedules undo; undoLastDelete restores', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    actions.removeGoal(getState().goals[0].id);
    expect(getState().goals).toHaveLength(0);
    expect(getState().pendingUndo).not.toBeNull();
    actions.undoLastDelete();
    expect(getState().goals).toHaveLength(1);
    expect(getState().pendingUndo).toBeNull();
  });

  it('undo window expires after 5s', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    actions.removeGoal(getState().goals[0].id);
    vi.advanceTimersByTime(5000);
    expect(getState().pendingUndo).toBeNull();
    actions.undoLastDelete();
    expect(getState().goals).toHaveLength(0); // nothing restored
  });

  it('setGoalDates clamps inverted spans', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    const gid = getState().goals[0].id;
    actions.setGoalDates(gid, '2026-10-01', '2026-02-01');
    expect(getState().goals[0].start).toBe('2026-02-01');
    expect(getState().goals[0].deadline).toBe('2026-10-01');
  });

  it('toggleHabit adds then removes a today check-in', async () => {
    const { actions, getState } = await freshStore();
    actions.addHabit('Run', 'daily', 4);
    const hid = getState().habits[0].id;
    actions.toggleHabit(hid);
    expect(getState().habits[0].checkins).toHaveLength(1);
    actions.toggleHabit(hid);
    expect(getState().habits[0].checkins).toHaveLength(0);
  });

  it('moveTaskToDate reschedules a task', async () => {
    const { actions, getState } = await freshStore();
    actions.addTask('T', '2026-01-05', null);
    actions.moveTaskToDate(getState().tasks[0].id, '2026-07-02');
    expect(getState().tasks[0].date).toBe('2026-07-02');
  });
});
```

- [ ] **Step 2: Run `npm test`** — expect ALL PASS (existing 68 + new; if a test fails, the store has a real bug — fix the store, not the test).
- [ ] **Step 3: Commit** — `git commit -m "test(store): action-surface tests with mocked db"`

---

## Backlog (deliberately NOT planned — YAGNI until wanted)

- Structural undo (indent/outdent/reorder) — deletion undo already covers the data-loss risk.
- Weekly review view (habits hit-rate, tasks done, goals moved).
- Notes field per goal; archive/hide completed goals.
- Recurring tasks; global quick-add keyboard shortcut.
- PWA manifest + offline install; mobile touch polish.
- Component-level tests (@testing-library) — pure-lib + store tests cover the risky logic.

## Self-Review (done at authoring time)

- Coverage: every half-built feature found in the gap analysis has a task (zoom UI → 1+2, `setGoalDates` UI → 3+6, `expectedPct`/`behindPaceBy` → 4, milestones on timeline → 5, drag helpers → 6, persistence/error hardening → 8, untested store → 9). Overdue rollover (7) is the one net-new feature, matching the app's purpose.
- Types consistent: `DateWindow`/`Segment` defined in Task 1 and consumed by 2/5/6; `moveTaskToDate` defined in 7, tested in 9.
- No placeholders; all code complete against the current files (`Timeline.tsx`, `App.tsx`, `Today.tsx`, `store.ts`, `main.tsx` as of commit `f4a1469`).
