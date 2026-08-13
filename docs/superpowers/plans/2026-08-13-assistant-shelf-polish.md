# Assistant Shelf Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the floating assistant shelf the app's own button vocabulary, a status line that stops inviting you to start a session you are already in, and a frame that fits its window.

**Architecture:** Four independent changes to an existing, working surface. `AssistantSurface.tsx` is one file rendered in two places — the in-app panel (`AssistantHost`, 380px) and the Electron overlay (`AssistantOverlay`, 620px) — so every change here lands in both. A new pure helper goes in `src/lib/assistantProtocol.ts` beside the one it corrects. One constant changes in `electron/assistantWindow.cjs`. No store, no IPC, no layout, no new actions.

**Tech Stack:** React 19 + TypeScript + Tailwind + Vitest (jsdom via `// @vitest-environment jsdom`) + Testing Library. Electron shell tested as plain Node modules.

**Spec:** `docs/superpowers/specs/2026-08-13-assistant-shelf-polish-design.md`

## Global Constraints

- **No literal hex colours, no arbitrary `text-[Nrem]`.** `src/designScale.test.ts` fails the build on either. Every colour and size comes from a theme token.
- **Visual identity is locked.** Do not restyle anything the spec does not name.
- **Type sizes come from the `fontSize` scale** in `tailwind.config.js` (`meta`, `ui`, `body`, `h2`, …). Never invent one.
- **`src/lib` logic ships with a sibling `*.test.ts`.**
- **Run `npm test` and `npx tsc -b` before committing.** Both must pass.
- **Nothing in `src/assistant/**` or anything it imports may reach `src/state/`, `src/db/` or `App.tsx` at runtime.** `src/assistant/entryBoundary.test.ts` walks the real module graph and fails the build otherwise. Type-only imports are exempt.
- **The shelf's controls are `dialogStyles` exports**, never hand-rolled class lists.
- **The dash in a range is an en-dash `–`**, matching `expectedTimeLabel`'s existing `45–60m`.
- **The ellipsis in the placeholder is the single character `…`**, not three dots.
- Commit messages follow the repo's form: `type(scope): lowercase imperative summary`, e.g. `fix(assistant): state progress on a running session`.

---

### Task 1: `elapsedAgainstExpected` — the running-session phrasing

`expectedTimeLabel` returns "Start with 30m" for `kind: 'starter'`. That is an invitation to begin, correct on `AdvicePanel` where work has not started, and wrong on `FocusPanel` where it has. This task adds the running-session counterpart. It does not wire it up — Task 2 does that — so this task is pure logic with a test and nothing on screen changes.

**Files:**
- Create: `src/lib/assistantProtocol.test.ts`
- Modify: `src/lib/assistantProtocol.ts`

**Interfaces:**
- Consumes: `ExpectedTime` from `src/lib/expectedTime.ts` (already imported as a type in `assistantProtocol.ts`); `fmtMinutes` from `src/lib/effort.ts`.
- Produces: `elapsedAgainstExpected(elapsedMin: number, expected: ExpectedTime): string`, consumed by Task 2.

**Background the implementer needs:**

`ExpectedTime` is a discriminated union with three arms. The existing `expectedTimeLabel` at the bottom of `assistantProtocol.ts` shows all three:

```ts
case 'history':  return `Usually ${expected.lowMin}–${expected.highMin}m`;
case 'estimate': return `Planned ${expected.minutes}m`;
case 'starter':  return `Start with ${expected.minutes}m`;
```

So `history` carries `lowMin`/`highMin`; `estimate` and `starter` both carry `minutes`.

`fmtMinutes` (in `src/lib/effort.ts:82`) turns minutes into `0m` / `45m` / `1h 30m` / `3h`. Use it for the **elapsed** side, because that is what the shelf already uses for elapsed time and for the `Log 3h 20m` button. Use the **raw** `${...}m` form for the expected side, because that is what `expectedTimeLabel` uses and the two functions must not disagree about how an expectation is spelled. `3h 20m of 30m` is the correct reading of a session that overran.

`assistantProtocol.ts` already imports `ExpectedTime` as a type. Adding a runtime import of `fmtMinutes` is safe for the overlay boundary: `AssistantSurface.tsx` already imports `fmtMinutes` from `../../lib/effort`, so `effort.ts` is in the overlay's module graph today and `entryBoundary.test.ts` passes.

- [ ] **Step 1: Write the failing test**

Create `src/lib/assistantProtocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { elapsedAgainstExpected, expectedTimeLabel } from './assistantProtocol';

describe('expectedTimeLabel', () => {
  it('speaks a range as a range, a plan as a plan, and a starter as an invitation', () => {
    expect(expectedTimeLabel({
      kind: 'history', lowMin: 45, highMin: 60, confidence: 'high', sampleCount: 6,
    })).toBe('Usually 45–60m');
    expect(expectedTimeLabel({ kind: 'estimate', minutes: 30 })).toBe('Planned 30m');
    expect(expectedTimeLabel({ kind: 'starter', minutes: 30 })).toBe('Start with 30m');
  });
});

describe('elapsedAgainstExpected', () => {
  it('states progress rather than inviting a start', () => {
    expect(elapsedAgainstExpected(0, { kind: 'starter', minutes: 30 })).toBe('0m of 30m');
    expect(elapsedAgainstExpected(5, { kind: 'estimate', minutes: 30 })).toBe('5m of 30m');
  });

  it('keeps a range a range', () => {
    expect(elapsedAgainstExpected(12, {
      kind: 'history', lowMin: 45, highMin: 60, confidence: 'high', sampleCount: 6,
    })).toBe('12m of 45–60m');
  });

  it('spells the elapsed side the way the rest of the shelf does', () => {
    // fmtMinutes, so it matches "Log 3h 20m" on the confirmation button. The
    // expected side stays raw minutes, so it matches expectedTimeLabel.
    expect(elapsedAgainstExpected(200, { kind: 'starter', minutes: 30 })).toBe('3h 20m of 30m');
    expect(elapsedAgainstExpected(90, { kind: 'estimate', minutes: 90 })).toBe('1h 30m of 90m');
  });

  it('never invites a start once a session is under way', () => {
    for (const expected of [
      { kind: 'starter', minutes: 30 },
      { kind: 'estimate', minutes: 30 },
      { kind: 'history', lowMin: 45, highMin: 60, confidence: 'high', sampleCount: 6 },
    ] as const) {
      expect(elapsedAgainstExpected(0, expected)).not.toMatch(/start/i);
      expect(elapsedAgainstExpected(0, expected)).not.toMatch(/planned/i);
      expect(elapsedAgainstExpected(0, expected)).not.toMatch(/usually/i);
    }
  });
});
```

Two things about `ExpectedTime` (declared at `src/lib/expectedTime.ts:34`) that the test above depends on: the `history` arm requires `confidence` and `sampleCount` as well as the two bounds, and the `starter` arm's `minutes` is typed as the **literal** `30`, not `number` — so `{ kind: 'starter', minutes: 45 }` will not typecheck. Every starter in these tests is 30 for that reason.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run --config vitest.config.ts src/lib/assistantProtocol.test.ts`

Expected: FAIL. The `expectedTimeLabel` block passes; every `elapsedAgainstExpected` test fails at import with a message naming `elapsedAgainstExpected` as not exported.

- [ ] **Step 3: Add the helper**

In `src/lib/assistantProtocol.ts`, add the runtime import at the top, after the existing type imports:

```ts
import { fmtMinutes } from './effort';
```

Then append below `expectedTimeLabel`:

```ts
/**
 * The same expectation, restated for a session already under way.
 *
 * `expectedTimeLabel` is written as an INVITATION — "Start with 30m" — which is
 * right on work that has not begun and wrong the moment it has: a paused
 * session read `0m worked · on a break · Start with 30m`, inviting you to begin
 * the thing you were already doing. This states progress instead. The range
 * survives as a range, because "12m of 45–60m" is the only honest thing to say
 * about a session whose evidence is a range.
 *
 * The elapsed side is `fmtMinutes` and the expected side is raw minutes. That
 * looks mixed and is deliberate: each half is spelled the way the surface
 * already spells it — `Log 3h 20m` on one, `Planned 30m` on the other — so
 * neither this function nor `expectedTimeLabel` can drift from the button
 * beside it.
 */
export function elapsedAgainstExpected(elapsedMin: number, expected: ExpectedTime): string {
  const done = fmtMinutes(elapsedMin);
  return expected.kind === 'history'
    ? `${done} of ${expected.lowMin}–${expected.highMin}m`
    : `${done} of ${expected.minutes}m`;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run --config vitest.config.ts src/lib/assistantProtocol.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Confirm the overlay boundary still holds**

Run: `npx vitest run --config vitest.config.ts src/assistant/entryBoundary.test.ts`

Expected: PASS. This proves the new `./effort` import did not drag `src/db/` or `src/state/` into the overlay's graph.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -b
git add src/lib/assistantProtocol.ts src/lib/assistantProtocol.test.ts
git commit -m "feat(assistant): phrase an expectation for a session under way"
```

---

### Task 2: The running session states progress

Wire Task 1's helper into `FocusPanel` and add the assertion whose absence let the defect ship.

**Files:**
- Modify: `src/components/assistant/AssistantSurface.tsx:176-186` (the `info` block inside `FocusPanel`)
- Modify: `src/components/assistant/AssistantSurface.test.tsx`

**Interfaces:**
- Consumes: `elapsedAgainstExpected` from Task 1.
- Produces: nothing later tasks depend on.

**Background the implementer needs:**

`FocusPanel`'s `info` currently ends with:

```tsx
{focus.phase === 'confirming' ? (
  <p className="text-body text-ink">
    This session shows {fmtMinutes(focus.proposedMinutes ?? focus.elapsedMin)} — was that real work?
  </p>
) : (
  <p className="text-meta text-muted">
    {fmtMinutes(focus.elapsedMin)} worked
    {focus.phase === 'break' ? ' · on a break' : ''}
    {' · '}
    {expectedTimeLabel(focus.expected)}
  </p>
)}
```

Only the non-confirming branch changes. The `confirming` branch is already correct and is not touched.

`expectedTimeLabel` stays imported — `AdvicePanel` still uses it, and that use is correct.

Note that the JSX above renders as three text nodes, so the DOM text is `0m worked · on a break · Start with 30m`. Testing Library's `getByText` with a string matches against normalized text content of an element, so query the new line with a regex or an exact string on the `<p>`.

- [ ] **Step 1: Write the failing tests**

In `src/components/assistant/AssistantSurface.test.tsx`, add these two tests immediately after the existing `'offers Continue on a break and the confirmation pair while confirming'` test (which ends around line 272):

```tsx
  it('states progress on a running session instead of inviting a start', () => {
    render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', phase: 'break',
            elapsedMin: 0, expected: { kind: 'starter', minutes: 30 },
          },
        })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText('0m of 30m · On a break')).toBeTruthy();
    // The invitation belongs to work that has not started. This one has.
    expect(screen.queryByText(/Start with/)).toBeNull();
    expect(screen.queryByText(/worked/)).toBeNull();
  });

  it('drops the break clause once the session is active and keeps a range a range', () => {
    render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', phase: 'active',
            elapsedMin: 12,
            expected: { kind: 'history', lowMin: 45, highMin: 60, confidence: 'high', sampleCount: 6 },
          },
        })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText('12m of 45–60m')).toBeTruthy();
    expect(screen.queryByText(/break/i)).toBeNull();
  });
```

No new import is needed in the test file. These assert rendered text only — the surface does the formatting, and the test should not reach for `elapsedAgainstExpected` itself or it would be asserting the helper against itself rather than against the screen.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx`

Expected: FAIL on both new tests. The first reports it cannot find `0m of 30m · On a break` and the surrounding output shows the rendered `0m worked · on a break · Start with 30m`.

- [ ] **Step 3: Change the non-confirming branch**

In `src/components/assistant/AssistantSurface.tsx`, replace the `: (` branch shown above with:

```tsx
) : (
  <p className="text-meta text-muted">
    {elapsedAgainstExpected(focus.elapsedMin, focus.expected)}
    {focus.phase === 'break' ? ' · On a break' : ''}
  </p>
)}
```

Update the import on line 6 from:

```tsx
import { expectedTimeLabel } from '../../lib/assistantProtocol';
```

to:

```tsx
import { elapsedAgainstExpected, expectedTimeLabel } from '../../lib/assistantProtocol';
```

`expectedTimeLabel` is still used by `AdvicePanel`, so do not remove it.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx`

Expected: PASS, all tests in the file. In particular `'distinguishes history, planned estimate, and starter language'` must still pass — it asserts `Start with 30m` on an **advice** snapshot, which is correct and untouched.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b
git add src/components/assistant/AssistantSurface.tsx src/components/assistant/AssistantSurface.test.tsx
git commit -m "fix(assistant): state progress on a session already under way"
```

---

### Task 3: The shelf speaks the app's control vocabulary

Delete `quietButton`. Adopt `primaryBtn` / `secondaryBtn` / `ghostBtn` from `dialogStyles.ts`, give every state exactly one filled primary, and put it last.

**Files:**
- Modify: `src/components/assistant/AssistantSurface.tsx` (lines 51-53 `quietButton`, and every call site: `ProposalPanel`, `FocusPanel`, `AdvicePanel`, `OtherOptions`' children)
- Modify: `src/components/assistant/AssistantSurface.test.tsx`

**Interfaces:**
- Consumes: `primaryBtn`, `secondaryBtn`, `ghostBtn` from `src/components/dialogStyles.ts` (already exported; no changes there).
- Produces: nothing later tasks depend on.

**Background the implementer needs:**

`src/components/dialogStyles.ts` already exports the three variants and documents why each exists. Read its header comment before starting — it is an account of four dialogs having drifted into four button styles, which is exactly what the shelf did as a fifth. Do not modify that file.

- `primaryBtn` — filled `bg-ink text-paper`, semibold, already carries `disabled:opacity-40 disabled:pointer-events-none`.
- `secondaryBtn` — outlined `border border-line-2`.
- `ghostBtn` — borderless, `text-muted hover:bg-hover hover:text-ink`.

All three are 33px tall by construction (the file explains the arithmetic). The shelf's current `py-1.5` buttons are shorter, so controls will grow ~4px. That is expected and Task 4 absorbs it.

`dialogStyles.ts` has no imports at all, so it is safe for the overlay's module graph.

**The assignment, by state:**

| state | rendered order (left → right) |
| --- | --- |
| `active` | `secondaryBtn` Take break, `primaryBtn` Complete session |
| `break` | `secondaryBtn` Complete session, `primaryBtn` Continue |
| `confirming` | `ghostBtn` Didn't happen, `primaryBtn` Log *N*m |
| advice (`work`) | `primaryBtn` Start session |
| proposal | `ghostBtn` Cancel, `primaryBtn` Confirm |

The primary is last in every row, per `dialogFooter`'s stated rule that the commit button lands under the reading edge. The dismissive answers — "Didn't happen", "Cancel" — are `ghostBtn`, not outlined: a border on the *no* makes it compete with a real secondary action, and neither is one.

**Do not change any button's label.** All five labels stay exactly as they are; existing tests query by those names and they are correct.

The list-shaped buttons — `choose-subject` choices, and the alternatives inside `OtherOptions` in both `FocusPanel` and `AdvicePanel` — are **rows, not dialog buttons**. They get a local `optionRow` constant that preserves their current appearance.

- [ ] **Step 1: Write the failing tests**

In `src/components/assistant/AssistantSurface.test.tsx`, add this import at the top, after the existing imports:

```tsx
import { ghostBtn, primaryBtn, secondaryBtn } from '../dialogStyles';
```

Add these tests at the end of the `describe('AssistantSurface', …)` block, before its closing `});`:

```tsx
  it('gives an active session one filled primary, last, and an outlined partner', () => {
    render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', phase: 'active',
            elapsedMin: 25, expected: { kind: 'estimate', minutes: 45 },
          },
        })}
        onAction={() => {}}
      />,
    );
    const complete = screen.getByRole('button', { name: 'Complete session' });
    const pause = screen.getByRole('button', { name: 'Take break' });
    expect(complete.className).toBe(primaryBtn);
    expect(pause.className).toBe(secondaryBtn);
    // The commit button lands under the reading edge, per dialogFooter.
    expect([...complete.parentElement!.children].map((b) => b.textContent))
      .toEqual(['Take break', 'Complete session']);
  });

  it('moves the filled treatment to Continue on a break', () => {
    render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', phase: 'break',
            elapsedMin: 25, expected: { kind: 'starter', minutes: 30 },
          },
        })}
        onAction={() => {}}
      />,
    );
    const resume = screen.getByRole('button', { name: 'Continue' });
    expect(resume.className).toBe(primaryBtn);
    expect(screen.getByRole('button', { name: 'Complete session' }).className).toBe(secondaryBtn);
    expect([...resume.parentElement!.children].map((b) => b.textContent))
      .toEqual(['Complete session', 'Continue']);
  });

  it('leaves the dismissive answer borderless', () => {
    const { rerender } = render(
      <AssistantSurface
        snapshot={ready({
          activeFocus: {
            ref: { kind: 'step', id: 'n1', goalId: 'g1' },
            title: 'Problem set 4', phase: 'confirming',
            elapsedMin: 200, expected: { kind: 'starter', minutes: 30 },
            proposedMinutes: 200,
          },
        })}
        onAction={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Log 3h 20m' }).className).toBe(primaryBtn);
    expect(screen.getByRole('button', { name: "Didn't happen" }).className).toBe(ghostBtn);

    rerender(
      <AssistantSurface
        snapshot={ready({
          proposal: { kind: 'capture', id: 'p1', title: 'Lab report', goalId: null, date: null },
        })}
        onAction={() => {}}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm.className).toBe(primaryBtn);
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toBe(ghostBtn);
    expect([...confirm.parentElement!.children].map((b) => b.textContent))
      .toEqual(['Cancel', 'Confirm']);
  });

  it('starts a session on a filled primary', () => {
    render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    expect(screen.getByRole('button', { name: 'Start session' }).className).toBe(primaryBtn);
  });

  it('keeps a list of choices as rows rather than a fourth button variant', () => {
    render(
      <AssistantSurface
        snapshot={ready({
          proposal: {
            kind: 'choose-subject', id: 'p2', verb: 'complete',
            choices: [
              { ref: { kind: 'step', id: 'n1', goalId: 'g1' }, title: 'Lab report', goalTitle: 'Algorithms' },
              { ref: { kind: 'step', id: 'n2', goalId: 'g2' }, title: 'Lab report', goalTitle: 'Biology' },
            ],
          },
        })}
        onAction={() => {}}
      />,
    );
    for (const name of [/Algorithms/, /Biology/]) {
      const row = screen.getByRole('button', { name });
      expect(row.className).toContain('text-left');
      expect(row.className).not.toBe(primaryBtn);
      expect(row.className).not.toBe(secondaryBtn);
    }
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx`

Expected: FAIL on the five new tests, with class-name mismatches showing the current hand-rolled `rounded-field border border-line bg-panel px-3 py-1.5 …` where `primaryBtn` was expected, and the order assertions reporting `['Complete session', 'Take break']`.

- [ ] **Step 3: Replace `quietButton` with the shared vocabulary**

In `src/components/assistant/AssistantSurface.tsx`:

**3a.** Add the import after the existing `useReducedMotion` import:

```tsx
import { ghostBtn, primaryBtn, secondaryBtn } from '../dialogStyles';
```

**3b.** Delete the `quietButton` function (lines 51-53) and put this in its place:

```tsx
/**
 * A row in a list of choices — a subject to disambiguate, an alternative to
 * switch to. Deliberately NOT one of the three dialog variants: those three
 * answer "which of these commits", and a list of things to pick from is not a
 * commit at all. Left-aligned and full-width, because it is read as a row.
 */
const optionRow =
  'w-full rounded-field border border-line bg-panel px-3 py-1.5 text-left text-ui text-ink '
  + 'hover:bg-hover disabled:opacity-40 disabled:pointer-events-none';
```

**3c.** In `ProposalPanel`'s `choose-subject` branch, change the choice button's `className={quietButton('text-left')}` to `className={optionRow}`.

**3d.** In `ProposalPanel`'s commit row, swap the order and the variants. Replace the whole `<div className="mt-2 flex gap-2">` block with:

```tsx
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className={ghostBtn}
          onClick={() => onAction({ type: 'cancel-proposal' })}
        >
          Cancel
        </button>
        <button
          type="button"
          className={primaryBtn}
          onClick={() => onAction({ type: 'confirm-proposal', id: proposal.id })}
        >
          Confirm
        </button>
      </div>
```

**3e.** In `FocusPanel`, replace the whole `const actions = …` expression with:

```tsx
  // The filled button is whatever moves the session forward from where you
  // are: on a break you came back to resume, mid-session you came to finish,
  // and `confirming` is a question whose expected answer is yes. It sits last,
  // under the reading edge, exactly as dialogFooter puts a commit button last.
  const actions = focus.phase === 'confirming' ? (
    <div className="flex gap-2">
      <button
        type="button"
        className={ghostBtn}
        onClick={() => onAction({ type: 'confirm-focus', minutes: null })}
      >
        Didn&apos;t happen
      </button>
      <button
        type="button"
        className={primaryBtn}
        onClick={() => onAction({ type: 'confirm-focus', minutes: focus.proposedMinutes ?? focus.elapsedMin })}
      >
        Log {fmtMinutes(focus.proposedMinutes ?? focus.elapsedMin)}
      </button>
    </div>
  ) : focus.phase === 'active' ? (
    <div className="flex gap-2">
      <button type="button" className={secondaryBtn} onClick={() => onAction({ type: 'pause-focus' })}>
        Take break
      </button>
      <button
        type="button"
        className={primaryBtn}
        onClick={() => onAction({ type: 'complete-focus' })}
      >
        Complete session
      </button>
    </div>
  ) : (
    <div className="flex gap-2">
      <button
        type="button"
        className={secondaryBtn}
        onClick={() => onAction({ type: 'complete-focus' })}
      >
        Complete session
      </button>
      <button type="button" className={primaryBtn} onClick={() => onAction({ type: 'resume-focus' })}>
        Continue
      </button>
    </div>
  );
```

**3f.** In `FocusPanel`'s `OtherOptions` children, change `className={quietButton('text-left')}` to `className={optionRow}`.

**3g.** In `AdvicePanel`, change the Start session button's `className={quietButton('border-line-2 font-medium disabled:cursor-default disabled:opacity-60')}` to `className={primaryBtn}`. Drop the extra disabled classes entirely — `primaryBtn` already carries `disabled:opacity-40 disabled:pointer-events-none`, and `pointer-events-none` does the job `disabled:cursor-default` was reaching for.

**3h.** In `AdvicePanel`'s `OtherOptions` children, change `className={quietButton('text-left disabled:cursor-default disabled:opacity-60')}` to `className={optionRow}`.

**3i.** Confirm `quietButton` has no remaining references:

```bash
grep -n "quietButton" src/components/assistant/AssistantSurface.tsx
```

Expected: no output.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx`

Expected: PASS, every test in the file. The pre-existing tests that click by button name (`'exposes the approved verbs for an active session'`, `'offers Continue on a break …'`, `'requires an explicit Confirm on a proposal'`, `'gives every icon button an accessible name'`) must pass unchanged — no label moved.

- [ ] **Step 5: Run the neighbouring suites**

Run: `npx vitest run --config vitest.config.ts src/components/assistant src/designScale.test.ts src/assistant`

Expected: PASS. `AssistantHost.test.tsx:221` clicks `Complete session` by name and must still find it. `designScale.test.ts` must not object to `optionRow` — it contains no hex and no arbitrary `text-[…]`.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -b
git add src/components/assistant/AssistantSurface.tsx src/components/assistant/AssistantSurface.test.tsx
git commit -m "feat(assistant): give the shelf the app's button vocabulary"
```

---

### Task 4: The frame fits the window

Tighten the surface's own padding and bring the shelf window down to 190px.

**Files:**
- Modify: `src/components/assistant/AssistantSurface.tsx` (the `Skeleton` wrapper, and the root `<div>` of `AssistantSurface`)
- Modify: `electron/assistantWindow.cjs:6-10`
- Modify: `electron/assistantWindowController.test.ts` (eight `height: 200` values)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on. `HEIGHT` remains a module-private constant in `assistantWindow.cjs`; it is not exported.

**Background the implementer needs:**

The shelf window is fixed at 620×200 and cannot be resized — `resizable: false`, with `minHeight`/`maxHeight` both pinned. Content that exceeds it scrolls inside `AssistantSurface`'s `overflow-y-auto` body. Today the common focus-with-goal case leaves an empty band while the focus-with-alternatives case overflows; tightening the frame and shrinking the window is meant to leave every state fitting without a scrollbar.

**190 is provisional.** It comes from arithmetic against the type scale, not from measuring the running shelf. Task 5 measures it. If a state scrolls, the number moves — the constant serves the states, not the other way round.

Be careful with the numeral `200` in the controller test. Eight occurrences are the window height and change (lines 125, 128, 129, 187, 193, 223, 245, 291). These do **not** change: the cursor point `{ x: -100, y: 200 }` (lines 202, 221), and the work-area fixtures with `height: 957` / `height: 900` (lines 111, 186, 192, 204, 641). Do not use a blind find-and-replace.

The `assistantShelfBounds` cases keep their `x` and `y` — the height change does not move the panel, which is centred horizontally and pinned `TOP_GAP` below the menu bar.

- [ ] **Step 1: Update the Electron test to the new height**

In `electron/assistantWindowController.test.ts`, change `200` to `190` at exactly these eight sites:

- line 125 `height: 200,` → `height: 190,`
- line 128 `minHeight: 200,` → `minHeight: 190,`
- line 129 `maxHeight: 200,` → `maxHeight: 190,`
- line 187 `x: 446, y: 43, width: 620, height: 200,` → `… height: 190,`
- line 193 `x: -1030, y: 18, width: 620, height: 200,` → `… height: 190,`
- line 223 `{ x: -1030, y: 18, width: 620, height: 200 },` → `… height: 190 },`
- line 245 `{ x: 446, y: 18, width: 620, height: 200 },` → `… height: 190 },`
- line 291 `type: 'panel', width: 620, height: 200,` → `… height: 190,`

- [ ] **Step 2: Run the Electron tests and confirm they fail**

Run: `npx vitest run --config vitest.config.ts electron/assistantWindowController.test.ts`

Expected: FAIL, reporting received `200` against expected `190`.

- [ ] **Step 3: Change the constant and its reason**

In `electron/assistantWindow.cjs`, replace the comment and constant block (lines 6-10):

```js
// Compact and fixed: the shelf is 620 × 190 and never grows, so a long
// proposal list scrolls inside the pane instead of forming a tower under the
// shortcut.
//
// 190 is what the surface needs, not a round number: it is the tallest real
// state — a running session with its goal title and an "Other options" row —
// plus nothing. The window is unresizable, so this constant is the only thing
// standing between a state and a scrollbar; if a state grows, measure it and
// move the number rather than letting the pane scroll.
const WIDTH = 620
const HEIGHT = 190
const TOP_GAP = 18
```

- [ ] **Step 4: Run the Electron tests and confirm they pass**

Run: `npx vitest run --config vitest.config.ts electron/assistantWindowController.test.ts`

Expected: PASS.

- [ ] **Step 5: Tighten the surface's frame**

In `src/components/assistant/AssistantSurface.tsx`:

In `Skeleton`, change:

```tsx
<div role="status" aria-label="Preparing your next step" className="flex flex-col gap-3 p-4">
```

to:

```tsx
<div role="status" aria-label="Preparing your next step" className="flex flex-col gap-2 p-3">
```

In `AssistantSurface`'s returned root, change:

```tsx
<div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4">
```

to:

```tsx
<div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-3">
```

The loading and loaded states must use the same numbers, or the pane jumps when the snapshot arrives.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test`

Expected: PASS, whole suite.

Run: `npx tsc -b`

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/components/assistant/AssistantSurface.tsx electron/assistantWindow.cjs electron/assistantWindowController.test.ts
git commit -m "feat(shell): fit the shelf's frame to its window"
```

---

### Task 5: Confirm it against the real shelf, then write the rule down

Everything so far is arithmetic and jsdom. Neither can tell you whether a state scrolls at 190px on a real screen, and 190 was explicitly written down as provisional. This task is where it stops being provisional.

**Files:**
- Possibly modify: `electron/assistantWindow.cjs` and `electron/assistantWindowController.test.ts` (only if a state scrolls)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the shipped shelf from Tasks 1-4.
- Produces: nothing.

**Background the implementer needs:**

The shelf is a macOS `NSPanel` (`type: 'panel'` in `assistantWindowOptions`) and is **invisible to the usual accessibility tooling**. Probe it through the System Events AX window list instead. Launch with `npm run app:dev`, which runs the Electron shell against the Vite dev server, and summon the shelf with its configured shortcut.

- [ ] **Step 1: Launch the desktop shell**

Run: `npm run app:dev`

Expected: the main window opens against the dev server. Summon the shelf with its shortcut (default is shown in Settings → the assistant shortcut section).

- [ ] **Step 2: Walk the four states and look for a scrollbar**

Reach each of these and confirm nothing clips and no scrollbar appears in the body:

1. **Advice** — a recommendation with a goal title, and at least two alternatives so the "Other options" row renders.
2. **Active session** — start one; confirm `Take break` sits left of a filled `Complete session`, and the status line reads `Nm of Nm` with no "worked" and no "Start with".
3. **Break** — take a break; confirm the filled button is `Continue`, on the right, and the line ends `· On a break`.
4. **Zero state** — the "Nothing needs you right now" advice with its examples list, which is the tallest text state.

- [ ] **Step 3: If any state scrolls, move the number**

If a state clips or scrolls, raise `HEIGHT` in `electron/assistantWindow.cjs` to the smallest value that clears it, update the same eight sites in `electron/assistantWindowController.test.ts`, and note the measured state in the constant's comment. Then re-run `npx vitest run --config vitest.config.ts electron/assistantWindowController.test.ts` and repeat Step 2.

If nothing scrolls, change nothing and continue.

- [ ] **Step 4: Record the rule in CLAUDE.md**

The repo keeps its decisions in `CLAUDE.md`'s **Invariants** section, and the assistant shelf has no entry there at all — which is part of why it drifted into its own button style. Add this paragraph to the end of that section:

```markdown
- **The assistant shelf speaks `dialogStyles`, and its primary is whatever moves the session forward.** `AssistantSurface` renders in two places — the in-app panel and the Electron overlay — and it used to hand-roll a `quietButton` whose "primary" was a one-shade border difference, which is how two equal-weight buttons came to offer "end this session" and "resume it" with no hierarchy between them. It now uses `primaryBtn`/`secondaryBtn`/`ghostBtn`, one filled button per state, placed LAST per `dialogFooter`'s reading-edge rule. Which button is filled depends on the phase — `break` fills Continue, `active` fills Complete session — so "Complete session" changes side between the two. That is deliberate: the states are mutually exclusive and the filled button is always the reason you summoned the shelf. The dismissive answers ("Didn't happen", "Cancel") are `ghostBtn`, never outlined, so they cannot be mistaken for a secondary action. `optionRow` is NOT a fourth variant — it is a row in a list of choices, and a list is not a commit. Copy splits the same way: `expectedTimeLabel` is the INVITATION and belongs to work that has not started, `elapsedAgainstExpected` is the progress readout and belongs to a session under way. Using the first on a running session is what made a paused shelf read `0m worked · on a break · Start with 30m`.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(assistant): record the shelf's control and copy rules"
```

If Step 3 moved the height, commit that separately first:

```bash
git add electron/assistantWindow.cjs electron/assistantWindowController.test.ts
git commit -m "fix(shell): raise the shelf to the measured height"
```

---

## Done when

- `npm test` and `npx tsc -b` both pass.
- The shelf has exactly one filled button per state, and it is the rightmost.
- A running session reads `0m of 30m · On a break`, never `Start with 30m`.
- `grep -n "quietButton" src/` returns nothing.
- No state scrolls in the real 620×190 panel, confirmed by eye rather than by arithmetic.
