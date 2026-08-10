# Remaster round 2 — audit and prioritized plan

Second pass against the UI/UX remaster brief, one day after
`2026-08-09-remaster-brief-delta.md` and the S1–S17 slices of
`../superpowers/plans/2026-08-09-product-remaster.md`, all of which landed.

Baseline: `tsc -b` clean, 123 test files, 2404 tests passing.

Method: six parallel read-only audits (Today, Plan, Goals board, goal/task
detail, shell+palette+keyboard+a11y, cross-cutting visual system), then every
load-bearing claim re-verified by hand before it entered this document.

## Headline

The eight gaps in yesterday's audit are closed. `Popover` exists, the `⋯` row
menu exists, milestone drill-down exists, `TaskPage` exists, `+ Add` is
contextual. What is left is **narrower and more specific than the brief
implies**, and falls into four groups: four genuine product gaps, three
density/chrome corrections, one systemic hole, and a short list of real bugs.

## Rejected recommendations

Recorded because they will be proposed again by the next reader.

| Proposal | Why not |
|---|---|
| Invert the text-colour hierarchy; "only 4% of text is primary" | The count was wrong. Actual: `text-ink` 190, `text-muted` 211, `text-ink-soft` 98, `text-faint` 52 — a real four-level hierarchy already. |
| Retire `text-h3`, `text-micro`, `text-compact`, `text-badge` | `text-h3` and `text-micro` are both in use — `text-h3` in `.note-prose` (`index.css`), which a `.tsx`-only sweep misses. Retiring the other two is churn with no user-visible change. |
| Swap `rounded-field` (9px) and `rounded-card` (14px) | Controls rounding less than surfaces is correct and deliberate. |
| Move the estimate and `◐` behind hover | CLAUDE.md keeps the row controls that are also READOUTS visible. That is the rule, not an oversight. |
| Move the blocked reason into the `⋯` menu | It is what makes a blocked task actionable; hiding it lets a row say "Blocked" without saying what by. |
| Promote Today's section headings from `text-meta` to `text-ui` | A section label is fixed at `text-meta font-semibold text-muted`. A quiet eyebrow over larger content is the intended pattern. |
| Put a progress bar on the goal board card | `effort.ts`'s sentence is the deliberate honest default; a percentage silently changes basis. |
| Add a leading `1 ·` index to task rows | Noise; no decision it improves. |

## A. Product gaps (the brief's real remainder)

### A1. Goal Overview never answers "am I on track?" — brief §12
`OverviewTab.tsx` renders Next / Progress / Upcoming. It does not state a
forecast. The hard part is already built and merely misfiled:
`goalHealth()` is computed in `ProjectHeader.tsx:76`, and
`describeVelocity(projectVelocity(...))` in `GoalMetaPopover.tsx:86` — i.e.
the pace answer exists but is behind a popover, on the one surface whose whole
job is that question. Add FORECAST (at-pace vs target) and THIS WEEK
(n tasks · minutes), and give the first Next row a Schedule affordance.

### A2. Decomposition stops at "added" — brief §9
`ProposalPanel.tsx` parses a pasted list (heuristic, `lib/proposal.ts` —
correctly NOT fake AI) and calls `addChildren`. Missing: the contextual
invitation on an oversized leaf ("This looks larger than one focused work
session"), and the follow-through after accept ("You have 1h 25m free
tomorrow. Schedule first 3 →"). The panel closes on a dead end, which is the
one place the product's own slogan should land.

### A3. Backlog group headers under-report — brief §10
`Backlog.tsx:290` shows title + `pct`. The brief wants `0 / 12` and
`4h 20m unscheduled`. Inline estimate editing already works
(`EstimateControl` at `Backlog.tsx:114`) — only the group aggregate is missing.

### A4. Goal card hides the next action — brief §11
`nextOpenAction()` (`lib/plan.ts:401`) computes it; `BoardCard.tsx` shows only
the effort line. One quiet `Next: …` line is the card's largest momentum win.
No progress bar (see rejected).

## B. Density and chrome — brief §3, §6, §14

### B1. Kanban columns are four grey boxes
`BoardTab.tsx:198` — every column carries `bg-hover` at rest, and the card grip
(`:252`) is permanently visible. Brief §14 wants transparent at rest, tinted
only on drag-over, grip on hover.

### B2. The notes editor is a permanent outlined box
`.note-prose` (`index.css:210`) carries `border border-line` always, plus
`min-h-[120px]`. Brief §15 wants it to disappear until focused.

### B3. The Plan hint has no dismissal
`Plan.tsx:609` — `showPlanHint()` retires it only once work is placed. A user
who plans by keyboard, or who reads it and wants it gone, cannot dismiss it.

## C. Systemic — the one axis with no guard

`designScale.test.ts` enforces font sizes, radii, colours, icon glyphs, dashed
borders and type roles. It does **not** enforce spacing — and spacing is
exactly where drift happened: **152 distinct arbitrary px values**.

| Value | Count | On scale? |
|---|---|---|
| `py-[5px]` | 27 | no |
| `gap-[10px]` | 19 | no |
| `gap-[5px]` | 17 | no |
| `px-[9px]` | 15 | no |
| `py-[7px]` | 12 | no |
| `gap-[9px]` | 10 | no |
| `px-[13px]` | 9 | no |
| `py-[9px]` | 8 | no |

Also: each view sets its own vertical offset in `App.tsx:453–468`
(`py-[22px]`, `py-[18px]`, `py-[20px]`, `py-[28px]`) and its own measure
(Today 720px, Project 1100px, Goals 1280px). Switching tabs moves the page
title both vertically and horizontally.

The fix that lasts is the one the type scale already models: agree the steps,
migrate the offenders, and add the guard so the next feature cannot re-drift.

## D. Bugs and a11y (small, high confidence)

1. **Hand-rolled hover controls** — `EventBlock.tsx:157`, `EventBlock.tsx:173`,
   `Habits.tsx:241` use `opacity-0 group-hover:opacity-100` instead of
   `.quiet-control`. CLAUDE.md forbids this precisely because the class carries
   the `@media (hover: hover)` gate — so on touch these three are unreachable —
   and the 24px target floor.
2. **`EventBlock`'s complete toggle has no `aria-label`**, and a calendar block
   has no focus ring.
3. **Motion outside the 120–200ms band**: `ProgressBar` 250ms,
   `.tl-bar-fill` 300ms (`index.css:171`). `Project.tsx`'s `row.animate()`
   does not consult `useReducedMotion()` — the global CSS rule kills
   transitions, not Web Animations.
4. **`ShortcutsOverlay` is silent on scope** — `S`, `E`, `X` are leaf-only and
   `S` cannot reach `done`; `⌘↵` (insert sibling) is missing entirely.
5. **Palette lacks Move and Estimate** — `moveNode` exists in the store but is
   unreachable from `⌘K` (brief §17).

## Sequencing

The brief's order (Today first) does not match the findings: Today is the
surface in the best shape. Proposed order, product value first:

1. **D** — bugs and a11y. Small, independent, no design debate.
2. **A1 + A4** — the two "what next / on track" gaps, sharing `lib` work.
3. **B1 + B2** — Kanban and notes chrome.
4. **A3** — backlog aggregates.
5. **A2** — decomposition follow-through (largest, most design-sensitive).
6. **C** — spacing scale, migration and guard. Last: it touches many files and
   would conflict with every edit above.
7. **B3** — hint dismissal.
