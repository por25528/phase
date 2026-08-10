# Reachable on touch, motion in band, and the card's next action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make two calendar controls reachable on a touch device, bring every CSS duration into the agreed band, and put the goal card's next action on the card — each with a guard so it cannot silently come back.

**Architecture:** Three small, independent changes, each paired with an enforcement rule rather than a one-off fix. The touch bug becomes a `designScale` rule banning hand-rolled hover reveals on controls; the motion drift becomes a rule pinning every `duration-[…ms]` into 120–200ms; and the card's missing line is unblocked by giving `nextOpenAction` a discriminator so the card can tell "this names a real task" from "this is a status sentence".

**Tech Stack:** React 19, TypeScript, Tailwind 3, Vitest + @testing-library/react (jsdom).

## Global Constraints

Copied from `CLAUDE.md` and enforced by `src/lib/designScale.test.ts`:

- No arbitrary font sizes. Named `fontSize` keys only.
- Radii: only `rounded-[4px]`, `rounded-[6px]`, `rounded-[11px]`, `rounded-field`, `rounded-card`.
- No literal hex / `rgb()` / `hsl()` colours. Theme tokens only.
- No Unicode icon glyphs. Use `src/components/Icons.tsx`.
- `font-disp` only in `App.tsx`. `uppercase` only in the three named calendar files. `border-dashed` only in `views/plan/DayColumn.tsx` and `views/plan/EventBlock.tsx`.
- **`.quiet-control` is the ONE hover-reveal mechanism for controls.** It carries the `@media (hover: hover)` gate and the 24px target floor, and it requires a **literal `group` ancestor — `group/name` does not match.**
- `jest-dom` is NOT installed. Plain DOM reads only.
- Run `npm test` and `npx tsc -b` before every commit.

**Baseline before starting:** `tsc -b` clean, 127 test files, 2460 tests passing.

## What this plan does NOT do, having checked

Four items from the round-2 audit's "bugs" list did not survive verification and are deliberately excluded:

- `EventBlock`'s complete toggle **already has** an `aria-label` (`Reopen/Complete ${title}`).
- Calendar blocks **do** get a focus ring — the global `:focus-visible` rule in `index.css` applies, and nothing sets `outline-none` on them.
- `⌘↵` **is** listed in `ShortcutsOverlay` ("Add a task below this one"), and the `S` entry already spells out `to do → in progress → blocked`, which is how it communicates that `S` cannot reach done.
- `Project.tsx`'s focus pulse **does** respect reduced motion — it reads `matchMedia('(prefers-reduced-motion: reduce)')` directly and guards the `animate()` call. It does not use the hook, which is a style difference, not a defect.
- `Habits.tsx`'s hover-revealed grip is a `pointer-events-none` decorative icon, **not a control**. `.quiet-control` would impose a 24px interactive target on something nobody can click. It is correctly left alone, and the Task 1 guard allowlists it.

---

### Task 1: Two calendar controls are unreachable on touch

**Files:**
- Modify: `src/views/plan/EventBlock.tsx`
- Test: `src/lib/designScale.test.ts`

**The bug.** A work block's Complete and Unschedule buttons are revealed with `opacity-0 group-hover/blk:opacity-100`. On a coarse pointer `:hover` never matches, so both sit at `opacity: 0` permanently — the two controls are unreachable by touch. `.quiet-control` exists precisely to prevent this: it carries the `@media (hover: hover)` gate so the controls stay visible where there is no hover, plus the 24px target floor.

`.quiet-control` needs a **literal `group`** ancestor. The block currently uses the named `group/blk`. Renaming it is safe: `DayColumn` uses `role="group"` (an ARIA attribute, not the class), and there is no `class="group"` ancestor anywhere above an `EventBlock`.

- [ ] **Step 1: Write the failing guard**

Add to `src/lib/designScale.test.ts`, as a new top-level `describe`:

```ts
/**
 * `.quiet-control` is the one hover-reveal for a CONTROL, because it carries
 * the `@media (hover: hover)` gate. A hand-rolled `opacity-0 group-hover:`
 * has no such gate, so on a touch device the control never appears at all —
 * it is not "subtle", it is missing. Two calendar buttons shipped that way.
 *
 * The survivor is a decorative drag hint: `pointer-events-none`, nothing to
 * click, and giving it `.quiet-control` would impose a 24px interactive
 * target on something that is not interactive.
 */
describe('hover-revealed controls', () => {
  it('use .quiet-control rather than a hand-rolled reveal', () => {
    const hits = offenders(/opacity-0 group-hover[^\s"'`]*:opacity-100/g)
      .map((h) => h.split(':')[0]);
    expect([...new Set(hits)].sort()).toEqual(['views/plan/sidebar/Habits.tsx']);
  });
});
```

`offenders` is already defined at the top of that file — do not redefine it.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/designScale.test.ts`
Expected: FAIL — `views/plan/EventBlock.tsx` appears in the list.

- [ ] **Step 3: Convert the two controls**

In `src/views/plan/EventBlock.tsx`:

1. On the block's root element, change `group/blk` to `group`.
2. On the **complete** button, replace `opacity-0 group-hover/blk:opacity-100` with the `quiet-control` class, keeping the `block.done ? 'opacity-100' : …` behaviour: a done block keeps its tick visible because that tick is state, not an offer. Express that as `block.done ? 'opacity-100' : 'quiet-control'`.
3. On the **unschedule** button, replace `opacity-0 group-hover/blk:opacity-100` with `quiet-control`.
4. Remove the now-redundant `focus-visible:opacity-100` from both — `.quiet-control`'s own rule already exempts `:focus-visible`. Keep `transition-opacity` off these two: `.quiet-control` supplies its own transition.

`.quiet-control` sets `min-width: 24px; min-height: 24px; border-radius: 6px; display: inline-flex`. The buttons already declare `w-[24px] h-[24px] grid place-items-center`; keep their absolute positioning and their compact-mode classes exactly as they are, and check that `display: inline-flex` from the class does not fight `grid place-items-center` — if the icon shifts, drop `grid place-items-center` and let `.quiet-control`'s centring do the work.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/designScale.test.ts src/views/plan/`
Expected: PASS. If any `EventBlock` test asserted the old class strings, update those assertions — but report that you did and why.

- [ ] **Step 5: Commit**

```bash
npx tsc -b && npm test
git add src/views/plan/EventBlock.tsx src/lib/designScale.test.ts
git commit -m "fix(plan): a block's controls exist on a device without hover"
```

---

### Task 2: Every duration in the agreed band

**Files:**
- Modify: `src/components/ProgressBar.tsx`, `src/index.css`, `src/App.tsx`
- Test: `src/lib/designScale.test.ts`

The agreed band is 120–200ms. Three offenders: `ProgressBar` at 250ms, `.tl-bar-fill` at 300ms, and the two toasts at 220ms.

- [ ] **Step 1: Write the failing guard**

Add to `src/lib/designScale.test.ts`:

```ts
/**
 * Motion is restrained by agreement, not by taste: 120–200ms for hover, menus,
 * property changes, selection, expansion and completion. Anything longer reads
 * as the interface thinking about it.
 *
 * Deliberately NOT covered: the focus pulse in `Project.tsx`, which is a Web
 * Animations call rather than a CSS class, is 1400ms on purpose, and already
 * checks `prefers-reduced-motion` itself.
 */
describe('motion', () => {
  const inBand = (ms: number) => ms >= 120 && ms <= 200;

  it('keeps every CSS duration between 120ms and 200ms', () => {
    const bad = offenders(/duration-\[(\d+)ms\]/g)
      .filter((hit) => {
        const ms = /duration-\[(\d+)ms\]/.exec(hit)?.[1];
        return ms != null && !inBand(Number(ms));
      });
    expect(bad).toEqual([]);
  });

  it('keeps the stylesheet transitions in band', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const ms = [...css.matchAll(/transition:[^;]*?(\d+)ms/g)].map((m) => Number(m[1]));
    const s = [...css.matchAll(/transition:[^;]*?(\d*\.?\d+)s\b/g)].map((m) => Number(m[1]) * 1000);
    expect([...ms, ...s].filter((v) => !inBand(v))).toEqual([]);
  });
});
```

`readFileSync`, `join` and `SRC` are already imported in that file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/designScale.test.ts`
Expected: FAIL, listing `ProgressBar.tsx` (250ms), the two `App.tsx` toasts (220ms), and 300ms from `index.css`.

- [ ] **Step 3: Bring them into band**

- `src/components/ProgressBar.tsx`: `duration-[250ms]` → `duration-[200ms]`.
- `src/App.tsx`: both `duration-[220ms]` → `duration-[200ms]`.
- `src/index.css`, the `.tl-bar-fill` rule: `transition: width 300ms ease-out;` → `transition: width 200ms ease-out;`.

Change nothing else. If the second guard flags a value written in seconds that is already in band (`.12s` = 120ms, `.15s` = 150ms), the regex is doing its job — those pass.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/designScale.test.ts`, then `npx tsc -b && npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProgressBar.tsx src/App.tsx src/index.css src/lib/designScale.test.ts
git commit -m "fix(ui): motion inside the band it was agreed at"
```

---

### Task 3: The goal card names its next action

**Files:**
- Modify: `src/lib/plan.ts` (`NextAction`, `nextOpenAction`)
- Modify: `src/lib/plan.test.ts` (the five `toEqual` assertions this widens)
- Modify: `src/views/goals/BoardCard.tsx`
- Test: `src/lib/plan.test.ts`

**Interfaces:**

```ts
export interface NextAction {
  kind: 'planned' | 'open' | 'needs-breakdown' | 'complete';
  title: string;
  /**
   * The leaf this names, when it names one. Absent for the three sentences
   * that describe a STATE rather than a task — no tasks yet, all complete,
   * everything blocked — which is what lets a caller show the line only when
   * there is something to point at.
   */
  nodeId?: string;
}
```

**Why the discriminator is needed.** `nextOpenAction` returns four kinds, and three of them carry a sentence rather than a task: "No tasks yet…", "All tasks complete", "All open tasks are blocked". The card already says all three of those things — via the attention badge, the effort line's "Every task done", and the blocked indicator. Rendering the next-action line unconditionally would duplicate existing content on three cards out of four. `kind` alone cannot separate them, because `'open'` covers BOTH "here is the next leaf" and "everything is blocked".

`nextOpenAction` currently has **no production consumer** — only tests. This task is what puts it on screen.

- [ ] **Step 1: Write the failing tests**

In `src/lib/plan.test.ts`'s `nextOpenAction` describe block, widen the five existing `toEqual` assertions to include the new field, and add two new tests:

```ts
  it('names the node it picked, so a caller can point at it', () => {
    const g = goal({ nodes: [
      { id: 'a', title: 'A', status: 'done' },
      { id: 'b', title: 'B' },
    ] });
    expect(nextOpenAction(g, TODAY).nodeId).toBe('b');
  });

  /**
   * The three state sentences name no task, and a caller must be able to tell:
   * the card already says all three of these things by other means.
   */
  it('names no node for a state sentence', () => {
    expect(nextOpenAction(goal({ nodes: [] }), TODAY).nodeId).toBeUndefined();
    const done = goal({ nodes: [{ id: 'a', title: 'A', status: 'done' }] });
    expect(nextOpenAction(done, TODAY).nodeId).toBeUndefined();
    const blocked = goal({ nodes: [{ id: 'a', title: 'A', status: 'blocked', blockedOn: 'x' }] });
    expect(nextOpenAction(blocked, TODAY).nodeId).toBeUndefined();
  });
```

Use the file's existing `goal(...)` helper and its `TODAY` constant — read the describe block first and match the fixture style already there.

The five existing assertions use `toEqual({ kind, title })`, which fails once an extra field is present. Add `nodeId` to the three that name a real leaf (`'B'` cases) and leave the two state sentences as `toEqual({ kind, title })`, which stays correct because the field is absent.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/plan.test.ts`
Expected: FAIL — `nodeId` is undefined on the picked-leaf cases.

- [ ] **Step 3: Implement**

In `src/lib/plan.ts`, add the `nodeId` field to `NextAction` with the JSDoc above, and set it on the one return that picks a leaf:

```ts
  const planned = workable.find((n) => n.plannedWeek === week);
  const pick = planned ?? doing[0] ?? todo[0];
  return { kind: planned ? 'planned' : 'open', title: pick.title, nodeId: pick.id };
```

Leave the three state returns exactly as they are — no `nodeId`.

- [ ] **Step 4: Show it on the card**

In `src/views/goals/BoardCard.tsx`, import `nextOpenAction` (extend the existing `../../lib/plan` import) and derive it beside the existing `effort`/`badge`:

```tsx
  const next = nextOpenAction(goal, today);
```

Then, immediately AFTER the effort `<p>` and BEFORE the badge/blocked row, add:

```tsx
      {/* Only when it names a real task. The three state sentences this can
          return — no tasks yet, all complete, everything blocked — are already
          said by the badge, the effort line and the blocked indicator, and
          repeating them here would be the card arguing with itself. */}
      {next.nodeId && (
        <p className="text-compact text-muted truncate">
          <span className="text-ink-soft">Next</span> {next.title}
        </p>
      )}
```

`truncate` matters: a card is ~240px wide and a task title is not.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/lib/plan.test.ts src/views/goals/`, then `npx tsc -b && npm test`.

If a `BoardCard` or `Goals` test asserts the card's exact text content, it may now see an extra line. Update such an assertion only if the new line is genuinely what changed, and report it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/plan.ts src/lib/plan.test.ts src/views/goals/BoardCard.tsx
git commit -m "feat(goals): the card names the one thing to do next"
```

---

## Self-review

**Spec coverage.** Audit D1 (touch-unreachable controls) — Task 1. Audit D3 (motion out of band) — Task 2. Audit A4 (card hides the next action) — Task 3. D2, D4 and the `Project.tsx` motion claim were verified false and are documented above rather than "fixed".

**Deliberately not here.** Audit D5 (palette lacks Move and Estimate) is a feature addition, not a bug, and belongs with the command-palette work.

**Type consistency.** `NextAction.nodeId` is optional, so no existing caller breaks at the type level; the five test assertions that break are behavioural, and Step 1 handles them explicitly. `nextOpenAction(goal, today)` in `BoardCard` matches the signature `(g: Goal, today: string)` and the card already has both values in scope.

**Risk.** Task 1 renames `group/blk` to `group`. If any descendant of an `EventBlock` uses a *different* named group, it is unaffected; but if anything above a block ever gains `class="group"`, every block's controls would reveal together. Nothing does today — `DayColumn`'s `role="group"` is an ARIA attribute, not a class — and the Task 1 guard would not catch such a change, so it is called out here.
