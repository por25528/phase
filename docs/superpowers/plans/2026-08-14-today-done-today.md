# Today: Done Today — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today grows a final section listing what was finished today, replacing the one stranded grey sentence that is currently the whole record of a day's work.

**Architecture:** One new pure function in `src/lib/actuals.ts` (`loggedForItemOn`) so a finished row can state what the work cost. `Today.tsx` renders `sections.completedToday` — already computed by `buildDailyWork` and currently discarded except for its `.length` — as a final section, and deletes the sentence it replaces. No store changes: un-ticking already takes a no-undo branch in both `toggleTask` and `toggleLeaf`.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, Vitest + @testing-library/react (jsdom).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-14-today-done-today-design.md`
- Run `npm test` and `npx tsc -b` before every commit.
- Pure logic goes in `src/lib` with a sibling `*.test.ts`. Views stay thin and delegate to `actions`.
- No literal hex colours, no arbitrary `text-[Nrem]` — `designScale.test.ts` fails the build on both.
- A section label is exactly `px-[8px] text-meta font-semibold text-muted`, sentence case — matching the four headings already on this page.
- **No store changes.** If a task appears to need one, stop and report; the spec's claim is that this section is a new reader of existing behaviour.
- **No completion timestamp.** `doneAt` is a date. Do not add a time field, and do not sort chronologically.
- Visual identity is locked. Do not restyle anything this plan does not name.
- `git add` only the files each task names. This repo has untracked `docs/research/` and may carry another session's uncommitted work — never `git add -A`, never `git commit -a`, never switch or create branches.

---

### Task 1: `loggedForItemOn`

**Files:**
- Modify: `src/lib/actuals.ts`
- Test: `src/lib/actuals.test.ts`

**Interfaces:**
- Consumes: `Session` from `../db/types`.
- Produces: `loggedForItemOn(sessions: Session[], item: { kind: 'task' | 'step'; id: string }, date: string): number`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/actuals.test.ts`:

```ts
describe('loggedForItemOn', () => {
  const step = { kind: 'step' as const, id: 'n1' };
  const task = { kind: 'task' as const, id: 't1' };

  it('sums only the sessions logged on that date', () => {
    const sessions = [
      session({ id: 'a', nodeId: 'n1', date: '2026-07-28', minutes: 30 }),
      session({ id: 'b', nodeId: 'n1', date: '2026-07-28', minutes: 15 }),
      session({ id: 'c', nodeId: 'n1', date: '2026-07-27', minutes: 90 }),
    ];
    expect(loggedForItemOn(sessions, step, '2026-07-28')).toBe(45);
  });

  it('counts a task session that carries no nodeId', () => {
    const sessions = [session({ id: 'a', taskId: 't1', date: '2026-07-28', minutes: 20 })];
    expect(loggedForItemOn(sessions, task, '2026-07-28')).toBe(20);
  });

  /**
   * The two ids are documented as mutually exclusive and `logSession` writes
   * only one, but `importStateFromFile` does not sanitise sessions. Without the
   * precedence rule a hand-edited backup would charge the same minutes twice.
   */
  it('charges a session carrying both ids to the node only', () => {
    const sessions = [
      session({ id: 'a', nodeId: 'n1', taskId: 't1', date: '2026-07-28', minutes: 60 }),
    ];
    expect(loggedForItemOn(sessions, step, '2026-07-28')).toBe(60);
    expect(loggedForItemOn(sessions, task, '2026-07-28')).toBe(0);
  });

  it('is zero when nothing was logged, or nothing on that day', () => {
    expect(loggedForItemOn([], step, '2026-07-28')).toBe(0);
    expect(loggedForItemOn(
      [session({ id: 'a', nodeId: 'n1', date: '2026-07-01', minutes: 60 })],
      step,
      '2026-07-28',
    )).toBe(0);
  });
});
```

Add `loggedForItemOn` to the existing import block at the top of the file (currently `loggedForNode, loggedForTask, compareEstimate, projectCalibration, weekEffort, describeCalibration, MIN_CALIBRATION_SAMPLES`):

```ts
import {
  loggedForNode, loggedForTask, loggedForItemOn, compareEstimate, projectCalibration,
  weekEffort, describeCalibration, MIN_CALIBRATION_SAMPLES,
} from './actuals';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/actuals.test.ts`
Expected: FAIL — `loggedForItemOn is not a function`.

- [ ] **Step 3: Implement it**

Append to `src/lib/actuals.ts`, after `loggedForTask`:

```ts
/**
 * Minutes logged against one commitment ON one day.
 *
 * `loggedForNode` and `loggedForTask` answer all-time, which is the right
 * question beside an estimate and the wrong one beside a row that says "you
 * finished this today". This is the same read, scoped to a date.
 *
 * `nodeId` takes precedence for the reason `loggedForTask` states: the two ids
 * are documented as mutually exclusive and `logSession` writes only one, but
 * `importStateFromFile` does not sanitise sessions, so a hand-edited backup
 * carrying both would have its minutes counted twice.
 */
export function loggedForItemOn(
  sessions: Session[],
  item: { kind: 'task' | 'step'; id: string },
  date: string,
): number {
  let total = 0;
  for (const s of sessions) {
    if (s.date !== date || s.minutes <= 0) continue;
    if (item.kind === 'step') {
      if (s.nodeId === item.id) total += s.minutes;
    } else if (s.nodeId === undefined && s.taskId === item.id) {
      total += s.minutes;
    }
  }
  return total;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/actuals.test.ts`
Expected: PASS, all suites.

- [ ] **Step 5: Typecheck, full suite, commit**

```bash
npx tsc -b
npm test
git add src/lib/actuals.ts src/lib/actuals.test.ts
git commit -m "feat(lib): what the work cost, on the day it was finished"
```

---

### Task 2: The Done today section

**Files:**
- Modify: `src/views/Today.tsx`
- Test: `src/views/Today.doneToday.test.tsx` (create)

**Interfaces:**
- Consumes: `loggedForItemOn` (Task 1); the existing `complete(item)`, `openItem(item)`, `sections.completedToday`, `sessions` and `today` already in `Today.tsx`.
- Produces: nothing consumed by a later task.

**Two facts about the existing file, so you do not have to hunt for them:**
- `sessions` is already destructured at line 39 — `const { goals, tasks, sessions, availability, allDayBlocks, actions } = useAppStore();`. Do not add a second `useAppStore` call.
- `doneCount` (line 98) STAYS. Only the `<p>` that renders it goes; the empty-Now message still reads `Nothing left today — ${doneCount} done.` and would break if you removed the const.

- [ ] **Step 1: Write the failing test**

Create `src/views/Today.doneToday.test.tsx`. Copy lines 1–102 of `src/views/Today.carryOver.test.tsx` verbatim (the `dbMocks` hoist, both `vi.mock` calls, the `beforeAll` matchMedia shim, `TODAY`, `WORKDAY`, `project`, `mountToday`, `beforeEach`, `afterEach`) — there is no shared fixture module to import from.

Then make one change to the copied `mountToday`, so a test can seed sessions. Add `sessions?: Session[];` to its `over` parameter type, and change the `loadState` call to pass them:

```tsx
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(over.goals ?? [project]),
    habits: structuredClone(over.habits ?? []),
    tasks: structuredClone(over.tasks ?? []),
    sessions: structuredClone(over.sessions ?? []),
  });
```

Add `Session` to the `db/types` import at the top of the copied block.

Then append:

```tsx
/** Finished today: `done` plus a `doneAt` equal to today is what buildDailyWork keys on. */
const doneTask = (id: string): Task =>
  ({ id, title: id, done: true, doneAt: TODAY, goalId: null });

describe('done today', () => {
  it('lists what was finished, struck through', async () => {
    await mountToday({ goals: [], tasks: [doneTask('Renew T pass')] });

    expect(screen.getByLabelText('Done today')).toBeTruthy();
    const title = screen.getByText('Renew T pass');
    expect(title.className).toContain('line-through');
  });

  /**
   * The section REPLACES the sentence. Asserting its absence is what stops the
   * two ever shipping together and stating the same fact twice.
   */
  it('replaces the finished-today sentence rather than joining it', async () => {
    await mountToday({ goals: [], tasks: [doneTask('Renew T pass')] });

    expect(screen.queryByText(/finished today/)).toBeNull();
  });

  it('un-ticking a row un-completes it and the row leaves', async () => {
    const store = await mountToday({ goals: [], tasks: [doneTask('Renew T pass')] });

    await act(async () => {
      screen.getByRole('checkbox', { name: 'Mark "Renew T pass" as not done' }).click();
    });

    expect(store.getState().tasks[0].done).toBe(false);
    expect(screen.queryByLabelText('Done today')).toBeNull();
  });

  /** Un-ticking IS the undo. A toast offering to undo an undo is noise. */
  it('arms no undo when un-ticking', async () => {
    const store = await mountToday({ goals: [], tasks: [doneTask('Renew T pass')] });

    await act(async () => {
      screen.getByRole('checkbox', { name: 'Mark "Renew T pass" as not done' }).click();
    });

    expect(store.getState().pendingUndo).toBeFalsy();
  });

  it('states what the work cost, when time was logged for it today', async () => {
    await mountToday({
      goals: [],
      tasks: [doneTask('Renew T pass')],
      sessions: [{
        id: 's1', goalId: null, taskId: 'Renew T pass',
        date: TODAY, minutes: 45, note: '',
      }],
    });

    expect(screen.getByText('45m')).toBeTruthy();
  });

  /** Most work is finished without a logged session; 0m would report a measurement nobody took. */
  it('says nothing about time when none was logged', async () => {
    await mountToday({ goals: [], tasks: [doneTask('Renew T pass')] });

    expect(screen.queryByText('0m')).toBeNull();
  });

  it('says nothing at all when nothing was finished', async () => {
    await mountToday({ goals: [], tasks: [] });

    expect(screen.queryByLabelText('Done today')).toBeNull();
  });

  /**
   * `completedToday` walks `allLeaves`, not `activeLeaves` — the one place this
   * section's membership differs from every neighbour, which filters completed
   * goals out. Finishing the goal does not erase the last thing you finished
   * inside it.
   */
  it('keeps a leaf finished inside a goal that was completed today', async () => {
    await mountToday({
      goals: [{
        id: 'g1', title: 'Thesis', column: 0, completedAt: TODAY,
        nodes: [{ id: 'n1', title: 'Draft the intro', status: 'done', doneAt: TODAY }],
      }],
      tasks: [],
    });

    expect(screen.getByLabelText('Done today')).toBeTruthy();
    expect(screen.getByText('Draft the intro')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/views/Today.doneToday.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Done today`.

- [ ] **Step 3: Render the section**

Add to the imports in `src/views/Today.tsx`:

```ts
import { loggedForItemOn } from '../lib/actuals';
```

DELETE this block (currently around line 522, immediately after the Attention `</section>` and before `<ReplanPreview`):

```tsx
      {doneCount > 0 && (
        <p className="mt-[24px] text-meta text-muted">
          {doneCount} finished today.
        </p>
      )}
```

Insert in its place:

```tsx
      {/* ── Done today ──
          Last, because work that is done cannot outrank work that is not.
          It renders only when something was actually finished, so it is a
          record of the day and never filler on an empty one.

          No cap, unlike `Carried over`: that section's input is unbounded
          backlog, this one's is bounded by a day of one person's work, and
          telling someone who finished eleven things that five of them counted
          would undercut the only section that exists to show what they did.

          The order is `buildDailyWork`'s and makes NO chronological claim —
          `doneAt` is a date with no time in it. Sorting this list by when
          things were finished needs a completion timestamp, which the spec
          refuses; read that refusal before reaching for one. */}
      {sections.completedToday.length > 0 && (
        <section aria-label="Done today" className="mt-[24px]">
          <h2 className="px-[8px] text-meta font-semibold text-muted mb-[6px]">Done today</h2>
          <ul>
            {sections.completedToday.map((item) => {
              const logged = loggedForItemOn(sessions, item, today);
              return (
                <li key={item.key}>
                  <TaskRow
                    title={item.title}
                    subtitle={item.goalTitle}
                    completed
                    onOpen={() => openItem(item)}
                    lead={
                      <TodayCheckbox
                        checked
                        onToggle={() => complete(item)}
                        ariaLabel={`Mark "${item.title}" as not done`}
                      />
                    }
                    meta={
                      logged > 0
                        ? <span className="tabular-nums">{fmtMinutes(logged)}</span>
                        : undefined
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/views/Today.doneToday.test.tsx`
Expected: PASS, all seven.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. Watch `Today.freeTime.test.tsx` in particular — it asserts on the empty-Now message that still spends `doneCount`.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -b
git add src/views/Today.tsx src/views/Today.doneToday.test.tsx
git commit -m "feat(today): the day gets a bottom"
```

---

### Task 3: Record the rule in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (the Invariants section)

**Interfaces:**
- Consumes: everything above. Produces: nothing.

- [ ] **Step 1: Add the invariant**

Add this bullet to the Invariants list, immediately after the bullet beginning **"Today shows the slipped work it names, and names it once"**:

```markdown
- **Today ends with what you finished, and that section is a record — never
  filler.** `completedToday` was computed by `buildDailyWork` on every render
  and discarded except for its `.length`, so the page's whole acknowledgement
  of a finished day was one grey sentence below the whitespace: a surface whose
  reward for use is a blanker screen. It renders LAST, because work that is
  done cannot outrank work that is not, and only when something was actually
  finished — so it adds nothing to the sparse page, which the one-gesture spec
  correctly diagnosed as an empty database rather than a layout fault. It takes
  NO cap where `Carried over` takes `MAX_CARRY_OVER`, because that section's
  input is unbounded backlog and this one's is one day of one person's work.
  It makes no chronological claim: `doneAt` is a `'YYYY-MM-DD'` date with no
  time in it, and ordering the list by when things finished would need a
  completion timestamp written on every tick of every leaf and task, to
  decorate one list. What a row states instead is what the work COST —
  `loggedForItemOn`, which is `loggedForNode`/`loggedForTask` scoped to a date
  and inheriting their `nodeId`-takes-precedence rule — and it states nothing
  when nothing was logged, because `0m` reports a measurement nobody took.
  Un-ticking needs no undo and gets none: `toggleTask` and `toggleLeaf` each
  already branch on `wasDone` and take a plain `setAndPersist` when
  un-completing, so the section is a new READER of existing behaviour and
  changes no store action.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: the day gets a bottom, and why it has no cap"
```

---

## Self-Review

**Spec coverage.** §1 placement and heading → Task 2 Step 3 (last, `mt-[24px]`, label voice, sentence deleted). §2 the row → Task 2 Step 3 (`completed`, checked checkbox, `openItem`, logged minutes) with the no-undo claim pinned by a test. §2 logged minutes → Task 1. §3 no cap → Task 2's comment and Task 3's bullet; there is no cap constant to test, so it is recorded rather than asserted. §4 no chronological claim → Task 2's comment and Task 3's bullet. §5 the `allLeaves` quirk → Task 3's bullet omits it; see the gap note below. Tests → each task.

**One gap found and closed.** §5's `allLeaves` quirk was described in the spec and asserted by nothing. The first draft of this plan left the fix in this self-review section, which is the wrong place — a worker executing Task 2 reads Task 2, not the appendix. It is now the eighth test in Task 2 Step 1, where it will actually be written.

**One assumption verified rather than shipped.** The tests reach the checkbox with `getByRole('checkbox', { name: … })`. `TodayCheckbox` is a `<button>` carrying `role="checkbox"` and passing `ariaLabel` to `aria-label`, so the query resolves.

**Type consistency.** `loggedForItemOn(sessions, item, date)` is defined in Task 1 and called with exactly that shape in Task 2; `DailyWorkItem` carries `kind: 'task' | 'step'` and `id`, so an item passes directly with no adapter. `sections.completedToday` is `DailyWorkItem[]` in both tasks. The `ariaLabel` string `Mark "X" as not done` is written identically in Task 2's implementation and its three tests.

**Every commit is green**, and no task depends on a later one to pass.
