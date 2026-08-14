# Assistant Shelf: Focus Level and the Void — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip the assistant shelf down to one job — name the work, start the work — and give it a standing focus level (Low / Medium / High) that filters what it offers without ever re-ordering the queue.

**Architecture:** A new pure module `src/lib/focusLens.ts` owns the entire focus-level vocabulary; `executionAdvisor` consumes it as an optional membership filter and never as a ranking. The typed-command surface (`assistantCommands.ts`, the input, the proposal panels) is deleted outright. The floating window's card sizes to its content inside fixed transparent bounds instead of stretching to a fixed pane.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind, Dexie/IndexedDB, Vitest + @testing-library/react, Electron (CommonJS main process).

## Global Constraints

- **Colours come from theme tokens only.** `designScale.test.ts` fails the build on a literal hex, on an arbitrary `text-[Nrem]`, and on a `fontSize` key colliding with a `colors` key.
- **Type sizes come from the scale in `tailwind.config.js`.** Pick from the menu; never invent a value.
- **Section labels are sentence case** (`Focus session`, `This week`). All-caps is reserved for the three weekday strips.
- **A section label is exactly** `text-meta font-semibold text-muted`.
- **Buttons use `src/components/dialogStyles.ts`** — `primaryBtn` / `secondaryBtn` / `ghostBtn`. One filled button per state, placed last.
- **Hover-revealed row controls use `.quiet-control`**, never hand-rolled `opacity-0 group-hover:opacity-100`.
- **New pure logic goes in `src/lib` with a sibling `*.test.ts`.** Views stay thin and delegate to `actions`.
- **Views never call `db` directly.** All mutation goes through `actions` in `src/state/store.ts`.
- **Every settings write goes through `ifOwner`.** A tab that does not own the Web Lock never writes.
- **Run `npm test` and `npx tsc -b` before every commit.**
- **The overlay renderer must never import the store, Dexie, or the tab lock.** `src/assistant/entryBoundary.test.ts` enforces this and must stay green.
- **Commit style:** lowercase `type(scope): summary` in the imperative, matching `git log`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/focusLens.ts` **(new)** | The whole focus-level vocabulary: levels, caps, storage shape, daily reset, the `fitsFocus` predicate, the commitment set. |
| `src/lib/focusLens.test.ts` **(new)** | Its suite. |
| `src/lib/assistantShell.ts` **(new)** | One pure function: does this platform get a hugging card or a filling one. |
| `src/lib/assistantShell.test.ts` **(new)** | Its suite. |
| `src/lib/assistantCommands.ts` **(deleted)** | The retired typed-verb parser. |
| `src/lib/assistantCommands.test.ts` **(deleted)** | Its suite. |
| `src/lib/assistantProtocol.ts` | The snapshot/action contract — gains `focusLevel` and `set-focus-level`, loses four proposal verbs. |
| `src/lib/executionAdvisor.ts` | Gains the optional lens and `beyondFocus`; loses `rankedWork` and `workThatFits`. |
| `src/lib/expectedTime.ts` | Its evidence gatherer skips low-focus sessions. |
| `src/lib/focusSession.ts` | The draft freezes the level it started at. |
| `src/db/types.ts` | `Session.focus?: 'low'`. |
| `src/db/db.ts` | One settings row for the standing level. |
| `src/state/store.ts` | `focusLevel` state, `setFocusLevel` action, the level carried onto a logged session. |
| `src/components/assistant/AssistantSurface.tsx` | The redesigned surface: focus strip, notice above the body, no input. |
| `src/components/assistant/AssistantHost.tsx` | The store adapter, minus every proposal branch. |
| `src/assistant/AssistantOverlay.tsx` | Hugging card, click-the-remainder-to-close. |
| `electron/assistantIpc.cjs` | Validates the new verb, rejects the retired four. |
| `electron/assistantWindow.cjs` | `HEIGHT` re-measured and re-documented as a budget. |

---

## Task 1: The focus lens vocabulary

**Files:**
- Create: `src/lib/focusLens.ts`
- Create: `src/lib/focusLens.test.ts`

**Interfaces:**
- Consumes: `AdviceReason` (type-only) from `src/lib/executionAdvisor.ts`; `ExpectedTime` (type-only) from `src/lib/expectedTime.ts`; `isValidLocalDate` from `src/lib/schedule.ts`.
- Produces:
  - `type FocusLevel = 'low' | 'medium' | 'high'`
  - `const FOCUS_LEVELS: readonly FocusLevel[]`
  - `const DEFAULT_FOCUS_LEVEL: FocusLevel`
  - `const FOCUS_CAP: Record<FocusLevel, number>`
  - `const FOCUS_WORD: Record<FocusLevel, string>`
  - `function isFocusLevel(raw: unknown): raw is FocusLevel`
  - `interface StoredFocusLevel { level: FocusLevel; date: string }`
  - `function serializeFocusLevel(stored: StoredFocusLevel): string`
  - `function parseStoredFocusLevel(raw: unknown): StoredFocusLevel | null`
  - `function focusLevelFor(stored: StoredFocusLevel | null, today: string): FocusLevel`
  - `function fitsFocus(level: FocusLevel, expected: ExpectedTime): boolean`
  - `function isCommitment(reason: AdviceReason): boolean`
  - `function admits(level: FocusLevel, reason: AdviceReason, expected: ExpectedTime): boolean`

> The import of `AdviceReason` is **type-only** and therefore erased at compile time, so `executionAdvisor` importing `focusLens` in Task 6 creates no runtime cycle. Keep it `import type`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/focusLens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FOCUS_LEVEL, FOCUS_CAP, FOCUS_LEVELS, admits, fitsFocus, focusLevelFor,
  isCommitment, isFocusLevel, parseStoredFocusLevel, serializeFocusLevel,
} from './focusLens';
import type { AdviceReason } from './executionAdvisor';
import type { ExpectedTime } from './expectedTime';

const history = (lowMin: number, highMin: number): ExpectedTime =>
  ({ kind: 'history', lowMin, highMin, confidence: 'medium', sampleCount: 2 });
const estimate = (minutes: number): ExpectedTime => ({ kind: 'estimate', minutes });
const starter: ExpectedTime = { kind: 'starter', minutes: 30 };

describe('the caps', () => {
  it('are monotone: every level admits what the level below it admits', () => {
    const samples: ExpectedTime[] = [
      history(5, 12), history(40, 50), history(120, 150), estimate(20), estimate(90), starter,
    ];
    for (const expected of samples) {
      if (fitsFocus('low', expected)) expect(fitsFocus('medium', expected)).toBe(true);
      if (fitsFocus('medium', expected)) expect(fitsFocus('high', expected)).toBe(true);
    }
  });

  it('caps low at 25 and medium at 60, and leaves high uncapped', () => {
    expect(FOCUS_CAP.low).toBe(25);
    expect(FOCUS_CAP.medium).toBe(60);
    expect(FOCUS_CAP.high).toBe(Infinity);
  });
});

describe('fitsFocus', () => {
  it('judges a history range on its HIGH end, never its low one', () => {
    // "probably 20 to 45 minutes" does not claim to fit half an hour.
    expect(fitsFocus('low', history(10, 45))).toBe(false);
    expect(fitsFocus('medium', history(10, 45))).toBe(true);
  });

  it('takes a planned estimate at face value', () => {
    expect(fitsFocus('low', estimate(20))).toBe(true);
    expect(fitsFocus('low', estimate(26))).toBe(false);
  });

  it('refuses a starter at low, because unknown length is not short', () => {
    expect(fitsFocus('low', starter)).toBe(false);
  });

  it('admits a starter at medium and high, where the cap is not tight', () => {
    expect(fitsFocus('medium', starter)).toBe(true);
    expect(fitsFocus('high', starter)).toBe(true);
  });

  it('admits everything at high, including work no cap could hold', () => {
    expect(fitsFocus('high', history(120, 150))).toBe(true);
    expect(fitsFocus('high', estimate(600))).toBe(true);
  });
});

describe('isCommitment', () => {
  it('names every reason exhaustively, so a new one cannot default silently', () => {
    const all: AdviceReason[] = [
      'scheduled-now', 'scheduled-next', 'due', 'committed-today',
      'committed-week', 'carried-over', 'free-time',
    ];
    expect(all.filter(isCommitment)).toEqual([
      'scheduled-now', 'scheduled-next', 'due', 'committed-today',
    ]);
  });
});

describe('admits', () => {
  it('never filters a fact about today, however long it is', () => {
    expect(admits('low', 'scheduled-now', estimate(90))).toBe(true);
    expect(admits('low', 'due', history(120, 150))).toBe(true);
  });

  it('does filter the discretionary tail', () => {
    expect(admits('low', 'free-time', estimate(90))).toBe(false);
    expect(admits('low', 'carried-over', history(120, 150))).toBe(false);
    expect(admits('low', 'committed-week', estimate(45))).toBe(false);
  });

  it('lets short discretionary work through at low', () => {
    expect(admits('low', 'free-time', history(8, 12))).toBe(true);
  });
});

describe('focusLevelFor', () => {
  it('holds the level within the day it was set', () => {
    expect(focusLevelFor({ level: 'low', date: '2026-08-14' }, '2026-08-14')).toBe('low');
  });

  it('resets to medium once the date has turned over', () => {
    expect(focusLevelFor({ level: 'low', date: '2026-08-13' }, '2026-08-14')).toBe('medium');
    expect(DEFAULT_FOCUS_LEVEL).toBe('medium');
  });

  it('reads nothing stored as the default rather than throwing', () => {
    expect(focusLevelFor(null, '2026-08-14')).toBe('medium');
  });
});

describe('parseStoredFocusLevel', () => {
  it('round-trips what serializeFocusLevel wrote', () => {
    const stored = { level: 'high' as const, date: '2026-08-14' };
    expect(parseStoredFocusLevel(serializeFocusLevel(stored))).toEqual(stored);
  });

  it('is total: every malformed shape reads as null, never as an exception', () => {
    expect(parseStoredFocusLevel(undefined)).toBeNull();
    expect(parseStoredFocusLevel('')).toBeNull();
    expect(parseStoredFocusLevel('{oops')).toBeNull();
    expect(parseStoredFocusLevel(JSON.stringify({ level: 'sideways', date: '2026-08-14' }))).toBeNull();
    expect(parseStoredFocusLevel(JSON.stringify({ level: 'low', date: 'yesterday' }))).toBeNull();
    expect(parseStoredFocusLevel(JSON.stringify({ level: 'low' }))).toBeNull();
    expect(parseStoredFocusLevel(42)).toBeNull();
  });
});

describe('isFocusLevel', () => {
  it('accepts exactly the three levels', () => {
    expect(FOCUS_LEVELS.every(isFocusLevel)).toBe(true);
    expect(isFocusLevel('none')).toBe(false);
    expect(isFocusLevel(2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/focusLens.test.ts`
Expected: FAIL — `Failed to resolve import "./focusLens"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/focusLens.ts`:

```ts
import type { AdviceReason } from './executionAdvisor';
import type { ExpectedTime } from './expectedTime';
import { isValidLocalDate } from './schedule';

/**
 * How much focus the room you are in will support, and what the shelf may
 * offer you because of it.
 *
 * This is a LENS, not a ranking. `executionAdvisor` states its own
 * constitution — "This module deliberately contains no ranking of its own… two
 * opinions is how the assistant and the Today page start disagreeing" — and
 * nothing here touches order. Membership is the only thing a level changes,
 * exactly as `lifeScope` changes which cards the board shows without touching
 * their ranks.
 *
 * The caps are monotone: every level admits everything the level below it
 * admits, plus more. A dial whose middle setting hid something its lowest
 * setting showed would not be a dial.
 */

export type FocusLevel = 'low' | 'medium' | 'high';

export const FOCUS_LEVELS: readonly FocusLevel[] = ['low', 'medium', 'high'];

/** What a new day starts at. Nobody has to remember to put the dial back. */
export const DEFAULT_FOCUS_LEVEL: FocusLevel = 'medium';

/** The longest piece of DISCRETIONARY work each level will offer, in minutes. */
export const FOCUS_CAP: Record<FocusLevel, number> = {
  low: 25,
  medium: 60,
  high: Infinity,
};

export const FOCUS_WORD: Record<FocusLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export function isFocusLevel(raw: unknown): raw is FocusLevel {
  return raw === 'low' || raw === 'medium' || raw === 'high';
}

/**
 * The stored form: the level, and the day it was set. Both, because the reset
 * is arithmetic over the date at READ time rather than a write at midnight —
 * a machine asleep for three days comes back at Medium without anything having
 * run while it slept. `focusSession` banks timestamps for the same reason.
 */
export interface StoredFocusLevel {
  level: FocusLevel;
  date: string; // 'YYYY-MM-DD'
}

export function serializeFocusLevel(stored: StoredFocusLevel): string {
  return JSON.stringify(stored);
}

/**
 * A stored row, or null. Total: any malformed shape — a hand-edited settings
 * row, a value written by a future build, plain corruption — reads as "nothing
 * stored" rather than as an exception at startup.
 */
export function parseStoredFocusLevel(raw: unknown): StoredFocusLevel | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  if (!isFocusLevel(row.level)) return null;
  if (typeof row.date !== 'string' || !isValidLocalDate(row.date)) return null;
  return { level: row.level, date: row.date };
}

/** The level in force today: what was set, if it was set today. */
export function focusLevelFor(stored: StoredFocusLevel | null, today: string): FocusLevel {
  if (!stored || stored.date !== today) return DEFAULT_FOCUS_LEVEL;
  return stored.level;
}

/**
 * Whether the evidence about this work's length clears the level's cap.
 *
 * A history range is judged on its HIGH end — "probably 20 to 45 minutes" does
 * not claim to fit half an hour — and a plain estimate at face value. Both
 * rules are inherited verbatim from the retired `workThatFits`, which is where
 * they were first written down.
 *
 * A `starter` is refused at Low as a RULE and not as arithmetic. It is the
 * app's own 30-minute default standing in for evidence it does not have, and
 * Low is the one level that demands positive evidence of shortness. Medium and
 * High admit it because their caps are not asking for a promise.
 */
export function fitsFocus(level: FocusLevel, expected: ExpectedTime): boolean {
  if (level === 'high') return true;
  if (expected.kind === 'starter') return level !== 'low';
  const cap = FOCUS_CAP[level];
  return expected.kind === 'history' ? expected.highMin <= cap : expected.minutes <= cap;
}

/**
 * The reasons that are FACTS about today rather than offers.
 *
 * Your 2pm block is true whether you are sharp or wrecked, so no level may
 * hide it: a shelf that dropped your afternoon because you told it you were
 * tired would be lying about your day, and being believable at a glance is the
 * one thing this surface has to be.
 */
const COMMITMENT_REASONS: ReadonlySet<AdviceReason> = new Set<AdviceReason>([
  'scheduled-now', 'scheduled-next', 'due', 'committed-today',
]);

export function isCommitment(reason: AdviceReason): boolean {
  return COMMITMENT_REASONS.has(reason);
}

/** The one membership question: does this level offer this piece of work? */
export function admits(
  level: FocusLevel,
  reason: AdviceReason,
  expected: ExpectedTime,
): boolean {
  return isCommitment(reason) || fitsFocus(level, expected);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/focusLens.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b
git add src/lib/focusLens.ts src/lib/focusLens.test.ts
git commit -m "feat(lib): the vocabulary for how much focus the room supports"
```

---

## Task 2: Retire the input and the typed vocabulary

**Files:**
- Delete: `src/lib/assistantCommands.ts`, `src/lib/assistantCommands.test.ts`
- Modify: `src/lib/assistantProtocol.ts`
- Modify: `src/lib/executionAdvisor.ts` (delete `rankedWork`, `workThatFits`)
- Modify: `src/lib/executionAdvisor.test.ts` (delete the `workThatFits` describe block, lines 207–227, and the `workThatFits` import on line 2)
- Modify: `src/components/assistant/AssistantHost.tsx`
- Modify: `src/components/assistant/AssistantSurface.tsx`
- Modify: `src/components/assistant/AssistantSurface.test.tsx`
- Modify: `electron/assistantIpc.cjs`
- Modify: `electron/assistantIpc.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `AssistantSnapshot` with no `proposal` key; `AssistantAction` reduced to `start-focus | pause-focus | resume-focus | complete-focus | confirm-focus | switch-focus | close`.

> Do the whole deletion in ONE commit. Deleting `workThatFits` before its caller in `AssistantHost` leaves the tree uncompilable, and deleting the caller first leaves an unreferenced export — neither is a state worth committing.

- [ ] **Step 1: Update the surface test first, so it states the new contract**

In `src/components/assistant/AssistantSurface.test.tsx`:

Remove `proposal: null,` from the `ready()` helper (line ~40). Delete every test that renders a proposal or asserts on the input — search for `proposal`, `submit-input`, `Ask Phase`, and `Try:` and delete the whole `it(...)` block each appears in.

Then add this test to the `describe('AssistantSurface')` block:

```tsx
  it('has no textbox at all — the shelf starts work, it does not parse sentences', () => {
    render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keeps the primary action reachable when a notice is showing', () => {
    const snapshot = ready({ notice: { tone: 'warning', text: 'A session is already running.' } });
    render(<AssistantSurface snapshot={snapshot} onAction={() => {}} />);
    expect(screen.getByText('A session is already running.')).toBeTruthy();
    // The fault this replaces: the notice took the whole surface with it.
    expect(screen.getByRole('heading', { name: 'Problem set 4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start session' })).toBeTruthy();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/assistant/AssistantSurface.test.tsx`
Expected: FAIL — the textbox test fails because the input still renders, and the notice test fails because the neutral/warning branch still replaces the body.

- [ ] **Step 3: Shrink the protocol**

In `src/lib/assistantProtocol.ts`, delete line 2 (`import type { AssistantProposal } from './assistantCommands';`), then replace the snapshot and action types:

```ts
export type AssistantSnapshot =
  | { status: 'loading' }
  | {
      status: 'ready';
      advice: ExecutionAdvice;
      activeFocus: AssistantFocusView | null;
      notice?: { tone: 'neutral' | 'warning'; text: string };
    };

export type AssistantAction =
  | { type: 'start-focus'; ref: WorkRef }
  | { type: 'pause-focus' }
  | { type: 'resume-focus' }
  | { type: 'complete-focus' }
  | { type: 'confirm-focus'; minutes: number | null }
  | { type: 'switch-focus'; ref: WorkRef }
  | { type: 'close' };
```

- [ ] **Step 4: Delete the parser and the two advisor exports**

```bash
git rm src/lib/assistantCommands.ts src/lib/assistantCommands.test.ts
```

In `src/lib/executionAdvisor.ts`, delete `rankedWork` (and its doc comment) and `workThatFits` (and its doc comment) — everything from the comment beginning `/**\n * The full canonical queue with evidence attached` to the end of the file. The file now ends with the closing brace of `executionAdvice`.

In `src/lib/executionAdvisor.test.ts`, change line 2 to:

```ts
import { executionAdvice, type ExecutionAdviceInput } from './executionAdvisor';
```

and delete the whole `describe('workThatFits', ...)` block (lines 207–227). If `RecommendedWork` is no longer referenced in that file, drop it from the import too; if it is, keep it.

- [ ] **Step 5: Strip the surface**

In `src/components/assistant/AssistantSurface.tsx`:

- Delete the `useState` import usage for `text` and the whole `<input>` element.
- Delete the `ProposalPanel` function entirely.
- Delete lines 7–8 (`import type { AssistantProposal } …` and `import { ASSISTANT_EXAMPLES } …`).
- In `AdvicePanel`, the `clear` branch loses its examples line:

```tsx
  if (advice.kind === 'clear') {
    return <p className="text-body text-ink">Nothing needs you right now.</p>;
  }
```

- Replace the component's returned JSX (the block starting `return (` at line ~391) with:

```tsx
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-3">
      {snapshot.notice && (
        <p className={`text-meta ${snapshot.notice.tone === 'warning' ? 'text-warn' : 'text-muted'}`}>
          {snapshot.notice.text}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {snapshot.activeFocus ? (
          <FocusPanel
            focus={snapshot.activeFocus}
            alternatives={snapshot.advice.kind === 'work' ? snapshot.advice.alternatives : []}
            onAction={onAction}
            shelf={shelf}
          />
        ) : (
          <AdvicePanel
            snapshot={snapshot}
            shelf={shelf}
            pending={sendoff.pending}
            onStart={sendoff.start}
          />
        )}
      </div>
    </div>
  );
```

Note what changed beyond the deletion: a notice is now a LINE ABOVE the body, and the body always renders. The old `notice?.tone === 'neutral'` branch — which returned a bare paragraph instead of the advice — is gone. `useState` is now unused in this file; remove it from the React import, leaving `import { useEffect, useState } from 'react';` only if `OtherOptions` still uses it (it does — keep both).

- [ ] **Step 6: Strip the host**

In `src/components/assistant/AssistantHost.tsx`:

- Delete the imports on lines 6–11 for `rankedWork`, `workThatFits`, `ExecutionAdviceInput`, `ASSISTANT_EXAMPLES`, `interpretAssistantInput`, `proposeAssistant`, `AssistantProposal`. Line 6 becomes `import { executionAdvice } from '../../lib/executionAdvisor';`.
- Delete the `proposal` state (`const [proposal, setProposal] = useState<AssistantProposal | null>(null);`).
- Delete the `adviceInput` helper.
- Delete the `commit` function entirely.
- Remove `proposal,` from the snapshot object and `proposal` from the `useMemo` dependency array.
- Delete the `submit-input`, `confirm-proposal`, `choose-subject` and `cancel-proposal` cases from `onAction`. Whatever follows `cancel-proposal` in that switch (the `close` case and any default) stays.
- Every remaining `setProposal(null)` call is now a reference to a deleted setter — delete those lines too.

- [ ] **Step 7: Strip the relay**

In `electron/assistantIpc.cjs`:

- Delete `validProposal` entirely.
- In `validSnapshot`, delete the `&& validProposal(snapshot.proposal)` clause.
- In `validAction`, delete the `case 'cancel-proposal':` line from the always-true group, and delete the `submit-input`, `confirm-proposal` and `choose-subject` cases.
- Delete `MAX_CHOICES` and `MAX_INPUT_TEXT` if nothing else references them (grep first — `validDate` and `validSubject` may still be used by `validAdvice`; leave anything still referenced).

In `electron/assistantIpc.test.ts`: delete `proposal: null,` from the snapshot fixture (line ~68) and change the `{ type: 'confirm-proposal' }` case (line ~202) so it asserts the verb is now REJECTED. If it already sits in a "rejects malformed actions" list, move it there; if it sits in an "accepts" list, move it to the rejecting one.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: PASS. Fix any remaining reference to a deleted symbol — `npx tsc -b` will name every one.

- [ ] **Step 9: Typecheck and commit**

```bash
npx tsc -b
git add -A src/lib src/components/assistant electron/assistantIpc.cjs electron/assistantIpc.test.ts
git commit -m "feat(assistant): the shelf starts work and no longer parses sentences"
```

---

## Task 3: A low-focus session is stored, and never learned from

**Files:**
- Modify: `src/db/types.ts` (the `Session` interface, from line 194)
- Modify: `src/lib/expectedTime.ts` (`gatherSamples`, lines ~143–163)
- Modify: `src/lib/expectedTime.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Session.focus?: 'low'` — read by `expectedTime` only.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/expectedTime.test.ts` (match the file's existing fixture helpers — read the top of the file and reuse them rather than inventing new ones; the shapes below assume a goal with two completed leaves and sessions logged against them):

```ts
describe('low-focus sessions', () => {
  it('are not evidence about how long work takes', () => {
    const goals: Goal[] = [{
      id: 'g1', title: 'Physics 201', nodes: [
        { id: 'n1', title: 'Lab 1', status: 'done' },
        { id: 'n2', title: 'Lab 2', status: 'done' },
        { id: 'n3', title: 'Lab 3' },
      ],
    }];
    const ordinary: Session[] = [
      { id: 's1', goalId: 'g1', nodeId: 'n1', date: '2026-08-10', minutes: 40, note: '' },
      { id: 's2', goalId: 'g1', nodeId: 'n2', date: '2026-08-11', minutes: 45, note: '' },
    ];
    const withSlog: Session[] = [
      ...ordinary,
      { id: 's3', goalId: 'g1', nodeId: 'n2', date: '2026-08-12', minutes: 90, note: '', focus: 'low' },
    ];

    const target = { kind: 'step' as const, id: 'n3', goalId: 'g1' };
    const before = expectedTimeFor(target, { goals, tasks: [], sessions: ordinary });
    const after = expectedTimeFor(target, { goals, tasks: [], sessions: withSlog });

    // The 90-minute slog in a loud room must not teach Phase that a lab takes 90.
    expect(after).toEqual(before);
  });

  it('still count as time actually spent', () => {
    const sessions: Session[] = [
      { id: 's1', goalId: 'g1', nodeId: 'n1', date: '2026-08-12', minutes: 90, note: '', focus: 'low' },
    ];
    expect(loggedForNode(sessions, 'n1')).toBe(90);
  });
});
```

Add `loggedForNode` to the file's imports from `./actuals`, and `Session` / `Goal` to its type imports from `../db/types`, if they are not already there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/expectedTime.test.ts`
Expected: FAIL — the first test fails because the slog widens the range; the second may already pass, which is correct (it is a regression guard).

- [ ] **Step 3: Add the field**

In `src/db/types.ts`, inside the `Session` interface, after the `taskId`/`nodeId` block:

```ts
  /**
   * Written only when the session ran at LOW focus, and read by exactly one
   * thing: `expectedTime`, which refuses to learn from it. Nothing in the UI
   * displays this field — there is no trend, no badge and no readout.
   *
   * A 90-minute slog through a 45-minute task in a loud room is not evidence
   * that the task takes 90 minutes, and without this the focus level would
   * quietly inflate every future estimate on exactly the days the student was
   * already struggling.
   *
   * Only `'low'` is ever stored. Medium and high are the norm, and a field
   * whose value on most rows means "nothing special" is a field that should be
   * absent — the same reason `status` never writes `'todo'`.
   *
   * ACTUALS ARE UNTOUCHED: `loggedForNode`/`loggedForTask` and every capacity
   * figure count these minutes in full. The time really happened; it is
   * disqualified as a PREDICTOR, never as a fact.
   */
  focus?: 'low';
```

- [ ] **Step 4: Filter the evidence**

In `src/lib/expectedTime.ts`, add above `gatherSamples`:

```ts
/**
 * The sessions allowed to TEACH. See `Session.focus` — a low-focus sitting is
 * a fact about time spent and not a prediction about how long the work takes.
 */
function evidenceSessions(sessions: Session[]): Session[] {
  return sessions.filter((s) => s.focus !== 'low');
}
```

Then, at the top of `gatherSamples`, bind the filtered list and use it in both branches:

```ts
function gatherSamples(target: ResolvedTarget, input: ExpectedTimeInput): Array<{ title: string; minutes: number }> {
  const samples: Array<{ title: string; minutes: number }> = [];
  const teaching = evidenceSessions(input.sessions);
  if (target.kind === 'step') {
    for (const goal of input.goals) {
      if (goal.id !== target.goalId) continue;
      walkLeaves(goal, (n) => {
        if (!isDone(n)) return;
        const minutes = loggedForNode(teaching, n.id);
        if (minutes > 0) samples.push({ title: n.title, minutes });
      });
    }
  } else {
    for (const task of input.tasks) {
      if (task.goalId !== target.goalId) continue;
      if (!task.done) continue;
      const minutes = loggedForTask(teaching, task.id);
      if (minutes > 0) samples.push({ title: task.title, minutes });
    }
  }
  return samples;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/expectedTime.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -b
git add src/db/types.ts src/lib/expectedTime.ts src/lib/expectedTime.test.ts
git commit -m "feat(lib): a low-focus session is time spent, not evidence"
```

---

## Task 4: The draft freezes the level it started at

**Files:**
- Modify: `src/lib/focusSession.ts`
- Modify: `src/lib/focusSession.test.ts`

**Interfaces:**
- Consumes: `FocusLevel`, `DEFAULT_FOCUS_LEVEL`, `isFocusLevel` from Task 1.
- Produces: `ActiveFocusSession.focusLevel: FocusLevel` (required); `StartFocusInput.focusLevel: FocusLevel` (required).

- [ ] **Step 1: Write the failing test**

Append to `src/lib/focusSession.test.ts` (reuse the file's existing helpers for building a session; the calls below assume `startFocusSession` is called with a full input object as it is elsewhere in that suite):

```ts
describe('the focus level a session ran at', () => {
  it('is frozen at start, so moving the dial does not relabel work already done', () => {
    const session = startFocusSession({
      ref: { kind: 'step', id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      expected: { kind: 'estimate', minutes: 45 },
      focusLevel: 'low',
      nowMs: 1_000,
    });
    expect(session.focusLevel).toBe('low');
  });

  it('survives a serialize/parse round trip', () => {
    const session = startFocusSession({
      ref: { kind: 'step', id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      expected: { kind: 'estimate', minutes: 45 },
      focusLevel: 'high',
      nowMs: 1_000,
    });
    const parsed = parseActiveFocusSession(serializeActiveFocusSession(session));
    expect(parsed?.focusLevel).toBe('high');
  });

  it('reads a draft written before this field existed as medium', () => {
    const legacy = JSON.stringify({
      id: 'f1',
      ref: { kind: 'step', id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      startedAtMs: 1_000,
      activeSinceMs: 1_000,
      accumulatedMs: 0,
      phase: 'active',
      expected: { kind: 'estimate', minutes: 45 },
    });
    expect(parseActiveFocusSession(legacy)?.focusLevel).toBe('medium');
  });

  it('reads a malformed level as medium rather than as no session', () => {
    const odd = JSON.stringify({
      id: 'f1',
      ref: { kind: 'step', id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      startedAtMs: 1_000,
      activeSinceMs: 1_000,
      accumulatedMs: 0,
      phase: 'active',
      expected: { kind: 'estimate', minutes: 45 },
      focusLevel: 'sideways',
    });
    expect(parseActiveFocusSession(odd)?.focusLevel).toBe('medium');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/focusSession.test.ts`
Expected: FAIL — `focusLevel` is not a property of `StartFocusInput`.

- [ ] **Step 3: Implement**

In `src/lib/focusSession.ts`:

Add the import:

```ts
import { DEFAULT_FOCUS_LEVEL, isFocusLevel, type FocusLevel } from './focusLens';
```

Add to `ActiveFocusSession`, after `expected`:

```ts
  /**
   * The level the dial was at when this began. Frozen, exactly as `title` and
   * `expected` are: moving the dial mid-session must not relabel work already
   * done. It reaches history as `Session.focus` and nowhere else.
   */
  focusLevel: FocusLevel;
```

Add to `StartFocusInput`:

```ts
  focusLevel: FocusLevel;
```

In `startFocusSession`, add to the returned object after `expected: input.expected,`:

```ts
    focusLevel: input.focusLevel,
```

In `parseActiveFocusSession`, add to the returned object after `expected: s.expected,`:

```ts
    // Absent or malformed reads as the default rather than as "no session":
    // a draft written before this field existed is still a real session, and
    // losing it would cost the user time they actually worked.
    focusLevel: isFocusLevel(s.focusLevel) ? s.focusLevel : DEFAULT_FOCUS_LEVEL,
```

Do NOT add a validation guard that returns null for a bad `focusLevel` — the whole point of the line above is that this field can never be the reason a draft is discarded.

- [ ] **Step 4: Run the tests and fix every construction site**

Run: `npx tsc -b`
Expected: errors listing every place an `ActiveFocusSession` or `StartFocusInput` is built without `focusLevel` — test fixtures in `src/lib/focusSession.test.ts`, `src/state/store.*.test.ts`, and `src/state/store.ts`'s `startFocus`. Add `focusLevel: 'medium'` to every test fixture. Leave `store.ts` alone for now if it errors; Task 5 fixes it properly.

Run: `npx vitest run src/lib/focusSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/focusSession.ts src/lib/focusSession.test.ts
git commit -m "feat(lib): a focus draft remembers the room it started in"
```

---

## Task 5: The standing mode, persisted and reset daily

**Files:**
- Modify: `src/db/db.ts` (after `saveAssistantAccelerator`, line ~213)
- Modify: `src/state/store.ts`
- Test: `src/state/store.focusLevel.test.ts` **(new)**

**Interfaces:**
- Consumes: `StoredFocusLevel`, `focusLevelFor`, `parseStoredFocusLevel`, `serializeFocusLevel`, `isFocusLevel`, `DEFAULT_FOCUS_LEVEL`, `FocusLevel` from Task 1; `ActiveFocusSession.focusLevel` from Task 4.
- Produces:
  - `loadStoredFocusLevel(): Promise<StoredFocusLevel | null>` and `saveStoredFocusLevel(stored: StoredFocusLevel): Promise<void>` in `src/db/db.ts`
  - `state.focusLevel: FocusLevel`
  - `actions.setFocusLevel(next: FocusLevel): boolean`
  - `actions.logSession(kind, id, minutes, date?, focus?: 'low'): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/state/store.focusLevel.test.ts`. **Read an existing store test first** (`src/state/store.*.test.ts`) and copy its harness verbatim — the store is a module singleton and these suites boot it themselves; do not invent a new setup.

```ts
import { describe, it, expect, beforeEach } from 'vitest';
// ↓ Replace this import block with the exact harness the neighbouring
//   store test files use to reset and seed the store.
import { actions, getState } from './store';

describe('the standing focus level', () => {
  beforeEach(() => {
    // Reset the store the same way the neighbouring suites do.
  });

  it('starts at medium', () => {
    expect(getState().focusLevel).toBe('medium');
  });

  it('is set by setFocusLevel and reported back', () => {
    expect(actions.setFocusLevel('low')).toBe(true);
    expect(getState().focusLevel).toBe('low');
  });

  it('refuses a level that is not one of the three', () => {
    actions.setFocusLevel('high');
    // @ts-expect-error — the boundary must refuse it at runtime too.
    expect(actions.setFocusLevel('sideways')).toBe(false);
    expect(getState().focusLevel).toBe('high');
  });

  it('freezes the level onto the draft it starts', () => {
    actions.setFocusLevel('low');
    // Seed one goal with one leaf, then:
    //   actions.startFocus({ kind: 'step', id: <leafId>, goalId: <goalId> },
    //                      { kind: 'estimate', minutes: 30 });
    expect(getState().activeFocusSession?.focusLevel).toBe('low');
  });

  it('carries low onto the logged session, and nothing onto the others', () => {
    actions.setFocusLevel('low');
    // start a focus session on a seeded leaf, then complete it:
    //   actions.completeFocus(Date.now() + 20 * 60_000);
    const logged = getState().sessions.at(-1);
    expect(logged?.focus).toBe('low');

    actions.setFocusLevel('high');
    // start and complete a second session the same way, then:
    expect(getState().sessions.at(-1)?.focus).toBeUndefined();
  });
});
```

Fill in the seeding comments using the helpers the neighbouring store suites already provide (they seed goals through `actions.addGoals` or a direct state injection — follow whichever they use).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/state/store.focusLevel.test.ts`
Expected: FAIL — `focusLevel` is not a property of the state, `setFocusLevel` is not a function.

- [ ] **Step 3: Add the settings row**

In `src/db/db.ts`, add the import to the existing import block:

```ts
import {
  parseStoredFocusLevel, serializeFocusLevel, type StoredFocusLevel,
} from '../lib/focusLens';
```

and after `saveAssistantAccelerator`:

```ts
/**
 * The standing focus level and the day it was set.
 *
 * A device preference like `assistantAccelerator`, and deliberately NOT part
 * of backup export/import: the room you were in on this machine on Tuesday is
 * not a fact about your plan. The load is total — a malformed row reads as
 * nothing stored, which `focusLevelFor` turns into the default.
 */
const FOCUS_LEVEL_KEY = 'focusLevel';

export async function loadStoredFocusLevel(): Promise<StoredFocusLevel | null> {
  const row = await db.settings.get(FOCUS_LEVEL_KEY);
  return parseStoredFocusLevel(row?.value);
}

export async function saveStoredFocusLevel(stored: StoredFocusLevel): Promise<void> {
  await db.settings.put({ key: FOCUS_LEVEL_KEY, value: serializeFocusLevel(stored) });
}
```

- [ ] **Step 4: Wire the store**

In `src/state/store.ts`:

**(a)** Add to the imports:

```ts
import {
  DEFAULT_FOCUS_LEVEL, focusLevelFor, isFocusLevel, type FocusLevel,
} from '../lib/focusLens';
import { loadStoredFocusLevel, saveStoredFocusLevel } from '../db/db';
```

(fold the two db functions into the existing `../db/db` import statement rather than adding a second one.)

**(b)** In `UIState`, after `assistantAccelerator: string;`:

```ts
  /**
   * How much focus the room supports. A standing mode, set from the shelf and
   * held until it is changed — a fact about where you are, not about one task,
   * which is why it does not live on the session.
   *
   * Reset to `medium` when the stored date is not today, evaluated on hydrate.
   * A window left open across midnight keeps the level until it reloads: that
   * is the deliberate cost of having no timer, and the same trade `focusSession`
   * makes by banking timestamps instead of ticking.
   */
  focusLevel: FocusLevel;
```

**(c)** In the initial `state` object, after `assistantAccelerator: DEFAULT_ASSISTANT_ACCELERATOR,`:

```ts
  focusLevel: DEFAULT_FOCUS_LEVEL,
```

**(d)** In `hydrate`, add `loadStoredFocusLevel()` to the `Promise.all` array and `storedFocusLevel` to the destructured tuple (append both at the END of their lists so no existing position shifts):

```ts
    const [appState, pxPerDay, planReview, availability, allDayBlocks, sidebarPanels, planMode, goalsMode, activeFocusSession, assistantAccelerator, storedFocusLevel] = await Promise.all([
      loadState(), loadScale(), loadPlanReview(), loadAvailability(), loadAllDayBlocks(), loadSidebarPanels(), loadPlanMode(), loadGoalsMode(), loadActiveFocusSession(), loadAssistantAccelerator(), loadStoredFocusLevel(),
    ]);
```

and in the `state = { ... }` assignment, after `assistantAccelerator,`:

```ts
      focusLevel: focusLevelFor(storedFocusLevel, todayStr()),
```

**(e)** Add the action, immediately after `setAssistantShortcutStatus`:

```ts
  /**
   * Move the dial. Validation is at the boundary and the write goes through
   * the owner gate, exactly like `setAssistantAccelerator`. The date is
   * stamped with the value so `focusLevelFor` can retire it tomorrow without
   * anything having to run at midnight.
   */
  setFocusLevel(next: FocusLevel): boolean {
    if (!isFocusLevel(next)) return false;
    set({ focusLevel: next });
    ifOwner(() => saveStoredFocusLevel({ level: next, date: todayStr() }));
    return true;
  },
```

**(f)** In `startFocus`, add the level to the draft:

```ts
    setFocusDraft(startFocusSession({
      ref, title, ...(goalTitle === undefined ? {} : { goalTitle }),
      expected, focusLevel: state.focusLevel, nowMs,
    }));
```

**(g)** In `logSession`, add the fifth parameter and carry it onto the row:

```ts
  logSession(
    kind: 'step' | 'task',
    id: string,
    minutes: number,
    date = todayStr(),
    focus?: 'low',
  ): boolean {
```

and in the `const session: Session = {` literal, after the `nodeId`/`taskId` spread:

```ts
      ...(focus === undefined ? {} : { focus }),
```

**(h)** In `completeFocus`, pass the draft's level:

```ts
    if (!actions.logSession(
      draft.ref.kind, draft.ref.id, finish.minutes, todayStr(),
      draft.focusLevel === 'low' ? 'low' : undefined,
    )) return 'refused';
```

**(i)** In `confirmFocus`, the same:

```ts
    if (!actions.logSession(
      draft.ref.kind, draft.ref.id, minutes, todayStr(),
      draft.focusLevel === 'low' ? 'low' : undefined,
    )) return false;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/state/store.focusLevel.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS — the whole suite, including the store fixtures Task 4 left needing `focusLevel`.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -b
git add src/db/db.ts src/state/store.ts src/state/store.focusLevel.test.ts
git commit -m "feat(store): the dial holds for the day, and rides the session it starts"
```

---

## Task 6: The advisor applies the lens

**Files:**
- Modify: `src/lib/executionAdvisor.ts`
- Modify: `src/lib/executionAdvisor.test.ts`

**Interfaces:**
- Consumes: `admits`, `FocusLevel` from Task 1.
- Produces: `ExecutionAdviceInput.focusLevel?: FocusLevel`; `ExecutionAdvice` work verdict gains `beyondFocus?: true`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/executionAdvisor.test.ts`:

```ts
describe('the focus lens', () => {
  /** Two free-time candidates: one long, one short, in that canonical order. */
  function twoSizes() {
    return goal({
      id: 'g1', title: 'Physics 201',
      nodes: [
        { id: 'n1', title: 'Lab report', estimateMin: 45 },
        { id: 'n2', title: 'Reply to Dr. Chen', estimateMin: 10 },
      ],
    });
  }

  it('changes nothing when no level is given, so Today is untouched', () => {
    const withoutLens = executionAdvice(input({ goals: [twoSizes()] }));
    const withHigh = executionAdvice(input({ goals: [twoSizes()], focusLevel: 'high' }));
    expect(withoutLens).toEqual(withHigh);
  });

  it('offers the first SHORT candidate at low, without re-ordering the queue', () => {
    const advice = executionAdvice(input({ goals: [twoSizes()], focusLevel: 'low' }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.title).toBe('Reply to Dr. Chen');
    expect(advice.beyondFocus).toBeUndefined();
  });

  it('offers the queue head at medium, where the long one clears the cap', () => {
    const advice = executionAdvice(input({ goals: [twoSizes()], focusLevel: 'medium' }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.title).toBe('Lab report');
  });

  it('never hides a commitment, however long it is', () => {
    const g = goal({
      id: 'g1', title: 'History 340',
      nodes: [{
        id: 'n1', title: 'Seminar prep', plannedWeek: week, estimateMin: 90,
        blocks: [{ id: 'b1', date: today, startMin: 540, minutes: 90 }],
      }],
    });
    const advice = executionAdvice(input({
      goals: [g], focusLevel: 'low', now: { date: today, minute: 570 },
    }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.title).toBe('Seminar prep');
    expect(advice.primary.reason).toBe('scheduled-now');
  });

  it('flags beyondFocus and still offers the real head when the lens empties', () => {
    const g = goal({
      id: 'g1', title: 'Dissertation',
      nodes: [{ id: 'n1', title: 'Thesis chapter 2', estimateMin: 120 }],
    });
    const advice = executionAdvice(input({ goals: [g], focusLevel: 'low' }));
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.title).toBe('Thesis chapter 2');
    expect(advice.beyondFocus).toBe(true);
    // It offers the head, not a consolation list.
    expect(advice.alternatives).toEqual([]);
  });

  it('says clear rather than beyondFocus when there was nothing to begin with', () => {
    const advice = executionAdvice(input({ focusLevel: 'low' }));
    expect(advice.kind).toBe('clear');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/executionAdvisor.test.ts`
Expected: FAIL — `focusLevel` is not a property of `ExecutionAdviceInput`.

- [ ] **Step 3: Implement**

In `src/lib/executionAdvisor.ts`:

**(a)** Add the import:

```ts
import { admits, type FocusLevel } from './focusLens';
```

**(b)** Extend the advice type:

```ts
export type ExecutionAdvice =
  | {
      kind: 'work';
      primary: RecommendedWork;
      alternatives: RecommendedWork[];
      /**
       * The level in force admitted nothing, so `primary` is the unfiltered
       * head of the queue. The surface says so out loud — "Nothing light left"
       * is a different sentence from "nothing needs you", and re-sorting to
       * find a lighter task would be the second opinion this module refuses.
       */
      beyondFocus?: true;
    }
  /** Availability was never set — the same distinct verdict `todayPlan` keeps. */
  | { kind: 'needs-hours' }
  | { kind: 'clear' };
```

**(c)** Add to `ExecutionAdviceInput`, after `now: Now;`:

```ts
  /**
   * How much focus the room supports. ABSENT means no lens at all, which is
   * what every surface other than the shelf passes: a mood set in a café must
   * not rewrite the Today page you check on the train home — the same boundary
   * the life switcher holds when the board scopes and the week does not.
   */
  focusLevel?: FocusLevel;
```

**(d)** Replace `executionAdvice` entirely:

```ts
export function executionAdvice(input: ExecutionAdviceInput): ExecutionAdvice {
  const { pool, noHours } = orderedCandidates(input);
  if (pool.length === 0) return noHours ? { kind: 'needs-hours' } : { kind: 'clear' };

  // Evidence is attached to the whole pool because membership depends on it.
  // Both callers memoize this, so the cost is per-change and not per-frame.
  const queue = pool.map((c) => withExpected(c, input));
  const level = input.focusLevel;
  const admitted = level === undefined
    ? queue
    : queue.filter((w) => admits(level, w.reason, w.expected));

  // An emptied lens offers the real head, flagged — never a re-sort.
  const beyondFocus = admitted.length === 0;
  const visible = beyondFocus ? queue.slice(0, 1) : admitted;

  const [primary, ...rest] = visible;
  const alternatives: RecommendedWork[] = rest.slice(0, MAX_ALTERNATIVES);
  if (rest.length > MAX_ALTERNATIVES) {
    /*
     * Alternative two may diversify by life: the first LATER candidate from a
     * life the primary and first alternative do not already cover. It swaps in
     * quietly — the primary and alternative one never move, and no
     * "under-served" claim is made.
     */
    const covered = new Set([primary.lifeId, alternatives[0]?.lifeId]);
    const other = rest.slice(MAX_ALTERNATIVES).find(
      (c) => c.lifeId !== undefined && !covered.has(c.lifeId),
    );
    if (other && alternatives[1] && covered.has(alternatives[1].lifeId)) {
      alternatives[1] = other;
    }
  }

  return {
    kind: 'work',
    primary,
    alternatives,
    ...(beyondFocus ? { beyondFocus: true as const } : {}),
  };
}
```

Note the deliberate detail: `beyondFocus` is spread in only when true, so an ordinary verdict has no key at all and `toEqual` comparisons against the unlensed shape keep passing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/executionAdvisor.test.ts`
Expected: PASS — the new block plus every pre-existing advisor test unchanged.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b
git add src/lib/executionAdvisor.ts src/lib/executionAdvisor.test.ts
git commit -m "feat(lib): the advisor takes the room as an argument, and never re-sorts"
```

---

## Task 7: The shelf grows a dial

**Files:**
- Modify: `src/lib/assistantProtocol.ts`
- Modify: `src/lib/assistantProtocol.test.ts`
- Modify: `src/components/assistant/AssistantSurface.tsx`
- Modify: `src/components/assistant/AssistantSurface.test.tsx`
- Modify: `src/components/assistant/AssistantHost.tsx`
- Modify: `electron/assistantIpc.cjs`

**Interfaces:**
- Consumes: `FocusLevel`, `FOCUS_LEVELS`, `FOCUS_WORD` from Task 1; `beyondFocus` from Task 6; `actions.setFocusLevel` from Task 5.
- Produces: `AssistantSnapshot` gains `focusLevel: FocusLevel`; `AssistantAction` gains `{ type: 'set-focus-level'; level: FocusLevel }`; `elapsedAgainstExpected(elapsedMin, expected, level?)`.

- [ ] **Step 1: Write the failing tests**

In `src/components/assistant/AssistantSurface.test.tsx`, add `focusLevel: 'medium',` to the `ready()` helper, then append:

```tsx
  it('offers the three levels and reports which is on', () => {
    render(<AssistantSurface snapshot={ready({ focusLevel: 'low' })} onAction={() => {}} />);
    expect(screen.getByRole('button', { name: 'Low' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Medium' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'High' })).toBeTruthy();
  });

  it('sends the level the user picked', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Low' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'set-focus-level', level: 'low' });
  });

  it('sets the level from the number keys', () => {
    const onAction = vi.fn();
    render(<AssistantSurface snapshot={ready()} onAction={onAction} />);
    fireEvent.keyDown(window, { key: '1' });
    expect(onAction).toHaveBeenCalledWith({ type: 'set-focus-level', level: 'low' });
    fireEvent.keyDown(window, { key: '3' });
    expect(onAction).toHaveBeenCalledWith({ type: 'set-focus-level', level: 'high' });
  });

  it('says nothing light is left rather than nothing needs you', () => {
    const snapshot = ready({
      focusLevel: 'low',
      advice: { kind: 'work', primary: work({ title: 'Thesis chapter 2' }), alternatives: [], beyondFocus: true },
    });
    render(<AssistantSurface snapshot={snapshot} onAction={() => {}} />);
    expect(screen.getByText("Nothing light left — this is next when you're ready.")).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Thesis chapter 2' })).toBeTruthy();
  });

  it('drops the comparison from a running session at low focus', () => {
    const focus = {
      ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      phase: 'active' as const,
      elapsedMin: 18,
      expected: { kind: 'estimate' as const, minutes: 45 },
    };
    render(<AssistantSurface snapshot={ready({ focusLevel: 'low', activeFocus: focus })} onAction={() => {}} />);
    expect(screen.getByText('18m so far')).toBeTruthy();
    expect(screen.queryByText(/of 45m/)).toBeNull();
  });

  it('keeps the comparison at medium, where it is not pressure but information', () => {
    const focus = {
      ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
      title: 'Lab report',
      phase: 'active' as const,
      elapsedMin: 18,
      expected: { kind: 'estimate' as const, minutes: 45 },
    };
    render(<AssistantSurface snapshot={ready({ focusLevel: 'medium', activeFocus: focus })} onAction={() => {}} />);
    expect(screen.getByText('18m of 45m')).toBeTruthy();
  });
```

And in `src/lib/assistantProtocol.test.ts`, append:

```ts
describe('elapsedAgainstExpected at low focus', () => {
  it('states the number and withholds the verdict', () => {
    expect(elapsedAgainstExpected(18, { kind: 'estimate', minutes: 45 }, 'low')).toBe('18m so far');
    expect(elapsedAgainstExpected(18, {
      kind: 'history', lowMin: 40, highMin: 50, confidence: 'medium', sampleCount: 2,
    }, 'low')).toBe('18m so far');
  });

  it('defaults to stating the comparison, so existing callers are unchanged', () => {
    expect(elapsedAgainstExpected(18, { kind: 'estimate', minutes: 45 })).toBe('18m of 45m');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/assistant/AssistantSurface.test.tsx src/lib/assistantProtocol.test.ts`
Expected: FAIL — no `Low` button exists; `elapsedAgainstExpected` takes two arguments.

- [ ] **Step 3: Extend the protocol**

In `src/lib/assistantProtocol.ts`:

Add the import:

```ts
import type { FocusLevel } from './focusLens';
```

Add `focusLevel: FocusLevel;` to the `ready` snapshot variant, after `activeFocus`.

Add the verb to `AssistantAction`:

```ts
  | { type: 'set-focus-level'; level: FocusLevel }
```

Replace `elapsedAgainstExpected`, keeping its existing doc comment and adding to it:

```ts
export function elapsedAgainstExpected(
  elapsedMin: number,
  expected: ExpectedTime,
  level: FocusLevel = 'medium',
): string {
  const done = fmtMinutes(elapsedMin);
  // At low focus the number survives and the verdict does not. The pressure in
  // a running session was never the elapsed figure — it is the figure it is
  // being measured against.
  if (level === 'low') return `${done} so far`;
  return expected.kind === 'history'
    ? `${done} of ${expected.lowMin}–${expected.highMin}m`
    : `${done} of ${expected.minutes}m`;
}
```

- [ ] **Step 4: Build the strip and rewire the surface**

In `src/components/assistant/AssistantSurface.tsx`:

Add the imports:

```ts
import { FOCUS_LEVELS, FOCUS_WORD, type FocusLevel } from '../../lib/focusLens';
import { SegmentedSwitch } from '../SegmentedControl';
```

Add the strip component, next to `SectionLabel`:

```tsx
/**
 * The dial, and the only always-present control on the shelf.
 *
 * `SegmentedSwitch` rather than `SegmentedControl`: this is view state and not
 * form data, the same distinction Board/Timeline already makes. `sm` because
 * the shelf is a dense toolbar, and because 26px clears the 24px target floor.
 */
function FocusStrip({ level, onAction }: {
  level: FocusLevel;
  onAction: Props['onAction'];
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line pb-2">
      <span className="text-meta font-semibold text-muted">Focus</span>
      <SegmentedSwitch
        label="Focus level"
        size="sm"
        value={level}
        options={FOCUS_LEVELS.map((value) => ({ value, label: FOCUS_WORD[value] }))}
        onChange={(next) => onAction({ type: 'set-focus-level', level: next })}
      />
    </div>
  );
}
```

In `FocusPanel`, take the level and spend it on the readout. Change its props to include `level: FocusLevel` and its status line to:

```tsx
        <p className="text-meta text-muted">
          {elapsedAgainstExpected(focus.elapsedMin, focus.expected, level)}
          {focus.phase === 'break' ? ' · On a break' : ''}
        </p>
```

In `AdvicePanel`, render the `beyondFocus` sentence above the primary. Inside the `work` branch, immediately before the returned `<div className="flex flex-col gap-2">`, and then as the first child of it:

```tsx
      {advice.beyondFocus && (
        <p className="text-meta text-muted">Nothing light left — this is next when you&apos;re ready.</p>
      )}
```

In `AssistantSurface`:

- Extend the keyboard effect to carry the number keys:

```tsx
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onAction({ type: 'close' });
        return;
      }
      const level = KEY_TO_LEVEL[event.key];
      if (level) onAction({ type: 'set-focus-level', level });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAction]);
```

with, at module scope beside `REASON_WORD`:

```tsx
/** The dial on the home row of the number keys. There is no text field to steal them. */
const KEY_TO_LEVEL: Record<string, FocusLevel | undefined> = {
  '1': 'low', '2': 'medium', '3': 'high',
};
```

- Render the strip as the first child of the returned column, and pass `level` down:

```tsx
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-3">
      <FocusStrip level={snapshot.focusLevel} onAction={onAction} />
      {snapshot.notice && (
        <p className={`text-meta ${snapshot.notice.tone === 'warning' ? 'text-warn' : 'text-muted'}`}>
          {snapshot.notice.text}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {snapshot.activeFocus ? (
          <FocusPanel
            focus={snapshot.activeFocus}
            alternatives={snapshot.advice.kind === 'work' ? snapshot.advice.alternatives : []}
            onAction={onAction}
            shelf={shelf}
            level={snapshot.focusLevel}
          />
        ) : (
          <AdvicePanel
            snapshot={snapshot}
            shelf={shelf}
            pending={sendoff.pending}
            onStart={sendoff.start}
          />
        )}
      </div>
    </div>
  );
```

- Give the primary action `autoFocus`, which is how Enter starts a session now that no text field owns the key. In `AdvicePanel`'s `Start session` button add `autoFocus`, and in `FocusPanel`'s filled button for each phase add `autoFocus`. The platform handles Enter and Space; no key handler is needed, and the focus ring shows the user exactly what Enter will do.

- [ ] **Step 5: Feed and forward it**

In `src/components/assistant/AssistantHost.tsx`:

Pull `focusLevel` out of the store alongside the rest:

```ts
  const {
    goals, tasks, sessions, availability, allDayBlocks, activeFocusSession,
    assistantAccelerator, focusLevel, hydration, actions,
  } = useAppStore();
```

Pass it into the advice call and onto the snapshot:

```ts
    const advice = executionAdvice({
      goals, tasks, sessions, availability, blocks: [], allDayBlocks,
      today, week: weekOf(today), now: { date: today, minute: nowMinute() },
      focusLevel,
    });
```

```ts
    return {
      status: 'ready',
      advice,
      activeFocus,
      focusLevel,
      ...(notice ? { notice } : {}),
    };
```

and add `focusLevel` to the `useMemo` dependency array.

Add the case to `onAction`:

```ts
      case 'set-focus-level': actions.setFocusLevel(action.level); return;
```

In `electron/assistantIpc.cjs`, add to `validAction`:

```js
    case 'set-focus-level':
      return action.level === 'low' || action.level === 'medium' || action.level === 'high';
```

and add to `validSnapshot`, in the `ready` return expression:

```js
    && (snapshot.focusLevel === 'low' || snapshot.focusLevel === 'medium' || snapshot.focusLevel === 'high')
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. `electron/assistantIpc.test.ts`'s snapshot fixture now needs `focusLevel: 'medium'` — add it if the suite complains.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc -b
git add src/lib/assistantProtocol.ts src/lib/assistantProtocol.test.ts src/components/assistant electron/assistantIpc.cjs electron/assistantIpc.test.ts
git commit -m "feat(assistant): a dial for the room, and a session that stops keeping score"
```

---

## Task 8: The card hugs its content

**Files:**
- Create: `src/lib/assistantShell.ts`
- Create: `src/lib/assistantShell.test.ts`
- Modify: `src/assistant/AssistantOverlay.tsx`
- Modify: `electron/assistantWindow.cjs`
- Modify: `electron/assistantWindowController.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `shelfSizing(userAgent: string): 'hug' | 'fill'`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/assistantShell.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shelfSizing } from './assistantShell';

describe('shelfSizing', () => {
  it('hugs on macOS, where the window behind the card is transparent', () => {
    expect(shelfSizing('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('hug');
  });

  it('fills everywhere else, where the window paints a background', () => {
    expect(shelfSizing('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('fill');
    expect(shelfSizing('Mozilla/5.0 (X11; Linux x86_64)')).toBe('fill');
  });

  it('fills when it cannot tell, because a painted notch is worse than dead space', () => {
    expect(shelfSizing('')).toBe('fill');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/assistantShell.test.ts`
Expected: FAIL — `Failed to resolve import "./assistantShell"`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/assistantShell.ts`:

```ts
/**
 * Whether the shelf's card should size to its content or fill its window.
 *
 * The window is a fixed height sized to the TALLEST state, so every shorter
 * state used to float at the top of a pane with a hundred pixels of nothing
 * under it. On macOS the window is `transparent`, so a card that hugs its
 * content leaves the remainder invisible rather than white — and a click on
 * that remainder can close the shelf, which turns dead space into
 * click-outside-to-dismiss.
 *
 * Everywhere else the window paints `backgroundColor`, so hugging would leave
 * a visible painted notch under the card. Those platforms keep filling.
 *
 * A string rather than a boolean because the two values name what they do at
 * the call site, where `sizing === 'hug'` reads and `transparent === true`
 * would not.
 */
export function shelfSizing(userAgent: string): 'hug' | 'fill' {
  return /Mac|Macintosh|Mac OS X/.test(userAgent) ? 'hug' : 'fill';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/assistantShell.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Rewire the overlay**

In `src/assistant/AssistantOverlay.tsx`, add the import:

```ts
import { shelfSizing } from '../lib/assistantShell';
```

and replace the returned JSX:

```tsx
  const sizing = shelfSizing(navigator.userAgent);

  return (
    <div
      className="h-screen"
      // The window is fixed at its tallest state; on macOS everything the card
      // does not cover is transparent, so a press there is a press on the
      // desktop as far as the user is concerned. Closing is the honest answer.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) bridge.close();
      }}
    >
      <div
        key={openCycle}
        data-shelf
        className={[
          sizing === 'fill' ? 'h-full' : '',
          'overflow-hidden rounded-card border border-line bg-panel text-ink shadow-card',
          opening ? 'assistant-shelf-enter' : '',
        ].join(' ')}
      >
        <AssistantSurface
          snapshot={snapshot}
          onAction={onAction}
          presentation="shelf"
          resetKey={openCycle}
        />
      </div>
    </div>
  );
```

Note `key={openCycle}` moved onto the card, and `data-shelf` was added so the next step can measure it.

- [ ] **Step 6: Measure the tallest state**

Run the desktop shell:

```bash
npm run app:dev
```

Summon the shelf, put it in the **tallest working state** — a running focus session on a step that has a goal title, with at least two alternatives so "Other options" renders — then open the overlay's devtools and run:

```js
document.querySelector('[data-shelf]').getBoundingClientRect().height
```

Record the number. Repeat for the zero state and for `needs-hours` to confirm they are shorter. The tallest measured value, rounded up to a whole pixel, is the new `HEIGHT`.

- [ ] **Step 7: Set the measured height**

In `electron/assistantWindow.cjs`, replace the `HEIGHT` constant and the comment above it with the measured value and this rationale (substitute the real number for `<MEASURED>`):

```js
// Compact and fixed: the shelf is 620 wide and never grows, so a long list
// scrolls inside the pane instead of forming a tower under the shortcut.
//
// HEIGHT is a BUDGET, not the size of the pane. The card sizes to its own
// content (see `shelfSizing`), so a short state no longer paints the leftover
// space — on macOS the window behind it is transparent and a click there
// closes the shelf. What this number still has to guarantee is that the
// TALLEST state fits without scrolling: a running session with its goal title
// and an "Other options" row, measured at 620px wide.
//
// MEASURED, never derived. Arithmetic against the type scale put this number
// 20px low once already. If a state grows, measure it again.
const WIDTH = 620
const HEIGHT = <MEASURED>
```

Update `electron/assistantWindowController.test.ts` — every `192` on lines 125, 128, 129, 187, 193, 223, 245 and 291 becomes the measured value.

- [ ] **Step 8: Run the suite and verify by hand**

Run: `npm test`
Expected: PASS.

Then, with `npm run app:dev` running, confirm by eye:
1. The zero state shows a card that ends just under its last line — no white band.
2. Clicking the empty area under the card closes the shelf.
3. The running-session state does not scroll inside the pane.
4. Escape still closes; `1`/`2`/`3` still move the dial; Enter starts the offered session.

- [ ] **Step 9: Typecheck and commit**

```bash
npx tsc -b
git add src/lib/assistantShell.ts src/lib/assistantShell.test.ts src/assistant/AssistantOverlay.tsx electron/assistantWindow.cjs electron/assistantWindowController.test.ts
git commit -m "fix(shell): the card ends where its content does"
```

---

## Task 9: Record the rules

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the invariants**

In the **Invariants** section of `CLAUDE.md`, after the existing assistant-shelf bullet, add:

```markdown
- **The shelf starts work; it does not parse sentences.** The typed vocabulary
  (`assistantCommands.ts`, the input, the proposal panels, `rankedWork` and
  `workThatFits`) is RETIRED — `⌘K` is the one place a sentence becomes a task,
  and a second parser is a second opinion about what a sentence means. What
  survives of `workThatFits` is its discipline, carried into `fitsFocus`: a
  history range is judged on its HIGH end, and a `starter` is never evidence
  about length. A notice is a LINE ABOVE the body and never a replacement for
  it — there is no state of the shelf with nothing to press.
- **`focusLens.ts` is the one vocabulary for how much focus the room supports**,
  and it is a LENS, never a ranking: order never changes, membership does, the
  same move `lifeScope` makes on the board. The caps (`low` 25, `medium` 60,
  `high` ∞) are monotone. A FACT about today — `scheduled-now`,
  `scheduled-next`, `due`, `committed-today` — is never filtered, because a
  shelf that hid your 2pm block because you said you were tired would be lying
  about your day; only the discretionary tail is. Unknown length is not short,
  so Low refuses a `starter` as a RULE and not as arithmetic. An emptied lens
  answers `beyondFocus` — "Nothing light left" is a different sentence from
  "nothing needs you", exactly as `no-hours` is not a zero — and offers the
  unfiltered head rather than re-sorting to find something lighter.
  `ExecutionAdviceInput.focusLevel` is OPTIONAL and absent everywhere but the
  shelf: `Today.tsx` calls the same function, and a mood set in a café must not
  rewrite the plan you check on the train home.
- **The level a session ran at is stored and never shown.** `Session.focus` is
  only ever `'low'`, is frozen onto the draft at start beside `title` and
  `expected`, and is read by exactly one thing: `expectedTime`'s evidence
  gatherer, which skips it. A 90-minute slog in a loud room is not evidence
  that the work takes 90 minutes. ACTUALS are untouched — `loggedForNode` and
  every capacity figure count those minutes in full. The daily reset to
  `medium` is arithmetic over the stored date at hydrate (`focusLevelFor`), so
  nothing runs at midnight; a window left open across it keeps the level until
  it reloads, which is the deliberate cost of having no timer.
- **The shelf's card ends where its content does.** `shelfSizing` hugs on
  macOS, where the window behind it is transparent, and fills elsewhere, where
  it would leave a painted notch. `HEIGHT` in `electron/assistantWindow.cjs` is
  therefore a BUDGET — the guarantee that the tallest state fits without
  scrolling — and not the size of the pane. Still MEASURED at 620px wide, never
  derived. A click on the transparent remainder closes the shelf.
```

Also update the existing shelf bullet's mention of the measured heights: the numbers quoted there (136, 157, 90, 233) described states that no longer exist in that form. Replace that sentence with a pointer to the new rule rather than leaving stale measurements behind.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(assistant): the shelf's one job, and the dial that scopes it"
```

---

## Self-Review

**Spec coverage.** Every numbered decision in `docs/superpowers/specs/2026-08-14-assistant-shelf-focus-and-void-design.md` maps to a task: §1 → Task 2; §2 → Task 2 (Step 5); §3 → Task 8; §4 → Tasks 1 and 5; §5 → Tasks 1 and 6; §6 → Task 1 (`isCommitment`/`admits`) and Task 6; §7 → Task 1 (`fitsFocus`); §8 → Task 6 (`beyondFocus`) and Task 7 (the copy); §9 → Task 7 (`elapsedAgainstExpected`); §10 → Tasks 3, 4 and 5; §11 → Task 6 (the optional input); §12 → Task 7 (number keys, `autoFocus` for Enter). The spec's test list is distributed across the tasks that own each module.

**Known soft spots, called out rather than hidden.**
- Task 5's store suite gives structure and assertions but defers the seeding boilerplate to the harness the neighbouring `store.*.test.ts` files already use, because that harness must be copied exactly rather than reinvented. Read one before writing it.
- Task 3's fixtures assume the shape of `expectedTime.test.ts`'s existing helpers. Reuse them; the assertions are what matters.
- Task 8 Step 6 is a genuine measurement, not a placeholder: the spec forbids deriving this number, and `CLAUDE.md` records that deriving it was wrong by 20px last time.

**Type consistency.** `FocusLevel`, `FOCUS_CAP`, `FOCUS_WORD`, `FOCUS_LEVELS`, `DEFAULT_FOCUS_LEVEL`, `isFocusLevel`, `StoredFocusLevel`, `serializeFocusLevel`, `parseStoredFocusLevel`, `focusLevelFor`, `fitsFocus`, `isCommitment` and `admits` are named identically in Task 1's implementation, Task 5's store wiring, Task 6's advisor and Task 7's surface. `beyondFocus` is spelled the same in Task 6's type, Task 6's tests and Task 7's render. `shelfSizing` returns `'hug' | 'fill'` in Task 8's helper and is consumed as those two strings in the overlay.
