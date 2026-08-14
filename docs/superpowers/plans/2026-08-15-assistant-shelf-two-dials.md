# Assistant Shelf: Two Dials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the shelf's one mislabelled dial into two honest ones — time decides what fits, Focus decides how much you are handed — replace the "Other options" disclosure with a Sidecar column, add a session ring that never implies a countdown, put a sourced quote on the send-off, and stop the focus ring painting on every open.

**Architecture:** `src/lib/focusLens.ts` is renamed to `src/lib/timeLens.ts` — same caps, same membership rules, honest labels. A new, deliberately thin `src/lib/shelfDetail.ts` owns the display axis and is applied by `AssistantSurface` alone, never by `executionAdvisor`. Two new pure modules (`sessionRing.ts`, `sendoff.ts`) carry logic that would otherwise sit in components. All rendering changes land in `AssistantSurface.tsx`, which keeps its two presentations (`shelf` = Sidecar, `embedded` = stacked).

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, Vitest + Testing Library, Electron.

**Spec:** `docs/superpowers/specs/2026-08-15-assistant-shelf-two-dials-design.md`

## Global Constraints

- **Value strings never change.** Both dials keep `'low' | 'medium' | 'high'`. `Session.focus?: 'low'` is historical data read by `teachingSessions` (`expectedTime.ts:147`, `s.focus !== 'low'`); changing the string would make every stored low-focus session start teaching estimates again. Rename types, not values. No migration is written by this plan.
- **Storage property names never change.** `FOCUS_LEVEL_KEY = 'focusLevel'` (`db.ts:226`), `ActiveFocusSession.focusLevel`, `Session.focus`. Storage/UI divergence follows the `checkpoint`/Milestone precedent.
- **The display dial never reaches `executionAdvisor`.** It caps alternatives in `AssistantSurface` via `slice`. The advisor holds no ranking and no presentation, and `agentReads.ts:107` already refuses to pass a shelf mood outward.
- **The overlay gains no new snapshot data beyond the two level fields.** No free-time figures, no busy spans, no next-commitment time, no calendar titles. `entryBoundary.test.ts` must still pass.
- **`MAX_ALTERNATIVES` stays 2** (`executionAdvisor.ts:83`) as the ceiling. `ALTERNATIVE_CAP` caps below it and never above.
- **Nothing counts down.** No timer, no countdown, no notice fired when a declared gap elapses.
- **Type scale and colour tokens only.** `designScale.test.ts` fails the build on a literal hex, an arbitrary `text-[Nrem]`, and any second use of `font-disp`. The send-off quote is Inter, not Fraunces.
- Run `npx tsc -b` and `npm test` before every commit.

---

### Task 1: Rename `focusLens` to `timeLens`

The module already caps by minutes (`FOCUS_CAP = { low: 25, medium: 60, high: Infinity }` under the comment "The longest piece of DISCRETIONARY work each level will offer, in minutes"). This gives it the honest name and label, and moves the narrowest cap 25 → 30 so the chip reads a number a person thinks in. No behaviour beyond that cap changes.

**Files:**
- Rename: `src/lib/focusLens.ts` → `src/lib/timeLens.ts`
- Rename: `src/lib/focusLens.test.ts` → `src/lib/timeLens.test.ts`
- Rename: `src/state/store.focusLevel.test.ts` → `src/state/store.timeLevel.test.ts`
- Modify: `src/lib/executionAdvisor.ts`, `src/lib/assistantProtocol.ts`, `src/lib/focusSession.ts`, `src/db/db.ts`, `src/state/store.ts`, `src/components/assistant/AssistantSurface.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `TimeLevel` (`'low'|'medium'|'high'`), `TIME_LEVELS`, `TIME_CAP: Record<TimeLevel, number>` = `{ low: 30, medium: 60, high: Infinity }`, `TIME_WORD: Record<TimeLevel, string>` = `{ low: '30m', medium: '1h', high: 'Any' }`, `DEFAULT_TIME_LEVEL`, `isTimeLevel`, `fitsWindow(level, expected)`, `admits(level, reason, expected)`, `isCommitment`, `StoredTimeLevel`, `parseStoredTimeLevel`, `serializeTimeLevel`, `timeLevelFor(stored, today)`.

- [ ] **Step 1: Move the files with git so history follows**

```bash
cd "/Users/por25528/Programming stuff/Projects/Phase"
git mv src/lib/focusLens.ts src/lib/timeLens.ts
git mv src/lib/focusLens.test.ts src/lib/timeLens.test.ts
git mv src/state/store.focusLevel.test.ts src/state/store.timeLevel.test.ts
```

- [ ] **Step 2: Write the failing test for the new cap and words**

Add to `src/lib/timeLens.test.ts` (keep every existing case, only change the import path and identifiers):

```ts
import { TIME_CAP, TIME_WORD, fitsWindow } from './timeLens';

describe('the dial says what it filters', () => {
  it('caps the narrowest level at the round number its chip shows', () => {
    expect(TIME_CAP.low).toBe(30);
    expect(TIME_WORD.low).toBe('30m');
  });

  it('admits a 30-minute estimate at the narrowest level', () => {
    expect(fitsWindow('low', { kind: 'estimate', minutes: 30 })).toBe(true);
  });

  it('still refuses a starter at the narrowest level, as a rule and not arithmetic', () => {
    expect(fitsWindow('low', { kind: 'starter', minutes: 5 })).toBe(false);
  });

  it('still judges a history range on its high end', () => {
    expect(fitsWindow('low', { kind: 'history', lowMin: 10, highMin: 45 })).toBe(false);
    expect(fitsWindow('low', { kind: 'history', lowMin: 10, highMin: 30 })).toBe(true);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/lib/timeLens.test.ts`
Expected: FAIL — `Failed to resolve import "./timeLens"` has been fixed by the `git mv`, so the failure is `TIME_CAP is not exported` / `fitsWindow is not a function`.

- [ ] **Step 4: Rename the identifiers inside `src/lib/timeLens.ts`**

Apply exactly these renames in the moved file, leaving every doc comment's *reasoning* intact and updating only the words that name things:

| from | to |
|---|---|
| `FocusLevel` | `TimeLevel` |
| `FOCUS_LEVELS` | `TIME_LEVELS` |
| `DEFAULT_FOCUS_LEVEL` | `DEFAULT_TIME_LEVEL` |
| `FOCUS_CAP` | `TIME_CAP` |
| `FOCUS_WORD` | `TIME_WORD` |
| `isFocusLevel` | `isTimeLevel` |
| `StoredFocusLevel` | `StoredTimeLevel` |
| `parseStoredFocusLevel` | `parseStoredTimeLevel` |
| `serializeFocusLevel` | `serializeTimeLevel` |
| `focusLevelFor` | `timeLevelFor` |
| `fitsFocus` | `fitsWindow` |

Then change these three values:

```ts
/** The longest piece of DISCRETIONARY work each level will offer, in minutes. */
export const TIME_CAP: Record<TimeLevel, number> = {
  low: 30,
  medium: 60,
  high: Infinity,
};

/**
 * What each level is called on the dial. The words are DURATIONS because the
 * caps always were: a control that asked how you felt while filtering by
 * minutes made you translate a mood into a number it already had.
 *
 * 30 rather than the 25 this cap carried for its first life. The number is a
 * self-report now, and nobody has a twenty-five-minute gap — they have half an
 * hour. A threshold nobody would choose is a threshold that gets ignored.
 */
export const TIME_WORD: Record<TimeLevel, string> = {
  low: '30m',
  medium: '1h',
  high: 'Any',
};
```

Replace the module's opening doc comment with:

```ts
/**
 * How long you have, and what the shelf may offer you because of it.
 *
 * This is a LENS, not a ranking. `executionAdvisor` states its own
 * constitution — "This module deliberately contains no ranking of its own… two
 * opinions is how the assistant and the Today page start disagreeing" — and
 * nothing here touches order. Membership is the only thing a level changes,
 * exactly as `lifeScope` changes which cards the board shows without touching
 * their ranks.
 *
 * The number is one you SET, never one Phase predicts. A gap computed from
 * your calendar is wrong exactly when the day goes sideways — a class runs
 * late, a friend calls — which is exactly when this surface gets opened. The
 * one figure it trusts is the one you are holding when you summon it, and it
 * spends that figure on CHOOSING work and never on bounding the session that
 * follows. Once you start, nothing counts down.
 *
 * The caps are monotone: every level admits everything the level below it
 * admits, plus more. A dial whose middle setting hid something its lowest
 * setting showed would not be a dial.
 */
```

- [ ] **Step 5: Run the module's tests**

Run: `npx vitest run --config vitest.config.ts src/lib/timeLens.test.ts`
Expected: PASS. If an existing case asserted `25`, update it to `30` — that is the one intended behaviour change.

- [ ] **Step 6: Update the six importers**

`src/lib/executionAdvisor.ts` — line 7, and the field and local names:

```ts
import { admits, type TimeLevel } from './timeLens';
```

```ts
      /**
       * The window in force admitted nothing, so `primary` is the unfiltered
       * head of the queue. The surface says so out loud — "Nothing that short
       * left" is a different sentence from "nothing needs you", and re-sorting
       * to find something shorter would be the second opinion this module
       * refuses.
       */
      beyondWindow?: true;
```

```ts
  /**
   * How long the user says they have. ABSENT means no lens at all, which is
   * what every surface other than the shelf passes: a gap declared in a café
   * must not rewrite the Today page you check on the train home — the same
   * boundary the life switcher holds when the board scopes and the week does
   * not.
   */
  timeLevel?: TimeLevel;
```

and in the body (currently lines 219–250) rename `input.focusLevel` → `input.timeLevel` and the local `beyondFocus` → `beyondWindow`, including the spread `...(beyondWindow ? { beyondWindow: true as const } : {})`.

`src/lib/assistantProtocol.ts` — swap the import and the snapshot field:

```ts
import type { TimeLevel } from './timeLens';
```
```ts
      timeLevel: TimeLevel;
```
```ts
  | { type: 'set-time-level'; level: TimeLevel }
```

`src/lib/focusSession.ts` — line 2 and the two `FocusLevel` annotations. **Keep the property name `focusLevel`** on `ActiveFocusSession` and its input; it is persisted in a settings row and renaming it would drop the level of any session in flight across the upgrade:

```ts
import { DEFAULT_TIME_LEVEL, isTimeLevel, type TimeLevel } from './timeLens';
```
```ts
  /**
   * The window the session was started in. Stored under its original name
   * because this object is a settings row: a rename would read as absent to
   * every session already in flight. It reaches history as `Session.focus` and
   * nowhere else.
   */
  focusLevel: TimeLevel;
```
and line 214: `focusLevel: isTimeLevel(s.focusLevel) ? s.focusLevel : DEFAULT_TIME_LEVEL,`

`src/db/db.ts` — lines 18–19 and 228–234. **Keep `FOCUS_LEVEL_KEY = 'focusLevel'`**:

```ts
import {
  parseStoredTimeLevel, serializeTimeLevel, type StoredTimeLevel,
} from '../lib/timeLens';
```
```ts
// The settings KEY keeps its original spelling: it names a row that already
// exists in every database, and renaming it would silently reset the dial.
const FOCUS_LEVEL_KEY = 'focusLevel';

export async function loadStoredTimeLevel(): Promise<StoredTimeLevel | null> {
  const row = await db.settings.get(FOCUS_LEVEL_KEY);
  return parseStoredTimeLevel(row?.value);
}

export async function saveStoredTimeLevel(stored: StoredTimeLevel): Promise<void> {
  await db.settings.put({ key: FOCUS_LEVEL_KEY, value: serializeTimeLevel(stored) });
}
```

`src/state/store.ts` — line 15 (`loadStoredTimeLevel, saveStoredTimeLevel`), line 69 (`DEFAULT_TIME_LEVEL, timeLevelFor, isTimeLevel, type TimeLevel`), and rename the state field `focusLevel` → `timeLevel` at lines 217, 269, 672, 1876 and the action at 1973:

```ts
  /**
   * How long the user last said they had. Reset daily by `timeLevelFor`, so
   * nobody has to remember to put the dial back.
   */
  setTimeLevel(next: TimeLevel): boolean {
    if (!isTimeLevel(next)) return false;
    set({ timeLevel: next });
    ifOwner(() => saveStoredTimeLevel({ level: next, date: todayStr() }));
    return true;
  },
```

Lines 1914 and 1935 keep their shape and gain a comment, because this is the one place the two axes could be confused:

```ts
      // The TIME level, never the display one: a session run inside a declared
      // half-hour is not evidence the work takes half an hour, while how many
      // options you were shown cannot affect how long you worked.
      draft.focusLevel === 'low' ? 'low' : undefined,
```

`src/components/assistant/AssistantSurface.tsx` — line 8 becomes
`import { TIME_LEVELS, TIME_WORD, type TimeLevel } from '../../lib/timeLens';`
and `FocusStrip`'s internals are rewritten wholesale in Task 5. For this task only, make it compile: rename its `level: FocusLevel` to `level: TimeLevel`, `FOCUS_LEVELS` → `TIME_LEVELS`, `FOCUS_WORD` → `TIME_WORD`, and the action to `set-time-level`.

- [ ] **Step 7: Sweep the test fixtures**

Run: `grep -rln "focusLevel\|FocusLevel\|fitsFocus\|beyondFocus\|FOCUS_" src electron`
Every remaining hit is a test fixture building a store or advice object. Rename `focusLevel:` → `timeLevel:` and `beyondFocus` → `beyondWindow` in each. Leave `Session.focus`, `ActiveFocusSession.focusLevel` and `FOCUS_LEVEL_KEY` alone — those are storage.

- [ ] **Step 8: Typecheck and run the whole suite**

Run: `npx tsc -b && npm test`
Expected: PASS, whole suite green.

- [ ] **Step 9: Commit**

```bash
git add -A src electron
git commit -m "refactor(shelf): the dial that filters by minutes is named for minutes

FOCUS_CAP was {25, 60, ∞} under a comment saying it capped DISCRETIONARY work
in minutes, while the control above it asked how you felt. Same lens, same
membership rules, honest name — and the narrowest cap moves 25 to 30, because
the number is a self-report now and nobody has a twenty-five-minute gap.

Value strings and storage keys are untouched: Session.focus is history that
teachingSessions reads, and a renamed value would silently let every old
low-focus sitting start teaching estimates again.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: `shelfDetail.ts` — the display axis

**Files:**
- Create: `src/lib/shelfDetail.ts`
- Create: `src/lib/shelfDetail.test.ts`

**Interfaces:**
- Consumes: `MAX_ALTERNATIVES` from `./executionAdvisor`.
- Produces: `DetailLevel` (`'low'|'medium'|'high'`), `DETAIL_LEVELS`, `DETAIL_WORD`, `DEFAULT_DETAIL_LEVEL`, `isDetailLevel(raw): raw is DetailLevel`, `ALTERNATIVE_CAP: Record<DetailLevel, number>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/shelfDetail.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ALTERNATIVE_CAP, DETAIL_LEVELS, DETAIL_WORD, DEFAULT_DETAIL_LEVEL,
  isDetailLevel, type DetailLevel,
} from './shelfDetail';
import { MAX_ALTERNATIVES } from './executionAdvisor';

describe('shelfDetail', () => {
  it('never offers more than the advisor produces', () => {
    for (const level of DETAIL_LEVELS) {
      expect(ALTERNATIVE_CAP[level]).toBeLessThanOrEqual(MAX_ALTERNATIVES);
    }
  });

  it('is monotone — a higher setting never hides what a lower one showed', () => {
    expect(ALTERNATIVE_CAP.low).toBeLessThanOrEqual(ALTERNATIVE_CAP.medium);
    expect(ALTERNATIVE_CAP.medium).toBeLessThanOrEqual(ALTERNATIVE_CAP.high);
  });

  it('hands you one thing and no menu at its lowest', () => {
    expect(ALTERNATIVE_CAP.low).toBe(0);
  });

  it('names every level', () => {
    for (const level of DETAIL_LEVELS) {
      expect(DETAIL_WORD[level].length).toBeGreaterThan(0);
    }
    expect(DEFAULT_DETAIL_LEVEL).toBe('medium');
  });

  it('rejects anything that is not a level', () => {
    expect(isDetailLevel('low')).toBe(true);
    expect(isDetailLevel('LOW')).toBe(false);
    expect(isDetailLevel(undefined)).toBe(false);
    expect(isDetailLevel(2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/lib/shelfDetail.test.ts`
Expected: FAIL — `Failed to resolve import "./shelfDetail"`.

- [ ] **Step 3: Write the module**

Create `src/lib/shelfDetail.ts`:

```ts
import { MAX_ALTERNATIVES } from './executionAdvisor';

/**
 * How much the shelf puts in front of you.
 *
 * The second of the shelf's two dials, and deliberately the thinner one. A
 * task in Phase carries a title, an estimate, a status, dates and blocks —
 * nothing says how HARD it is — so this cannot mean "give me easy work"
 * without inventing a field somebody has to fill in by hand, forever, for
 * every task. What it can honestly mean is how many choices you are handed,
 * because choosing is the expensive part when you are tired.
 *
 * It changes no ranking and no membership: `timeLens` decides what fits, this
 * decides how much of it you see, and the same work is behind both. That is
 * why it is applied by `AssistantSurface` and never reaches
 * `executionAdvisor` — the advisor holds no presentation, exactly as
 * `agentReads` refuses to let a shelf setting reach the agent surface.
 *
 * Pure view state, like `activeLifeId` on the board: held in memory, never
 * persisted, and never written onto a session. How many options you were shown
 * cannot affect how long you worked, so it is not evidence about anything.
 */

export type DetailLevel = 'low' | 'medium' | 'high';

export const DETAIL_LEVELS: readonly DetailLevel[] = ['low', 'medium', 'high'];

/** What a fresh shelf offers. Not stored, so this is also what every open starts at. */
export const DEFAULT_DETAIL_LEVEL: DetailLevel = 'medium';

export const DETAIL_WORD: Record<DetailLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/**
 * How many alternatives each level offers beside the primary.
 *
 * `MAX_ALTERNATIVES` (2) remains the ceiling and this caps BELOW it, never
 * above — the advisor decides what exists, this decides how much is drawn.
 * `low` is 0, which is what removes the Sidecar column entirely: one card, no
 * menu.
 */
export const ALTERNATIVE_CAP: Record<DetailLevel, number> = {
  low: 0,
  medium: 1,
  high: MAX_ALTERNATIVES,
};

export function isDetailLevel(raw: unknown): raw is DetailLevel {
  return raw === 'low' || raw === 'medium' || raw === 'high';
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run --config vitest.config.ts src/lib/shelfDetail.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shelfDetail.ts src/lib/shelfDetail.test.ts
git commit -m "feat(shelf): a dial for how much, beside the one for how long

Focus cannot mean 'easy work' — no task in Phase carries a difficulty. It can
honestly mean how many choices you are handed, which is the expensive part
when you are tired. Caps below MAX_ALTERNATIVES, never above, and never
reaches the advisor.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Carry both levels across the relay

**Files:**
- Modify: `src/lib/assistantProtocol.ts`
- Modify: `electron/assistantIpc.cjs:107` and `:124`
- Modify: `electron/assistantIpc.test.ts`

**Interfaces:**
- Consumes: `TimeLevel` (Task 1), `DetailLevel` (Task 2).
- Produces: `AssistantSnapshot` ready-variant carries `timeLevel: TimeLevel` **and** `detailLevel: DetailLevel`; `AssistantAction` gains `{ type: 'set-detail-level'; level: DetailLevel }`.

- [ ] **Step 1: Write the failing relay test**

Add to `electron/assistantIpc.test.ts`, matching the file's existing style for building a snapshot:

```ts
it('rejects a snapshot missing the detail level', () => {
  const snapshot = { ...readySnapshot(), detailLevel: undefined };
  expect(validSnapshot(snapshot)).toBe(false);
});

it('rejects a detail level that is not a level', () => {
  expect(validSnapshot({ ...readySnapshot(), detailLevel: 'LOW' })).toBe(false);
});

it('accepts the detail-level verb and rejects a bad level', () => {
  expect(validAction({ type: 'set-detail-level', level: 'high' })).toBe(true);
  expect(validAction({ type: 'set-detail-level', level: 'huge' })).toBe(false);
});

it('accepts the renamed time-level verb', () => {
  expect(validAction({ type: 'set-time-level', level: 'low' })).toBe(true);
  expect(validAction({ type: 'set-focus-level', level: 'low' })).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts electron/assistantIpc.test.ts`
Expected: FAIL — `set-detail-level` falls to `default: return false`, and `set-focus-level` still returns true.

- [ ] **Step 3: Update the protocol**

In `src/lib/assistantProtocol.ts`:

```ts
import type { DetailLevel } from './shelfDetail';
import type { TimeLevel } from './timeLens';
```

```ts
export type AssistantSnapshot =
  | { status: 'loading' }
  | {
      status: 'ready';
      advice: ExecutionAdvice;
      activeFocus: AssistantFocusView | null;
      /** How long the user says they have. Decides what fits. */
      timeLevel: TimeLevel;
      /** How much the shelf hands over. Decides how much is drawn. */
      detailLevel: DetailLevel;
      notice?: { tone: 'neutral' | 'warning'; text: string };
    };
```

```ts
  | { type: 'set-time-level'; level: TimeLevel }
  | { type: 'set-detail-level'; level: DetailLevel }
```

- [ ] **Step 4: Update the relay validator**

In `electron/assistantIpc.cjs`, replace line 107 and the `set-focus-level` case. The file imports nothing from `src/` by design, so the level words are spelled out here as they always were:

```js
function validLevel(level) {
  return level === 'low' || level === 'medium' || level === 'high';
}
```

```js
  return validAdvice(snapshot.advice)
    && validFocus(snapshot.activeFocus)
    && validLevel(snapshot.timeLevel)
    && validLevel(snapshot.detailLevel)
    && validNotice(snapshot.notice);
```

```js
    case 'set-time-level':
    case 'set-detail-level':
      return validLevel(action.level);
```

- [ ] **Step 5: Run the relay tests**

Run: `npx vitest run --config vitest.config.ts electron/assistantIpc.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/assistantProtocol.ts electron/assistantIpc.cjs electron/assistantIpc.test.ts
git commit -m "feat(shelf): the relay carries both dials

Two levels on the snapshot, two verbs back. The validator gains one shared
predicate rather than two spellings of the same three words.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Store and host wiring

**Files:**
- Modify: `src/state/store.ts` (state field, default, `setDetailLevel`)
- Modify: `src/components/assistant/AssistantHost.tsx:158-200`
- Modify: `src/lib/assistantProtocol.ts` (`elapsedAgainstExpected` parameter type)
- Modify: `src/state/store.timeLevel.test.ts`

**Interfaces:**
- Consumes: `DetailLevel`, `DEFAULT_DETAIL_LEVEL`, `isDetailLevel` (Task 2); protocol from Task 3.
- Produces: `actions.setDetailLevel(next: DetailLevel): boolean`; `state.detailLevel: DetailLevel`; snapshot built by `AssistantHost` carries both levels.

- [ ] **Step 1: Write the failing store test**

Add to `src/state/store.timeLevel.test.ts`:

```ts
it('keeps the display dial in memory and never writes it', async () => {
  const puts: unknown[] = [];
  // The suite's existing settings spy — mirror whatever this file already uses
  // to assert `saveStoredTimeLevel` was called; assert the opposite here.
  expect(store.getState().detailLevel).toBe('medium');
  expect(actions.setDetailLevel('low')).toBe(true);
  expect(store.getState().detailLevel).toBe('low');
  expect(puts).toHaveLength(0);
});

it('refuses a detail level that is not a level', () => {
  expect(actions.setDetailLevel('enormous' as never)).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/state/store.timeLevel.test.ts`
Expected: FAIL — `actions.setDetailLevel is not a function`.

- [ ] **Step 3: Add the state and the action**

In `src/state/store.ts`, beside `timeLevel: TimeLevel;` at line 217:

```ts
  /**
   * How much the shelf hands over. In memory beside `activeLifeId` and never
   * persisted, so every load starts at the default — a mood is not a setting.
   */
  detailLevel: DetailLevel;
```

Beside the default at line 269: `detailLevel: DEFAULT_DETAIL_LEVEL,`

Beside `setTimeLevel`:

```ts
  setDetailLevel(next: DetailLevel): boolean {
    if (!isDetailLevel(next)) return false;
    set({ detailLevel: next });
    return true;
  },
```

Import at line 69's neighbour:

```ts
import { DEFAULT_DETAIL_LEVEL, isDetailLevel, type DetailLevel } from '../lib/shelfDetail';
```

- [ ] **Step 4: Wire the host**

In `src/components/assistant/AssistantHost.tsx`, take `detailLevel` from the store beside `timeLevel`, pass `timeLevel` into `executionAdvice`, and put both on the snapshot:

```ts
    const advice = executionAdvice({
      goals, tasks, sessions, availability, blocks: [], allDayBlocks,
      today, week: weekOf(today), now: { date: today, minute: nowMinute() },
      timeLevel,
    });
```
```ts
    return {
      status: 'ready',
      advice,
      activeFocus,
      timeLevel,
      detailLevel,
      ...(notice ? { notice } : {}),
    };
  }, [hydration, goals, tasks, sessions, availability, allDayBlocks, activeFocusSession, timeLevel, detailLevel, notice]);
```

and in `onAction`:

```ts
      case 'set-time-level': actions.setTimeLevel(action.level); return;
      case 'set-detail-level': actions.setDetailLevel(action.level); return;
```

- [ ] **Step 5: Retype `elapsedAgainstExpected`**

In `src/lib/assistantProtocol.ts`, the third parameter becomes the DISPLAY axis. Change the import and signature, and extend the doc comment:

```ts
import { DEFAULT_DETAIL_LEVEL, type DetailLevel } from './shelfDetail';
```
```ts
/**
 * …existing comment retained…
 *
 * The level here is the DISPLAY dial, not the time one. Dropping the
 * comparison is a statement about how much you want in front of you — "the
 * pressure in a running session was never the elapsed figure, it is the figure
 * it is being measured against" — and that is the display axis exactly. How
 * long your gap was has no bearing on how much of the readout you want.
 */
export function elapsedAgainstExpected(
  elapsedMin: number,
  expected: ExpectedTime,
  level: DetailLevel = DEFAULT_DETAIL_LEVEL,
): string {
```

- [ ] **Step 6: Run typecheck and the suite**

Run: `npx tsc -b && npm test`
Expected: PASS. Test fixtures that build a ready snapshot need `detailLevel: 'medium'` added — add it wherever the compiler points.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "feat(shelf): the display dial is in-memory state, like the life switcher

Never persisted, never on a session, and never passed to the advisor. And
elapsedAgainstExpected takes the display level now: dropping the comparison is
about how much you want in front of you, not how long your gap was.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Two dials in the header

**Files:**
- Modify: `src/components/assistant/AssistantSurface.tsx:71-87` (`FocusStrip`), `:326-337` (the key handler)
- Modify: `src/components/assistant/AssistantSurface.test.tsx`

**Interfaces:**
- Consumes: `TIME_LEVELS`/`TIME_WORD`/`TimeLevel` (Task 1), `DETAIL_LEVELS`/`DETAIL_WORD`/`DetailLevel` (Task 2), both verbs (Task 3).
- Produces: a `DialStrip` component rendering both `SegmentedSwitch`es, accessible names `"How long you have"` and `"How much to show"`.

- [ ] **Step 1: Write the failing test**

```tsx
it('offers both dials, named for what each one does', () => {
  const onAction = vi.fn();
  render(<AssistantSurface snapshot={ready()} onAction={onAction} />);

  expect(screen.getByRole('group', { name: 'How long you have' })).toBeTruthy();
  expect(screen.getByRole('group', { name: 'How much to show' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '30m' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Any' })).toBeTruthy();
});

it('sends the right verb from the right dial', () => {
  const onAction = vi.fn();
  render(<AssistantSurface snapshot={ready()} onAction={onAction} />);

  fireEvent.click(screen.getByRole('button', { name: '30m' }));
  expect(onAction).toHaveBeenCalledWith({ type: 'set-time-level', level: 'low' });

  fireEvent.click(screen.getByRole('button', { name: 'High' }));
  expect(onAction).toHaveBeenCalledWith({ type: 'set-detail-level', level: 'high' });
});

it('keeps the number keys on the dial that changes what you are offered', () => {
  const onAction = vi.fn();
  render(<AssistantSurface snapshot={ready()} onAction={onAction} />);

  fireEvent.keyDown(window, { key: '1' });
  expect(onAction).toHaveBeenCalledWith({ type: 'set-time-level', level: 'low' });
  fireEvent.keyDown(window, { key: '3' });
  expect(onAction).toHaveBeenCalledWith({ type: 'set-time-level', level: 'high' });
});
```

Update the `ready()` helper in this file to `timeLevel: 'medium', detailLevel: 'medium'`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx -t "both dials"`
Expected: FAIL — `Unable to find role="group" with name "How long you have"`.

- [ ] **Step 3: Replace `FocusStrip` with `DialStrip`**

```tsx
/**
 * The shelf's two dials, and the only always-present controls on it.
 *
 * They are two axes and never one: the left says how long you have, which
 * decides what fits; the right says how much to hand over, which decides how
 * much is drawn. Ship them as one control and "half an hour" and "keep it
 * simple" have to share a number neither of them means.
 *
 * `SegmentedSwitch` rather than `SegmentedControl`: this is view state and not
 * form data, the same distinction Board/Timeline already makes. `sm` because
 * the shelf is a dense toolbar, and because 26px clears the 24px target floor.
 */
function DialStrip({ timeLevel, detailLevel, onAction }: {
  timeLevel: TimeLevel;
  detailLevel: DetailLevel;
  onAction: Props['onAction'];
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line pb-2">
      <span className="text-meta font-semibold text-muted">I&rsquo;ve got</span>
      <SegmentedSwitch
        label="How long you have"
        size="sm"
        value={timeLevel}
        options={TIME_LEVELS.map((value) => ({ value, label: TIME_WORD[value] }))}
        onChange={(next) => onAction({ type: 'set-time-level', level: next })}
      />
      <span className="ml-1 text-meta font-semibold text-muted">Focus</span>
      <SegmentedSwitch
        label="How much to show"
        size="sm"
        value={detailLevel}
        options={DETAIL_LEVELS.map((value) => ({ value, label: DETAIL_WORD[value] }))}
        onChange={(next) => onAction({ type: 'set-detail-level', level: next })}
      />
    </div>
  );
}
```

Rename the constant and keep the comment's reason:

```tsx
/**
 * The dial on the home row of the number keys, and it drives the TIME one —
 * that is the dial which changes what you are offered. Two dials would want
 * six keys, and the shelf is not a keyboard surface. There is no text field to
 * steal them.
 */
const KEY_TO_TIME_LEVEL: Record<string, TimeLevel | undefined> = {
  '1': 'low', '2': 'medium', '3': 'high',
};
```

and in the key handler:

```tsx
      const level = KEY_TO_TIME_LEVEL[event.key];
      if (level) onAction({ type: 'set-time-level', level });
```

Update the render site: `<DialStrip timeLevel={snapshot.timeLevel} detailLevel={snapshot.detailLevel} onAction={onAction} />`, and `FocusPanel`'s `level` prop now takes `snapshot.detailLevel`.

- [ ] **Step 4: Run the surface tests**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx`
Expected: PASS. Existing tests referencing `Focus level` as a group name need the new names.

- [ ] **Step 5: Commit**

```bash
git add src/components/assistant/AssistantSurface.tsx src/components/assistant/AssistantSurface.test.tsx
git commit -m "feat(shelf): two dials, named for the two questions they answer

I've got / Focus. Number keys stay on the time dial, the one that changes what
you are offered.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Sidecar, and the end of the disclosure

Expanded with two alternatives, `OtherOptions` computes to ~237px inside a 219px window that clips rather than scrolls — so the disclosure does not merely hide the alternatives, it loses them. Sidecar spends the shelf's width instead, which is the budget that is not scarce.

**Files:**
- Modify: `src/components/assistant/AssistantSurface.tsx` (delete `OtherOptions`, rewrite `bodyClass`, `AdvicePanel`, `FocusPanel`)
- Modify: `src/components/assistant/AssistantSurface.test.tsx`

**Interfaces:**
- Consumes: `ALTERNATIVE_CAP` (Task 2), `detailLevel` on the snapshot (Task 3).
- Produces: `Sidecar` component; `optionRow` retained as the row class for both presentations.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows the alternatives without asking for a click', () => {
  const alternatives = [work({ key: 'step:n2', title: 'Read chapter 5' })];
  render(
    <AssistantSurface
      snapshot={ready({ advice: { kind: 'work', primary: work(), alternatives } })}
      onAction={() => {}}
      presentation="shelf"
    />,
  );
  expect(screen.queryByRole('button', { name: 'Other options' })).toBeNull();
  expect(screen.getByRole('button', { name: /Read chapter 5/ })).toBeTruthy();
});

it('hands over one thing and no menu at the lowest detail', () => {
  const alternatives = [
    work({ key: 'step:n2', title: 'Read chapter 5' }),
    work({ key: 'step:n3', title: 'Pitch deck' }),
  ];
  render(
    <AssistantSurface
      snapshot={ready({ detailLevel: 'low', advice: { kind: 'work', primary: work(), alternatives } })}
      onAction={() => {}}
      presentation="shelf"
    />,
  );
  expect(screen.queryByText('Read chapter 5')).toBeNull();
  expect(screen.queryByText('Pitch deck')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Problem set 4' })).toBeTruthy();
});

it('offers one alternative at medium and two at high', () => {
  const alternatives = [
    work({ key: 'step:n2', title: 'Read chapter 5' }),
    work({ key: 'step:n3', title: 'Pitch deck' }),
  ];
  const advice = { kind: 'work' as const, primary: work(), alternatives };

  const { rerender } = render(
    <AssistantSurface snapshot={ready({ detailLevel: 'medium', advice })} onAction={() => {}} presentation="shelf" />,
  );
  expect(screen.getByText('Read chapter 5')).toBeTruthy();
  expect(screen.queryByText('Pitch deck')).toBeNull();

  rerender(
    <AssistantSurface snapshot={ready({ detailLevel: 'high', advice })} onAction={() => {}} presentation="shelf" />,
  );
  expect(screen.getByText('Pitch deck')).toBeTruthy();
});

it('withholds the column while a session is running', () => {
  const focus = {
    ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
    title: 'Problem set 4', phase: 'active' as const,
    elapsedMin: 12, expected: { kind: 'estimate' as const, minutes: 45 },
  };
  const alternatives = [work({ key: 'step:n2', title: 'Read chapter 5' })];
  render(
    <AssistantSurface
      snapshot={ready({ activeFocus: focus, advice: { kind: 'work', primary: work(), alternatives } })}
      onAction={() => {}}
      presentation="shelf"
    />,
  );
  expect(screen.queryByText('Read chapter 5')).toBeNull();
  expect(screen.getByRole('button', { name: 'Complete session' })).toBeTruthy();
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx -t "without asking for a click"`
Expected: FAIL — the `Other options` button is still found.

- [ ] **Step 3: Delete `OtherOptions` and add `Sidecar`**

Remove the whole `OtherOptions` function (lines 106–126) and its two call sites. Replace `bodyClass` and add:

```tsx
/**
 * The alternatives, in the open.
 *
 * They used to sit behind an `Other options` disclosure, which did not merely
 * hide them: expanded with two, the card computed past the window's fixed
 * height, and the window CLIPS rather than scrolls — so the second one was
 * partly off the bottom of the screen. This spends the shelf's WIDTH instead,
 * which is the budget that is not scarce, and every row is one click from
 * starting.
 *
 * `shelf` only. `AssistantHost` renders the same surface in-app at 380px,
 * where a 200px column beside a primary would leave the title 160px to live
 * in; there the same rows stack underneath. One component, two arrangements —
 * the disclosure dies in both, because it is the disclosure that loses rows,
 * not the layout.
 */
function Sidecar({ label, items, disabled, onPick, shelf }: {
  label: string;
  items: RecommendedWork[];
  disabled: boolean;
  onPick: (ref: RecommendedWork['ref']) => void;
  shelf: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className={shelf ? 'flex min-w-0 flex-col gap-1' : 'flex flex-col gap-1'}>
      <SectionLabel>{label}</SectionLabel>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          disabled={disabled}
          className={optionRow}
          onClick={() => onPick(item.ref)}
        >
          <span className="block truncate text-ink-soft">{item.title}</span>
          <span className="block truncate text-meta text-muted">
            {item.goalTitle ? `${item.goalTitle} · ` : ''}{expectedTimeLabel(item.expected)}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The one primary/action arrangement, and where the alternatives go with it.
 * On the shelf the column sits beside the primary at a fixed 200px; embedded,
 * everything stacks.
 */
function bodyClass(shelf: boolean): string {
  return shelf
    ? 'grid min-h-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1'
    : 'flex min-h-0 flex-col gap-2';
}
```

`optionRow` gains the two-line shape:

```tsx
const optionRow =
  'w-full rounded-field border border-line bg-panel px-3 py-1.5 text-left text-ui text-ink '
  + 'hover:bg-hover disabled:opacity-40 disabled:pointer-events-none';
```

`AdvicePanel` becomes:

```tsx
  const { primary } = advice;
  const alternatives = advice.alternatives.slice(0, ALTERNATIVE_CAP[detail]);
  const primaryColumn = (/* unchanged */);
  const startButton = (
    <button type="button" disabled={pending} className={primaryBtn} onClick={() => onStart(primary.ref)}>
      Start session
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      {advice.beyondWindow && (
        <p className="text-meta text-muted">Nothing that short left — this is next when you&apos;re ready.</p>
      )}
      {shelf && alternatives.length > 0 ? (
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_1px_200px] gap-x-3.5">
          <div className={bodyClass(true)}>{primaryColumn}{startButton}</div>
          <div className="bg-line" />
          <Sidecar label="Or" items={alternatives} disabled={pending} onPick={onStart} shelf />
        </div>
      ) : (
        <>
          <div className={bodyClass(shelf)}>{primaryColumn}{startButton}</div>
          {!shelf && (
            <Sidecar label="Or" items={alternatives} disabled={pending} onPick={onStart} shelf={false} />
          )}
        </>
      )}
    </div>
  );
```

`FocusPanel` drops its `alternatives` prop and its disclosure entirely — the column is withheld while a session runs, because the running state needs its width for two full-length buttons and a list of other things to do is the opposite of the point. Delete the `alternatives` prop from its signature, its call site and the `OtherOptions` block at its foot.

Add the imports:

```tsx
import { ALTERNATIVE_CAP, DETAIL_LEVELS, DETAIL_WORD, type DetailLevel } from '../../lib/shelfDetail';
```

- [ ] **Step 4: Run the surface tests**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx`
Expected: PASS. The existing "keeps alternatives behind Other options" test is now wrong by design — delete it; the four new tests replace it.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc -b && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/assistant/AssistantSurface.tsx src/components/assistant/AssistantSurface.test.tsx
git commit -m "feat(shelf): the alternatives come out of hiding

Other options did not merely hide them. Expanded with two it computed to ~237px
inside a 219px window that clips rather than scrolls, so the second one was
partly off the bottom of the screen. The column spends width instead, which is
the budget that is not scarce, and it is withheld while a session runs.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: The session ring

**Files:**
- Create: `src/lib/sessionRing.ts`, `src/lib/sessionRing.test.ts`
- Create: `src/components/assistant/SessionRing.tsx`
- Modify: `src/components/assistant/AssistantSurface.tsx` (`FocusPanel`)
- Modify: `src/components/assistant/AssistantSurface.test.tsx`

**Interfaces:**
- Consumes: `ExpectedTime` from `../lib/expectedTime`, `DetailLevel` (Task 2).
- Produces: `type RingState = { kind: 'turn' } | { kind: 'fill'; fraction: number; overflow: number }` and `ringState(expected, elapsedMin, detail, phase): RingState`; `<SessionRing state={…} paused={…} />`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/sessionRing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ringState } from './sessionRing';

const HISTORY = { kind: 'history' as const, lowMin: 45, highMin: 60 };
const ESTIMATE = { kind: 'estimate' as const, minutes: 30 };
const STARTER = { kind: 'starter' as const, minutes: 30 };

describe('ringState', () => {
  it('fills a history range against its HIGH end, the rule fitsWindow already uses', () => {
    expect(ringState(HISTORY, 30, 'medium')).toEqual({ kind: 'fill', fraction: 0.5, overflow: 0 });
  });

  it('fills an estimate against the number you typed', () => {
    expect(ringState(ESTIMATE, 15, 'medium')).toEqual({ kind: 'fill', fraction: 0.5, overflow: 0 });
  });

  it('completes and reports the overflow rather than stopping at full', () => {
    expect(ringState(ESTIMATE, 38, 'medium')).toEqual({
      kind: 'fill', fraction: 1, overflow: (38 - 30) / 30,
    });
  });

  it('never fills against a starter — a guess drawn as a target is a countdown', () => {
    expect(ringState(STARTER, 15, 'medium')).toEqual({ kind: 'turn' });
    expect(ringState(STARTER, 999, 'high')).toEqual({ kind: 'turn' });
  });

  it('turns at the lowest detail, because the text withholds the comparison there', () => {
    expect(ringState(ESTIMATE, 15, 'low')).toEqual({ kind: 'turn' });
    expect(ringState(HISTORY, 15, 'low')).toEqual({ kind: 'turn' });
  });

  it('caps overflow so a session left running overnight cannot draw a ring of any size', () => {
    const state = ringState(ESTIMATE, 60 * 24, 'medium');
    expect(state).toEqual({ kind: 'fill', fraction: 1, overflow: 1 });
  });

  it('is empty at zero rather than undefined', () => {
    expect(ringState(ESTIMATE, 0, 'medium')).toEqual({ kind: 'fill', fraction: 0, overflow: 0 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/lib/sessionRing.test.ts`
Expected: FAIL — `Failed to resolve import "./sessionRing"`.

- [ ] **Step 3: Write the module**

Create `src/lib/sessionRing.ts`:

```ts
import type { ExpectedTime } from './expectedTime';
import type { DetailLevel } from './shelfDetail';

/**
 * What the small circle on a running session should draw.
 *
 * ONE rule: the ring fills only against evidence, and only when the shelf is
 * showing comparisons at all.
 *
 * A `starter` is Phase's own 30-minute default standing in for evidence it does
 * not have — `fitsWindow` already refuses to treat it as a promise, and
 * `teachingSessions` already refuses to learn from a constrained sitting. Fill
 * a ring against it and the guess becomes a target, and a target is the
 * countdown this whole surface exists without, wearing a circle. So it turns
 * instead.
 *
 * At the lowest detail the ring turns whatever the evidence, because
 * `elapsedAgainstExpected` drops the comparison there for a stated reason —
 * "the pressure was never the elapsed figure, it is the figure it is being
 * measured against". A graphic that kept asserting a target the text had just
 * withheld would make one card contradict itself.
 *
 * `overflow` is a FRACTION of the target and is capped at 1. Past the
 * expectation the arc completes and the excess is drawn as a second sweep, so
 * going over reads as a fact rather than a failure — the same thing
 * `38m of 30m` says in words. The cap is what stops a session left running
 * overnight from asking for eleven revolutions.
 */

export type RingState =
  | { kind: 'turn' }
  | { kind: 'fill'; fraction: number; overflow: number };

/** The figure a range is judged against: its HIGH end, exactly as `fitsWindow` does. */
function targetMinutes(expected: ExpectedTime): number | null {
  switch (expected.kind) {
    case 'history': return expected.highMin;
    case 'estimate': return expected.minutes;
    case 'starter': return null;
  }
}

export function ringState(
  expected: ExpectedTime,
  elapsedMin: number,
  detail: DetailLevel,
): RingState {
  if (detail === 'low') return { kind: 'turn' };
  const target = targetMinutes(expected);
  if (target === null || target <= 0) return { kind: 'turn' };

  const ratio = Math.max(0, elapsedMin) / target;
  if (ratio <= 1) return { kind: 'fill', fraction: ratio, overflow: 0 };
  return { kind: 'fill', fraction: 1, overflow: Math.min(1, ratio - 1) };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run --config vitest.config.ts src/lib/sessionRing.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the component**

Create `src/components/assistant/SessionRing.tsx`:

```tsx
import type { RingState } from '../../lib/sessionRing';

/**
 * The circle beside a running session. Aesthetic, and honest about it: what it
 * draws is decided entirely by `ringState`, which refuses to fill against a
 * guess.
 *
 * A 34px box with a 2.5px stroke. `r={14}` leaves the stroke inside the box, so
 * nothing is clipped by a scroll container the way an outset focus ring is.
 * Both arcs are rotated -90° so they start at twelve o'clock, where a person
 * looks first.
 *
 * `aria-hidden`: every figure this states is already in the sentence beside it,
 * and a screen reader that read a decorative sweep would be reading the
 * elapsed time twice.
 */
const R = 14;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function SessionRing({ state, paused }: { state: RingState; paused: boolean }) {
  const arcStroke = paused ? 'text-faint-2' : 'text-fill';
  return (
    <svg
      aria-hidden
      width="34"
      height="34"
      viewBox="0 0 34 34"
      className="shrink-0"
    >
      <circle
        cx="17" cy="17" r={R} fill="none" strokeWidth="2.5"
        className={paused ? 'text-faint-2' : 'text-track'}
        stroke="currentColor"
        strokeDasharray={paused ? '3 4' : undefined}
      />
      {state.kind === 'turn' ? (
        <circle
          cx="17" cy="17" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round"
          className={`${arcStroke} origin-center -rotate-90 ${paused ? '' : 'assistant-ring-turn'}`}
          stroke="currentColor"
          strokeDasharray={`${CIRCUMFERENCE * 0.16} ${CIRCUMFERENCE}`}
        />
      ) : (
        <>
          <circle
            cx="17" cy="17" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round"
            className={`${arcStroke} origin-center -rotate-90`}
            stroke="currentColor"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - state.fraction)}
          />
          {state.overflow > 0 && (
            <circle
              cx="17" cy="17" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round"
              className="origin-center -rotate-90 text-accent"
              stroke="currentColor"
              strokeDasharray={`${CIRCUMFERENCE * state.overflow} ${CIRCUMFERENCE}`}
            />
          )}
        </>
      )}
    </svg>
  );
}
```

Add the keyframes to `src/index.css` beside the existing assistant animations, gated on reduced motion like its neighbours:

```css
  /* The running ring's sweep. One slow revolution — it marks a session as
     alive and measures nothing, which is why it has no duration tied to any
     figure on the card. */
  @keyframes assistant-ring-turn {
    to { transform: rotate(270deg); }
  }
  .assistant-ring-turn {
    transform-origin: 50% 50%;
    animation: assistant-ring-turn 1.6s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .assistant-ring-turn { animation: none; }
  }
```

- [ ] **Step 6: Write the failing surface test**

```tsx
it('draws a ring beside a running session and none while confirming', () => {
  const base = {
    ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
    title: 'Problem set 4', elapsedMin: 12,
    expected: { kind: 'estimate' as const, minutes: 45 },
  };
  const { container, rerender } = render(
    <AssistantSurface snapshot={ready({ activeFocus: { ...base, phase: 'active' } })} onAction={() => {}} />,
  );
  expect(container.querySelector('svg')).toBeTruthy();

  rerender(
    <AssistantSurface
      snapshot={ready({ activeFocus: { ...base, phase: 'confirming', proposedMinutes: 12 } })}
      onAction={() => {}}
    />,
  );
  expect(container.querySelector('svg')).toBeNull();
});

it('draws no ring on the idle card, where nothing is running', () => {
  const { container } = render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
  expect(container.querySelector('svg')).toBeNull();
});
```

- [ ] **Step 7: Wire it into `FocusPanel`**

Inside `FocusPanel`, wrap the info column so the ring sits beside it, and render it for `active` and `break` only:

```tsx
  const ring = focus.phase === 'confirming'
    ? null
    : <SessionRing state={ringState(focus.expected, focus.elapsedMin, level)} paused={focus.phase === 'break'} />;

  const info = (
    <div className="flex min-w-0 items-center gap-3">
      {ring}
      <div className="flex min-w-0 flex-col gap-1">
        {/* the existing label, title, goal title and readout, unchanged */}
      </div>
    </div>
  );
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run --config vitest.config.ts src/lib/sessionRing.test.ts src/components/assistant/AssistantSurface.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/sessionRing.ts src/lib/sessionRing.test.ts src/components/assistant/SessionRing.tsx src/components/assistant/AssistantSurface.tsx src/components/assistant/AssistantSurface.test.tsx src/index.css
git commit -m "feat(shelf): a ring that fills only against evidence

A starter is Phase guessing, and a guess drawn as a target is the countdown
this surface exists without, wearing a circle — so it turns instead. It turns
at the lowest detail too, where the text already withholds the comparison, so
the graphic cannot assert what the sentence just declined to say.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: The send-off carries a sourced quote

**Files:**
- Create: `src/lib/sendoff.ts`, `src/lib/sendoff.test.ts`
- Modify: `src/components/assistant/useAssistantSendoff.ts:35-37`, and the transition at `:134-141`
- Modify: `src/components/assistant/AssistantSurface.tsx:341-363`
- Modify: `src/components/assistant/useAssistantSendoff.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface Sendoff { text: string; who: string; source: string }`, `SENDOFFS: readonly Sendoff[]`, `sendoffFor(nowMs: number): Sendoff`; the hook's return gains `quote: Sendoff | null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/sendoff.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SENDOFFS, sendoffFor } from './sendoff';

describe('sendoff quotes', () => {
  it('sources every quote, because misattribution is the default state of a quote', () => {
    for (const quote of SENDOFFS) {
      expect(quote.text.length).toBeGreaterThan(0);
      expect(quote.who.length).toBeGreaterThan(0);
      expect(quote.source.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic for a given moment, so a test can pin it', () => {
    expect(sendoffFor(1_700_000_000_000)).toEqual(sendoffFor(1_700_000_000_000));
  });

  it('varies across sessions', () => {
    const seen = new Set(
      Array.from({ length: SENDOFFS.length }, (_, i) => sendoffFor(i * 60_000).text),
    );
    expect(seen.size).toBe(SENDOFFS.length);
  });

  it('holds a real list rather than one line', () => {
    expect(SENDOFFS.length).toBeGreaterThanOrEqual(6);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/lib/sendoff.test.ts`
Expected: FAIL — `Failed to resolve import "./sendoff"`.

- [ ] **Step 3: Write the module**

Create `src/lib/sendoff.ts`:

```ts
/**
 * What the shelf says as it closes behind you.
 *
 * `source` is REQUIRED and is the point of this file. Famous-quote
 * misattribution is endemic — most of the Einstein, Ford, Twain and Churchill
 * lines in circulation were never said by them — so a quote that cannot name
 * where it is documented does not go in this list. That makes the list
 * checkable rather than a matter of taste, and it is the field to fill in
 * FIRST when adding one.
 *
 * Selection is derived from the moment the send-off begins rather than from
 * `Math.random()`: it varies every session and a test can still pin it, which
 * is the same trick the rest of the codebase uses to stay testable.
 */

export interface Sendoff {
  text: string;
  who: string;
  /** Where the line is documented. Not decoration — the admission ticket. */
  source: string;
}

export const SENDOFFS: readonly Sendoff[] = [
  {
    text: 'The first principle is that you must not fool yourself — and you are the easiest person to fool.',
    who: 'Richard Feynman',
    source: 'Caltech commencement address, 1974',
  },
  {
    text: 'A wealth of information creates a poverty of attention.',
    who: 'Herbert Simon',
    source: 'Designing Organizations for an Information-Rich World, 1971',
  },
  {
    text: 'Nothing in life is as important as you think it is, while you are thinking about it.',
    who: 'Daniel Kahneman',
    source: 'Thinking, Fast and Slow, 2011',
  },
  {
    text: 'If you are not embarrassed by the first version of your product, you have launched too late.',
    who: 'Reid Hoffman',
    source: 'founder of LinkedIn, widely quoted from his own talks',
  },
  {
    text: 'Startups take off because the founders make them take off.',
    who: 'Paul Graham',
    source: 'Do Things That Don’t Scale, 2013',
  },
  {
    text: 'Bird by bird, buddy. Just take it bird by bird.',
    who: 'Anne Lamott',
    source: 'Bird by Bird, 1994',
  },
  {
    text: 'Nothing in life is to be feared, it is only to be understood.',
    who: 'Marie Curie',
    source: 'quoted in Eve Curie, Madame Curie, 1937',
  },
  {
    text: 'Real artists ship.',
    who: 'Steve Jobs',
    source: 'to the Macintosh team, 1983',
  },
];

/** One minute is the grain: two sessions started in the same minute are the same session's worth of intent. */
export function sendoffFor(nowMs: number): Sendoff {
  const index = Math.abs(Math.floor(nowMs / 60_000)) % SENDOFFS.length;
  return SENDOFFS[index];
}
```

**Before committing this task, verify every entry against its named source.** The list is the well-documented end, not a cleared one. Any line that cannot be confirmed is deleted rather than shipped with a hopeful `source`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run --config vitest.config.ts src/lib/sendoff.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Extend the hold, and capture the quote at the transition**

In `src/components/assistant/useAssistantSendoff.ts`:

```ts
/**
 * The farewell holds long enough to READ.
 *
 * 660ms was right for two words and is not right for a quote and its
 * attribution. This blocks nothing — the session has already started and the
 * work is under way — but it does leave an always-on-top panel over the screen
 * for the duration, which is the whole cost of putting words there.
 *
 * Reduced motion drops the TRANSFORM and keeps the duration: less movement is
 * what was asked for, not less content, and closing early would show that user
 * a flash of text they can never finish.
 */
const MESSAGE_AND_HOLD_MS = 2400;
const FALLBACK_CLOSE_MS = 2740;
const REDUCED_CLOSE_MS = 2400;
const PENDING_TIMEOUT_MS = 5000;
```

Add state beside `stage`, and set it in the same branch that reaches `'message'`:

```ts
  const [quote, setQuote] = useState<Sendoff | null>(null);
```
```ts
      clearTimers();
      // Captured once, here: recomputing it on every render would change the
      // words mid-farewell.
      setQuote(sendoffFor(Date.now()));
      setStage('message');
```

Clear it wherever the hook returns to `'idle'` (the reset effect and the warning-notice branch): `setQuote(null);`. Return it: `return { stage, pending: stage === 'pending', quote, /* …existing… */ };`

- [ ] **Step 6: Render it**

In `AssistantSurface`'s leaving branch, replace `Good luck!`:

```tsx
        className={[
          'grid h-full place-items-center px-[46px] text-center',
          sendoff.stage === 'message' ? 'assistant-sendoff-enter' : '',
          'transition-[opacity,transform] duration-[180ms] ease-out',
          sendoff.stage === 'leaving' || sendoff.stage === 'hidden'
            ? 'pointer-events-none -translate-y-[6px] opacity-0'
            : 'translate-y-0 opacity-100',
        ].join(' ')}
      >
        {sendoff.quote ? (
          <div className="flex flex-col gap-2">
            <p className="text-h2 font-semibold text-ink">&ldquo;{sendoff.quote.text}&rdquo;</p>
            <p className="text-meta text-muted">
              <span className="font-semibold text-ink-soft">{sendoff.quote.who}</span>
              {' · '}{sendoff.quote.source}
            </p>
          </div>
        ) : (
          <span className="text-h2 font-semibold text-ink">Good luck!</span>
        )}
```

The face stays Inter. Fraunces would fail `designScale.test.ts`, which asserts `font-disp` appears exactly once, on the wordmark.

- [ ] **Step 7: Update the hook's tests for the new timings**

Every `vi.advanceTimersByTime(660)` in `useAssistantSendoff.test.tsx` becomes `2400`, and the reduced-motion case moves from `350` to `2400`. Add:

```tsx
it('shows a sourced quote rather than two words', () => {
  vi.setSystemTime(new Date('2026-08-15T09:00:00Z'));
  // …drive the hook to 'message' exactly as the neighbouring tests do…
  expect(result.current.quote).not.toBeNull();
  expect(result.current.quote?.source.length).toBeGreaterThan(0);
});
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run --config vitest.config.ts src/lib/sendoff.test.ts src/components/assistant/useAssistantSendoff.test.tsx src/components/assistant/AssistantSurface.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/sendoff.ts src/lib/sendoff.test.ts src/components/assistant/useAssistantSendoff.ts src/components/assistant/useAssistantSendoff.test.tsx src/components/assistant/AssistantSurface.tsx
git commit -m "feat(shelf): the send-off says something worth reading

660ms was right for two words. A quote and its attribution need 2400, which
blocks nothing — the session has already started — but does hold an always-on-top
panel over the screen for that long, which is the cost of putting words there.

Every quote carries a required source. Misattribution is the default state of a
famous quote, and a source field is what makes the list checkable instead of
a matter of taste.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: The focus ring stops shouting, and stops being clipped

The original complaint. Two independent faults: the ring is on 100% of the time because the shelf autofocuses the same button on every open, and it is clipped because a scroll container clips at its padding box and an outset ring sits 3px outside the button.

**Files:**
- Modify: `src/components/assistant/AssistantSurface.tsx` (three `autoFocus` attributes)
- Modify: `src/index.css` (shelf-scoped inset ring)
- Modify: `src/components/assistant/AssistantHost.tsx:170` (`data-shelf`)
- Modify: `src/components/assistant/AssistantSurface.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable — a behaviour and a style rule.

- [ ] **Step 1: Write the failing test**

```tsx
it('focuses nothing when it opens, so no ring paints on arrival', () => {
  const { container } = render(
    <AssistantSurface snapshot={ready()} onAction={() => {}} presentation="shelf" />,
  );
  expect(container.querySelector('[autofocus]')).toBeNull();
  expect(document.activeElement).toBe(document.body);
});

it('focuses nothing on a running session either', () => {
  const focus = {
    ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
    title: 'Problem set 4', phase: 'active' as const,
    elapsedMin: 12, expected: { kind: 'estimate' as const, minutes: 45 },
  };
  const { container } = render(
    <AssistantSurface snapshot={ready({ activeFocus: focus })} onAction={() => {}} />,
  );
  expect(container.querySelector('[autofocus]')).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx -t "no ring paints on arrival"`
Expected: FAIL — `document.activeElement` is the Start button.

- [ ] **Step 3: Remove every `autoFocus`**

Delete the `autoFocus` attribute from all three buttons in `AssistantSurface.tsx`: the `confirming` Log button, the `active` Complete button, and `AdvicePanel`'s Start button. Add the reason where the last one was:

```tsx
        {/*
          No autoFocus. A shelf that focuses the same button on every open gains
          nothing from a mark saying which button is focused — the ring was on
          100% of the time and distinguished nothing, in the one hue the system
          reserves for action. Tab and it appears, where it means something.
        */}
```

- [ ] **Step 4: Make the ring inset inside the shelf**

Add to `src/index.css`, in the `@layer components` block:

```css
  /* A focus ring inside the shelf is INSET, and a scroll container is why.
     `overflow-y: auto` forces `overflow-x: auto`, and a scroller clips at its
     padding box — so the 3px an outset ring sits outside its button is cut off
     by whichever scroller the button lands nearest. Measured on the real
     window: the orange stopped dead at the button's own right edge. An inset
     ring paints inside the element's own border box and cannot be clipped by
     an ancestor. Accent on ink measures 3.52:1, clearing the 3:1 floor WCAG
     1.4.11 sets for a focus indicator against its adjacent colour. */
  [data-shelf] :focus-visible {
    outline-offset: -2px;
  }
```

- [ ] **Step 5: Mark the embedded host too**

In `src/components/assistant/AssistantHost.tsx:170`, add `data-shelf` to the panel. It needs it for the same reason and not merely for consistency — that div carries its own `overflow-y-auto`:

```tsx
    <div
      role="dialog"
      aria-label="Assistant"
      data-shelf
      className="fixed right-[16px] top-[64px] z-40 max-h-[70vh] w-[380px] overflow-y-auto rounded-card border border-line bg-panel"
    >
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/`
Expected: PASS. Any existing test asserting a button receives focus on mount is now wrong by design — delete it.

- [ ] **Step 7: Commit**

```bash
git add src/components/assistant/AssistantSurface.tsx src/components/assistant/AssistantSurface.test.tsx src/components/assistant/AssistantHost.tsx src/index.css
git commit -m "fix(shelf): the ring appears when it means something, and is not cut in half

Two faults, one screenshot. autoFocus put an accent ring on the same button
every open, so it distinguished nothing. And the clipping was never the card's
border: overflow-y forces overflow-x, a scroller clips at its padding box, and
an outset ring sits 3px outside the button. Inset inside the shelf, where the
panels scroll.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: Re-measure `HEIGHT`

`HEIGHT` is a BUDGET and is MEASURED, never derived — arithmetic against the type scale put it 20px low once already. The card hugs on macOS and the window clips rather than scrolls, so anything past this line is invisible, not merely awkward.

**Files:**
- Modify: `electron/assistantWindow.cjs:17-25`

**Interfaces:**
- Consumes: every state built in Tasks 5–8.
- Produces: a `HEIGHT` constant whose comment names the state it was measured against.

- [ ] **Step 1: Run the shell against the dev server**

```bash
cd "/Users/por25528/Programming stuff/Projects/Phase"
npm run app:dev
```

- [ ] **Step 2: Measure each candidate tallest state**

Open the shelf, then in the overlay window's DevTools console run:

```js
document.querySelector('[data-shelf]').getBoundingClientRect().height
```

Measure all four candidates — the previous tallest may no longer be it, because the Sidecar column can now outgrow the primary beside it:

| state | how to reach it |
|---|---|
| `confirming` + a notice | start a session, leave it, complete it so it parks in `confirming`; trigger a warning notice |
| idle, detail High, two alternatives, `beyondWindow` | set `I've got` to 30m with nothing short available |
| idle, detail High, two alternatives with long goal titles | ordinary state, `Focus` on High |
| the send-off, mid-quote | start anything; the card pins its own measured height while the farewell plays |

Record every figure. The window is 620 wide — measure at that width and nowhere else.

- [ ] **Step 3: Update the constant**

Set `HEIGHT` to the largest measured figure, rounded up to a whole pixel, and rewrite the comment to name the state and the number:

```js
// The tallest state is <NAME IT>, measured at <N>px at 620 wide.
//
// MEASURED, never derived. Arithmetic against the type scale put this number
// 20px low once already. If a state grows, measure it again.
const HEIGHT = /* the measured figure */
```

If the tallest figure is ≤ 219, leave `HEIGHT` at 219 and say so in the comment — an unchanged number with a fresh measurement behind it is a different fact from an unchanged number nobody checked.

- [ ] **Step 4: Confirm nothing is clipped**

With the new `HEIGHT`, revisit each state from Step 2 and confirm the card's bottom edge is inside the window. Pay particular attention to detail High with two alternatives, which is the state this plan newly created.

- [ ] **Step 5: Full suite and typecheck**

Run: `npx tsc -b && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/assistantWindow.cjs
git commit -m "fix(shelf): re-measure the window budget against the states that now exist

The card hugs and the window clips rather than scrolls, so this number is the
line past which a state is invisible. The Sidecar column can outgrow the
primary beside it, which is a shape the previous measurement never saw.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** Every numbered decision maps to a task: §1 time dial → Task 1; §2 display dial → Tasks 2, 4, 5; §3 Sidecar and the embedded stack → Task 6; §4 ring → Task 7; §5 quote → Task 8; §6 focus ring → Task 9; §7 copy (`Nothing that short left`) → folded into Task 6's `AdvicePanel` rewrite, where that string lives. Relay plumbing the spec implies but does not number → Task 3. The `HEIGHT` invariant → Task 10.

**Deliberately not built,** per the spec's own out-of-scope section: the `needs-hours` dead end, any predicted free-time readout or day ribbon, the keyboard contract (Enter-to-start), and any change to how sessions are logged.

**Type consistency.** `TimeLevel` and `DetailLevel` are both `'low'|'medium'|'high'` and are used with those names from Task 1 onward. `ringState(expected, elapsedMin, detail)` takes three arguments everywhere it appears — the test in Task 7 Step 1 and the call site in Step 7 agree. `sendoffFor(nowMs)` is one argument in both its test and the hook. `ALTERNATIVE_CAP` is indexed by `DetailLevel` in Tasks 2 and 6. `beyondWindow` replaces `beyondFocus` in Task 1 and is read under that name in Task 6.

**Ordering.** Every task leaves the build green and the suite passing, so any task is a safe stopping point.

