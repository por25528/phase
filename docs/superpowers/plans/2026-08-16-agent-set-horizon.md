# `set_horizon` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent surface a verb that moves a project between the board's four commitment horizons, so an assistant driving Phase from a terminal can triage work instead of only adding it.

**Architecture:** Three thin layers, no new store mutation. `horizons.ts` gains the word↔column vocabulary; `agentProtocol.ts` validates it at the seam (in the renderer, which is the first side that may import from `src/`); `agentWrites.ts` makes one call into `actions.moveGoalToColumn`, which already exists, already normalises the board through `setGoalBoard`, and already arms its own undo. `mcp/server.js` declares the shape for the model's benefit only.

**Tech Stack:** TypeScript, React 19, Vitest, Zod (in `mcp/server.js` only), Electron.

## Global Constraints

- **Scope is §1 of `docs/superpowers/specs/2026-08-16-agent-triage-and-term-design.md` ONLY.** §2 (the term) and §3 (the deadline/practice split) are deferred by the owner's decision of 16 August 2026. Do not add `termUntil`, `inTerm`, `isLive`, `Goal.kind` or `Goal.weeklyMin`.
- **A write is ONE call into the action the UI already calls.** No new store action, no second path to the data.
- **A refusal is never reported as success.** Where an action returns `void` and refuses silently, re-read the store and confirm; never mirror the action's own guard with a pre-check.
- **`persistFailed` is re-read after every mutation**, through the existing `settled` helper — in-memory state advances even when nothing reached IndexedDB.
- **The horizon argument is a WORD, never a column index.** `'now' | 'next' | 'later' | 'someday'`, lowercase, exact.
- **Do not re-implement the WIP cap.** `moveGoalToColumn` does not enforce `NOW_WIP_LIMIT`; the board's `4 of 6 focus slots used` is a readout, not a refusal.
- **Do not reuse `goalImport`'s `horizonFromWord`.** It carries legacy aliases whose meaning already changed once (`later` meant column 3 under the old scheme, column 2 under the new).
- **`electron/agentSocket.cjs` and `electron/agentIpc.cjs` are NOT touched.** They frame and relay; neither knows a verb by name, and both import nothing from `src/` by design. If a task seems to need an edit there, the design is wrong — stop and report.
- Run `npm test` and `npx tsc -b` before every commit (project convention, `CLAUDE.md`).
- Branch: `feat/agent-set-life` (already checked out). Do not create a new branch.

---

### Task 1: The horizon word vocabulary, and the seam that validates it

`horizons.ts` owns `HORIZON_LABELS` and is already imported by both the store and the agent layer, so the words and the columns they name cannot drift apart if they live together. `agentProtocol.ts` is where an untrusted request is checked.

**Files:**
- Modify: `src/lib/horizons.ts` (append after line 33)
- Create: `src/lib/horizons.test.ts`
- Modify: `src/lib/agentProtocol.ts` (union at lines 19-35, `AGENT_TOOLS` at lines 40-44, `validAgentRequest` switch at lines 80-121)
- Modify: `src/lib/agentProtocol.test.ts` (append a case before the closing `});` at line 56)

**Interfaces:**
- Consumes: `HORIZON_LABELS` (existing, `src/lib/horizons.ts:9`).
- Produces:
  - `type HorizonWord = 'now' | 'next' | 'later' | 'someday'`
  - `function isHorizonWord(value: unknown): value is HorizonWord`
  - `function columnOfHorizonWord(word: HorizonWord): number`
  - `AgentRequest` member `{ tool: 'set_horizon'; goalId: string; horizon: HorizonWord }`

- [ ] **Step 1: Write the failing test for the vocabulary**

Create `src/lib/horizons.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  HORIZON_LABELS,
  isHorizonWord,
  columnOfHorizonWord,
  isPlanningHorizon,
} from './horizons';

describe('horizon words', () => {
  it('names every label, and nothing else', () => {
    for (const label of HORIZON_LABELS) {
      expect(isHorizonWord(label.toLowerCase())).toBe(true);
    }
    expect(isHorizonWord('archived')).toBe(false);
    expect(isHorizonWord('')).toBe(false);
  });

  /*
   * Case-SENSITIVE, unlike `set_life`'s name matching. A life title is
   * something a person typed and may capitalise however they like; a horizon
   * word is an enum on a wire protocol, and `mcp/server.js` already constrains
   * it with `z.enum`. Accepting 'Now' would be inventing a second spelling of
   * a value that has exactly one.
   */
  it('does not accept a capitalised word', () => {
    expect(isHorizonWord('Now')).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isHorizonWord(0)).toBe(false);
    expect(isHorizonWord(undefined)).toBe(false);
  });

  it('maps each word to the column its label sits in', () => {
    expect(columnOfHorizonWord('now')).toBe(0);
    expect(columnOfHorizonWord('next')).toBe(1);
    expect(columnOfHorizonWord('later')).toBe(2);
    expect(columnOfHorizonWord('someday')).toBe(3);
  });

  it('agrees with isPlanningHorizon about which words the calendar plans from', () => {
    expect(isPlanningHorizon(columnOfHorizonWord('now'))).toBe(true);
    expect(isPlanningHorizon(columnOfHorizonWord('next'))).toBe(true);
    expect(isPlanningHorizon(columnOfHorizonWord('later'))).toBe(false);
    expect(isPlanningHorizon(columnOfHorizonWord('someday'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/horizons.test.ts`
Expected: FAIL — `isHorizonWord is not a function` (and a TS error that `isHorizonWord` / `columnOfHorizonWord` are not exported members).

- [ ] **Step 3: Implement the vocabulary**

Append to `src/lib/horizons.ts`, after `isPlanningHorizon` (line 33):

```ts
/**
 * The horizon words the agent surface speaks, derived from the labels so the
 * two cannot drift. `Lowercase<>` over `HORIZON_LABELS` means adding a fifth
 * horizon adds its word for free.
 */
export type HorizonWord = Lowercase<(typeof HORIZON_LABELS)[number]>;

/**
 * Exact, lowercase, and deliberately case-SENSITIVE — see the note in
 * `horizons.test.ts`. This is a wire value, not a title someone typed.
 */
export function isHorizonWord(value: unknown): value is HorizonWord {
  return typeof value === 'string' && HORIZON_LABELS.some((l) => l.toLowerCase() === value);
}

/**
 * The column a horizon word names.
 *
 * Deliberately NOT `goalImport`'s `horizonFromWord`: that parser carries
 * aliases from the old priority scheme, where `later` meant column 3 and now
 * means column 2. Round-tripping an export is `create_project`'s problem and
 * stays there; a new verb should not inherit a word whose meaning has already
 * changed once.
 */
export function columnOfHorizonWord(word: HorizonWord): number {
  return HORIZON_LABELS.findIndex((l) => l.toLowerCase() === word);
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run src/lib/horizons.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing protocol test**

In `src/lib/agentProtocol.test.ts`, insert before the closing `});` of the `validAgentRequest` describe block (currently line 56):

```ts
  it('accepts only the four lowercase words on set_horizon', () => {
    for (const horizon of ['now', 'next', 'later', 'someday']) {
      expect(validAgentRequest({ tool: 'set_horizon', goalId: 'g1', horizon })).toBe(true);
    }
    expect(validAgentRequest({ tool: 'set_horizon', goalId: 'g1', horizon: 'Now' })).toBe(false);
    expect(validAgentRequest({ tool: 'set_horizon', goalId: 'g1', horizon: 'archived' })).toBe(false);
    // A column index is what this verb exists NOT to take: it appears in no
    // read, so a model would have to guess it.
    expect(validAgentRequest({ tool: 'set_horizon', goalId: 'g1', horizon: 3 })).toBe(false);
    expect(validAgentRequest({ tool: 'set_horizon', horizon: 'now' })).toBe(false);
  });
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `npx vitest run src/lib/agentProtocol.test.ts`
Expected: FAIL — the four accept cases return `false`, because `validAgentRequest` falls through to `default: return false` for an unknown tool.

- [ ] **Step 7: Wire the protocol**

Three edits to `src/lib/agentProtocol.ts`.

First, extend the import at line 1-2:

```ts
import type { StepStatus } from '../db/types';
import type { WorkRef } from './expectedTime';
import { isHorizonWord, type HorizonWord } from './horizons';
```

Second, add to the `AgentRequest` union, immediately after the `set_life` member (line 30):

```ts
  | { tool: 'set_horizon'; goalId: string; horizon: HorizonWord }
```

Third, add `'set_horizon'` to `AGENT_TOOLS` (lines 40-44), after `'set_life'`:

```ts
export const AGENT_TOOLS = [
  'today', 'week', 'backlog', 'list_projects', 'get_project',
  'create_project', 'add_task', 'rename', 'estimate', 'set_status',
  'set_life', 'set_horizon', 'complete_task', 'schedule', 'delete', 'undo_last',
] as const;
```

Fourth, add the validation case in `validAgentRequest`, after the `set_life` case (which ends at line 110):

```ts
    case 'set_horizon':
      // A word, not a column: a column index is invisible from outside the app
      // and no read verb reports one, so an index-taking verb would be
      // unusable without a second one beside it. `list_projects` already
      // answers in these words.
      return id(req.goalId) && isHorizonWord(req.horizon);
```

- [ ] **Step 8: Run both test files to verify they pass**

Run: `npx vitest run src/lib/horizons.test.ts src/lib/agentProtocol.test.ts`
Expected: PASS — 5 tests in `horizons.test.ts`, 9 in `agentProtocol.test.ts`.

- [ ] **Step 9: Typecheck**

Run: `npx tsc -b`
Expected: no output, exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/lib/horizons.ts src/lib/horizons.test.ts src/lib/agentProtocol.ts src/lib/agentProtocol.test.ts
git commit -m "feat(agent): the horizon words, and the seam that checks them

A word and not a column index, for the reason set_life takes a life by
name: a column number appears in no read verb, so a model would have to
guess it. Derived from HORIZON_LABELS with Lowercase<> so the words and
the columns they name cannot drift.

Deliberately not goalImport's horizonFromWord — that parser carries
aliases from the old priority scheme, where 'later' meant a different
column than it means now."
```

---

### Task 2: The handler

One call into `actions.moveGoalToColumn`, which exists at `src/state/store.ts:1642`. It routes through `setGoalBoard` (so column-major order and `weaveHidden` hold), and it already calls `scheduleUndo` with `Moved "X" to Later` and a full `goals` snapshot — so undo comes free and `undo_last` reaches it.

**Files:**
- Modify: `src/lib/agentWrites.ts` (import at line 1-9; new `case` in the switch, after the `set_life` case which ends around line 262)
- Modify: `src/lib/agentWrites.test.ts` (harness spies around lines 78-102; new `describe` block after the `set_life` block, which ends around line 310)

**Interfaces:**
- Consumes: `columnOfHorizonWord`, `HORIZON_LABELS` (Task 1 / existing); `project(state, goalId): Found<Goal>` (existing, `src/lib/agentWrites.ts:70`); `failed(result)` (existing, line 54); `settled(data)` (existing, line 122); `actions.moveGoalToColumn(goalId: string, column: number): void`.
- Produces: response data shape `{ goalId: string; horizon: string; moved: boolean; nowCount: number }`.

- [ ] **Step 1: Add a default spy for `moveGoalToColumn` to the harness**

In `src/lib/agentWrites.test.ts`, inside the `spies` object, immediately after the `setGoalLife` spy (which ends at line 91 with `}),`):

```ts
    /*
     * A SIMPLIFICATION of the real action, and deliberately so: the real one
     * also re-ranks the target column through `setGoalBoard`. The handler
     * reads only `column`, so modelling the rank here would test the fixture.
     * It DOES model the early return, because "already there" is a case the
     * handler has to answer for.
     */
    moveGoalToColumn: vi.fn((goalId: string, column: number) => {
      patch({
        goals: current.goals.map((g) => {
          if (g.id !== goalId || (g.column ?? 0) === column) return g;
          return { ...g, column };
        }),
      });
    }),
```

- [ ] **Step 2: Write the failing tests**

In `src/lib/agentWrites.test.ts`, after the closing `});` of the `set_life` describe block:

```ts
describe('set_horizon', () => {
  it('moves a project, and answers in the board\'s own words', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite(
      { tool: 'set_horizon', goalId: 'g1', horizon: 'someday' },
      h.deps,
    );
    expect(h.spies.moveGoalToColumn).toHaveBeenCalledWith('g1', 3);
    expect(res).toEqual({
      ok: true,
      data: { goalId: 'g1', horizon: 'Someday', moved: true, nowCount: 0 },
    });
  });

  /*
   * `moveGoalToColumn` returns early when the goal is already in the
   * requested horizon — deliberately, so a no-op cannot arm an undo that
   * displaces a real one. The postcondition the caller asked for nevertheless
   * HOLDS, so this is `ok`. Rule 1 forbids reporting a failed WRITE as
   * success; it does not forbid reporting an already-true STATE as true.
   */
  it('is a no-op and not a refusal when the project is already there', () => {
    const h = harness({ goals: [GOAL({ column: 3 })] });
    const res = handleAgentWrite(
      { tool: 'set_horizon', goalId: 'g1', horizon: 'someday' },
      h.deps,
    );
    expect(h.spies.moveGoalToColumn).toHaveBeenCalledWith('g1', 3);
    expect(res).toEqual({
      ok: true,
      data: { goalId: 'g1', horizon: 'Someday', moved: false, nowCount: 0 },
    });
  });

  it('treats an absent column as Now', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite(
      { tool: 'set_horizon', goalId: 'g1', horizon: 'now' },
      h.deps,
    );
    expect(res).toEqual({
      ok: true,
      data: { goalId: 'g1', horizon: 'Now', moved: false, nowCount: 1 },
    });
  });

  /*
   * The cap is a READOUT on the board ("4 of 6 focus slots used"), not a
   * refusal — `moveGoalToColumn` does not check `NOW_WIP_LIMIT`. So this verb
   * does not either, and reports the resulting count instead, which is what
   * lets an agent say "that is seven in Now and the board shows six".
   */
  it('reports the resulting Now count rather than enforcing the cap', () => {
    const h = harness({
      goals: [
        GOAL({ id: 'g1', column: 3 }),
        GOAL({ id: 'g2', column: 0 }),
        GOAL({ id: 'g3', column: 0 }),
        GOAL({ id: 'g4', column: 0, completedAt: '2026-08-01' }),
      ],
    });
    const res = handleAgentWrite(
      { tool: 'set_horizon', goalId: 'g1', horizon: 'now' },
      h.deps,
    );
    // g1 joins g2 and g3. The archived g4 is not a focus slot.
    expect(res).toEqual({
      ok: true,
      data: { goalId: 'g1', horizon: 'Now', moved: true, nowCount: 3 },
    });
  });

  it('refuses a project that is not there', () => {
    const h = harness({ goals: [GOAL()] });
    const res = handleAgentWrite(
      { tool: 'set_horizon', goalId: 'nope', horizon: 'now' },
      h.deps,
    );
    expect(h.spies.moveGoalToColumn).not.toHaveBeenCalled();
    expect(errorOf(res)).toBe('No project with id "nope".');
  });

  it('refuses a completed project rather than moving it', () => {
    const h = harness({ goals: [GOAL({ completedAt: '2026-08-01' })] });
    const res = handleAgentWrite(
      { tool: 'set_horizon', goalId: 'g1', horizon: 'now' },
      h.deps,
    );
    expect(h.spies.moveGoalToColumn).not.toHaveBeenCalled();
    expect(errorOf(res)).toBe('"Thesis" is a completed project — reopen it in Phase first.');
  });

  it('reports a refusal when the store silently declined to write', () => {
    const h = harness({
      goals: [GOAL()],
      actions: { moveGoalToColumn: vi.fn() },
    });
    const res = handleAgentWrite(
      { tool: 'set_horizon', goalId: 'g1', horizon: 'someday' },
      h.deps,
    );
    expect(errorOf(res)).toBe('"Thesis" did not move to Someday.');
  });

  it('reports persistFailed even though the move landed in memory', () => {
    const h = harness({ goals: [GOAL()], state: { persistFailed: true } });
    const res = handleAgentWrite(
      { tool: 'set_horizon', goalId: 'g1', horizon: 'someday' },
      h.deps,
    );
    expect(h.spies.moveGoalToColumn).toHaveBeenCalledWith('g1', 3);
    expect(errorOf(res)).toContain('could not be saved');
  });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `npx vitest run src/lib/agentWrites.test.ts -t set_horizon`
Expected: FAIL, 8 tests — each returning `{ ok: false, error: '"set_horizon" is not a write.' }` from the switch's `default`.

- [ ] **Step 4: Implement the handler**

First extend the imports at the top of `src/lib/agentWrites.ts`:

```ts
import { columnOfHorizonWord, HORIZON_LABELS } from './horizons';
```

Then add the case, after the `set_life` case and before `case 'complete_task'`:

```ts
    case 'set_horizon': {
      const owner = project(state, request.goalId);
      if (failed(owner)) return errorResponse(owner.error);
      const target = columnOfHorizonWord(request.horizon);
      const before = owner.found.column ?? 0;
      actions.moveGoalToColumn(request.goalId, target);
      /*
       * Rule 2: `moveGoalToColumn` returns void and refuses SILENTLY — on a
       * goal it cannot find, and on the horizon the goal is already in. Re-read
       * rather than mirror its guard.
       *
       * The already-there case passes this check by construction: nothing
       * moved, but `before === target`, so the postcondition holds and `moved`
       * carries the distinction instead of an error doing it.
       */
      const after = getState().goals.find((g) => g.id === request.goalId);
      if ((after?.column ?? 0) !== target) {
        return errorResponse(`"${owner.found.title}" did not move to ${HORIZON_LABELS[target]}.`);
      }
      // The cap is a readout, not a refusal — `moveGoalToColumn` does not check
      // `NOW_WIP_LIMIT` and neither does this. Saying what Now now holds is the
      // difference between an agent that overfills it in silence and one that
      // can tell its owner it just did.
      const nowCount = getState().goals
        .filter((g) => !g.completedAt && (g.column ?? 0) === 0).length;
      return settled({
        goalId: request.goalId,
        horizon: HORIZON_LABELS[target],
        moved: before !== target,
        nowCount,
      });
    }
```

- [ ] **Step 5: Run them to verify they pass**

Run: `npx vitest run src/lib/agentWrites.test.ts -t set_horizon`
Expected: PASS, 8 tests.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm test && npx tsc -b`
Expected: all tests pass; `tsc -b` silent, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/agentWrites.ts src/lib/agentWrites.test.ts
git commit -m "feat(agent): set_horizon moves a project between horizons

One call into moveGoalToColumn, which already routes through setGoalBoard
and already arms 'Moved \"X\" to Later' with a whole-slice snapshot — so
column-major order, weaveHidden and undo_last all come free.

Already-in-that-horizon answers ok with moved:false, not an error. Rule 1
forbids reporting a failed WRITE as success; the postcondition the caller
asked for does hold, and the store's early return exists so a no-op cannot
displace a real undo entry.

The WIP cap is reported, never enforced: moveGoalToColumn does not check
NOW_WIP_LIMIT, the board's '4 of 6' is a readout, and a verb that refused
where a drag succeeds would be a second opinion about one rule. nowCount
costs one filter and is what lets an agent name an over-full board."
```

---

### Task 3: Declare it to the model, and document it

`mcp/server.js` runs in a separate process and imports nothing from `src/`. Its schemas are for the model's benefit only — `validAgentRequest` in the renderer is the validation, which is why this task has no unit test and ends in a real smoke test instead.

This task also repairs an existing gap: `set_life` shipped in `b1877fa` without reaching `docs/mcp-server.md`, so the writes table is one verb behind. Two rows, same table, same edit.

**Files:**
- Modify: `mcp/server.js` (the `WRITES` object, lines 109-153 — insert after the `set_life` entry at lines 134-137)
- Modify: `docs/mcp-server.md` (the writes table, lines 81-90)

**Interfaces:**
- Consumes: the `AGENT_TOOLS` name `'set_horizon'` and the four words from Task 1.
- Produces: nothing consumed by later tasks — this is the last one.

- [ ] **Step 1: Declare the tool**

In `mcp/server.js`, inside `WRITES`, immediately after the `set_life` entry:

```js
  set_horizon: [
    'Move a project between the board\'s four commitment horizons. "now" is what you are actively working on, "next" is queued, "later" and "someday" are parked — the calendar rail and the daily suggestions only draw from now and next. Answers with how many projects Now holds afterwards.',
    { goalId: z.string(), horizon: z.enum(['now', 'next', 'later', 'someday']) },
  ],
```

- [ ] **Step 2: Document both missing verbs**

In `docs/mcp-server.md`, in the writes table, add two rows after the `set_status` row (line 87):

```markdown
| `set_life` | `goalId`, `life` (or `null`) | `setGoalLife` | By NAME, not id — naming one that does not exist answers with the ones that do |
| `set_horizon` | `goalId`, `horizon` | `moveGoalToColumn` | `now`/`next`/`later`/`someday`; returns `nowCount`, and never enforces the WIP cap the board only reports |
```

- [ ] **Step 3: Verify the tool list is complete and consistent**

Run:

```bash
node -e "const s=require('fs').readFileSync('mcp/server.js','utf8'); const p=require('fs').readFileSync('src/lib/agentProtocol.ts','utf8'); const d=require('fs').readFileSync('docs/mcp-server.md','utf8'); for (const t of ['set_life','set_horizon']) console.log(t, {server:s.includes(t+':'), protocol:p.includes(\"'\"+t+\"'\"), docs:d.includes('\`'+t+'\`')});"
```

Expected:
```
set_life { server: true, protocol: true, docs: true }
set_horizon { server: true, protocol: true, docs: true }
```

- [ ] **Step 4: Full suite and typecheck**

Run: `npm test && npx tsc -b`
Expected: all tests pass; `tsc -b` silent, exit 0.

- [ ] **Step 5: Commit**

```bash
git add mcp/server.js docs/mcp-server.md
git commit -m "feat(agent): declare set_horizon, and document the two missing verbs

The schema is for the model's benefit only — validAgentRequest in the
renderer is the validation, because a socket is not a trusted caller.

set_life shipped in b1877fa without reaching the writes table, so the doc
was already a verb behind. Both rows land together."
```

- [ ] **Step 6: Rebuild the app — this is required, not optional**

`validAgentRequest` runs in the RENDERER. A tool advertised by `mcp/server.js` alone reaches an old bundle that rejects it as an unknown verb, and the failure looks like a broken socket rather than a stale build.

Run: `npm run build:mac`

Then quit Phase gracefully (⌘Q — do not force-kill; the Web Lock and a pending write both want a clean exit) and replace the installed app with the freshly built one from `dist/`. App data lives outside the bundle and is not affected.

- [ ] **Step 7: Smoke-test against the real app**

With Phase running and the MCP connected, in a Claude Code session:

1. Call `list_projects`. Note a project's `id` and its `horizon`.
2. Call `set_horizon` with that `goalId` and a different word.
3. Expect `{"ok":true,"data":{"goalId":"…","horizon":"…","moved":true,"nowCount":N}}`.
4. Watch the app: the card moves columns and a toast reads `Moved "…" to …` with an Undo button.
5. Call `set_horizon` again with the SAME word. Expect `moved: false` and no toast.
6. Call `undo_last`. Expect `{"ok":true,"data":{"undone":"Moved \"…\" to …"}}` and the card returning to where it started.
7. Call `set_horizon` with `horizon: "archived"`. Expect the MCP layer to reject it against the `z.enum` before it ever reaches the socket.

- [ ] **Step 8: Do the thing the verb was built for**

Four calls, on the owner's real board — this is the acceptance test:

```
set_horizon 39hj3pd someday   # Boot.dev — Backend Developer Path, out of Now
set_horizon j388ous now       # Midterm — 2301286 PROB/STAT   (due Sep 24)
set_horizon k3um0e8 now       # Midterm — 2900111 ECONOMICS I (due Sep 22)
set_horizon 0cda9ld now       # Midterm — 3404117 INTRO TO LAW (due Sep 25)
set_horizon 5ph66d5 next      # Midterm — 0299004 DATA ANLYS  (due Sep 25)
```

Expected: no exam left in Someday, and `nowCount` reported on each call so the six-slot board can be seen filling. `5ph66d5` goes to `next` deliberately — seven exams do not fit in six slots, and the cap doing its job visibly is the correct outcome, not a bug to route around.

---

## Notes for the implementer

**Do not "fix" these — they are decisions, and each has a comment saying so:**

- `moveGoalToColumn` clamps its column and returns early when the goal is already in the target. Both are load-bearing; the early return is why a no-op cannot displace a live undo entry.
- The handler does not pre-check whether the goal exists before calling the action. That is rule 2: mirroring an action's guard drifts the first time the guard moves.
- `isHorizonWord` rejects `'Now'`. Case-insensitivity belongs to `set_life`, where the value is a title a person typed.
- `set_horizon` arms no undo of its own. `moveGoalToColumn` already arms one, and adding a second would be two entries for one write.

**If a step's expectation does not match reality, stop and report it rather than adapting the code to fit the plan.** The likeliest place is Task 2 Step 3's failure message, which depends on the exact wording of the `default` branch at `src/lib/agentWrites.ts:374`.
