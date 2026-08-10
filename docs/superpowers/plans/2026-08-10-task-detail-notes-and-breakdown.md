# Task detail — the note that hides, and the breakdown that invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an empty note disappear until it is used, and make the breakdown offer itself when a task is too big to sit down to — with the cost of the breakdown stated before it is accepted.

**Architecture:** Two unrelated surfaces, one page. The note is pure CSS: `.note-prose` keeps its 1px border for geometry but paints it only on `:focus-within`, so nothing moves when it appears. The breakdown gains a predicate in `lib` (`looksOversized`) that decides when the offer is an invitation rather than a button, and `ProposalPanel` gains a costed accept row — the total it is about to add, beside the free time the next available day actually has.

**Tech Stack:** React 19, TypeScript, Tailwind 3, Vitest + @testing-library/react (jsdom).

## Global Constraints

Copied from `CLAUDE.md` and enforced by `src/lib/designScale.test.ts` — the build fails on any of these:

- No arbitrary font sizes. Named `fontSize` keys only (`meta`, `ui`, `body`, `lead`, …).
- Radii: only `rounded-[4px]`, `rounded-[6px]`, `rounded-[11px]`, `rounded-field` (9px), `rounded-card` (14px).
- No literal hex / `rgb()` / `hsl()` colours. Theme tokens only.
- No Unicode icon glyphs (`✕✓✎▶◆◇⠿⋯✦⚠⌕＋`). Use `src/components/Icons.tsx` — the sparkle is `IconSparkle`.
- `font-disp` only in `App.tsx`. `uppercase` only in the three named calendar files.
- `border-dashed` only in `views/plan/DayColumn.tsx` and `views/plan/EventBlock.tsx`.
- **Every class declared in `index.css` must be applied by some markup** — `designScale.test.ts` fails on an orphan.
- `jest-dom` is NOT installed. Plain DOM reads only (`el.textContent`, `el.className`, `el.getAttribute(...)`).
- A section label is `text-meta font-semibold text-muted`, sentence case.
- **`ProposalPanel` must not fabricate an AI provider.** Phase has none; the paste round-trip stays. Only the framing around it changes.
- Run `npm test` and `npx tsc -b` before every commit.

**Baseline before starting:** `tsc -b` clean, 126 test files, 2433 tests passing.

**Deliberately NOT in this plan — and why.** Brief §9's "Schedule first 3 →" after accepting is not built here. `addChildren` (`store.ts:1042`) returns `void` and mints its children's ids internally, so a caller cannot schedule them afterwards; doing it as N separate `scheduleNode` calls would arm N undo entries whose sweeps discard one another, breaking the "bulk edits are ONE undoable write" invariant. Worse, accepting converts the leaf to a container, and the render-time branch in `Project.tsx`/`AreaPage.tsx` swaps the page to the container inspector — so the panel unmounts before any follow-through could be shown. Doing it properly needs a compound store action, which is its own slice. What this plan delivers instead is the same decision support *before* the write, where the user can still act on it.

---

### Task 1: An empty note is invisible until it is used

**Files:**
- Modify: `src/index.css` (the `.note-prose` rule, ~line 210)
- Test: `src/lib/designScale.test.ts` (add one guard)

**Interfaces:** none — CSS only.

`.note-prose` currently reads:

```css
  .note-prose {
    @apply w-full border border-line rounded-[6px] bg-transparent px-[9px] py-[7px] text-body leading-[1.6] text-ink;
  }
```

It is used by `TaskPage`, `StepPanel`, `AreaPage` and the goal Notes tab, so this change lands on all four at once, which is the point.

- [ ] **Step 1: Write the failing guard**

Add to `src/lib/designScale.test.ts`, as a new top-level `describe` at the end of the file:

```ts
/**
 * An empty note should read as empty page, not as an empty form field.
 *
 * `.note-prose` is the only large outlined box left on a task page, and it is
 * outlined even when it holds nothing — which is what made a task detail feel
 * like a form rather than a document. The border still EXISTS at rest, so the
 * text does not shift by a pixel when it appears; it is simply transparent
 * until the editor has focus.
 */
describe('the notes editor', () => {
  const css = readFileSync(join(SRC, 'index.css'), 'utf8');
  const rule = /\.note-prose\s*\{[^}]*\}/.exec(css)?.[0] ?? '';

  it('keeps its border transparent at rest', () => {
    expect(rule).toContain('border-transparent');
    expect(/border-line\b/.test(rule)).toBe(false);
  });

  it('paints that border only while it is focused', () => {
    expect(/\.note-prose:focus-within\s*\{[^}]*border-line\b[^}]*\}/.test(css)).toBe(true);
  });
});
```

`readFileSync`, `join` and `SRC` are already imported at the top of that file — do not re-import them.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/designScale.test.ts`
Expected: FAIL — the rule contains `border-line` and there is no `:focus-within` rule.

- [ ] **Step 3: Implement**

In `src/index.css`, replace the `.note-prose` rule with:

```css
  /* The border exists at rest and is simply not painted, so nothing moves when
     it appears — an empty note reads as page, and the box arrives only once
     you are actually writing in it. */
  .note-prose {
    @apply w-full border border-transparent rounded-[6px] bg-transparent px-[9px] py-[7px] text-body leading-[1.6] text-ink;
    transition: border-color .15s;
  }
  .note-prose:focus-within {
    @apply border-line;
  }
```

`transition` is 150ms, inside the 120–200ms band, and the global `prefers-reduced-motion` rule at the bottom of the file already disables it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/designScale.test.ts`
Expected: PASS, including the pre-existing "applies every class its own stylesheet targets" test — `.note-prose:focus-within` is a state of a class the markup already applies, so it does not need its own consumer.

- [ ] **Step 5: Confirm the real stylesheet, not just the source**

Run: `npm run build`, then:

```bash
grep -o "note-prose:focus-within[^}]*}" dist/assets/index-*.css | head -2
```

Expected: a rule whose body sets `border-color` to `rgb(var(--c-line) / …)`. If the grep is empty, Tailwind did not emit the variant and the change is inert in production — do not commit; report it.

- [ ] **Step 6: Commit**

```bash
npx tsc -b && npm test
git add src/index.css src/lib/designScale.test.ts
git commit -m "feat(notes): an empty note is page, not a form field"
```

---

### Task 2: A task too big to sit down to says so

**Files:**
- Modify: `src/lib/proposal.ts`
- Test: `src/lib/proposal.test.ts`

**Interfaces:**
- Produces, relied on by Task 3:

```ts
/** Minutes past which a task is more than one focused sitting. */
export const SESSION_MIN = 90;

/**
 * Whether a leaf is big enough that breaking it down is worth suggesting.
 * A container is already broken down; an unestimated leaf is unknown, not big.
 */
export function looksOversized(node: GoalNode): boolean;
```

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/proposal.test.ts` (import `looksOversized` and `SESSION_MIN` from `./proposal`, and the `GoalNode` type from `../db/types`):

```ts
describe('looksOversized', () => {
  const leaf = (over: Partial<GoalNode> = {}): GoalNode => ({ id: 'n', title: 'T', ...over });

  it('is true for a leaf estimated past one sitting', () => {
    expect(looksOversized(leaf({ estimateMin: SESSION_MIN + 1 }))).toBe(true);
  });

  it('is false exactly at the threshold — a sitting is not oversized', () => {
    expect(looksOversized(leaf({ estimateMin: SESSION_MIN }))).toBe(false);
  });

  /**
   * An unestimated task is UNKNOWN, not big. Suggesting a breakdown for
   * everything nobody has priced yet would put the invitation on most of the
   * app, which is how a contextual prompt becomes chrome.
   */
  it('is false for a leaf with no estimate', () => {
    expect(looksOversized(leaf())).toBe(false);
  });

  /** A container is already broken down. */
  it('is false for a node with children', () => {
    expect(looksOversized(leaf({
      estimateMin: SESSION_MIN * 3,
      children: [{ id: 'c', title: 'C' }],
    }))).toBe(false);
  });

  it('is TRUE for a node whose children array is present but empty', () => {
    // `children: []` is the legacy-leaf ambiguity CLAUDE.md names. An empty
    // array is not a breakdown, so the node is still a leaf and still oversized.
    expect(looksOversized(leaf({ estimateMin: SESSION_MIN * 2, children: [] }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/proposal.test.ts`
Expected: FAIL — `looksOversized` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/proposal.ts` (it already imports what it needs; add the `GoalNode` type import if absent):

```ts
/**
 * Minutes past which a task is more than one focused sitting.
 *
 * Ninety minutes is the point at which the work stops fitting into an
 * uninterrupted block most people actually get, so it is where "should I break
 * this up?" becomes a real question rather than a nag. It is a suggestion
 * threshold and nothing else — no roll-up, no capacity maths reads it.
 */
export const SESSION_MIN = 90;

/**
 * Whether a leaf is big enough that breaking it down is worth suggesting.
 *
 * A container is already broken down, and an unestimated leaf is UNKNOWN
 * rather than big — offering to decompose everything nobody has priced yet is
 * how a contextual invitation turns into permanent chrome.
 */
export function looksOversized(node: GoalNode): boolean {
  if (node.children && node.children.length > 0) return false;
  return node.estimateMin !== undefined && node.estimateMin > SESSION_MIN;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/proposal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx tsc -b && npm test
git add src/lib/proposal.ts src/lib/proposal.test.ts
git commit -m "feat(proposal): the size at which a task is worth breaking up"
```

---

### Task 3: The invitation, and what the breakdown costs

**Files:**
- Modify: `src/views/project/TaskPage.tsx` (the trigger at `:394-412`, and the store read at `:70`)
- Modify: `src/views/project/ProposalPanel.tsx` (the accept row at `:198-214`, and its props)

**Interfaces:** consumes `looksOversized` (Task 2). `ProposalPanel`'s props gain one optional field; every existing prop keeps its name and type:

```ts
  /**
   * The next day with unbooked time, for pricing the breakdown against reality.
   * Absent when no availability is set — say nothing rather than guess.
   */
  freeDay?: { date: string; freeMin: number };
```

- [ ] **Step 1: TaskPage learns the next free day**

At `src/views/project/TaskPage.tsx:70`, widen the store read:

```tsx
  const { goals, tasks, sessions, availability, allDayBlocks, actions } = useAppStore();
```

Add these imports alongside the existing ones:

```tsx
import { useMemo } from 'react';                       // extend the existing react import
import { looksOversized } from '../../lib/proposal';
import { nextFreeDay, dayLabel as planDayLabel } from '../../lib/todayPlan';
```

`TaskPage` already imports `dayLabel` from `../../lib/rowSchedule` — hence the alias. Do not remove the existing one.

Then, near the other derivations in the component body:

```tsx
  const today = todayStr();
  // Priced against the first day that actually has room, so "add four steps"
  // can be weighed against somewhere to put them. Null when no availability is
  // set — the panel then says nothing rather than inventing a day.
  const freeDay = useMemo(
    () => nextFreeDay(today, availability, [], allDayBlocks, { date: today, minute: 0 }),
    [today, availability, allDayBlocks],
  );
```

If a `today` const already exists in this component, reuse it rather than declaring a second.

- [ ] **Step 2: The trigger becomes an invitation when the task is oversized**

Replace `src/views/project/TaskPage.tsx:403-412` (the `) : (` branch through its closing `)}`) with:

```tsx
        ) : looksOversized(node) ? (
          /* An invitation, not a button. It appears only when the estimate says
             this will not fit one sitting — everywhere else the same action is
             available, quietly, below. */
          <div className="mt-[14px]">
            <p className="text-ui text-ink-soft">
              This looks larger than one focused work session.
            </p>
            <button
              type="button"
              onClick={() => setProposing(true)}
              className="mt-[4px] inline-flex items-center gap-[6px] text-ui font-semibold text-accent-deep hover:bg-accent-tint px-[8px] py-[5px] rounded-[6px] -ml-[8px]"
            >
              <IconSparkle size={12} />
              Break into smaller steps
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setProposing(true)}
            className="mt-[14px] inline-flex items-center gap-[6px] text-ui font-medium text-accent-deep hover:bg-accent-tint px-[8px] py-[5px] rounded-[6px] -ml-[8px]"
          >
            <IconSparkle size={12} />
            Break into smaller steps
          </button>
        )}
```

Both branches now say **Break into smaller steps** rather than repeating the task's title, which is on screen directly above. The quiet branch is `font-medium`; the invited one is `font-semibold` under a sentence explaining why it is being offered. `-ml-[8px]` (was `-ml-[1px]`) cancels the button's own `px-[8px]` so its label sits on the page's text edge rather than 7px right of it.

- [ ] **Step 3: Pass the free day down**

In the `proposing` branch at `src/views/project/TaskPage.tsx:396-401`, add the prop:

```tsx
            <ProposalPanel
              goal={goal}
              node={node}
              actions={actions}
              {...(freeDay ? { freeDay } : {})}
              onClose={() => setProposing(false)}
            />
```

- [ ] **Step 4: The accept row states what it will add, and against what**

In `src/views/project/ProposalPanel.tsx`, add `freeDay` to the props type with the JSDoc from the Interfaces block above, and destructure it.

Add these two derivations beside the existing `const taking = ...`:

```tsx
  const accepted = acceptedRows(rows ?? []);
  const taking = accepted.length;
  // Only what is actually priced. Summing an unestimated row as zero would
  // make four steps look free.
  const takingMin = accepted.reduce((n, r) => n + (r.estimateMin ?? 0), 0);
  const unpriced = accepted.filter((r) => r.estimateMin === undefined).length;
```

Delete the old `const taking = acceptedRows(rows ?? []).length;`.

Then, between the `</ul>` and the `<div className="flex items-center gap-[8px] mt-[10px]">` button row, insert:

```tsx
          {/* What this will cost, beside where it could go. Stated BEFORE the
              write, because after it the leaf becomes a container and this
              panel is gone. */}
          {taking > 0 && (takingMin > 0 || freeDay) && (
            <p className="mt-[8px] text-meta text-muted">
              {takingMin > 0 && (
                <span className="tabular-nums">{fmtMinutes(takingMin)}</span>
              )}
              {takingMin > 0 && unpriced > 0 && ` · ${unpriced} unestimated`}
              {takingMin > 0 && freeDay && ' · '}
              {freeDay && (
                <>
                  {dayLabel(freeDay.date, todayStr())} has{' '}
                  <span className="tabular-nums">{fmtMinutes(freeDay.freeMin)}</span> free
                </>
              )}
            </p>
          )}
```

Add the imports this needs to `ProposalPanel.tsx`:

```tsx
import { fmtMinutes } from '../../lib/effort';
import { dayLabel } from '../../lib/todayPlan';
```

`todayStr` is already imported there.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/views/project/ src/lib/proposal.test.ts`
Expected: PASS. `TaskPage`'s existing suite covers the Milestone chip, status popover, blocked field and scheduling — none of which this touches. If a selector on the old button label `Break “…” into subtasks` fails, that is a REAL break: update the component only if the plan's copy is what changed, and report it either way.

Then the full gate: `npx tsc -b && npm test`. Expected tsc silent, 126 files, 2438 tests.

- [ ] **Step 6: Commit**

```bash
git add src/views/project/TaskPage.tsx src/views/project/ProposalPanel.tsx
git commit -m "feat(task): the breakdown offers itself, and says what it will cost"
```

---

## Self-review

**Spec coverage.** Brief §15's "an empty notes editor should visually disappear until focused" — Task 1. Brief §9's contextual invitation ("This looks larger than one focused work session. ✦ Break into smaller steps") — Tasks 2 and 3. Brief §9's costed accept row — Task 3 Step 4, in the "Add N steps" position the brief sketches.

**Knowingly deferred.** §9's "Schedule first 3 →" — reasoned at the top of this plan. §9's "Regenerate" is meaningless without a provider: with a paste round-trip, "Paste something else" already IS regenerate, and adding a second word for it would imply Phase can re-ask something.

**Type consistency.** `looksOversized(node: GoalNode): boolean` is used in `TaskPage` on the same `node: GoalNode` it already renders. `freeDay` is `{ date: string; freeMin: number }`, exactly `FreeDay` as `nextFreeDay` returns it (`todayPlan.ts:56`), and is passed only when non-null so the optional prop is never explicitly `undefined`.

**Risk.** `nextFreeDay` scans up to 7 days of `freeMinutes`, so it is memoised in Task 3 Step 1. It is computed on every `TaskPage` render regardless of whether the panel is open; that is one week-scan per leaf page open, which is the same order as the Plan rail already pays, and hoisting it behind `proposing` would recompute it at the moment the panel appears instead — a worse trade for a page that is already mounted.
