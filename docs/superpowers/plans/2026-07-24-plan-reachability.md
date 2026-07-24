# Plan Reachability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the weekly Plan modal a `4` keyboard route and a header nav button, surface the hidden `1–7`/`0` planner keys in the `?` cheat sheet, and drive Plan from a single store-owned overlay instead of two duplicated local ones.

**Architecture:** Hoist "is Plan open" from two component-local `useState`s into the global store (`useSyncExternalStore` singleton in `src/state/store.ts`), mirroring how the goal drawer already lives there. A single App-level `<PlanWeekOverlay>` reads that state; the keyboard handler, a new nav button, and the two existing card buttons all open it through `actions.openPlan()`. Plan stays a modal — no route/view change.

**Tech Stack:** React 18 + TypeScript + Vite, Tailwind (locked token palette), Vitest (node env, tests match `src/**/*.test.ts`). Store is a hand-rolled `useSyncExternalStore` with an `actions` object and a private `set()` that persists+notifies.

## Global Constraints

- **Visual identity is locked.** No new hex values, no new fonts. Reuse existing Tailwind tokens only (`ink`, `ink-soft`, `paper`, `muted`, `faint`, `accent`, `line`, `line-2`, `line-soft`, `hover`, `hover-deep`, `panel`, `field`…).
- **`4` is the single canonical Plan key** — no `p` alias (one binding per action). It extends the `1·2·3` view sequence.
- **Plan stays a modal**, not a view. Do not add a `'plan'` `ViewName` or a fourth nav *tab*; the new nav item is an action button that opens the modal.
- **`tsconfig` has `noUnusedLocals` + `noUnusedParameters`** — when you delete code, delete its now-unused imports/state too, or `npm run build` fails.
- **Dates are local `'YYYY-MM-DD'` strings**; never store `Date` objects. (Not touched here, but the invariant holds.)
- **Never stage/commit `src/components/GoalTree.tsx`** (user WIP). Stage files explicitly by path — never `git add -A`.
- Commit messages follow the repo's conventional style: `feat(scope): …`, `fix(scope): …`, `chore: …`, and end with the `Co-Authored-By` trailer.
- Run `npm test` and `npx tsc -b` green at every commit.

## File map

- `src/state/store.ts` — add `planOpen` + `planFocusGoalId` UI state and `openPlan`/`closePlan` actions. (Task 1)
- `src/state/store.test.ts` — pin the two actions. (Task 1)
- `src/lib/appKeyboard.ts` — map key `4` → new `'open-plan'` command. (Task 2)
- `src/lib/appKeyboard.test.ts` — pin the mapping. (Task 2)
- `src/App.tsx` — handle `'open-plan'`, render the single store-driven overlay, add the nav button. (Tasks 3 + 4)
- `src/views/Goals.tsx` — drop local plan state/overlay; `onPlan` → `actions.openPlan(id)`. (Task 3)
- `src/views/today/TodayWorkCard.tsx` — drop local plan state/overlay; button → `actions.openPlan()`. (Task 3)
- `src/components/ShortcutsOverlay.tsx` — add `4` row + a "While planning a step" group. (Task 5)

---

### Task 1: Store — Plan-open state + `openPlan`/`closePlan`

The enabling refactor. Add global overlay state and two actions; nothing consumes them yet (safe, inert until Task 3).

**Files:**
- Modify: `src/state/store.ts` (`UIState`, initial `state` literal, `actions`)
- Modify: `src/state/store.test.ts` (append tests)

**Interfaces:**
- Produces: `FullState.planOpen: boolean`, `FullState.planFocusGoalId: string | null`, `actions.openPlan(focusGoalId?: string | null): void`, `actions.closePlan(): void`. Tasks 3 and 4 consume these.

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe('store actions', …)` block of `src/state/store.test.ts`, after the last test:

```ts
  describe('plan overlay', () => {
    it('openPlan opens the overlay and records the focus target', async () => {
      const { actions, getState } = await freshStore();
      expect(getState().planOpen).toBe(false);
      expect(getState().planFocusGoalId).toBeNull();
      actions.openPlan('g1');
      expect(getState().planOpen).toBe(true);
      expect(getState().planFocusGoalId).toBe('g1');
    });

    it('openPlan with no argument opens the overlay focused on nothing', async () => {
      const { actions, getState } = await freshStore();
      actions.openPlan();
      expect(getState().planOpen).toBe(true);
      expect(getState().planFocusGoalId).toBeNull();
    });

    it('closePlan clears both the overlay flag and the focus target', async () => {
      const { actions, getState } = await freshStore();
      actions.openPlan('g1');
      actions.closePlan();
      expect(getState().planOpen).toBe(false);
      expect(getState().planFocusGoalId).toBeNull();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/state/store.test.ts`
Expected: FAIL — `getState().planOpen` is `undefined`, and `actions.openPlan` is not a function.

- [ ] **Step 3: Add the state fields**

In `src/state/store.ts`, in `interface UIState`, add two lines right after `drawerFocusNodeId`:

```ts
  drawerFocusNodeId: string | null; // node the drawer should scroll to + highlight
  planOpen: boolean; // the weekly Plan modal — a global overlay like the drawer
  planFocusGoalId: string | null; // board "Plan next step" deep-link target
```

In the initial `state` literal, add two lines right after `drawerFocusNodeId: null,`:

```ts
  drawerFocusNodeId: null,
  planOpen: false,
  planFocusGoalId: null,
```

- [ ] **Step 4: Add the actions**

In `src/state/store.ts`, in the `// UI` region of the `actions` object, immediately after the `closeDrawer()` action, add:

```ts
  // The weekly Plan modal is a global overlay (like the drawer): the header
  // button, the `4` shortcut, and the board "Plan next step" deep-link all open
  // the single App-level <PlanWeekOverlay> through here.
  openPlan(focusGoalId?: string | null) {
    set({ planOpen: true, planFocusGoalId: focusGoalId ?? null });
  },

  closePlan() {
    set({ planOpen: false, planFocusGoalId: null });
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/state/store.test.ts`
Expected: PASS (all three new tests green, existing store tests still green).

- [ ] **Step 6: Verify the build**

Run: `npx tsc -b`
Expected: clean (no output / exit 0).

- [ ] **Step 7: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts
git commit -m "$(cat <<'EOF'
feat(plan): global openPlan/closePlan overlay state in the store

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Keyboard — `4` opens Plan

Add the pure key→command mapping. App doesn't handle the command yet (Task 3), so `4` is a harmless no-op after this task.

**Files:**
- Modify: `src/lib/appKeyboard.ts` (`AppKeyCommand` union, `resolveAppKeyCommand`)
- Modify: `src/lib/appKeyboard.test.ts` (append a test)

**Interfaces:**
- Produces: `AppKeyCommand` gains the `'open-plan'` member; `resolveAppKeyCommand({ key: '4' })` returns `'open-plan'`. Task 3 consumes it.

- [ ] **Step 1: Write the failing test**

In `src/lib/appKeyboard.test.ts`, add a new test inside the `describe('resolveAppKeyCommand', …)` block (e.g. after the "preserves the existing unmodified app shortcuts" test):

```ts
  it('routes 4 to the plan overlay, but not while typing', () => {
    expect(resolveAppKeyCommand({ key: '4' })).toBe('open-plan');
    expect(resolveAppKeyCommand({ key: '4', target: inputTarget })).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/appKeyboard.test.ts`
Expected: FAIL — `resolveAppKeyCommand({ key: '4' })` returns `null`, not `'open-plan'`.

- [ ] **Step 3: Implement the mapping**

In `src/lib/appKeyboard.ts`, add `'open-plan'` to the `AppKeyCommand` union:

```ts
export type AppKeyCommand =
  | 'capture-task'
  | 'blur-target'
  | 'close-drawer'
  | 'view-today'
  | 'view-goals'
  | 'view-timeline'
  | 'open-plan'
  | 'go-today'
  | 'toggle-shortcuts';
```

Then in `resolveAppKeyCommand`, add the `4` case immediately after the `'3'` case:

```ts
  if (event.key === '3') return 'view-timeline';
  if (event.key === '4') return 'open-plan';
  if (event.key === 't') return 'go-today';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/appKeyboard.test.ts`
Expected: PASS (new test green, existing appKeyboard tests still green).

- [ ] **Step 5: Verify the build**

Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/appKeyboard.ts src/lib/appKeyboard.test.ts
git commit -m "$(cat <<'EOF'
feat(plan): map the 4 key to an open-plan command

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: App switchover — one store-driven overlay, `4` wired, cards migrated

Render a single App-level `<PlanWeekOverlay>` driven by the store, handle `'open-plan'` in the key handler, and migrate both card entry points off their local state. This is one atomic task — doing it in pieces would double-render the overlay. Behavior is preserved and guarded by the existing `TodayWorkCard.test.ts` (which asserts the "Plan week" button still renders).

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/views/Goals.tsx`
- Modify: `src/views/today/TodayWorkCard.tsx`

**Interfaces:**
- Consumes: `actions.openPlan`, `actions.closePlan`, `planOpen`, `planFocusGoalId` (Task 1); the `'open-plan'` command (Task 2).
- Produces: exactly one `<PlanWeekOverlay>` render, at App level.

- [ ] **Step 1: Add the PlanWeekOverlay import to App**

In `src/App.tsx`, after the `ShortcutsOverlay` import (line ~8), add:

```ts
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { PlanWeekOverlay } from './views/plan/PlanWeekOverlay';
```

- [ ] **Step 2: Pull the plan state out of the store**

In `src/App.tsx`, add `planOpen` and `planFocusGoalId` to the `useAppStore()` destructure (line ~49):

```ts
const { view, openGoalId, drawerFocusNodeId, toast, pendingUndo, goals, hydration, secondTab, theme, planOpen, planFocusGoalId, actions } = useAppStore();
```

- [ ] **Step 3: Handle the `open-plan` command**

In `src/App.tsx`, in the `onKey` handler, add the handler alongside the view commands — right after the `view-timeline` line (it sits below the `if (modalRegistry.hasOpenModal()) return;` guard, so `4` cannot fire under an open modal like the planner itself):

```ts
      if (command === 'view-today') actions.setView('today');
      if (command === 'view-goals') actions.setView('goals');
      if (command === 'view-timeline') actions.setView('timeline');
      if (command === 'open-plan') actions.openPlan();
```

- [ ] **Step 4: Render the single overlay**

In `src/App.tsx`, in the overlays block, add the overlay right after `<ShortcutsOverlay … />`:

```tsx
      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <PlanWeekOverlay open={planOpen} focusGoalId={planFocusGoalId} onClose={actions.closePlan} />
```

- [ ] **Step 5: Migrate Goals off local plan state**

In `src/views/Goals.tsx`:

1. Delete the `PlanWeekOverlay` import (line ~27): `import { PlanWeekOverlay } from './plan/PlanWeekOverlay';`
2. Delete the two state lines (lines ~41–42):
   ```ts
   const [planOpen, setPlanOpen] = useState(false);
   const [planFocusId, setPlanFocusId] = useState<string | null>(null);
   ```
3. Replace the `onPlan` body (lines ~167–170) so it opens the shared overlay:
   ```ts
   // Board "Plan next step" opens the planner focused on this project (T9): the
   // planner jumps to planning, scrolls to the project's rail group, and pulses it.
   function onPlan(id: string) {
     actions.openPlan(id);
   }
   ```
4. Delete the whole `<PlanWeekOverlay … />` element near the end of the returned JSX (lines ~388–396):
   ```tsx
   <PlanWeekOverlay
     open={planOpen}
     onClose={() => {
       setPlanOpen(false);
       setPlanFocusId(null);
     }}
     focusGoalId={planFocusId}
   />
   ```

(`actions` is already destructured from `useAppStore()` in this component. `useState` is still used elsewhere in the file, so keep its import.)

- [ ] **Step 6: Migrate TodayWorkCard off local plan state**

In `src/views/today/TodayWorkCard.tsx`:

1. Delete the `PlanWeekOverlay` import (line ~8): `import { PlanWeekOverlay } from '../plan/PlanWeekOverlay';`
2. Delete the state line (line ~26): `const [planOpen, setPlanOpen] = useState(false);`
3. Change the "Plan week" button's `onClick` (line ~86) from `() => setPlanOpen(true)` to `() => actions.openPlan()`:
   ```tsx
   <button
     type="button"
     onClick={() => actions.openPlan()}
     className="px-[13px] py-[6px] rounded-field bg-ink text-paper text-[.8rem] font-semibold hover:bg-ink-hover"
   >
   ```
4. Delete the `<PlanWeekOverlay open={planOpen} onClose={() => setPlanOpen(false)} />` element (line ~250).

(`actions` is already destructured from `useAppStore()` here, and `useState` is still used for `doneOpen`/`pickingTaskId` — keep its import.)

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS — everything green, including `TodayWorkCard.test.ts` (the "Plan week" button text is unchanged).

- [ ] **Step 8: Verify the build**

Run: `npx tsc -b`
Expected: clean. If it complains about an unused `useState`/`PlanWeekOverlay` import or an unused `set*` binding, delete the leftover — you missed one of the removals above.

- [ ] **Step 9: Manual smoke test**

Run `npm run dev`:
- Press `4` on Today, Goals, and Timeline → the Plan modal opens. `Esc` closes it.
- Open the planner, focus a rail step, press `4` → it plans that step on Thursday (the modal guard means `4` does **not** re-open Plan).
- On Goals, a board card's "Plan next step" opens the planner scrolled to and pulsing that project.
- Today's work card "Plan week" button still opens the planner.

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx src/views/Goals.tsx src/views/today/TodayWorkCard.tsx
git commit -m "$(cat <<'EOF'
feat(plan): 4 opens the planner; one store-driven overlay

Hoist the Plan modal to a single App-level overlay driven by store
state and route the `4` key to it. Goals and Today's work card now
open the shared overlay via actions.openPlan instead of each owning
a duplicate PlanWeekOverlay + local state.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Nav — a "Plan week" action button in the header

Add the visible nav affordance: a secondary/outline action button after the `Timeline` pill, showing a "· review" hint when a recap is pending.

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `actions.openPlan` (Task 1), `planReview` (already on `FullState`).

- [ ] **Step 1: Pull `planReview` and derive the review flag**

In `src/App.tsx`, add `planReview` to the `useAppStore()` destructure:

```ts
const { view, openGoalId, drawerFocusNodeId, toast, pendingUndo, goals, hydration, secondTab, theme, planOpen, planFocusGoalId, planReview, actions } = useAppStore();
```

Then, near the other render-time derivations (just before `return (`, next to `const openGoal = …`), add:

```ts
// Mirror the Today card's cue: a pending, unreviewed recap flags the nav button.
const reviewWaiting = Boolean(planReview && planReview.entries.length > 0 && !planReview.reviewed);
```

- [ ] **Step 2: Add the button to the nav**

In `src/App.tsx`, inside the `<nav>`, immediately after the `.map(…)` that renders the three view pills closes (`))}`) and before `</nav>`, add:

```tsx
          ))}
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

- [ ] **Step 3: Update the nav tooltip**

In `src/App.tsx`, update the `<nav>` element's `title` to advertise `4`:

```tsx
        <nav className="flex gap-[4px]" title="Keyboard: 1–3 switch views · 4 plan week · T today · ⌘N add task · ? shortcuts · Esc closes">
```

- [ ] **Step 4: Verify tests + build**

Run: `npm test` → green.
Run: `npx tsc -b` → clean.

- [ ] **Step 5: Manual verify**

Run `npm run dev`:
- The header nav shows `Today · Goals · Timeline · [ Plan week ]`, the last as an outlined button distinct from the filled active pill and subordinate to the `+ Task` CTA.
- Clicking it opens the planner.
- When a new week's recap is pending, the button reads "Plan week · review" (accent). (You can trigger a pending recap by having last week's planned steps present; otherwise verify the plain state.)

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "$(cat <<'EOF'
feat(plan): add a Plan week action button to the header nav

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Cheat sheet — surface `4` and the planner weekday keys

Add a `4` row to the `?` overlay and a labelled "While planning a step" group for the previously-hidden `1–7`/`0` keys, so they don't read as global shortcuts.

**Files:**
- Modify: `src/components/ShortcutsOverlay.tsx`

**Interfaces:** none (presentational).

- [ ] **Step 1: Add the `4` row and the planner-keys list**

In `src/components/ShortcutsOverlay.tsx`, add a `4` entry to the `SHORTCUTS` array right after the Timeline row, and add a second list below it:

```ts
const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['1'], label: 'Today' },
  { keys: ['2'], label: 'Goals' },
  { keys: ['3'], label: 'Timeline' },
  { keys: ['4'], label: 'Plan your week' },
  { keys: ['T'], label: 'Jump to today' },
  { keys: ['⌘', 'N'], label: 'Add a task' },
  { keys: ['?'], label: 'This cheat sheet' },
  { keys: ['Esc'], label: 'Close drawer or dialog' },
];

// Context keys — they act only on a focused step inside the planner, so the
// overlay groups them separately rather than implying they work everywhere.
const PLANNER_KEYS: { keys: string[]; label: string }[] = [
  { keys: ['1–7'], label: 'Put the focused step on that weekday' },
  { keys: ['0'], label: 'Any day this week' },
];
```

- [ ] **Step 2: Extract a row component (DRY) and render both lists**

In `src/components/ShortcutsOverlay.tsx`, add a `ShortcutRow` helper above `ShortcutsOverlay`:

```tsx
function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-[16px]">
      <dt className="text-[.86rem] text-ink-soft">{label}</dt>
      <dd className="flex items-center gap-[4px]">
        {keys.map((key) => (
          <kbd
            key={key}
            className="font-mono text-[.72rem] min-w-[22px] text-center px-[6px] py-[2px] rounded-[6px] border border-line-2 bg-field text-ink-soft"
          >
            {key}
          </kbd>
        ))}
      </dd>
    </div>
  );
}
```

Then replace the existing `<dl>…</dl>` block (the one that maps `SHORTCUTS`) with the main list plus the grouped planner list:

```tsx
        <dl className="flex flex-col gap-[9px]">
          {SHORTCUTS.map((shortcut) => (
            <ShortcutRow key={shortcut.label} keys={shortcut.keys} label={shortcut.label} />
          ))}
        </dl>
        <div className="mt-[14px] pt-[12px] border-t border-line-soft">
          <h3 className="font-mono text-[.6rem] tracking-[.1em] uppercase text-muted font-semibold mb-[9px]">
            While planning a step
          </h3>
          <dl className="flex flex-col gap-[9px]">
            {PLANNER_KEYS.map((shortcut) => (
              <ShortcutRow key={shortcut.label} keys={shortcut.keys} label={shortcut.label} />
            ))}
          </dl>
        </div>
```

- [ ] **Step 3: Verify tests + build**

Run: `npm test` → green.
Run: `npx tsc -b` → clean.

- [ ] **Step 4: Manual verify**

Run `npm run dev`, press `?`:
- The list shows `4 → Plan your week` between Timeline and Jump to today.
- A "While planning a step" section shows `1–7` and `0` with their descriptions.
- `Esc` still closes the cheat sheet; no layout overflow on the `360px` panel.

- [ ] **Step 5: Commit**

```bash
git add src/components/ShortcutsOverlay.tsx
git commit -m "$(cat <<'EOF'
feat(plan): document the 4 shortcut and planner weekday keys

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

- **Spec coverage:**
  - Feedback #1 keyboard route → Task 2 (`4` → `open-plan`) + Task 3 (App handles it).
  - Feedback #1 nav presence → Task 4 (nav action button).
  - Feedback #4 surface fast-planning keys → Task 5 (cheat-sheet group).
  - Spec §1 store hoist → Task 1. Spec §5 dedupe (one overlay) → Task 3.
  - Spec §3 tooltip update → Task 4 Step 3.
- **Placeholder scan:** none — every code step has the concrete code and exact commands.
- **Type consistency:** `openPlan(focusGoalId?: string | null)` / `closePlan()` defined in Task 1 are called with the same names/arities in Tasks 3–4. `planOpen`/`planFocusGoalId`/`planReview` field names match the store additions. `'open-plan'` command string is identical in `appKeyboard.ts`, its test, and the App handler. `PlanWeekOverlay` props used (`open`, `focusGoalId`, `onClose`) match its existing signature (`{ open, onClose, focusGoalId?: string | null }`).
- **Ordering:** Task 3 depends on Tasks 1–2; Task 4 depends on Task 3 (button + overlay must exist). Task 5 is independent (kept last). Between Task 2 and Task 3, `4` resolves to a command App ignores — a harmless no-op, suite stays green.
