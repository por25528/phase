# Timeline Canvas + Calendar Removal + Info Density — Design

**Date:** 2026-07-04
**Status:** Approved

## Problem

- The Timeline renders a fixed date window (month/quarter/year) inside a 1280px container with page-flip prev/next navigation. It feels small and boxed-in.
- The Calendar page is barely used; its only unique value is day-level detail (task dots, habit check-ins, deadline/milestone flags per day).
- The Timeline and Goals board feel plain. Desired direction: **more info density** — quiet data, no decoration — while staying minimal and compact.

## §1 — Timeline: infinite scroll canvas

The timeline becomes a horizontally scrollable canvas where **zoom = a fixed pixel-per-day scale**:

| Zoom | px/day | ~visible in 1200px |
|------|--------|--------------------|
| Week | 130 | ~9 days |
| Month | 40 | ~30 days |
| Quarter | 13 | ~92 days |

- Scroll freely through time in both directions; nearing an edge quietly extends the canvas (infinite scroll). No prev/next page-flips.
- The 200px goal-label column is sticky-left; a sticky time header shows month/day labels appropriate to the zoom.
- **Today** button smooth-scrolls today to viewport center; the today-line stays.
- Switching zoom preserves the date at the viewport center — zooming feels like leaning in, not teleporting.
- `[` / `]` scroll by one period (7 / 30 / 91 days).
- The Timeline view goes **full-bleed** (drops the 1280px cap; other views keep it).
- All drag/resize/snap interactions carry over; drag math simplifies (constant px/day per zoom).
- **Year zoom is deleted, Week zoom is added**: `ZoomLevel = 'week' | 'month' | 'quarter'`. Persisted `'year'` (IndexedDB settings and old export JSON) migrates to `'quarter'`.

## §2 — Week zoom absorbs the Calendar; Calendar page deleted

- Week zoom is the home for day-level detail: real day columns with day-number header buttons, plus a slim **DaysLane** under the time header showing per-day task counts and habit check-in dots (what the Calendar grid used to show).
- Clicking a day header opens the Today view at that date (same behavior as clicking a Calendar cell today).
- Deadline ⚑ and milestone ◆ markers stay on goal rows at every zoom.
- The Calendar page, its nav button, and the `4` shortcut are removed — nav becomes Today / Goals / Timeline (`1`/`2`/`3`). `src/lib/calendar.ts` stays (MiniCalendar in Today depends on it).

## §3 — Info density (quiet data, no decoration)

- **Timeline rows:** under each goal title in the label column, a muted one-liner `42% · 18d left`, plus the existing behind-pace chip (extracted into a shared `BehindChip` component — it's currently duplicated inline in Goals.tsx and today/GoalsCard.tsx).
- **Goals board cards:** add a quiet `exp N%` expected-progress stat (from `expectedPct`) to the card meta row; cards already carry %, days-left, pace chip, and next action.
- Everything stays within the locked palette and compact spacing — more information, not more ornament.

## Canvas mechanics (implementation-defining decisions)

- **State:** `range: DateRange` (inclusive), grown on demand; `pendingCenter` ref consumed by a layout effect (mount + zoom change both center through it); rAF-throttled `headerCenter` drives only the mono header label.
- **Positioning:** `dateToX(date, rangeStart, pxPerDay) = daysBetween(rangeStart, date) * pxPerDay`; bars keep exclusive-end width semantics with an 8px minimum.
- **Extension without scroll-jump:** on scroll near an edge, prepend/append ~3000px worth of days; a `useLayoutEffect` keyed on `range.start` compensates `scrollLeft += shiftedDays * pxPerDay` after DOM mutation, before paint.
- **`initialRange`** spans all goal/node/milestone dates + today (+ optional center), padded ~4000px per side — every bar is always on-canvas, so SpanBar's out-of-window branch is deleted.
- **Layout:** one scroll container (`overflow-auto`, `max-h`) hosts both stickies; opaque token backgrounds (`bg`, `panel`, `hover`) let sticky cells occlude bars passing underneath.

## Alternatives considered

- **A: Keep windowed nav, just bigger** — smallest change, but keeps the page-flip feel; rejected.
- **C: Hybrid carousel (prev/current/next windows in a scroll strip)** — scroll-y feel with old window math, but recenter jank and cross-window drag complexity; rejected.
- **B (chosen): continuous canvas, fixed px/day per zoom** — standard Gantt/roadmap pattern; delivers "bigger + infinite", simplifies drag math, gives Week zoom natural day columns for the absorbed calendar detail.
