# Plan Grid Remaster 3 — Colour, State and Motion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** none beyond plan 1 (geometry), which has shipped. This plan is independent of 2a/2b and can be built before, after, or between them.

**Goal:** Give every project its own identity colour on the grid, put *state* (overdue, behind pace) on the block fill instead of overloading the accent, and replace the codebase's ad-hoc transition timings with a named motion scale the build enforces.

**Architecture:** Six new theme tokens declared as CSS custom properties and exposed as Tailwind colour keys. A pure `projectColour.ts` hashes `goal.id` into `0…5` and returns a **literal class name from a static array**, because Tailwind's content scanner cannot see `border-l-proj-${i}`. State on the fill reuses the two predicates that already exist — `dueChip` and `behindPaceBy` — rather than re-deriving either. Motion becomes `transitionDuration`/`transitionTimingFunction` scales in the Tailwind config, guarded by a fourth `designScale.test.ts` rule.

**Tech Stack:** React 19, TypeScript, Tailwind (CSS custom properties as `R G B` channel triples), Vitest.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-02-plan-grid-remaster-design.md`, Part 3 and Part 5.
- **Colours are `R G B` channel triples**, consumed as `rgb(var(--c-name) / <alpha-value>)`, so Tailwind's opacity modifiers keep working. Never a hex in the config.
- **No `fontSize` key may share a name with a `colors` key.** Tailwind emits `text-<key>` for both and the colour silently wins. `designScale.test.ts` asserts this. Current `fontSize` keys: `root, micro, eyebrow, tiny, kbd, badge, meta, compact, ui, body, lead, title, h3, h2, h1, wordmark` — so `proj-0…proj-5` are safe, but let the test prove it.
- **No literal hex anywhere in `src/**/*.tsx?`** — `designScale.test.ts` fails the build on one. `rgb(var(--c-*))` is the one allowed route to a variable.
- Every hand-written CSS class must be applied somewhere in markup, or `designScale.test.ts`'s orphan rule fails.
- `prefers-reduced-motion` is already handled globally (`index.css`) and needs no per-component work.
- Run `npm test` and `npx tsc -b` before committing.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/index.css` | Modify | Declare `--c-proj-0` … `--c-proj-5` |
| `tailwind.config.js` | Modify | Expose the six colours; add the motion scales |
| `src/lib/projectColour.ts` | Create | id → palette index, and the static class array |
| `src/lib/projectColour.test.ts` | Create | Determinism, distribution, and 3:1 contrast in both themes |
| `src/lib/designScale.test.ts` | Modify | Fourth rule: no arbitrary `duration-[Nms]` |
| `src/App.tsx` | Modify | Migrate `duration-[220ms]` off the arbitrary value |
| `src/components/ProgressBar.tsx` | Modify | Migrate `duration-[250ms]` |
| `src/lib/blockState.ts` | Create | The fill-state predicate (overdue / behind pace / none) |
| `src/lib/blockState.test.ts` | Create | Its tests, including the undated-project case |
| `src/views/plan/EventBlock.tsx` | Modify | Project rail colour, state on the fill |
| `src/views/plan/DayBlocks.tsx` | Modify | Pass the goal and its state down |

---

### Task 1: The palette tokens

**Files:**
- Modify: `src/index.css`
- Modify: `tailwind.config.js`
- Test: `src/lib/projectColour.test.ts` (created in Task 2 — the contrast assertions live there)

**The six values, and why one set serves both themes.** WCAG 1.4.11 applies: the rail is a 3px non-text element, so each colour must clear **3:1 against `panel`** in both themes, exactly as `--c-check` does. Panel is `#FFFFFF` (light) and `#0D0D0E` (dark). Working the contrast formula backwards:

- vs white (L = 1.0): `1.05 / (L + 0.05) ≥ 3` → **L ≤ 0.30**
- vs `#0D0D0E` (L ≈ 0.0045): `(L + 0.05) / 0.0545 ≥ 3` → **L ≥ 0.113**

Any colour with relative luminance in `[0.113, 0.30]` therefore clears 3:1 on *both* panels, so a single declaration serves both themes. All six below sit in that band.

**This deviates from spec §3.1**, which says to declare the palette "under both `:root` and `.dark`". Declaring six identical pairs creates twelve values that must stay in sync with no test holding them equal — a drift hazard for no gain. Declaring once, with the luminance band documented and asserted against **both** panel colours in Task 2, is strictly safer. If a future theme moves `--c-panel` far enough that one set no longer spans it, the test fails and *that* is the moment to split.

- [ ] **Step 1: Declare the tokens**

In `src/index.css`, inside the `:root` block, after `--c-warn-tint`:

```css
    /*
     * Project identity. Six hues, assigned by hash — see lib/projectColour.ts.
     *
     * Declared once rather than per theme: every value's relative luminance
     * sits in [0.113, 0.30], which clears 3:1 against BOTH panels (#FFFFFF and
     * #0D0D0E). WCAG 1.4.11 applies because the rail is a 3px non-text element,
     * the same reason --c-check is tuned. projectColour.test.ts asserts the
     * ratio against both, so a value edited out of the band fails the build.
     *
     * Deliberately not near --c-accent (192 78 45): accent means ACTION and
     * warn means TROUBLE. Project identity is a third channel and must not be
     * mistaken for either.
     */
    --c-proj-0: 46 125 116;   /* teal */
    --c-proj-1: 75 95 191;    /* indigo */
    --c-proj-2: 142 74 140;   /* plum */
    --c-proj-3: 95 114 51;    /* moss */
    --c-proj-4: 47 110 158;   /* steel */
    --c-proj-5: 138 95 56;    /* clay */
```

- [ ] **Step 2: Expose them to Tailwind**

In `tailwind.config.js`, inside `theme.extend.colors`, after `'warn-tint'`:

```js
        // Project identity — see index.css for the contrast rationale. Six keys,
        // none of which may collide with a fontSize key (designScale.test.ts).
        'proj-0': 'rgb(var(--c-proj-0) / <alpha-value>)',
        'proj-1': 'rgb(var(--c-proj-1) / <alpha-value>)',
        'proj-2': 'rgb(var(--c-proj-2) / <alpha-value>)',
        'proj-3': 'rgb(var(--c-proj-3) / <alpha-value>)',
        'proj-4': 'rgb(var(--c-proj-4) / <alpha-value>)',
        'proj-5': 'rgb(var(--c-proj-5) / <alpha-value>)',
```

- [ ] **Step 3: Confirm no key collision**

```bash
npx vitest run src/lib/designScale.test.ts
```

Expected: PASS — in particular `shares no key between the fontSize and colors scales`. This is the rule that must not be re-derived by hand.

- [ ] **Step 4: Commit**

```bash
git add src/index.css tailwind.config.js
git commit -m "feat(design): six project identity tokens"
```

---

### Task 2: `projectColour.ts`

**Files:**
- Create: `src/lib/projectColour.ts`, `src/lib/projectColour.test.ts`

**Interfaces:**
- Produces:

```ts
export const PROJECT_COLOURS = 6;
export function projectColourIndex(goalId: string): number;
export function projectRailClass(goalId: string | null): string;
```

**Why a static array.** Tailwind's content scanner reads source text; it cannot evaluate `` `border-l-proj-${i}` ``, so those classes would never be generated and every rail would render borderless. The module therefore holds the six literal class names in an array the scanner can see.

**Why `null` gets the neutral rail.** A loose task belongs to no project. Inventing a colour for it would assert a membership that does not exist (spec §3.2).

- [ ] **Step 1: Write the failing test**

Create `src/lib/projectColour.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { projectColourIndex, projectRailClass, PROJECT_COLOURS } from './projectColour';

describe('assigning a project its colour', () => {
  it('is deterministic', () => {
    expect(projectColourIndex('abc1234')).toBe(projectColourIndex('abc1234'));
  });

  it('always lands inside the palette', () => {
    for (let i = 0; i < 500; i += 1) {
      const index = projectColourIndex(`goal-${i}`);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(PROJECT_COLOURS);
    }
  });

  it('spreads ids across all six, not into one bucket', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) seen.add(projectColourIndex(`goal-${i}`));
    expect(seen.size).toBe(PROJECT_COLOURS);
  });

  it('returns a literal class name Tailwind can scan', () => {
    const cls = projectRailClass('abc1234');
    expect(/^border-l-proj-[0-5]$/.test(cls)).toBe(true);
  });

  it('gives a loose task the neutral rail, not an invented identity', () => {
    expect(projectRailClass(null)).toBe('border-l-line-2');
  });
});

/*
 * The rail is a 3px non-text element, so WCAG 1.4.11 applies and each colour
 * must clear 3:1 against the panel it sits on — in BOTH themes. The tokens are
 * declared once (see index.css); this is what proves that single declaration
 * spans both panels.
 */
describe('palette contrast', () => {
  const CSS = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

  function channels(name: string): [number, number, number] {
    const match = new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`).exec(CSS);
    if (!match) throw new Error(`--${name} not found in index.css`);
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }

  function luminance([r, g, b]: [number, number, number]): number {
    const lin = [r, g, b].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  function ratio(a: number, b: number): number {
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
  }

  // Light panel is #FFFFFF, dark panel is #0D0D0E — both read from index.css
  // rather than hardcoded, so retuning a panel re-runs this check.
  const LIGHT_PANEL = luminance([255, 255, 255]);
  const DARK_PANEL = luminance([13, 13, 14]);

  for (let i = 0; i < PROJECT_COLOURS; i += 1) {
    it(`--c-proj-${i} clears 3:1 on both panels`, () => {
      const l = luminance(channels(`c-proj-${i}`));
      expect(ratio(l, LIGHT_PANEL)).toBeGreaterThanOrEqual(3);
      expect(ratio(l, DARK_PANEL)).toBeGreaterThanOrEqual(3);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/projectColour.test.ts
```

Expected: FAIL — cannot resolve `./projectColour`.

- [ ] **Step 3: Implement**

Create `src/lib/projectColour.ts`:

```ts
/**
 * Project identity colour, hashed from the id. No picker: a palette of six
 * assigned automatically is one less decision per project, and the spec's
 * decision table settles it (`Colour assignment | Auto, hashed from goal.id`).
 */
export const PROJECT_COLOURS = 6;

/**
 * The class names, written out in full.
 *
 * Tailwind's content scanner reads source TEXT — it cannot evaluate
 * `border-l-proj-${i}`, so a template literal would generate no CSS at all and
 * every rail would render borderless. This array is the whole reason the
 * module exists rather than the index being interpolated at the call site.
 */
const RAIL_CLASSES = [
  'border-l-proj-0',
  'border-l-proj-1',
  'border-l-proj-2',
  'border-l-proj-3',
  'border-l-proj-4',
  'border-l-proj-5',
] as const;

/** A loose task belongs to no project — see `projectRailClass`. */
const NEUTRAL_RAIL = 'border-l-line-2';

/**
 * FNV-1a, 32-bit. Chosen over `sum of charCodes % 6` because ids come from
 * `uid()` — 7 characters of base-36 — and a plain sum clusters badly on short
 * strings of a fixed length, which would hand most projects the same colour.
 * `>>> 0` keeps it unsigned so the modulo can never go negative.
 */
export function projectColourIndex(goalId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < goalId.length; i += 1) {
    hash ^= goalId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % PROJECT_COLOURS;
}

/**
 * The block's 3px left rail.
 *
 * `null` — a task belonging to no project — gets the neutral line colour.
 * Inventing a colour for it would assert a membership that does not exist.
 */
export function projectRailClass(goalId: string | null): string {
  return goalId === null ? NEUTRAL_RAIL : RAIL_CLASSES[projectColourIndex(goalId)];
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/projectColour.test.ts
```

Expected: PASS (11 tests — 5 behavioural + 6 contrast).

**If a contrast assertion fails**, adjust that token's value in `index.css` by moving its **lightness** toward the middle of the band, keeping its hue. Do not weaken the assertion.

- [ ] **Step 5: Prove the distribution test bites**

Temporarily replace the hash body with `return goalId.length % PROJECT_COLOURS;`. Re-run. Expected: `spreads ids across all six` FAILS — `uid()` ids are all length 7, so every project would share one colour. **Revert.** This is the check that the hash choice is doing real work.

- [ ] **Step 6: Commit**

```bash
npm test && npx tsc -b
git add src/lib/projectColour.ts src/lib/projectColour.test.ts
git commit -m "feat(plan): hash a project to one of six identity colours"
```

---

### Task 3: State on the fill

**Files:**
- Create: `src/lib/blockState.ts`, `src/lib/blockState.test.ts`

**Interfaces:**
- Consumes: `dueChip` (`src/lib/backlog.ts:69`), `behindPaceBy` (`src/lib/timeline.ts:66`), `goalPct` (`src/lib/pct.ts`).
- Produces:

```ts
export type BlockState = 'overdue' | 'behind' | 'none';
export function blockState(input: BlockStateInput): BlockState;
```

**Neither predicate is re-derived** (spec §3.3). Overdue comes from `dueChip(...).overdue`; behind-pace from `behindPaceBy`, which lives in `timeline.ts` — **not** `pace.ts`, which exports only the two label formatters `BehindChip` renders.

**The undated-project rule is the important one.** `behindPaceBy` needs a confirmed `start` **and** `deadline`. A project without both has no pace, and must fall through to `'none'`. Defaulting an undated project to "behind" would put warn colour on the majority of a new user's grid and paint the app's most serious signal onto its least informed state.

- [ ] **Step 1: Write the failing test**

Create `src/lib/blockState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { blockState } from './blockState';
import type { Goal } from '../db/types';

const TODAY = '2026-07-15';

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g1', title: 'P', column: 0,
    nodes: [{ id: 'n1', title: 'a', done: false }],
    ...over,
  } as Goal;
}

describe('what a block should say about itself', () => {
  it('is overdue when its own deadline has passed', () => {
    expect(blockState({ due: '2026-07-14', goal: null, today: TODAY })).toBe('overdue');
  });

  it('is not overdue on its due date', () => {
    expect(blockState({ due: TODAY, goal: null, today: TODAY })).toBe('none');
  });

  it('is behind when its project is behind pace', () => {
    // Halfway through the span with nothing done.
    const g = goal({ start: '2026-07-01', deadline: '2026-07-29' });
    expect(blockState({ due: undefined, goal: g, today: TODAY })).toBe('behind');
  });

  it('is NOT behind when the project has no schedule', () => {
    // The whole point: an undated project has no pace, so it must not be
    // painted warn. Most of a new user's projects are undated.
    expect(blockState({ due: undefined, goal: goal(), today: TODAY })).toBe('none');
  });

  it('is not behind when a scheduled project is on track', () => {
    const g = goal({
      start: '2026-07-01', deadline: '2026-07-29',
      nodes: [{ id: 'n1', title: 'a', done: true }],
    });
    expect(blockState({ due: undefined, goal: g, today: TODAY })).toBe('none');
  });

  it('prefers overdue over behind — the sharper fact wins', () => {
    const g = goal({ start: '2026-07-01', deadline: '2026-07-29' });
    expect(blockState({ due: '2026-07-14', goal: g, today: TODAY })).toBe('overdue');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/blockState.test.ts
```

Expected: FAIL — cannot resolve `./blockState`.

- [ ] **Step 3: Implement**

Create `src/lib/blockState.ts`:

```ts
import type { Goal } from '../db/types';
import { dueChip } from './backlog';
import { behindPaceBy } from './timeline';
import { goalPct } from './pct';

/**
 * What the block's FILL says. Project identity lives on the rail; this is the
 * other half of the hybrid the spec settles on — identity and state are
 * different questions and must not share a channel.
 */
export type BlockState = 'overdue' | 'behind' | 'none';

export interface BlockStateInput {
  /** The item's own deadline (step) or committed date (task). */
  due: string | undefined;
  /** Its project, or null for a loose task. */
  goal: Goal | null;
  today: string;
}

export function blockState({ due, goal, today }: BlockStateInput): BlockState {
  // Neither predicate is re-derived here — `dueChip` already owns "overdue"
  // for the rail, and re-implementing it would let the two drift.
  if (dueChip(due, today)?.overdue) return 'overdue';

  /*
   * `behindPaceBy` requires a confirmed start AND deadline. A project without
   * both has no pace at all, and must fall through to 'none'.
   *
   * Defaulting an undated project to "behind" would put warn colour on the
   * majority of a new user's grid — painting the app's most serious signal
   * onto exactly the state it knows least about.
   */
  if (goal?.start && goal.deadline) {
    if (behindPaceBy(goalPct(goal), goal.start, goal.deadline, today) > 0) return 'behind';
  }

  return 'none';
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/blockState.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Prove the undated guard bites**

Temporarily drop the `goal?.start && goal.deadline` guard, calling `behindPaceBy(goalPct(goal), goal.start ?? today, goal.deadline ?? today, today)`. Re-run. Expected: `is NOT behind when the project has no schedule` FAILS. **Revert.**

- [ ] **Step 6: Commit**

```bash
npm test && npx tsc -b
git add src/lib/blockState.ts src/lib/blockState.test.ts
git commit -m "feat(plan): decide a block's state from the predicates that already exist"
```

---

### Task 4: Paint the blocks

**Files:**
- Modify: `src/views/plan/EventBlock.tsx`, `src/views/plan/DayBlocks.tsx`

- [ ] **Step 1: Extend `GridBlock`**

In `src/views/plan/EventBlock.tsx`, add to the `GridBlock` interface (line 15):

```ts
  /** Owning project, or null for a loose task. Drives the rail colour. */
  goalId?: string | null;
  /** What the fill should say. See lib/blockState.ts. */
  state?: 'overdue' | 'behind' | 'none';
```

- [ ] **Step 2: Apply them**

Add the import:

```tsx
import { projectRailClass } from '../../lib/projectColour';
```

In the work-block branch of the root `className` (line 108), replace:

```tsx
          : `bg-panel border-line-2 border-l-[3px] border-l-accent text-ink touch-none ${block.done ? 'opacity-55 line-through' : ''} ${block.estimated ? '' : 'border-dashed'} cursor-grab`
```

with:

```tsx
          : `${block.state === 'none' || !block.state ? 'bg-panel' : 'bg-warn-tint'} border-line-2 border-l-[3px] ${projectRailClass(block.goalId ?? null)} text-ink touch-none ${block.done ? 'opacity-55 line-through' : ''} ${block.estimated ? '' : 'border-dashed'} cursor-grab`
```

> The rail was `border-l-accent` for every block — that is precisely the accent overload the UX review flagged. The accent now means *action*, `warn` means *trouble*, and project identity has its own six-value channel. A done block keeps today's `opacity-55 line-through`.

- [ ] **Step 3: Populate them where the block is built**

In `src/views/plan/DayBlocks.tsx` at the `const block: GridBlock = {` literal (line 102), add:

```tsx
          goalId: item.goalId,
          state: blockState({
            due: item.due,
            goal: item.goalId ? goals.find((g) => g.id === item.goalId) ?? null : null,
            today,
          }),
```

`DayBlocks` needs `goals` and `today` to do this. Rather than reaching into the store from a presentational component, add them as props:

```tsx
  /** Projects, for the rail colour and the pace predicate. */
  goals: Goal[];
  today: string;
```

and pass them from `Plan.tsx`'s `children` callback: `goals={goals}` and `today={today}` — both already in scope there.

> **`ScheduledItem` carries no `due` field** — verified: `src/lib/scheduled.ts` has `kind, id, goalId, goalTitle, title, done, date, startMin, endMin, estimated` and nothing else. Add `due?: string` to the interface and populate it inside `scheduledOn` from `n.deadline` for steps and `t.date` for tasks, mirroring exactly how `backlogGroups` builds `BacklogItem.due` (`backlog.ts`, the `...(n.deadline ? { due: n.deadline } : {})` and `...(t.date ? { due: t.date } : {})` spreads). That keeps one definition of "the urgency signal this item carries" rather than a second one on the grid.

- [ ] **Step 4: Typecheck, suite, commit**

```bash
npx tsc -b && npm test
git add src/views/plan/EventBlock.tsx src/views/plan/DayBlocks.tsx src/views/Plan.tsx src/lib/scheduled.ts
git commit -m "feat(plan): project identity on the rail, state on the fill"
```

---

### Task 5: The motion scale

**Files:**
- Modify: `tailwind.config.js`, `src/lib/designScale.test.ts`, `src/App.tsx`, `src/components/ProgressBar.tsx`

**This task must land as ONE commit.** The new rule rejects arbitrary `duration-[Nms]`, and the codebase already contains three: `duration-[220ms]` at `App.tsx:436` and `:462`, and `duration-[250ms]` at `ProgressBar.tsx:9`. Adding the rule without migrating them turns the suite red on arrival.

- [ ] **Step 1: Add the scale**

In `tailwind.config.js`, inside `theme.extend`, after `fontFamily`:

```js
      /*
       * The motion scale. Same reasoning as the type scale: it is only a scale
       * if it is enforced, so designScale.test.ts rejects arbitrary
       * `duration-[Nms]` alongside arbitrary font sizes.
       *
       * Tailwind's own numeric durations (duration-100, duration-150) remain
       * available and are still used in ~20 places. They are not the problem
       * the rule addresses — a NAMED step that drifts is; migrating them is
       * not worth the churn and is deliberately not attempted here.
       */
      transitionDuration: {
        fast: '120ms',   // hover, selection ring, quiet controls
        base: '180ms',   // block enter/exit, composer, panels
        slow: '260ms',   // week cross-fade
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(.2, 0, 0, 1)',
      },
```

> `fast` is 120ms because `.quiet-control` already transitions `opacity .12s` — the scale is being named around a value the codebase had already converged on, not imposed over it.

- [ ] **Step 2: Migrate the three arbitrary values**

In `src/App.tsx`, replace `duration-[220ms]` with `duration-base` at both sites (lines 436 and 462). Both are the **toast** transitions (`fixed bottom-[20px] … bg-ink text-paper`), not view changes — `slow` is reserved for the week cross-fade, and a toast that takes 260ms to appear feels sluggish. This speeds them from 220ms to 180ms.

In `src/components/ProgressBar.tsx:9`, replace `duration-[250ms]` with `duration-slow` (250 → 260ms, the nearest step) and `ease-in-out` with `ease-standard`.

```bash
grep -rn "duration-\[" src/
```

Expected after the edits: **no matches.**

- [ ] **Step 3: Add the rule**

In `src/lib/designScale.test.ts`, after the arbitrary-font-size test:

```ts
  /**
   * A duration is a scale value, not a number someone typed.
   *
   * Three arbitrary values had already accumulated — `duration-[220ms]` twice
   * in App and `duration-[250ms]` in ProgressBar — describing two transitions
   * that mean the same thing at two different speeds. Naming the scale is
   * worthless if the next feature adds `duration-[240ms]`, which is the same
   * argument the font-size rule above makes.
   *
   * Tailwind's own numeric steps (`duration-100`, `duration-150`) are NOT
   * policed: they are a documented part of the framework's scale, not an
   * invented value.
   */
  it('declares no arbitrary transition durations — use the named steps', () => {
    expect(offenders(/duration-\[[0-9.]+m?s\]/g)).toEqual([]);
  });
```

- [ ] **Step 4: Run and prove the rule bites**

```bash
npx vitest run src/lib/designScale.test.ts
```

Expected: PASS.

Now plant a violation — add `className="duration-[240ms]"` to any element in `src/views/plan/DayColumn.tsx` — and re-run. Expected: the new test FAILS, naming that file and line. **Remove the planted class.**

- [ ] **Step 5: Commit**

```bash
npm test && npx tsc -b
git add tailwind.config.js src/lib/designScale.test.ts src/App.tsx src/components/ProgressBar.tsx
git commit -m "feat(design): a named motion scale, and enforce it"
```

---

### Task 6: The week cross-fade

**Files:** Modify `src/views/plan/WeekGrid.tsx`

**A cross-fade, not a slide** (spec Part 5). Sliding a two-axis scroller is disproportionate work for the payoff and would fight the scroll-restoration logic, which re-arms on a real week change.

- [ ] **Step 1: Fade the grid on week change**

In `WeekGrid.tsx`, the component already derives `weekKey`. Add a keyed wrapper inside the scroller so a week change remounts the content and re-runs the entrance:

```tsx
      <div key={weekKey} className="min-w-[780px] animate-[fade-in] duration-slow ease-standard">
```

and declare the keyframes in `src/index.css`:

```css
@keyframes fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
```

> **Check this against scroll restoration before committing.** The `useLayoutEffect` at `WeekGrid.tsx:107` keys its `doneFor` guard on `weekKey`, and remounting the subtree must not make it re-run against a stale `scrollerRef`. The scroller itself is *outside* the keyed wrapper, so its ref and `scrollTop` survive — that placement is load-bearing. If the grid visibly jumps to 00:00 on week change, the wrapper has been placed too high; move it back inside the scroller.

- [ ] **Step 2: Verify the entrance does not fight reduced motion**

```bash
grep -n "prefers-reduced-motion" -A 6 src/index.css
```

Confirm the global rule disables animations, not merely transitions. If it only covers `transition`, extend it to `animation` — an entrance that ignores the preference is worse than no entrance.

- [ ] **Step 3: Commit**

```bash
npm test && npx tsc -b
git add src/views/plan/WeekGrid.tsx src/index.css
git commit -m "feat(plan): cross-fade the week"
```

---

### Task 7: Verification sweep

- [ ] **Step 1: Suite, typecheck, build**

```bash
npm test && npx tsc -b && npm run build
```

This plan adds 23 tests (11 + 6 + the design-scale rule + the contrast cases already counted).

- [ ] **Step 2: No hex crept in**

```bash
npx vitest run src/lib/designScale.test.ts
```

Expected: all five rules pass, including the new duration rule.

- [ ] **Step 3: The accent is no longer the block rail**

```bash
grep -n "border-l-accent" src/views/plan/EventBlock.tsx
```

Expected: **no matches.** That was the accent overload this part exists to resolve.

- [ ] **Step 4: Manual checks** — `npm run dev`:

- [ ] Two different projects' blocks show two different rail colours, and the same project is the same colour on every block and after a reload.
- [ ] A loose task (no project) shows the neutral grey rail, not a colour.
- [ ] Toggle dark mode → every rail is still clearly visible against the block.
- [ ] A step whose deadline has passed shows the warn fill. One due today does not.
- [ ] A project with **no start/deadline** shows **no** warn fill, however little is done — check this specifically, it is the failure mode that would paint most of a new grid red.
- [ ] A behind-pace project with dates shows the warn fill.
- [ ] A done block still reads as done (faded, struck through) rather than being recoloured.
- [ ] Change week → the grid cross-fades, and does **not** jump to midnight.
- [ ] Enable "Reduce motion" in the OS → the cross-fade stops.

---

## What this plan does NOT do

- The capacity gutter, the temperature wash, and the all-day lane — spec Part 4, planned separately.
- Anything in Part 2 (direct manipulation) — plans 2a and 2b.
- A colour picker. Assignment is automatic and hashed, by decision.
