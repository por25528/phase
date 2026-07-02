# Phase 3 — Today Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase's near-white/slate identity with the warm cream/terracotta identity from the approved claude.ai/design mockup ("Phase Redesign.dc.html"), and rework the Today view into a dashboard: top-bar shell, hero + quick-add, week strip, card-based two-column grid, mini calendar, and footer stats.

**Architecture:** Pure presentation-layer rework. The store (`src/state/store.ts`), Dexie layer, and all lib math (`pct`, `tree`, `timeline`, `sessions`, `calendar`) are **untouched** — every new component consumes existing actions/selectors. New Today sub-components live in `src/views/today/`. One new tested lib module (`src/lib/today.ts`) holds the new pure helpers (greeting, date kicker, hit-rate, deadline chip).

**Tech Stack:** Vite + React 19 + TypeScript, Tailwind 3.4 (token changes in `tailwind.config.js`), Dexie (untouched), Vitest, @dnd-kit (kept for reordering).

## Source design

The approved mockup is `Phase Redesign.dc.html` in claude.ai/design project `3b8ffb8c-ceda-479e-b0cc-77b8ea806c6c`. All hex values, radii, shadows, and layout measurements below were copied from it verbatim. **The mockup supersedes the previously "locked" visual identity** (old: #FCFCFB bg / slate #5D6B82 accent / no shadows). This is a user-directed identity change.

### Deliberate adaptations (mockup → real app)

The mockup is a static demo. Where it conflicts with shipped functionality, functionality wins:

1. **Keep** drag-to-reorder (hover-visible grip handles), the Overdue tasks block, undo toast, goal drawer, keyboard shortcuts (1–4, t, esc), `prefers-reduced-motion` handling, and all aria roles. The mockup simply doesn't show them.
2. **Week strip starts Sunday** (mockup shows Monday). Existing `weekDates()` is Sunday-based and feeds the weekly-habit stat; the mini calendar is also Sunday-first. Consistency wins.
3. **"+ Habit" opens the existing inline AddHabitForm** (cadence + weekly target) inside the Habits card, instead of focusing Quick Add. Quick Add's "Habit" type is the fast path and creates a `daily` habit. Otherwise weekly habits would become uncreatable.
4. **Goal rows show roll-up `pct%`** from `goalPct()` (the tested average-of-direct-children math), not the mockup's `done/total` leaf count.
5. **Task/log add-rows keep their goal `<select>`** (tag-for-context). The mockup's study-log row omits it.
6. **The habit "N missed" chip** replaces the old text nudge, using the same trigger (daily habit, yesterday AND the day before unchecked).
7. **Habit history**: the 15-week heatmap grid is replaced by the mockup's single 15-dot strip (last 14 days + today). `TodayHeatmap.tsx` and its `.heat-d` CSS are deleted (verified: no other usages).

## Global Constraints

- **Palette (exact, from mockup):** bg `#F2EDE2` · panel `#FBF7EE` · panel-bright `#FFFDF6` · field (input bg) `#FFFEF9` · ink `#211E19` · ink-hover `#3A352C` · ink-soft `#4A463C` · muted `#8B8375` · faint `#B3AB9B` · faint-2 `#C7BEAC` · line `#E4DAC7` · line-2 `#DDD2BC` · line-soft `#EDE4D0` · hover `#F3EDDD` · hover-deep `#E9E1D0` · fill `#211E19` · dot `#3B362B` · dot-off `#E6DCC5` · track `#E7DDC8` · accent `#C8512F` · accent-deep `#B34526` · accent-soft `#D89A7E` · accent-contrast `#FFF6EE` · accent-tint (selection) `#F0DCCF` · paper (text on ink) `#F7F2E7` · chip `#EEE6D3` · chip-ink `#6B6455` · warn `#A05A2C` · warn-tint `#F3E3D2` · delete-hover `#B4453A` (unchanged).
- **Type:** Fraunces (display; weights 400/500/600/650) · Inter (UI) · monospace labels use Tailwind's default `font-mono` stack (starts with `ui-monospace` — no webfont needed). Mono "kicker" labels are uppercase with `.09–.13em` tracking.
- **Radii:** cards 14px (`rounded-card`) · inputs/buttons 9px (`rounded-field`) · pills/chips 999px (`rounded-full`) · checkboxes 7px.
- **Shadows (now allowed, subtle only):** card `0 1px 3px rgba(70,55,30,.06)` · today-card `0 2px 8px rgba(160,85,45,.10)`. Nothing heavier.
- **Data invariants:** do NOT touch `src/state/store.ts`, `src/db/*`, or `src/lib/pct.ts`. Habits/tasks/sessions are context-tagged to goals but NEVER move a goal %. Milestones never enter pct roll-up.
- **A11y invariants:** checkboxes are `<button role="checkbox" aria-checked>`; every icon-only button has `aria-label`; `:focus-visible` ring stays visible (now terracotta); `prefers-reduced-motion` disables transitions.
- **Verification commands:** `npm test` (Vitest), `npm run build` (tsc -b + vite build), `npm run dev` (visual check at http://localhost:5173).
- Commit after every task. Never commit with failing tests or a failing build.

## File Structure

```
Modify:  tailwind.config.js            — new token set
Modify:  index.html                    — Fraunces 650 weight
Modify:  src/index.css                 — #root layout, responsive grid utilities, remove .heat-d
Modify:  src/App.tsx                   — top bar replaces sidebar; InlineEdit accent
Modify:  src/components/Tag.tsx        — neutral chip restyle
Modify:  src/components/SectionLabel.tsx — mono kicker restyle
Modify:  src/components/Checkbox.tsx   — terracotta checked state
Modify:  src/components/GoalTree.tsx   — InlineEdit accent hex only
Modify:  src/views/Goals.tsx           — InlineEdit accent hex only
Create:  src/lib/today.ts + src/lib/today.test.ts — pure helpers (TDD)
Create:  src/components/CardSection.tsx — shared card shell
Rewrite: src/views/Today.tsx           — thin composition root
Create:  src/views/today/Hero.tsx
Create:  src/views/today/QuickAdd.tsx
Create:  src/views/today/WeekStrip.tsx
Create:  src/views/today/TodayCheckbox.tsx   (moved out of Today.tsx, 22px restyle)
Create:  src/views/today/GripIcon.tsx        (moved out of Today.tsx)
Create:  src/views/today/useReducedMotion.ts (moved out of Today.tsx)
Create:  src/views/today/HabitsCard.tsx      (+ SortableHabitRow, AddHabitForm moved here)
Create:  src/views/today/HabitDots.tsx
Create:  src/views/today/TasksCard.tsx       (+ SortableTaskRow, Overdue moved here)
Create:  src/views/today/StudyLogCard.tsx
Create:  src/views/today/GoalsCard.tsx
Create:  src/views/today/MiniCalendar.tsx
Create:  src/views/today/FooterStats.tsx
Delete:  src/components/TodayHeatmap.tsx
```

Store interfaces every task relies on (all pre-existing, unchanged):

```ts
// src/state/store.ts
useAppStore(): { goals, habits, tasks, sessions, view, selDate, openGoalId, toast, pendingUndo, actions }
actions.addTask(title: string, date: string, goalId: string | null)
actions.addHabit(title: string, cadence: 'daily'|'weekly', weeklyTarget: number)
actions.addGoal(title: string, deadline: string)
actions.addSession(goalId: string | null, date: string, minutes: number, note?: string)
actions.toggleTask/removeTask/moveTaskToDate · toggleHabit/removeHabit · removeSession
actions.reorderHabits(activeId, overId) · reorderTasks(activeId, overId)
actions.setSelDate(s) · shiftDay(n) · goToToday() · setView(v) · openDrawer(goalId)
actions.exportBackup() · importBackup(file)
// src/lib/dates.ts: todayStr, parseD, fmtD, addDays, weekDates(s)→Sun-first 7 dates, streak(habit), daysLeftLabel
// src/lib/sessions.ts: minutesOn(sessions, date), minutesThisWeek(sessions, today, goalId?), fmtMinutes(min)
// src/lib/calendar.ts: ymOf(date), shiftYm(ym, n), ymLabel(ym), monthGrid(ym)→string[][] weeks Sun-first
// src/lib/pct.ts: goalPct(goal)  ·  src/lib/tree.ts: firstOpenLeaf(nodes)
```

---

### Task 1: Design tokens, fonts, global styles

**Files:**
- Modify: `tailwind.config.js`
- Modify: `index.html:10`
- Test: existing suite must stay green (`npm test`)

**Interfaces:**
- Consumes: nothing.
- Produces: Tailwind classes used by every later task: `bg-bg/panel/panel-bright/field/hover/hover-deep/chip/warn-tint/track/dot/dot-off`, `text-ink/ink-soft/muted/faint/faint-2/chip-ink/warn/paper/accent/accent-contrast`, `border-line/line-2/line-soft/accent-soft`, `bg-accent hover:bg-accent-deep`, `bg-ink hover:bg-ink-hover`, `rounded-card` (14px), `rounded-field` (9px), `shadow-card`, `shadow-today`, `font-[650]` for the wordmark.

- [ ] **Step 1: Replace the Tailwind theme**

Write `tailwind.config.js` with exactly:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F2EDE2',
        panel: '#FBF7EE',
        'panel-bright': '#FFFDF6',
        field: '#FFFEF9',
        ink: '#211E19',
        'ink-hover': '#3A352C',
        'ink-soft': '#4A463C',
        muted: '#8B8375',
        faint: '#B3AB9B',
        'faint-2': '#C7BEAC',
        line: '#E4DAC7',
        'line-2': '#DDD2BC',
        'line-soft': '#EDE4D0',
        hover: '#F3EDDD',
        'hover-deep': '#E9E1D0',
        fill: '#211E19',
        dot: '#3B362B',
        'dot-off': '#E6DCC5',
        track: '#E7DDC8',
        accent: '#C8512F',
        'accent-deep': '#B34526',
        'accent-soft': '#D89A7E',
        'accent-contrast': '#FFF6EE',
        'accent-tint': '#F0DCCF',
        paper: '#F7F2E7',
        chip: '#EEE6D3',
        'chip-ink': '#6B6455',
        warn: '#A05A2C',
        'warn-tint': '#F3E3D2',
      },
      borderRadius: {
        card: '14px',
        field: '9px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(70,55,30,.06)',
        today: '0 2px 8px rgba(160,85,45,.10)',
      },
      fontFamily: {
        disp: ['Fraunces', 'Georgia', 'serif'],
        ui: ['Inter', '-apple-system', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
```

Note: `fill: '#211E19'` and `accent-tint: '#F0DCCF'` intentionally re-point existing classes (`bg-fill`, selection color, `tl-bar-fill` in Timeline) at the new palette — no call-site edits needed for those. `hover`/`line`/`track` likewise re-skin all existing views for free.

- [ ] **Step 2: Add Fraunces 650 to the Google Fonts link**

In `index.html` line 10, replace the `<link href=...>` with:

```html
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,650&family=Inter:wght@400;450;500;600&display=swap" rel="stylesheet">
```

- [ ] **Step 3: Verify tests and build**

Run: `npm test` — Expected: all existing suites PASS (they test lib math, not styles).
Run: `npm run build` — Expected: exits 0.

- [ ] **Step 4: Visual smoke check**

Run `npm run dev`, open http://localhost:5173. Expected: whole app renders on warm cream (#F2EDE2); nav active pill and tags now look terracotta-tinted; nothing unreadable. (Old layout still present — that's fine.)

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.js index.html
git commit -m "feat(theme): warm cream/terracotta design tokens from Phase Redesign mockup"
```

---

### Task 2: `src/lib/today.ts` pure helpers (TDD)

**Files:**
- Create: `src/lib/today.ts`
- Test: `src/lib/today.test.ts`

**Interfaces:**
- Consumes: `parseD`, `addDays` from `src/lib/dates.ts`; `Habit` from `src/db/types.ts`.
- Produces (used by Tasks 5, 7, 10, 12):
  - `greeting(hour: number): string` — `'Good morning.'` (<12) | `'Good afternoon.'` (<18) | `'Good evening.'`
  - `dateKicker(s: string): string` — `'THURSDAY · 2 JULY 2026'`
  - `daysLeftInYear(s: string): number` — days from `s` to Dec 31 of s's year
  - `lastNDays(s: string, n: number): string[]` — n ISO dates ending at `s`, oldest first
  - `habitHitPct(habits: Habit[], today: string, windowDays?: number): number` — % of habit-day cells checked in the window (default 20)
  - `deadlineChip(deadline: string, today: string): string` — `'DEC 31 · 182D'`, or `'DEC 31 · 5D OVER'` when past

- [ ] **Step 1: Write the failing tests**

Create `src/lib/today.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { greeting, dateKicker, daysLeftInYear, lastNDays, habitHitPct, deadlineChip } from './today';
import type { Habit } from '../db/types';

describe('greeting', () => {
  it('morning before noon', () => expect(greeting(8)).toBe('Good morning.'));
  it('afternoon before 18', () => expect(greeting(12)).toBe('Good afternoon.'));
  it('evening from 18', () => expect(greeting(18)).toBe('Good evening.'));
  it('evening late night hours', () => expect(greeting(23)).toBe('Good evening.'));
});

describe('dateKicker', () => {
  it('formats WEEKDAY · D MONTH YYYY', () => {
    expect(dateKicker('2026-07-02')).toBe('THURSDAY · 2 JULY 2026');
  });
});

describe('daysLeftInYear', () => {
  it('counts to Dec 31', () => expect(daysLeftInYear('2026-07-02')).toBe(182));
  it('is 0 on Dec 31', () => expect(daysLeftInYear('2026-12-31')).toBe(0));
});

describe('lastNDays', () => {
  it('returns n dates ending today, oldest first', () => {
    expect(lastNDays('2026-07-02', 3)).toEqual(['2026-06-30', '2026-07-01', '2026-07-02']);
  });
});

describe('habitHitPct', () => {
  const mk = (checkins: string[]): Habit =>
    ({ id: 'h', title: 'h', cadence: 'daily', weeklyTarget: 4, goalId: null, checkins });
  it('0 with no habits', () => expect(habitHitPct([], '2026-07-02')).toBe(0));
  it('counts hits inside the window only', () => {
    // window of 2 days: 07-01 and 07-02; one hit inside, one outside
    expect(habitHitPct([mk(['2026-07-02', '2026-01-01'])], '2026-07-02', 2)).toBe(50);
  });
  it('averages across habits', () => {
    expect(habitHitPct([mk(['2026-07-02', '2026-07-01']), mk([])], '2026-07-02', 2)).toBe(50);
  });
});

describe('deadlineChip', () => {
  it('future deadline', () => expect(deadlineChip('2026-12-31', '2026-07-02')).toBe('DEC 31 · 182D'));
  it('due today', () => expect(deadlineChip('2026-07-02', '2026-07-02')).toBe('JUL 2 · 0D'));
  it('overdue', () => expect(deadlineChip('2026-06-27', '2026-07-02')).toBe('JUN 27 · 5D OVER'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/today.test.ts`
Expected: FAIL — cannot resolve `./today`.

- [ ] **Step 3: Implement**

Create `src/lib/today.ts`:

```ts
import { parseD, addDays } from './dates';
import type { Habit } from '../db/types';

export function greeting(hour: number): string {
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

export function dateKicker(s: string): string {
  const d = parseD(s);
  const wd = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  const mo = d.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
  return `${wd} · ${d.getDate()} ${mo} ${d.getFullYear()}`;
}

export function daysLeftInYear(s: string): number {
  const d = parseD(s);
  const end = new Date(d.getFullYear(), 11, 31);
  return Math.round((end.getTime() - d.getTime()) / 86_400_000);
}

export function lastNDays(s: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(s, -i));
  return out;
}

export function habitHitPct(habits: Habit[], today: string, windowDays = 20): number {
  if (habits.length === 0) return 0;
  const days = new Set(lastNDays(today, windowDays));
  const hits = habits.reduce(
    (acc, h) => acc + h.checkins.filter((c) => days.has(c)).length,
    0,
  );
  return Math.round((100 * hits) / (habits.length * windowDays));
}

export function deadlineChip(deadline: string, today: string): string {
  const d = parseD(deadline);
  const mo = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const diff = Math.round((d.getTime() - parseD(today).getTime()) / 86_400_000);
  const rel = diff >= 0 ? `${diff}D` : `${-diff}D OVER`;
  return `${mo} ${d.getDate()} · ${rel}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/today.test.ts`
Expected: PASS (all 13).

- [ ] **Step 5: Commit**

```bash
git add src/lib/today.ts src/lib/today.test.ts
git commit -m "feat(lib): today-dashboard helpers (greeting, kicker, hit-rate, deadline chip)"
```

---

### Task 3: Shell — top bar replaces sidebar

**Files:**
- Modify: `src/App.tsx` (sidebar `<aside>` → `<header>`, `<main>` container, `InlineEdit` accent)
- Modify: `src/index.css` (`#root` becomes a column; page scrolls normally)
- Modify: `src/components/GoalTree.tsx:74` and `src/views/Goals.tsx:79` (accent hex only)

**Interfaces:**
- Consumes: `actions.setView`, `actions.exportBackup`, `actions.importBackup`, existing `view` state. Keyboard shortcuts effect in `App.tsx` is untouched.
- Produces: full-width `<main>`; the Today view gets a `max-w-[1280px]` container, other views keep their `max-w-[880px]` column. Later tasks assume this.

- [ ] **Step 1: Make `#root` a column layout**

In `src/index.css` `@layer base`, replace the `body` and `#root` rules with:

```css
  body {
    @apply bg-bg text-ink font-ui text-[14px] leading-[1.5] antialiased;
  }
  #root {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    width: 100%;
  }
```

(Remove `display: flex;` from `body` and the old `#root` comment block — the sidebar-row constraint no longer exists.)

- [ ] **Step 2: Replace the sidebar with a top bar in `App.tsx`**

Delete the entire `{/* Sidebar */} <aside>…</aside>` block (lines 308–371) and the now-unused import of `IconSun, IconTarget, IconBars, IconCalendar` (line 8). In its place, as the first child of the fragment:

```tsx
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-bg border-b border-line flex items-center gap-[30px] px-[36px] py-[13px]">
        <div className="flex items-baseline gap-[10px]">
          <span className="font-disp text-[1.5rem] font-[650] tracking-[-0.01em]">
            Phase<span className="text-accent">.</span>
          </span>
          <span className="font-mono text-[.7rem] tracking-[.09em] text-muted uppercase">
            {new Date().getFullYear()} · plan &amp; ship
          </span>
        </div>
        <nav className="flex gap-[4px]">
          {(
            [
              ['today', 'Today'],
              ['goals', 'Goals'],
              ['timeline', 'Timeline'],
              ['calendar', 'Calendar'],
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
          <button onClick={() => actions.exportBackup()} className="hover:text-ink">↓ EXPORT</button>
          <button onClick={() => fileInputRef.current?.click()} className="hover:text-ink">↑ IMPORT</button>
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
      </header>
```

- [ ] **Step 3: Rework the `<main>` container**

Replace the existing `<main>` block (lines 374–381) with:

```tsx
      {/* Main */}
      <main className="flex-1 min-w-0">
        {view === 'today' ? (
          <div className="max-w-[1280px] mx-auto px-[36px] pb-[40px]">
            <Today />
          </div>
        ) : (
          <div className="max-w-[880px] mx-auto px-[40px] py-[42px] pb-[90px]">
            {view === 'goals' && <Goals />}
            {view === 'timeline' && <Timeline />}
            {view === 'calendar' && <Calendar />}
          </div>
        )}
      </main>
```

- [ ] **Step 4: Re-point the three hardcoded InlineEdit accents**

In `src/App.tsx:49`, `src/components/GoalTree.tsx:74`, and `src/views/Goals.tsx:79`, change:

```tsx
      style={{ border: 'none', borderBottom: '1px solid #5D6B82' }}
```
to
```tsx
      style={{ border: 'none', borderBottom: '1px solid #C8512F' }}
```

- [ ] **Step 5: Verify**

Run: `npm run build` — Expected: exits 0 (catches the removed-import/unused-var errors).
Run: `npm run dev` and check: top bar with pill nav; views switch by click AND by keys 1–4; export/import work; drawer still slides over everything (z-50 > header z-30); page scrolls as one column.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/index.css src/components/GoalTree.tsx src/views/Goals.tsx
git commit -m "feat(shell): top bar replaces sidebar; full-width column layout"
```

---

### Task 4: Shared primitives — CardSection, Tag, SectionLabel, Checkbox

**Files:**
- Create: `src/components/CardSection.tsx`
- Modify: `src/components/Tag.tsx`, `src/components/SectionLabel.tsx`, `src/components/Checkbox.tsx`

**Interfaces:**
- Produces: `CardSection({ label, meta, right, children, className })` — panel card with a mono-kicker header row. `label: string` renders the kicker; `meta?: ReactNode` sits directly after the label (e.g. the "2 OF 5 DONE" count); `right?: ReactNode` renders after a flex spacer, pushed to the card's right edge. Used by Tasks 7–11.

- [ ] **Step 1: Create `src/components/CardSection.tsx`**

```tsx
import type { ReactNode } from 'react';

interface Props {
  label: string;
  meta?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function CardSection({ label, meta, right, children, className }: Props) {
  return (
    <section className={`bg-panel border border-line rounded-card shadow-card px-[18px] py-[15px] ${className ?? ''}`}>
      <div className="flex items-center gap-[12px] mb-[6px]">
        <span className="font-mono text-[.72rem] tracking-[.12em] uppercase text-muted font-semibold">{label}</span>
        {meta}
        <div className="flex-1" />
        {right}
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Restyle `Tag` to the neutral chip**

Replace the `<span>` class in `src/components/Tag.tsx` with:

```tsx
    <span className="text-[.7rem] text-chip-ink bg-chip px-[9px] py-[2px] rounded-full font-medium whitespace-nowrap">
```

- [ ] **Step 3: Restyle `SectionLabel` as a mono kicker** (still used by Goals/Timeline/Calendar views)

In `src/components/SectionLabel.tsx`, replace the className with:

```tsx
      className={`font-mono text-[.7rem] tracking-[.13em] uppercase text-muted font-semibold mb-3 ${
        first ? 'mt-0' : 'mt-[34px]'
      }`}
```

- [ ] **Step 4: Terracotta checked state on `Checkbox`** (GoalTree leaves)

In `src/components/Checkbox.tsx`, change the two state classes:

```tsx
        checked
          ? 'bg-accent border-accent'
          : 'border-line-2 hover:border-muted'
```
and on the `<svg>`, change `stroke-white` to `stroke-accent-contrast` (Tailwind 3.4 generates `stroke-<color>` utilities for theme colors):

```tsx
        className={`w-[11px] h-[11px] stroke-accent-contrast fill-none transition-opacity duration-100 ${checked ? 'opacity-100' : 'opacity-0'}`}
```

- [ ] **Step 5: Verify and commit**

Run: `npm run build` — Expected: exits 0. Visual: goal-tree checkboxes and tags look terracotta/neutral-chip on all views.

```bash
git add src/components/CardSection.tsx src/components/Tag.tsx src/components/SectionLabel.tsx src/components/Checkbox.tsx
git commit -m "feat(ui): CardSection primitive; chip/kicker/checkbox restyle"
```

---

### Task 5: Today scaffold — Hero, QuickAdd, grid skeleton

**Files:**
- Create: `src/views/today/Hero.tsx`, `src/views/today/QuickAdd.tsx`, `src/views/today/TodayCheckbox.tsx`, `src/views/today/GripIcon.tsx`, `src/views/today/useReducedMotion.ts`
- Modify: `src/views/Today.tsx`, `src/index.css`

**Interfaces:**
- Produces:
  - `QuickType = 'task' | 'habit' | 'goal'` (exported from `QuickAdd.tsx`)
  - `QuickAdd({ type, onType, inputRef })` with `inputRef: RefObject<HTMLInputElement | null>`
  - `TodayCheckbox({ checked, onToggle, ariaLabel })` — 22px, `rounded-[7px]`, terracotta when checked
  - `GripIcon()` and `useReducedMotion(): boolean` — used by Tasks 7 and 8
  - `Today.tsx` exposes `focusQuick(t: QuickType)` internally and passes `onAddGoal={() => focusQuick('goal')}` to `GoalsCard` (Task 10).

- [ ] **Step 1: Responsive grid utilities in `src/index.css`**

Add to `@layer components`:

```css
  .today-hero { grid-template-columns: minmax(0, 1fr) 396px; }
  .today-main { grid-template-columns: minmax(0, 1fr) 372px; }
```

And at file end (outside layers), after the reduced-motion block:

```css
@media (max-width: 1160px) {
  .today-hero, .today-main { grid-template-columns: 1fr; }
}
@media (max-width: 1000px) {
  .hb-dots { display: none; }
}
```

- [ ] **Step 2: Create `src/views/today/Hero.tsx`**

```tsx
import { useAppStore } from '../../state/store';
import { todayStr } from '../../lib/dates';
import { dateKicker, greeting, daysLeftInYear } from '../../lib/today';

export function Hero() {
  const { habits, tasks } = useAppStore();
  const today = todayStr();
  const habitsDone = habits.filter((h) => h.checkins.includes(today)).length;
  const todayTasks = tasks.filter((t) => t.date === today);
  const tasksDone = todayTasks.filter((t) => t.done).length;

  return (
    <div>
      <div className="font-mono text-[.72rem] tracking-[.12em] text-muted mb-[6px]">{dateKicker(today)}</div>
      <h1 className="font-disp text-[2.5rem] font-semibold tracking-[-0.015em] leading-[1.1] mb-[6px]">
        {greeting(new Date().getHours())}
      </h1>
      <p className="text-[.9rem] text-chip-ink m-0">
        {habitsDone} of {habits.length} habits · {tasksDone} of {todayTasks.length} tasks done ·{' '}
        {daysLeftInYear(today)} days left in {today.slice(0, 4)}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/views/today/QuickAdd.tsx`**

```tsx
import type { KeyboardEvent, RefObject } from 'react';
import { useAppStore } from '../../state/store';
import { todayStr } from '../../lib/dates';

export type QuickType = 'task' | 'habit' | 'goal';

const PLACEHOLDER: Record<QuickType, string> = {
  task: 'Add a task for today…',
  habit: 'New habit name…',
  goal: 'New goal or project…',
};

const LABEL: Record<QuickType, string> = { task: 'Task', habit: 'Habit', goal: 'Goal' };

export function QuickAdd({
  type,
  onType,
  inputRef,
}: {
  type: QuickType;
  onType: (t: QuickType) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const { selDate, actions } = useAppStore();

  function submit() {
    const el = inputRef.current;
    if (!el) return;
    const val = el.value.trim();
    if (!val) { el.focus(); return; }
    if (type === 'task') actions.addTask(val, selDate, null);
    if (type === 'habit') actions.addHabit(val, 'daily', 4);
    if (type === 'goal') actions.addGoal(val, `${todayStr().slice(0, 4)}-12-31`);
    el.value = '';
    el.focus();
  }

  return (
    <div className="bg-panel border border-line rounded-card shadow-card px-[16px] py-[14px]">
      <div className="font-mono text-[.66rem] tracking-[.12em] text-accent font-semibold mb-[9px]">QUICK ADD</div>
      <div className="flex gap-[8px]">
        <input
          ref={inputRef}
          aria-label="Quick add"
          placeholder={PLACEHOLDER[type]}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') submit(); }}
          className="flex-1 min-w-0 bg-field border border-line-2 rounded-field px-[12px] py-[8px] text-[.9rem] text-ink outline-none placeholder:text-faint"
        />
        <button
          onClick={submit}
          aria-label="Add"
          className="w-[36px] h-[36px] rounded-field bg-accent text-accent-contrast text-[17px] font-semibold flex-none grid place-items-center hover:bg-accent-deep"
        >
          +
        </button>
      </div>
      <div className="flex items-center gap-[6px] mt-[9px]">
        {(['task', 'habit', 'goal'] as QuickType[]).map((t) => (
          <button
            key={t}
            onClick={() => onType(t)}
            aria-pressed={type === t}
            className={`px-[12px] py-[3px] rounded-full text-[.76rem] font-semibold border ${
              type === t ? 'bg-ink text-paper border-ink' : 'text-ink-soft border-line-2 hover:bg-hover'
            }`}
          >
            {LABEL[t]}
          </button>
        ))}
        <span className="ml-auto font-mono text-[.6rem] tracking-[.08em] text-faint">ENTER ↵</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/views/today/TodayCheckbox.tsx`** (22px version of the checkbox currently defined inline in `Today.tsx:28-59`)

```tsx
export function TodayCheckbox({
  checked,
  onToggle,
  ariaLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={`w-[22px] h-[22px] border-[1.5px] rounded-[7px] flex-shrink-0 grid place-items-center transition-colors duration-100 ${
        checked ? 'bg-accent border-accent' : 'bg-field border-line-2 hover:border-muted'
      }`}
    >
      <svg
        viewBox="0 0 12 12"
        className={`w-[12px] h-[12px] stroke-accent-contrast fill-none transition-opacity duration-100 ${
          checked ? 'opacity-100' : 'opacity-0'
        }`}
        strokeWidth={2.4}
      >
        <path d="M2 6.2 4.6 9 10 3" />
      </svg>
    </button>
  );
}
```

- [ ] **Step 5: Create `src/views/today/GripIcon.tsx`** (move verbatim from `Today.tsx:163-180`)

```tsx
export function GripIcon() {
  return (
    <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="3" r="1.2" />
      <circle cx="7" cy="3" r="1.2" />
      <circle cx="3" cy="8" r="1.2" />
      <circle cx="7" cy="8" r="1.2" />
      <circle cx="3" cy="13" r="1.2" />
      <circle cx="7" cy="13" r="1.2" />
    </svg>
  );
}
```

- [ ] **Step 6: Create `src/views/today/useReducedMotion.ts`** (extracted from `Today.tsx:375-381`)

```ts
import { useEffect, useState } from 'react';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}
```

- [ ] **Step 7: Restructure `Today.tsx`**

At the top of the `Today()` component add:

```tsx
  const quickRef = useRef<HTMLInputElement>(null);
  const [quickType, setQuickType] = useState<QuickType>('task');
  function focusQuick(t: QuickType) {
    setQuickType(t);
    quickRef.current?.focus();
  }
```

(import `useRef`; import `Hero`, `QuickAdd`, `QuickType`, `TodayCheckbox`, `GripIcon`, `useReducedMotion` from `./today/...`; delete the inline `TodayCheckbox`, `GripIcon` definitions and the inline reduced-motion `useEffect`/`useState`, replacing with `const reducedMotion = useReducedMotion();`).

Replace the old header (`<h1>Today</h1>` + date `<p>`, lines 425-436) and wrap the existing sections in the new layout. The component's return becomes:

```tsx
  return (
    <div className="pt-[26px]">
      {/* Hero + quick add */}
      <div className="today-hero grid gap-[28px] items-end mb-[20px]">
        <Hero />
        <QuickAdd type={quickType} onType={setQuickType} inputRef={quickRef} />
      </div>

      {/* WeekStrip mounts here in Task 6 */}

      {/* Main grid */}
      <div className="today-main grid gap-[22px] items-start mt-[20px]">
        <div className="flex flex-col gap-[18px] min-w-0">
          {/* MOVE the existing Habits section JSX here unchanged (SectionLabel + DndContext + AddHabitForm block) */}
          {/* MOVE the existing Study log section JSX here unchanged */}
          {/* MOVE the existing Tasks section JSX here unchanged (day navigator + overdue + DndContext + add row) */}
        </div>
        <div className="flex flex-col gap-[18px] min-w-0">
          {/* GoalsCard (Task 10) and MiniCalendar (Task 11) mount here */}
        </div>
      </div>

      {/* FooterStats mounts here in Task 12 */}
    </div>
  );
```

The three "MOVE" comments mean relocating the existing JSX blocks verbatim (they are restyled and extracted in Tasks 7–9 — do not restyle them now). `focusQuick` is unused until Task 10; suppress the TS unused warning by passing it nowhere yet — if `tsc` complains under noUnusedLocals, prefix with `void focusQuick;` temporarily and remove that line in Task 10.

- [ ] **Step 8: Verify and commit**

Run: `npm run build` — Expected: exits 0.
Visual: hero greeting + quick add card on top; quick-add creates a task on the selected day, a daily habit, and a goal with a Dec 31 deadline (check Goals view); old sections still function below (checkboxes, dnd, add rows).

```bash
git add src/views/today src/views/Today.tsx src/index.css
git commit -m "feat(today): hero + quick-add + dashboard grid scaffold"
```

---

### Task 6: Week strip

**Files:**
- Create: `src/views/today/WeekStrip.tsx`
- Modify: `src/views/Today.tsx` (mount it)

**Interfaces:**
- Consumes: `weekDates`, `todayStr`, `parseD` from dates; `tasks`, `habits`, `selDate`, `actions.setSelDate` from store.
- Produces: `WeekStrip()` — no props.

- [ ] **Step 1: Create `src/views/today/WeekStrip.tsx`**

```tsx
import { useAppStore } from '../../state/store';
import { todayStr, weekDates, parseD } from '../../lib/dates';

const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function WeekStrip() {
  const { tasks, habits, selDate, actions } = useAppStore();
  const today = todayStr();
  const habitsLeft = habits.filter((h) => !h.checkins.includes(today)).length;

  return (
    <div className="grid grid-cols-7 gap-[10px]">
      {weekDates(today).map((d) => {
        const isToday = d === today;
        const sel = selDate === d;
        const open = tasks.filter((t) => t.date === d && !t.done);
        const summary = isToday
          ? `${open.length} task${open.length === 1 ? '' : 's'} · ${habitsLeft} habit${habitsLeft === 1 ? '' : 's'} due`
          : open.length === 0
            ? '—'
            : open.length === 1
              ? open[0].title
              : `${open.length} tasks planned`;
        const date = parseD(d);
        const border = isToday ? 'border-accent-soft' : sel ? 'border-ink' : 'border-line hover:bg-hover';
        return (
          <button
            key={d}
            onClick={() => actions.setSelDate(d)}
            aria-pressed={sel}
            aria-label={`Select ${d}`}
            className={`text-left rounded-[12px] border px-[12px] py-[10px] min-h-[72px] flex flex-col gap-[5px] ${
              isToday ? 'bg-panel-bright shadow-today' : 'bg-panel'
            } ${border}`}
          >
            <span className="flex items-baseline gap-[7px]">
              <span className={`font-mono text-[.6rem] tracking-[.1em] ${isToday ? 'text-accent' : 'text-faint'}`}>
                {WD[date.getDay()]}
              </span>
              <span className="font-disp text-[1.06rem] font-semibold text-ink">{date.getDate()}</span>
              {isToday && (
                <span className="font-mono text-[.55rem] tracking-[.1em] text-accent font-bold">TODAY</span>
              )}
            </span>
            <span className={`text-[.72rem] leading-[1.4] truncate ${open.length || isToday ? 'text-chip-ink' : 'text-faint-2'}`}>
              {summary}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Mount in `Today.tsx`** at the `{/* WeekStrip mounts here */}` marker:

```tsx
      <WeekStrip />
```

- [ ] **Step 3: Verify and commit**

Run: `npm run build` — exits 0. Visual: 7 Sunday-first cards; today has cream-bright bg + soft terracotta border + TODAY badge; clicking a day changes the Tasks day navigator (selDate) below; clicked card gets ink border.

```bash
git add src/views/today/WeekStrip.tsx src/views/Today.tsx
git commit -m "feat(today): selectable week strip with per-day summaries"
```

---

### Task 7: Habits card with dot strips

**Files:**
- Create: `src/views/today/HabitsCard.tsx`, `src/views/today/HabitDots.tsx`
- Modify: `src/views/Today.tsx` (replace habits section with `<HabitsCard />`; remove now-dead imports)
- Delete: `src/components/TodayHeatmap.tsx`; the `.heat-d` block in `src/index.css:44-53`

**Interfaces:**
- Consumes: `TodayCheckbox`, `GripIcon`, `useReducedMotion` (Task 5); `lastNDays` (Task 2); `CardSection`, `Tag`; store `habits`, `goals`, `actions.toggleHabit/removeHabit/addHabit/reorderHabits`; `streak`, `weekDates`, `addDays` from dates.
- Produces: `HabitsCard()` — no props. The `AddHabitForm` component moves (verbatim logic, restyled classes) from `Today.tsx` into `HabitsCard.tsx`.

- [ ] **Step 1: Create `src/views/today/HabitDots.tsx`**

```tsx
import type { Habit } from '../../db/types';
import { lastNDays } from '../../lib/today';

export function HabitDots({ hb, today }: { hb: Habit; today: string }) {
  return (
    <div className="hb-dots flex gap-[2.5px] flex-none" aria-hidden="true">
      {lastNDays(today, 15).map((d) => {
        const hit = hb.checkins.includes(d);
        const isToday = d === today;
        const cls = isToday
          ? hit
            ? 'bg-accent'
            : 'bg-[#F7F2E5] shadow-[inset_0_0_0_1.5px_#CBBEA2]'
          : hit
            ? 'bg-dot'
            : 'bg-dot-off';
        return <span key={d} className={`w-[7px] h-[7px] rounded-[2px] ${cls}`} />;
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/views/today/HabitsCard.tsx`**

Move `AddHabitForm` (from `Today.tsx:62-160`) and `SortableHabitRow` (from `Today.tsx:198-282`) into this file, with the row restyled as below. Full file:

```tsx
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAppStore } from '../../state/store';
import { CardSection } from '../../components/CardSection';
import { Tag } from '../../components/Tag';
import { TodayCheckbox } from './TodayCheckbox';
import { GripIcon } from './GripIcon';
import { HabitDots } from './HabitDots';
import { useReducedMotion } from './useReducedMotion';
import { todayStr, addDays, weekDates, streak } from '../../lib/dates';
import type { Cadence, Habit } from '../../db/types';

function AddHabitForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, cadence: Cadence, target: number) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<Cadence>('daily');
  const [target, setTarget] = useState(4);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed, cadence, target);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') onCancel();
  }

  return (
    <div className="border border-line-2 rounded-field p-[12px] mt-[8px] flex flex-col gap-[10px] bg-field">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Habit name"
        className="ghost-in text-[.9rem]"
        aria-label="New habit name"
      />
      <div className="flex items-center gap-[8px] flex-wrap">
        <div className="flex border border-line-2 rounded-field overflow-hidden text-[.78rem] font-medium">
          {(['daily', 'weekly'] as Cadence[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCadence(c)}
              aria-pressed={cadence === c}
              className={`px-[12px] py-[4px] transition-colors duration-100 ${
                cadence === c ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-hover'
              }`}
            >
              {c === 'daily' ? 'Daily' : 'Weekly'}
            </button>
          ))}
        </div>
        {cadence === 'weekly' && (
          <div className="flex items-center gap-[6px]">
            <button
              type="button"
              onClick={() => setTarget((t) => Math.max(1, t - 1))}
              aria-label="Decrease weekly target"
              className="w-[22px] h-[22px] rounded-[4px] border border-line-2 text-[.9rem] text-ink-soft hover:bg-hover grid place-items-center"
            >
              −
            </button>
            <span className="text-[.82rem] tabular-nums w-[14px] text-center font-medium text-ink">{target}</span>
            <button
              type="button"
              onClick={() => setTarget((t) => Math.min(7, t + 1))}
              aria-label="Increase weekly target"
              className="w-[22px] h-[22px] rounded-[4px] border border-line-2 text-[.9rem] text-ink-soft hover:bg-hover grid place-items-center"
            >
              +
            </button>
            <span className="text-[.76rem] text-muted">× per week</span>
          </div>
        )}
      </div>
      <div className="flex gap-[8px]">
        <button
          type="button"
          onClick={submit}
          className="px-[13px] py-[5px] rounded-field bg-ink text-paper text-[.8rem] font-semibold hover:bg-ink-hover"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-[12px] py-[5px] rounded-field border border-line-2 text-[.8rem] text-ink-soft hover:bg-hover"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SortableHabitRow({
  hb,
  today,
  goal,
  onToggle,
  onRemove,
  reducedMotion,
}: {
  hb: Habit;
  today: string;
  goal: { id: string; title: string } | null | undefined;
  onToggle: () => void;
  onRemove: () => void;
  reducedMotion: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: hb.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const done = hb.checkins.includes(today);
  const missed =
    hb.cadence === 'daily' &&
    !hb.checkins.includes(addDays(today, -1)) &&
    !hb.checkins.includes(addDays(today, -2));
  const stat =
    hb.cadence === 'weekly'
      ? `${weekDates(today).filter((d) => hb.checkins.includes(d)).length}/${hb.weeklyTarget} this wk`
      : `${streak(hb)}d streak`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-[12px] py-[8px] px-[8px] -mx-[8px] rounded-field hover:bg-hover"
    >
      <button
        type="button"
        className="text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-grab active:cursor-grabbing touch-none flex-shrink-0 transition-opacity"
        aria-label={`Drag to reorder "${hb.title}"`}
        {...attributes}
        {...listeners}
      >
        <GripIcon />
      </button>
      <TodayCheckbox checked={done} onToggle={onToggle} ariaLabel={`Mark "${hb.title}" done today`} />
      <span className={`flex-1 min-w-[90px] truncate text-[.9rem] font-medium ${done ? 'text-muted' : 'text-ink'}`}>
        {hb.title}
      </span>
      {missed && (
        <span className="text-[.7rem] font-semibold px-[8px] py-[2px] rounded-full bg-warn-tint text-warn whitespace-nowrap">
          2 missed
        </span>
      )}
      {goal && <Tag label={goal.title} />}
      <HabitDots hb={hb} today={today} />
      <span className="font-mono text-[.7rem] text-muted w-[76px] text-right flex-none tabular-nums">{stat}</span>
      <button
        type="button"
        className="text-faint text-[.8rem] hover:text-[#B4453A] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        onClick={onRemove}
        aria-label={`Remove habit "${hb.title}"`}
      >
        ✕
      </button>
    </div>
  );
}

export function HabitsCard() {
  const { habits, goals, actions } = useAppStore();
  const today = todayStr();
  const reducedMotion = useReducedMotion();
  const [adding, setAdding] = useState(false);
  const done = habits.filter((h) => h.checkins.includes(today)).length;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      actions.reorderHabits(String(active.id), String(over.id));
    }
  }

  return (
    <CardSection
      label="Habits — today"
      meta={
        <span className="font-mono text-[.72rem] text-faint">
          {done} OF {habits.length} DONE
        </span>
      }
      right={
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="px-[13px] py-[6px] rounded-field bg-ink text-paper text-[.8rem] font-semibold hover:bg-ink-hover"
        >
          + Habit
        </button>
      }
    >
      {habits.length === 0 && !adding && (
        <div className="text-faint text-[.85rem] italic py-[6px]">No habits yet. Add one to start a streak.</div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={habits.map((h) => h.id)} strategy={verticalListSortingStrategy}>
          {habits.map((hb) => (
            <SortableHabitRow
              key={hb.id}
              hb={hb}
              today={today}
              goal={hb.goalId ? goals.find((g) => g.id === hb.goalId) : null}
              onToggle={() => actions.toggleHabit(hb.id)}
              onRemove={() => actions.removeHabit(hb.id)}
              reducedMotion={reducedMotion}
            />
          ))}
        </SortableContext>
      </DndContext>
      {adding && <AddHabitForm onAdd={(n, c, t) => { actions.addHabit(n, c, t); setAdding(false); }} onCancel={() => setAdding(false)} />}
    </CardSection>
  );
}
```

- [ ] **Step 3: Swap into `Today.tsx`**

Replace the entire moved habits block (SectionLabel + empty state + DndContext + add button/form) with `<HabitsCard />`. Delete from `Today.tsx`: `AddHabitForm`, `SortableHabitRow`, the `addingHabit` state, `handleAddHabit`, `handleHabitDragEnd`, `habitIds`, and imports that became unused (`TodayHeatmap`, `Cadence`, dnd imports if no longer referenced — Tasks section still needs dnd until Task 8, keep what's used).

- [ ] **Step 4: Delete the old heatmap**

```bash
rm src/components/TodayHeatmap.tsx
```
Remove the `.heat-d` rules from `src/index.css` (the block at lines 44–53 in `@layer components`). Verified pre-plan: `grep -rn "heat-d" src/` matches only `index.css` and `TodayHeatmap.tsx`.

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run build` — Expected: PASS / exit 0.
Visual: habits in a cream card; 15 dots per row (hide below 1000px width); toggling today's checkbox flips the last dot terracotta and updates the streak stat and hero counts; drag-reorder still works; "+ Habit" opens the inline form; weekly habit shows `n/target this wk`.

```bash
git add -A src/views src/components src/index.css
git commit -m "feat(today): habits card with 15-day dot strips; drop old heatmap"
```

---

### Task 8: Tasks card

**Files:**
- Create: `src/views/today/TasksCard.tsx`
- Modify: `src/views/Today.tsx` (replace tasks section + day navigator with `<TasksCard />`)

**Interfaces:**
- Consumes: `TodayCheckbox`, `GripIcon`, `useReducedMotion`, `CardSection`, `Tag`; store `tasks`, `goals`, `selDate`, `actions.toggleTask/removeTask/addTask/moveTaskToDate/reorderTasks/shiftDay/goToToday`; `todayStr`, `addDays`, `fmtD`, `parseD` from dates.
- Produces: `TasksCard()` — no props. Owns the day navigator (moved from the old view body into the card header) and the Overdue block.

- [ ] **Step 1: Create `src/views/today/TasksCard.tsx`**

```tsx
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAppStore } from '../../state/store';
import { CardSection } from '../../components/CardSection';
import { Tag } from '../../components/Tag';
import { TodayCheckbox } from './TodayCheckbox';
import { GripIcon } from './GripIcon';
import { useReducedMotion } from './useReducedMotion';
import { todayStr, addDays, fmtD, parseD } from '../../lib/dates';
import type { Task } from '../../db/types';

function relLabel(selDate: string, today: string): string {
  if (selDate === today) return 'Today';
  if (selDate === addDays(today, 1)) return 'Tomorrow';
  if (selDate === addDays(today, -1)) return 'Yesterday';
  return parseD(selDate).toLocaleDateString('en-US', { weekday: 'long' });
}

function SortableTaskRow({
  t,
  goal,
  onToggle,
  onRemove,
  reducedMotion,
}: {
  t: Task;
  goal: { id: string; title: string } | null | undefined;
  onToggle: () => void;
  onRemove: () => void;
  reducedMotion: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-[12px] py-[7px] px-[8px] -mx-[8px] rounded-field hover:bg-hover"
    >
      <button
        type="button"
        className="text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-grab active:cursor-grabbing touch-none flex-shrink-0 transition-opacity"
        aria-label={`Drag to reorder "${t.title}"`}
        {...attributes}
        {...listeners}
      >
        <GripIcon />
      </button>
      <TodayCheckbox checked={t.done} onToggle={onToggle} ariaLabel={`Mark "${t.title}" done`} />
      <span
        className={`flex-1 min-w-0 truncate text-[.9rem] transition-colors duration-150 ${
          t.done ? 'line-through text-faint' : 'text-ink-soft'
        }`}
      >
        {t.title}
      </span>
      {goal && <Tag label={goal.title} />}
      <button
        type="button"
        className="text-faint text-[.8rem] hover:text-[#B4453A] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        onClick={onRemove}
        aria-label={`Remove task "${t.title}"`}
      >
        ✕
      </button>
    </div>
  );
}

export function TasksCard() {
  const { tasks, goals, selDate, actions } = useAppStore();
  const today = todayStr();
  const isToday = selDate === today;
  const rel = relLabel(selDate, today);
  const reducedMotion = useReducedMotion();
  const [taskGoalId, setTaskGoalId] = useState('');

  const dayTasks = tasks.filter((t) => t.date === selDate);
  const overdue = tasks.filter((t) => !t.done && t.date < today);
  const doneCount = dayTasks.filter((t) => t.done).length;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      actions.reorderTasks(String(active.id), String(over.id));
    }
  }

  function handleAddKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const input = e.target as HTMLInputElement;
      const val = input.value.trim();
      if (val) {
        actions.addTask(val, selDate, taskGoalId || null);
        input.value = '';
      }
    }
  }

  const navBtn =
    'w-[26px] h-[26px] rounded-[7px] border border-line-2 text-[.86rem] text-chip-ink hover:bg-hover grid place-items-center';

  return (
    <CardSection
      label="Tasks"
      meta={
        <span className="font-mono text-[.72rem] text-faint">
          {doneCount} OF {dayTasks.length} DONE
        </span>
      }
      right={
        <div className="flex items-center gap-[6px]">
            <button type="button" className={navBtn} onClick={() => actions.shiftDay(-1)} aria-label="Previous day">
              ‹
            </button>
            <span className="font-disp text-[.94rem] font-semibold">
              {rel}{' '}
              <span className="font-mono text-[.66rem] font-normal text-muted tracking-[.04em]">
                {fmtD(selDate).toUpperCase()}
              </span>
            </span>
            <button type="button" className={navBtn} onClick={() => actions.shiftDay(1)} aria-label="Next day">
              ›
            </button>
            {!isToday && (
              <button
                type="button"
                className="px-[9px] h-[26px] rounded-[7px] border border-line-2 text-[.76rem] text-chip-ink hover:bg-hover"
                onClick={() => actions.goToToday()}
              >
                Today
              </button>
            )}
          </div>
      }
    >
      {isToday && overdue.length > 0 && (
        <div className="mb-[10px] border border-line-soft rounded-[10px] px-[10px] py-[8px] bg-panel-bright">
          <div className="font-mono text-[.66rem] font-semibold tracking-[.12em] uppercase text-warn mb-[4px]">
            Overdue
          </div>
          {overdue.map((t) => {
            const goal = t.goalId ? goals.find((g) => g.id === t.goalId) : null;
            return (
              <div key={t.id} className="flex items-center gap-[10px] py-[4px] group">
                <TodayCheckbox checked={t.done} onToggle={() => actions.toggleTask(t.id)} ariaLabel={`Mark "${t.title}" done`} />
                <span className="flex-1 min-w-0 truncate text-[.88rem] text-ink-soft">{t.title}</span>
                <span className="font-mono text-[.66rem] text-muted tabular-nums">{fmtD(t.date).toUpperCase()}</span>
                {goal && <Tag label={goal.title} />}
                <button
                  type="button"
                  onClick={() => actions.moveTaskToDate(t.id, today)}
                  className="text-[.76rem] text-ink-soft px-[7px] py-[2px] rounded-[5px] border border-line-2 hover:bg-hover"
                >
                  → today
                </button>
                <button
                  type="button"
                  onClick={() => actions.removeTask(t.id)}
                  aria-label={`Remove task "${t.title}"`}
                  className="text-faint text-[.8rem] hover:text-[#B4453A] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {dayTasks.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">
          Nothing planned for {rel.toLowerCase()}. Add a task to fill it in.
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={dayTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {dayTasks.map((t) => (
            <SortableTaskRow
              key={t.id}
              t={t}
              goal={t.goalId ? goals.find((g) => g.id === t.goalId) : null}
              onToggle={() => actions.toggleTask(t.id)}
              onRemove={() => actions.removeTask(t.id)}
              reducedMotion={reducedMotion}
            />
          ))}
        </SortableContext>
      </DndContext>

      <div className="flex gap-[8px] mt-[10px]">
        <input
          className="flex-1 min-w-0 bg-field border border-line-2 rounded-field px-[12px] py-[8px] text-[.88rem] text-ink outline-none placeholder:text-faint"
          placeholder={`Plan a task for ${rel.toLowerCase()}…`}
          onKeyDown={handleAddKeyDown}
          aria-label={`Add a task for ${rel.toLowerCase()}`}
        />
        <select
          className="bg-field border border-line-2 rounded-field px-[8px] text-[.78rem] text-chip-ink outline-none"
          value={taskGoalId}
          onChange={(e) => setTaskGoalId(e.target.value)}
          aria-label="Tag new task to a goal"
        >
          <option value="">no goal</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      </div>
    </CardSection>
  );
}
```

- [ ] **Step 2: Swap into `Today.tsx`**

Replace the moved tasks block (SectionLabel "Tasks" + day navigator + overdue + DndContext + add row) with `<TasksCard />`. Delete now-unused code from `Today.tsx`: `SortableTaskRow`, `taskGoalId` state, `handleTaskKeyDown`, `handleTaskDragEnd`, `taskIds`, `dayTasks`, `overdue`, dnd imports, `rel`/`wd`/`isToday` locals if only the study-log section still uses `rel` (it does — keep `rel` until Task 9, or inline it there).

- [ ] **Step 3: Verify and commit**

Run: `npm run build` — exits 0.
Visual: ‹ › in the card header move the selected day (and the week strip highlight follows); "Today" return button appears when off-today; overdue block with `→ today`; add row with goal select; dnd reorder; Enter adds.

```bash
git add src/views/today/TasksCard.tsx src/views/Today.tsx
git commit -m "feat(today): tasks card with in-header day navigator and overdue block"
```

---

### Task 9: Study log card

**Files:**
- Create: `src/views/today/StudyLogCard.tsx`
- Modify: `src/views/Today.tsx` (replace study-log section with `<StudyLogCard />`)

**Interfaces:**
- Consumes: `CardSection`, `Tag`; store `sessions`, `goals`, `selDate`, `actions.addSession/removeSession`; `minutesOn`, `minutesThisWeek`, `fmtMinutes` from `src/lib/sessions.ts`; `todayStr`, `addDays` from dates.
- Produces: `StudyLogCard()` — no props.

- [ ] **Step 1: Create `src/views/today/StudyLogCard.tsx`**

```tsx
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useAppStore } from '../../state/store';
import { CardSection } from '../../components/CardSection';
import { Tag } from '../../components/Tag';
import { todayStr, addDays } from '../../lib/dates';
import { minutesOn, minutesThisWeek, fmtMinutes } from '../../lib/sessions';

export function StudyLogCard() {
  const { sessions, goals, selDate, actions } = useAppStore();
  const today = todayStr();
  const rel =
    selDate === today ? 'today' : selDate === addDays(today, 1) ? 'tomorrow' : selDate === addDays(today, -1) ? 'yesterday' : 'that day';
  const daySessions = sessions.filter((s) => s.date === selDate);
  const [logMins, setLogMins] = useState('30');
  const [logGoalId, setLogGoalId] = useState('');

  function handleNoteKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const mins = parseInt(logMins, 10);
      if (mins > 0) {
        actions.addSession(logGoalId || null, selDate, mins, (e.target as HTMLInputElement).value.trim());
        (e.target as HTMLInputElement).value = '';
      }
    }
  }

  return (
    <CardSection
      label="Study log"
      right={
        <span className="font-mono text-[.72rem] text-muted tracking-[.04em]">
          {fmtMinutes(minutesThisWeek(sessions, today)).toUpperCase()} THIS WEEK
        </span>
      }
    >
      {daySessions.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">Nothing logged for {rel} yet.</div>
      )}
      {daySessions.map((s) => {
        const goal = s.goalId ? goals.find((g) => g.id === s.goalId) : null;
        return (
          <div key={s.id} className="group flex items-center gap-[12px] py-[7px] px-[8px] -mx-[8px] rounded-field hover:bg-hover">
            <span className="font-mono text-[.78rem] font-semibold text-ink w-[48px] flex-none tabular-nums">
              {fmtMinutes(s.minutes)}
            </span>
            <span className="flex-1 min-w-0 truncate text-[.88rem] text-ink-soft">{s.note || 'Session'}</span>
            {goal && <Tag label={goal.title} />}
            <button
              type="button"
              onClick={() => actions.removeSession(s.id)}
              aria-label="Remove session"
              className="text-faint text-[.8rem] hover:text-[#B4453A] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            >
              ✕
            </button>
          </div>
        );
      })}
      {daySessions.length > 0 && (
        <div className="font-mono text-[.68rem] text-muted mt-[4px] tabular-nums">
          {fmtMinutes(minutesOn(sessions, selDate))} TOTAL
        </div>
      )}
      <div className="flex gap-[8px] mt-[10px]">
        <input
          type="number"
          min={1}
          max={600}
          value={logMins}
          onChange={(e) => setLogMins(e.target.value)}
          aria-label="Minutes"
          className="w-[60px] bg-field border border-line-2 rounded-field px-[10px] py-[8px] text-[.88rem] text-ink tabular-nums outline-none"
        />
        <input
          className="flex-1 min-w-0 bg-field border border-line-2 rounded-field px-[12px] py-[8px] text-[.88rem] text-ink outline-none placeholder:text-faint"
          placeholder="What did you work on?"
          aria-label="Session note"
          onKeyDown={handleNoteKeyDown}
        />
        <select
          className="bg-field border border-line-2 rounded-field px-[8px] text-[.78rem] text-chip-ink outline-none"
          value={logGoalId}
          onChange={(e) => setLogGoalId(e.target.value)}
          aria-label="Tag session to a goal"
        >
          <option value="">no goal</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      </div>
    </CardSection>
  );
}
```

- [ ] **Step 2: Swap into `Today.tsx`** — replace the moved study-log IIFE block with `<StudyLogCard />`; delete now-unused locals/imports (`logMins`, `logGoalId`, `rel`, `wd`, sessions imports). After this task `Today.tsx` should be a thin composition root — roughly: imports, quick-add state, hero grid, `<WeekStrip />`, left column `<HabitsCard /><TasksCard /><StudyLogCard />`, right column placeholder.

- [ ] **Step 3: Verify and commit**

Run: `npm run build` — exits 0. Visual: log rows on selected day; Enter logs; week total in header updates.

```bash
git add src/views/today/StudyLogCard.tsx src/views/Today.tsx
git commit -m "feat(today): study log card"
```

---

### Task 10: Goals & Projects card (right column)

**Files:**
- Create: `src/views/today/GoalsCard.tsx`
- Modify: `src/views/Today.tsx` (mount in right column; wire `focusQuick`)

**Interfaces:**
- Consumes: `CardSection`; store `goals`, `actions.openDrawer`; `goalPct` from `src/lib/pct.ts`; `firstOpenLeaf` from `src/lib/tree.ts`; `deadlineChip` (Task 2); `todayStr`.
- Produces: `GoalsCard({ onAddGoal }: { onAddGoal: () => void })`.

- [ ] **Step 1: Create `src/views/today/GoalsCard.tsx`**

```tsx
import { useAppStore } from '../../state/store';
import { CardSection } from '../../components/CardSection';
import { goalPct } from '../../lib/pct';
import { firstOpenLeaf } from '../../lib/tree';
import { deadlineChip } from '../../lib/today';
import { todayStr } from '../../lib/dates';

export function GoalsCard({ onAddGoal }: { onAddGoal: () => void }) {
  const { goals, actions } = useAppStore();
  const today = todayStr();

  return (
    <CardSection
      label="Goals & projects"
      className="pb-[6px]"
      right={
        <button
          type="button"
          onClick={onAddGoal}
          className="px-[13px] py-[6px] rounded-field bg-ink text-paper text-[.8rem] font-semibold hover:bg-ink-hover"
        >
          + Goal
        </button>
      }
    >
      {goals.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">No goals yet — add your first above.</div>
      )}
      {goals.map((g) => {
        const pct = Math.round(goalPct(g));
        const next = firstOpenLeaf(g.nodes);
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => actions.openDrawer(g.id)}
            className="w-full text-left py-[11px] flex flex-col gap-[7px] border-b border-line-soft last:border-b-0 hover:bg-hover -mx-[8px] px-[8px] rounded-field"
          >
            <span className="flex items-baseline gap-[10px]">
              <span className="font-disp text-[.98rem] font-semibold flex-1 min-w-0 truncate">{g.title}</span>
              <span className="font-mono text-[.62rem] tracking-[.05em] text-muted flex-none tabular-nums">
                {deadlineChip(g.deadline, today)}
              </span>
            </span>
            <span className="block h-[4px] rounded-full bg-track overflow-hidden">
              <span
                className={`block h-full rounded-full ${pct > 0 ? 'bg-fill' : 'bg-[#D5C9AE]'}`}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </span>
            <span className="flex items-baseline gap-[10px]">
              <span className="text-[.76rem] text-muted flex-1 min-w-0 truncate">
                Next: {next ? next.title : 'Define the first step'}
              </span>
              <span className="font-mono text-[.7rem] text-ink-soft flex-none tabular-nums">{pct}%</span>
            </span>
          </button>
        );
      })}
    </CardSection>
  );
}
```

- [ ] **Step 2: Mount in `Today.tsx` right column**

```tsx
        <div className="flex flex-col gap-[18px] min-w-0">
          <GoalsCard onAddGoal={() => focusQuick('goal')} />
          {/* MiniCalendar mounts here in Task 11 */}
        </div>
```

Remove the temporary `void focusQuick;` if it was added in Task 5.

- [ ] **Step 3: Verify and commit**

Run: `npm run build` — exits 0. Visual: goal rows with serif titles, mono deadline chips (`DEC 31 · 182D`), 4px bars, roll-up %, Next line; clicking opens the drawer; "+ Goal" focuses Quick Add with Goal pill active.

```bash
git add src/views/today/GoalsCard.tsx src/views/Today.tsx
git commit -m "feat(today): goals & projects card with roll-up bars and next actions"
```

---

### Task 11: Mini calendar

**Files:**
- Create: `src/views/today/MiniCalendar.tsx`
- Modify: `src/views/Today.tsx` (mount below GoalsCard)

**Interfaces:**
- Consumes: `ymOf`, `shiftYm`, `ymLabel`, `monthGrid` from `src/lib/calendar.ts`; store `tasks`, `selDate`, `actions.setSelDate`; `todayStr`, `parseD`.
- Produces: `MiniCalendar()` — no props. Local `useState` for the displayed month.

- [ ] **Step 1: Create `src/views/today/MiniCalendar.tsx`**

```tsx
import { useState } from 'react';
import { useAppStore } from '../../state/store';
import { todayStr, parseD } from '../../lib/dates';
import { ymOf, shiftYm, ymLabel, monthGrid } from '../../lib/calendar';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function MiniCalendar() {
  const { tasks, selDate, actions } = useAppStore();
  const today = todayStr();
  const [ym, setYm] = useState(ymOf(today));
  const [monthName, year] = ymLabel(ym).split(' ');
  const planned = new Set(tasks.filter((t) => !t.done).map((t) => t.date));

  const navBtn =
    'w-[24px] h-[24px] rounded-[7px] border border-line-2 text-[.8rem] text-chip-ink hover:bg-hover grid place-items-center';

  return (
    <section className="bg-panel border border-line rounded-card shadow-card px-[18px] pt-[15px] pb-[12px]">
      <div className="flex items-center mb-[10px]">
        <span className="font-disp text-[.98rem] font-semibold">
          {monthName} <span className="text-muted font-medium">{year}</span>
        </span>
        <div className="flex-1" />
        <div className="flex gap-[4px]">
          <button type="button" aria-label="Previous month" className={navBtn} onClick={() => setYm(shiftYm(ym, -1))}>
            ‹
          </button>
          <button type="button" aria-label="Next month" className={navBtn} onClick={() => setYm(shiftYm(ym, 1))}>
            ›
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-[1px] mb-[4px]">
        {DAY_LETTERS.map((l, i) => (
          <span key={i} className="text-center font-mono text-[.58rem] text-faint">
            {l}
          </span>
        ))}
      </div>
      {monthGrid(ym).map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 gap-[1px]">
          {week.map((d) => {
            const inMonth = d.slice(0, 7) === ym;
            if (!inMonth) return <span key={d} className="h-[32px]" />;
            const isToday = d === today;
            const sel = d === selDate;
            const hasDot = planned.has(d) && !isToday;
            return (
              <button
                key={d}
                type="button"
                onClick={() => actions.setSelDate(d)}
                aria-label={`Plan ${d}`}
                aria-pressed={sel}
                className="h-[32px] flex flex-col items-center justify-center gap-[1px]"
              >
                <span
                  className={`w-[24px] h-[24px] rounded-full grid place-items-center text-[.76rem] ${
                    isToday
                      ? 'bg-accent text-accent-contrast font-semibold'
                      : sel
                        ? 'shadow-[inset_0_0_0_1.5px_#211E19] text-ink font-medium'
                        : d < today
                          ? 'text-faint hover:bg-hover'
                          : 'text-ink-soft hover:bg-hover'
                  }`}
                >
                  {parseD(d).getDate()}
                </span>
                <span className={`w-[4px] h-[4px] rounded-full ${hasDot ? 'bg-accent' : 'bg-transparent'}`} />
              </button>
            );
          })}
        </div>
      ))}
      <div className="mt-[6px] text-[.72rem] text-faint">Dots mark planned items · click a day to plan it</div>
    </section>
  );
}
```

- [ ] **Step 2: Mount in `Today.tsx`** right column, after `<GoalsCard … />`:

```tsx
          <MiniCalendar />
```

- [ ] **Step 3: Verify and commit**

Run: `npm run build` — exits 0. Visual: current month; today filled terracotta; days with open tasks show a dot; clicking a day drives the Tasks card + week strip selection; ‹ › paginate months; out-of-month cells blank.

```bash
git add src/views/today/MiniCalendar.tsx src/views/Today.tsx
git commit -m "feat(today): mini calendar with planned-day dots"
```

---

### Task 12: Footer stats

**Files:**
- Create: `src/views/today/FooterStats.tsx`
- Modify: `src/views/Today.tsx` (mount after the main grid)

**Interfaces:**
- Consumes: store `habits`, `sessions`; `streak`, `todayStr` from dates; `minutesThisWeek`, `fmtMinutes` from sessions; `habitHitPct` (Task 2).
- Produces: `FooterStats()` — no props. Also carries the keyboard hint (formerly in the sidebar footer).

- [ ] **Step 1: Create `src/views/today/FooterStats.tsx`**

```tsx
import { useAppStore } from '../../state/store';
import { todayStr, streak } from '../../lib/dates';
import { minutesThisWeek, fmtMinutes } from '../../lib/sessions';
import { habitHitPct } from '../../lib/today';

export function FooterStats() {
  const { habits, sessions } = useAppStore();
  const today = todayStr();
  const weekMin = minutesThisWeek(sessions, today);
  const best = habits.reduce<{ n: number; title: string } | null>((acc, h) => {
    const n = streak(h);
    return !acc || n > acc.n ? { n, title: h.title } : acc;
  }, null);

  const stats: { value: string; label: string }[] = [
    { value: weekMin > 0 ? fmtMinutes(weekMin).toLowerCase() : '0m', label: 'LOGGED THIS WEEK' },
  ];
  if (best) stats.push({ value: `${best.n}d`, label: `BEST STREAK — ${best.title.toUpperCase()}` });
  if (habits.length > 0) stats.push({ value: `${habitHitPct(habits, today, 20)}%`, label: 'HABIT HITS — LAST 20 DAYS' });

  return (
    <footer className="mt-[24px] border-t border-line pt-[16px] pb-[26px] flex gap-[56px] items-baseline flex-wrap">
      {stats.map((s) => (
        <div key={s.label}>
          <div className="font-disp text-[1.4rem] font-semibold">{s.value}</div>
          <div className="font-mono text-[.6rem] tracking-[.1em] text-muted mt-[2px]">{s.label}</div>
        </div>
      ))}
      <div className="flex-1" />
      <span className="font-mono text-[.6rem] tracking-[.08em] text-faint">
        1–4 SWITCH VIEWS · T TODAY · ESC CLOSES
      </span>
    </footer>
  );
}
```

- [ ] **Step 2: Mount in `Today.tsx`** after the `.today-main` grid:

```tsx
      <FooterStats />
```

- [ ] **Step 3: Verify and commit**

Run: `npm run build` — exits 0. Visual: three serif stats + mono labels; keyboard hint on the right; stats hide gracefully with no habits.

```bash
git add src/views/today/FooterStats.tsx src/views/Today.tsx
git commit -m "feat(today): footer stats and keyboard hint"
```

---

### Task 13: Identity sweep + full QA

**Files:**
- Modify: anything the sweep catches (expected: little or nothing)

- [ ] **Step 1: Sweep for old-identity leftovers**

Run: `grep -rn "5D6B82\|b06a4f\|FCFCFB\|EBEEF3\|heat-d\|TodayHeatmap" src/`
Expected: no matches. Fix any stragglers (old slate hex → `#C8512F`; deleted classes/components → remove references).

Run: `grep -rn "bg-white\|stroke-white" src/`
Expected: no `bg-white`. Any `stroke-white` on checkmarks should have become `stroke-accent-contrast` (Tasks 4–5).

- [ ] **Step 2: Full-app visual pass** (`npm run dev`)

Walk all four views + drawer against this checklist:
- **Today**: everything from Tasks 5–12; also `Esc` closes drawer, `t` returns to today, undo toast appears on delete and restores.
- **Goals / Timeline / Calendar**: readable on cream; hairlines, hovers, tags, progress fills, timeline today-line and bars all re-skinned via tokens; no white boxes; drawer (bg-panel) contrasts with scrim.
- Narrow the window below 1160px: hero and main grids stack; below 1000px habit dots hide.
- `prefers-reduced-motion` (toggle in devtools rendering panel): no transitions.

Fix anything broken with minimal, token-based edits (no layout redesigns of the other three views — that's a later phase).

- [ ] **Step 3: Final verification**

Run: `npm test` — Expected: all suites PASS.
Run: `npm run build` — Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(theme): old-identity sweep + cross-view QA fixes"
```

---

## Out of scope (future phases — do not do now)

- Layout redesigns of Goals, Timeline, Calendar views (they only get the token re-skin here).
- Command palette, habit editing (rename/cadence change), week-strip drag-planning.
- Mobile (<720px) layout beyond the two breakpoints above.
- Removing `src/components/Checkbox.tsx`/`Icons.tsx` dead exports (Icons still used? `IconSun` etc. become unused after Task 3 — the build's `noUnusedLocals` only flags locals, not exports; leave the file).
