# Remaster brief — audit and delta

Audit of the checked-in product against a fresh UX/UI remaster brief (Goal
workspace, inspector, rows, Plan, Board, keyboard, density, visual system).

The headline finding: **a large fraction of the brief is already built.** Phase
shipped S1–S17 of `docs/superpowers/plans/2026-08-09-product-remaster.md`, which
covers the same ground the brief covers, and the brief appears to have been
written against older screenshots. Building it literally would mean rewriting
working surfaces. What follows separates what exists from what genuinely does not.

Baseline at audit time: 113 test files, 2245 tests, all passing.

## Already satisfied — no work warranted

| Brief | Ask | Where it already lives |
|---|---|---|
| §1 | Goal tabs over one task store | `Project.tsx:9-14` — Work / Board / Calendar / Notes, `role="tablist"`, arrow-key roving tabindex. No duplicated state: every tab reads `goal.nodes`. |
| §8 | Remove permanent tutorial UI | Already conditional. `showPlanHint()` (`lib/planHint.ts:53`) retires the hint the moment any work is placed. `Plan.tsx:609`. |
| §9 | Board is a projection, not separate objects | `goalBoard()` projects over `goal.nodes`; a drop calls `setNodeStatus`. Confirmed no board-local state. |
| §10 | Global IA: Today · Plan · Goals + Search + Add + ⋯ | `App.tsx:57-61`, `:290-343`. Timeline is already demoted to a Goals view mode. |
| §11 | Compact goal header, not a hero | `ProjectHeader.tsx:86` — `min-h-[48px]`, breadcrumb on the header line, status cluster collapsed into one popover trigger, ⋯ for lifecycle. |
| §14 | Lightweight goal creation | S13 shipped two-field creation with type-specific starting points. |
| §15 | No fake AI | S15 shipped the inline acceptance surface; the round trip stays only because there is no provider. Fabricating one is what the brief itself forbids. |
| §16 | One system across Today/Plan/Goals | `WorkBlock` already lives inside the node/task, so the same object flows through all three. |

## Genuine gaps

Ranked by user-visible value per unit of risk.

### 1. Inspector is a form, not a property inspector — §3
`StepPanel.tsx` is a stack of `mt-[22px]` sections under eyebrow labels:
`Status` as a four-button radiogroup (`:191`), `Span` as start→end date fields
(`:244`), `Schedule` as Today / Tomorrow / Next free slot (`:263`), then
Estimate, Time logged, Progress, Notes. 300px wide; the brief wants 320–380.
No `↗` open action. No task list when a container is selected.

Blocked on: there is **no reusable popover primitive**. `HeaderMenu`,
`GoalMetaPopover` and BoardCard's menu each hand-roll anchoring, outside-
pointerdown and Escape. Compact properties that open popovers need one first.

### 2. Row controls are an admin toolbar — §4
A leaf row renders, always: grip, status box, title, schedule cell, estimate
control, log-time control. Then on hover: pencil, `+ sub`, `◐`, `✕`
(`GoalTree.tsx:695-911`). Six controls at rest, ten on hover. There is no `⋯`
overflow menu anywhere in the tree.

### 3. No Overview tab — §1
The workspace opens on Work. Nothing answers "what next / am I on track /
what's approaching" in one place; the pieces exist (`effort.ts`, `health.ts`,
`firstOpenLeaf`, `checkpoints.ts`) but are scattered across header and rows.

### 4. No milestone drill-down — §2
`openStep()` opens containers in the same inspector as leaves. There is no
route to a container as its own workspace, so the two-level model (click →
inspect, Enter/double-click/↗ → open) has only one level.

### 5. Keyboard is scattered, and `S` is taken — §6
No central registry: shortcuts live in `appKeyboard.ts`, `GoalTree.tsx`,
`BoardCard.tsx`, `CommandPalette.tsx` and `ShortcutsOverlay.tsx` independently.
`E` and `D` do not exist. **`S` already cycles status** (`GoalTree.tsx:636`),
so the brief's `S` = schedule is a direct collision.

### 6. Context is not preserved — §17
`openProject()` always resets `projectTab` to `'steps'`. No scroll restoration.
Back returns to the right view but not to the right place in it.

### 7. Plan rail affordance and density — §7
Already grouped by goal with counts and collapse. Missing: a visible drag
affordance (the whole row is draggable but carries no grip), and `BACKLOG_CAP`
is 3 per group, which hides most of the queue behind "+N more".

### 8. Global `+ Add` is not contextual — §10
Always opens task capture regardless of surface.

## Constraints any implementation must respect

`src/lib/designScale.test.ts` fails the build on:

1. Arbitrary font sizes — `text-[1.2rem]` etc. Named `fontSize` keys only.
2. Any radius outside `[4px]`, `[6px]`, `[11px]`, `rounded-field` (9px),
   `rounded-card` (14px).
3. A class declared in `index.css` that no markup uses.
4. Literal hex, `rgb()` or `hsl()` colours. Only `rgb(var(--c-*))`.
5. **Unicode icon glyphs** — `✕✓✎▶◆◇⠿⋯✦⚠⌕＋` are banned in markup. The
   brief's `⋯` and `⠿` must be `IconDots` / `IconGrip` from `Icons.tsx`.
6. A `fontSize` key colliding with a `colors` key.
7. `font-disp` outside `App.tsx`; `uppercase` outside the three weekday strips.

Plus the invariants in `CLAUDE.md` — notably that `status` never moves the
roll-up, `blocks` is absent rather than `[]`, and destructive edits are undoable.
