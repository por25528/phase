# Plan Reachability — Design

**Date:** 2026-07-24
**Source:** `docs/feedback/2026-07-24-usability-experience-cs-student.md` (friction #1 and #4, top-fix #1)
**Scope:** One piece of a larger feedback set. Trustworthy metrics, recurring templates, and first-run
onboarding are deliberately separate specs.

## Problem

The weekly **Plan** ritual is the app's core loop, but it is the hardest thing to reach:

- **No keyboard route.** Nav shortcuts are `1` Today, `2` Goals, `3` Timeline, `t` today, `?` cheat
  sheet, `⌘N` capture (`src/lib/appKeyboard.ts`). Plan has none — it is a `Modal` opened only by
  "Plan week" buttons buried in two cards.
- **No nav presence.** The header advertises `1–3 · T · ⌘N · ?` but the most important recurring
  action isn't among them.
- **Fast-planning keys are invisible.** Inside the planner a focused step accepts `1–7` (weekday) and
  `0` (any day), but this is documented only in a hover `title` and one line of body text
  (`PlanWeekOverlay.tsx`), not in the `?` cheat sheet (`ShortcutsOverlay.tsx`).

## Approach

Plan **stays a modal** — it is a periodic ritual with a last-week recap pre-step and a deep-link
(`focusGoalId`) from board cards, not a persistent page. We make it reachable without changing those
semantics:

1. Hoist "is Plan open" from two local `useState`s into the store (the enabling refactor).
2. Add keyboard key `4` → open Plan.
3. Add a secondary "Plan week" action button to the header nav.
4. Surface `4` and the planner weekday keys in the `?` cheat sheet.

Rejected alternative: promoting Plan to a real fourth `view`. More faithful to "a tab," but it would
change modal→route semantics — recap gating, the focus-jump deep-link, and the planner's `1–7` key
guard (which currently relies on `modalRegistry.hasOpenModal()`) would all need rework. Higher risk for
no added user value here.

## Current state (verified)

- `PlanWeekOverlay` (`src/views/plan/PlanWeekOverlay.tsx`) is a `Modal size="full"`. Props:
  `{ open, onClose, focusGoalId?: string | null }`. It runs `ensureWeekRollover()` on open and shows a
  recap step first unless `focusGoalId` is set or the review is already reviewed.
- It is rendered **twice**, each with its own local state:
  - `src/views/Goals.tsx` — `planOpen` + `planFocusId`; `onPlan(id)` (board "Plan next step") opens it
    focused on a project.
  - `src/views/today/TodayWorkCard.tsx` — `planOpen` (no focus); button shows "· review" when a recap
    is pending.
- `UIState` in `src/state/store.ts` already holds transient UI overlay state globally
  (`openGoalId`, `drawerFocusNodeId`, `planReview`). App renders single instances of the drawer,
  task-capture, and shortcuts overlays. Plan is the odd one out.
- App's key handler (`src/App.tsx`) already:
  - Swallows all keys except `?`/`Esc` while the cheat sheet is open (`if (showShortcuts) … return`).
  - Guards view commands behind `if (modalRegistry.hasOpenModal()) return`, so digit keys don't switch
    views under an open `Modal` (the planner is one).
  These two guards mean `4` needs no special-casing — it slots in beside the view commands.

## Changes

### 1. Store — hoist Plan-open (`src/state/store.ts`)

- `interface UIState`: add
  ```ts
  planOpen: boolean;
  planFocusGoalId: string | null; // board "Plan next step" deep-link target
  ```
- Initial state literal: `planOpen: false,` and `planFocusGoalId: null,`.
- Actions:
  ```ts
  openPlan(focusGoalId?: string | null) {
    set({ planOpen: true, planFocusGoalId: focusGoalId ?? null });
  },
  closePlan() {
    set({ planOpen: false, planFocusGoalId: null });
  },
  ```

### 2. Keyboard — `4` opens Plan (`src/lib/appKeyboard.ts`)

- Add `'open-plan'` to the `AppKeyCommand` union.
- In `resolveAppKeyCommand`, beside the existing digit checks (after the modifier/editable guards):
  ```ts
  if (event.key === '4') return 'open-plan';
  ```
- `4` is the single canonical key — it extends the `1·2·3` sequence the header advertises. No `p` alias
  (one binding per action).

### 3. App wiring (`src/App.tsx`)

- Destructure `planOpen`, `planFocusGoalId`, and `planReview` from `useAppStore()`.
- In the key handler, alongside the view commands (i.e. after the `modalRegistry.hasOpenModal()`
  guard): `if (command === 'open-plan') actions.openPlan();`.
- Render one overlay next to the other App-level overlays:
  ```tsx
  <PlanWeekOverlay open={planOpen} focusGoalId={planFocusGoalId} onClose={actions.closePlan} />
  ```
  (Add the `PlanWeekOverlay` import.)
- Nav button — placed immediately after the `Timeline` pill in the header `<nav>`, styled as a
  **secondary/outline action** (distinct from the three destination pills, subordinate to the primary
  `+ Task` CTA), within locked tokens. Proposed:
  ```tsx
  <button
    type="button"
    onClick={() => actions.openPlan()}
    aria-haspopup="dialog"
    title="Plan your week (4)"
    className="px-[14px] py-[6px] rounded-full text-[.86rem] font-medium text-ink-soft border border-line-2 hover:bg-hover hover:text-ink"
  >
    Plan week
    {reviewWaiting && <span className="text-accent"> · review</span>}
  </button>
  ```
  where `const reviewWaiting = Boolean(planReview && planReview.entries.length > 0 && !planReview.reviewed);`
  (same predicate the Today card uses). It is an action, not a destination — no `aria-current`.
- Update the nav `title` tooltip to include `4 Plan` (e.g. `… Timeline · 4 Plan · T today · ⌘N …`).

### 4. Cheat sheet (`src/components/ShortcutsOverlay.tsx`)

- Add a row: `4 → Plan your week`.
- Add a small **"While planning a step"** sub-group (a labelled section within the existing `<dl>`)
  surfacing the previously hidden keys:
  - `1–7` → put the step on that weekday
  - `0` → any day this week

  These are context keys (they only act on a focused step inside the planner), so the label keeps the
  cheat sheet honest rather than implying they work globally.

### 5. Cleanup — one overlay, not two

- `src/views/Goals.tsx`: remove the `planOpen`/`planFocusId` `useState`, the `<PlanWeekOverlay>` render,
  and the now-unused import. `onPlan(id)` becomes `actions.openPlan(id)`.
- `src/views/today/TodayWorkCard.tsx`: remove the `planOpen` `useState`, the `<PlanWeekOverlay>` render,
  and the now-unused import. The button's `onClick` becomes `actions.openPlan()`.
- Both cards keep their existing "Plan week" buttons as contextual entry points; only the state owner
  moves to the store. (`noUnusedLocals` will flag any leftover import/state — clean them up.)

## Testing

- `src/lib/appKeyboard.test.ts`: `resolveAppKeyCommand({ key: '4' })` → `'open-plan'`; an editable
  target still yields `null` (and `Escape` → `'blur-target'`).
- `src/state/store.test.ts`: `openPlan('g1')` sets `planOpen: true` and `planFocusGoalId: 'g1'`;
  `openPlan()` sets `planFocusGoalId: null`; `closePlan()` clears both.
- Manual (`npm run dev`):
  - `4` opens Plan from Today, Goals, and Timeline; `Esc` closes it.
  - `4` does nothing while the planner is already open (its `1–7` still plan a focused step) or while the
    cheat sheet is open.
  - The nav "Plan week" button opens the modal and shows "· review" when a recap is pending.
  - Board "Plan next step" still opens the planner focused on that project (deep-link preserved).
  - The `?` cheat sheet lists `4` and the `1–7`/`0` planner keys.
- `npm test` and `npx tsc -b` green before commit.

## Out of scope

- Promoting Plan to a real fourth view.
- Any restyle beyond the one new nav button (visual identity is locked).
- The other feedback pieces (trustworthy metrics, recurring templates, first-run onboarding) — each its
  own spec.
