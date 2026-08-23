# Remove Working Hours — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the `AvailabilityWindow` model and every figure priced against it, so Phase reports what you have taken on and never claims what fits.

**Architecture:** Nine tasks, leaf to root. Every task compiles (`npx tsc -b`) and passes `npm test` on its own, and each ends in its own commit. The order is chosen so no task leaves a dangling type: readers of `freeMin` stop reading it BEFORE `freeMin` is deleted, and the model itself goes last, when nothing imports it.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Tailwind, Dexie.

## Global Constraints

- Run `npm test` and `npx tsc -b` before every commit. Both must be green.
- Visual identity is locked. `designScale.test.ts` fails the build on a literal hex, an arbitrary `text-[Nrem]`, a corner radius outside `[4px] [6px] rounded-field rounded-card rounded-full`, uppercase outside `font-mono`, and `uppercase` spelled anywhere but `components/sectionLabel.ts`.
- `text-faint` is for decoration, placeholders and disabled states. Anything a user must READ is `text-muted` or louder.
- `.hatch` is NOT being removed. It keeps its jobs on Today's frame and the Goals board. Only `DayColumn`'s use of it goes.
- `border-dashed` stays reserved for the drop preview and a guessed-hour block.
- Comments in this codebase carry the reasoning, not the mechanics. When you delete a rule, rewrite the surrounding comment so it stops describing a world that no longer exists — do not leave a stale paragraph.
- New pure logic goes in `src/lib` with a sibling `*.test.ts`.
- Commit messages: conventional prefix, and end with the two trailer lines used by this repo (`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01DYoeP6Qp4yp2jA2QRDELRK`).

## Two corrections to the spec

The spec was written before two files were read in full. Both corrections are binding on this plan:

1. **`SettingsModal` SURVIVES.** The spec claimed `AvailabilitySettings` was its entire body. It is not — the dialog also holds Lives, the assistant shortcut, and launch-at-login, and `Goals.tsx` opens it for "Manage lives". Only its **Working hours** section is removed. The `settings` command verb survives too, relabelled from `Working hours` to `Settings`.
2. **`src/views/plan/AvailabilityModal.tsx` is already dead.** Nothing imports it (only a comment in `Modal.tsx` mentions it). It is deleted as unreferenced code, not as part of a wiring change.

## Two refinements to the spec

Both are deviations the spec's author should know about; they are decided, not open:

1. **`ORDINARY_DAY` is EXPORTED, not unexported.** The spec called for a private constant. Two callers outside `slot.ts` need the region — `todayPlan`'s day scan and its heading — so it is exported with a doc comment saying exactly what it is not (a fence, a setting, a thing that is drawn).
2. **`attentionItems` keeps its `blocked` kind.** The spec's phrasing ("the `goalHealth` verdict on each row goes with it") reads as deleting the whole function. `blocked` comes from `isFullyBlocked` in `lib/plan.ts`, which never touched availability; deleting it would remove a signal unrelated to working hours. Only the `at-risk` kind goes.

## File Structure

**Deleted:** `src/lib/health.ts`, `src/lib/health.test.ts`, `src/lib/dayGauge.ts`, `src/lib/dayGauge.test.ts`, `src/views/today/DayGauge.tsx`, `src/lib/availability.ts`, `src/lib/availability.test.ts`, `src/views/plan/AvailabilityModal.tsx`, `src/views/plan/AvailabilitySettings.tsx`, `src/views/plan/timeInput.ts`, `src/views/plan/timeInput.test.ts`.

**Renamed:** `src/views/plan/CapacityMeter.tsx` → `src/views/plan/LoadRule.tsx` (and its test).

**Modified:** `src/lib/slot.ts`, `src/lib/capacity.ts`, `src/lib/todayPlan.ts`, `src/lib/executionAdvisor.ts`, `src/lib/todaySurface.ts`, `src/lib/replan.ts`, `src/lib/migrateSlots.ts`, `src/lib/grid.ts`, `src/lib/planHint.ts`, `src/lib/agentReads.ts`, `src/lib/commands.ts`, `src/state/store.ts`, `src/db/db.ts`, `src/db/types.ts`, `src/components/SettingsModal.tsx`, `src/components/SchedulePopover.tsx`, `src/components/Icons.tsx`, `src/components/assistant/AssistantHost.tsx`, `src/App.tsx`, `src/views/Plan.tsx`, `src/views/Today.tsx`, `src/views/plan/capacityLabel.ts`, `src/views/plan/WeekHeader.tsx`, `src/views/plan/WeekGrid.tsx`, `src/views/plan/DayColumn.tsx`, `src/views/plan/MonthCell.tsx`, `src/views/plan/MonthGutter.tsx`, `src/views/plan/monthCapacity.ts`, `src/views/plan/PlanNotice.tsx`, `src/views/project/OverviewTab.tsx`, `src/views/project/ProjectHeader.tsx`, `src/views/project/GoalMetaPopover.tsx`, `src/views/project/ProposalPanel.tsx`, `src/views/project/TaskPage.tsx`, `src/views/project/CalendarTab.tsx`, `CLAUDE.md`.

---

### Task 1: Drop `goalHealth`

**Files:**
- Delete: `src/lib/health.ts`, `src/lib/health.test.ts`
- Modify: `src/lib/todaySurface.ts`, `src/lib/agentReads.ts`, `src/views/project/ProjectHeader.tsx`, `src/views/project/OverviewTab.tsx`, `src/views/project/GoalMetaPopover.tsx`
- Test: `src/lib/todaySurface.test.ts`, `src/views/project/OverviewTab.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `attentionItems(goals, _sections, today)` — three arguments, returns `AttentionItem[]` where `AttentionKind` is the string literal `'blocked'` only. `projectSummary` in `agentReads.ts` no longer emits a `health` field.

- [ ] **Step 1: Write the failing test for the narrowed `attentionItems`**

Replace the availability-dependent cases in `src/lib/todaySurface.test.ts` with this. Keep the file's existing imports and add nothing new:

```ts
describe('attentionItems without health', () => {
  it('reports a fully-blocked goal and nothing else', () => {
    const g = goal('g1', 'Midterm', [
      { id: 'n1', title: 'Wait on the TA', status: 'blocked' },
    ]);
    const items = attentionItems([g], sections(), '2026-08-23');
    expect(items.map((i) => i.kind)).toEqual(['blocked']);
    expect(items[0]!.text).toBe('Midterm has nothing that can be started');
  });

  it('says nothing about a goal that will miss its deadline', () => {
    const g = goal('g2', 'Essay', [
      { id: 'n2', title: 'Write it', estimateMin: 6000 },
    ]);
    g.deadline = '2026-08-24';
    expect(attentionItems([g], sections(), '2026-08-23')).toEqual([]);
  });
});
```

If `goal()` / `sections()` helpers do not already exist in that file, build the fixtures inline from the shapes the file's other tests already use — do not invent new helper modules.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/todaySurface.test.ts`
Expected: FAIL — `attentionItems` still takes six arguments, so TypeScript rejects the three-argument call.

- [ ] **Step 3: Delete `health.ts` and narrow `attentionItems`**

```bash
rm src/lib/health.ts src/lib/health.test.ts
```

In `src/lib/todaySurface.ts`, drop the `goalHealth` / `Health` import and the `AvailabilityWindow` / `BusyBlock` imports if nothing else in the file uses them. Change `AttentionKind` and `attentionItems`:

```ts
/**
 * What Today interrupts you about.
 *
 * One kind, not two. `at-risk` came from `goalHealth`, which compared the work
 * remaining against the free hours before a deadline — and free hours no
 * longer exist. `blocked` never needed them: it is `isFullyBlocked`, a fact
 * about the tree, and a goal with nothing startable is worth a row whatever
 * the calendar says.
 */
export type AttentionKind = 'blocked';

export function attentionItems(
  goals: Goal[],
  _sections: DailyWorkSections,
  _today: string,
): AttentionItem[] {
  const out: AttentionItem[] = [];

  for (const goal of goals.filter((g) => !g.completedAt && isFullyBlocked(g))) {
    const first = firstBlockedLeaf(goal.nodes);
    out.push({
      id: `blocked:${goal.id}`,
      kind: 'blocked',
      goalId: goal.id,
      ...(first ? { nodeId: first.id } : {}),
      text: `${goal.title} has nothing that can be started`,
    });
  }

  return out.slice(0, MAX_ATTENTION);
}
```

Add `isFullyBlocked` to the existing `from './plan'` import. Delete the now-unused `fmtD` import if `at-risk` was its only consumer.

The third parameter is kept and renamed `_today`: it is unused by the body now, but `Today.tsx` reads `today` in the same memo and removing the parameter would change the call site for no gain. The leading underscore is what this codebase already uses for `_sections` beside it.

- [ ] **Step 4: Update every caller**

`src/views/Today.tsx` — the memo at line ~86:

```tsx
  const attention = useMemo(
    () => attentionItems(goals, sections, today),
    [goals, sections, today],
  );
```

`src/lib/agentReads.ts` — delete the `goalHealth` import and the `health:` property from `projectSummary`'s return object, along with the comment above it that explains why `effort` is passed rather than recomputed (that comment stays — only the `health` key goes).

`src/views/project/ProjectHeader.tsx` — delete the `goalHealth, HEALTH_TONE, HEALTH_WORD` import, the `verdict` const and its comment block, the `availability`/`allDayBlocks` destructure if nothing else uses them, and the `verdict={verdict}` prop. Replace the health pill with the deadline, which was previously the second item in the same button:

```tsx
          {g.deadline && (
            <span className="text-muted whitespace-nowrap">Due {fmtD(g.deadline)}</span>
          )}
```

Note the leading `· ` is removed — it is now the first item in the row, and a leading separator was only ever correct behind the pill.

`src/views/project/GoalMetaPopover.tsx` — delete the `HealthVerdict` import, the `verdict` prop from the type and the destructure, and the `<p>` that rendered `verdict.reason`.

`src/views/project/OverviewTab.tsx` — delete the health imports, the `verdict` const and its comment, and the `Forecast` section's verdict line. The section keeps its heading and its `pace` line:

```tsx
      <section>
        <h3 className={`m-0 mb-[6px] ${sectionLabel}`}>Forecast</h3>
        {/* The observed rate and runway, never a predicted finish date:
            `describeVelocity` refuses to name one from a trailing average, and
            this surface is not the place to overrule it. A verdict used to sit
            above this line; it compared remaining work against free hours, and
            there are no free hours to compare against now. */}
        {pace
          ? <p className="m-0 px-[6px] text-meta text-muted">{pace}</p>
          : <p className="m-0 px-[6px] text-ui text-muted">Not enough finished work to measure a rate yet.</p>}
      </section>
```

- [ ] **Step 5: Fix the tests that assert a verdict**

In `src/views/project/OverviewTab.test.tsx`, delete the `goalHealth, HEALTH_WORD` import and every assertion that looks for a health word. If a test's only purpose was the verdict, delete the test.

Search for `health-pill` across the suite and delete those assertions:

```bash
grep -rn "health-pill\|HEALTH_WORD\|goalHealth" src
```

Every hit must be gone before this task is done.

- [ ] **Step 6: Run the full suite and the typecheck**

Run: `npm test && npx tsc -b`
Expected: PASS, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(health): drop goalHealth

The verdict compared the work remaining against the free hours before a
deadline, and free hours are going away. What it leaves behind is
attentionItems' `blocked` kind, which never needed them — it is
isFullyBlocked, a fact about the tree, and a goal with nothing startable
is worth a row whatever the calendar says.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DYoeP6Qp4yp2jA2QRDELRK
EOF
)"
```

---

### Task 2: Drop the day gauge

**Files:**
- Delete: `src/lib/dayGauge.ts`, `src/lib/dayGauge.test.ts`, `src/views/today/DayGauge.tsx`
- Modify: `src/views/Today.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing. This is a pure deletion.

- [ ] **Step 1: Confirm the gauge has exactly one consumer**

Run: `grep -rn "dayGauge\|DayGauge" src`
Expected: hits only in `src/lib/dayGauge.ts`, `src/lib/dayGauge.test.ts`, `src/views/today/DayGauge.tsx`, `src/views/Today.tsx`, and any `DayGauge`-named test. If anything else appears, stop and report it.

- [ ] **Step 2: Delete the files**

```bash
rm src/lib/dayGauge.ts src/lib/dayGauge.test.ts src/views/today/DayGauge.tsx
rm -f src/views/today/DayGauge.test.tsx
```

- [ ] **Step 3: Remove the render and the memo from `Today.tsx`**

Delete the `import { DayGauge } from './today/DayGauge';` line, the `import { dayGauge } from '../lib/dayGauge';` line, the whole `const gauge = useMemo(...)` block including its doc comment, and the render site:

```tsx
          {gauge && <DayGauge gauge={gauge} />}
```

along with the comment above it. Leave `scheduledOn` imported only if something else in the file still calls it — check with `grep -n scheduledOn src/views/Today.tsx`.

- [ ] **Step 4: Run the suite and the typecheck**

Run: `npm test && npx tsc -b`
Expected: PASS. If a Today test asserts the gauge exists, delete that assertion.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(today): drop the day gauge

It drew the working window's hull. With no window there is no hull, and
a flat empty bar would answer "you are out of time" to someone who was
never asked when they work — the exact confusion the module's own null
case existed to avoid.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DYoeP6Qp4yp2jA2QRDELRK
EOF
)"
```

---

### Task 3: `ORDINARY_DAY`, `longestFreeGap`, and the automatic aim

**Files:**
- Modify: `src/lib/slot.ts`, `src/lib/replan.ts`, `src/lib/migrateSlots.ts`, `src/state/store.ts`, `src/components/SchedulePopover.tsx`, `src/views/project/TaskPage.tsx`
- Test: `src/lib/slot.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces:
  - `export const ORDINARY_DAY: Interval` — frozen `{ startMin: 480, endMin: 1200 }`.
  - `export function aimFor(date: string, now: Now): number`
  - `export function longestFreeGap(date: string, span: Interval | null, blocks: BusyBlock[], placed: PlacedSpan[], now: Now, allDayBlocks: boolean): number`
  - `ReplanInput` in `replan.ts` no longer has a `windows` field.
  - `migrateSlots(goals, tasks, allDayBlocks)` — three arguments.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/slot.test.ts`:

```ts
describe('ORDINARY_DAY and the automatic aim', () => {
  const NOW: Now = { date: '2026-08-24', minute: 9 * 60 };

  it('aims a future day at the start of the ordinary day', () => {
    expect(aimFor('2026-08-26', NOW)).toBe(8 * 60);
  });

  it('clamps today forward to the clock', () => {
    expect(aimFor('2026-08-24', NOW)).toBe(9 * 60);
  });

  it('still aims at the ordinary start when the clock is before it', () => {
    expect(aimFor('2026-08-24', { date: '2026-08-24', minute: 6 * 60 })).toBe(8 * 60);
  });

  it('keeps an automatic placement out of the small hours', () => {
    const start = resolveSlot({
      date: '2026-08-26',
      aimMin: aimFor('2026-08-26', NOW),
      durationMin: 60,
      span: ORDINARY_DAY,
      blocks: [],
      placed: [],
      now: NO_PAST_LIMIT,
      allDayBlocks: false,
    });
    expect(start).toBe(8 * 60);
  });

  it('lets a manual placement land at 2am — ORDINARY_DAY is not a fence', () => {
    const start = resolveSlot({
      date: '2026-08-26',
      aimMin: 2 * 60,
      durationMin: 60,
      span: WHOLE_DAY,
      blocks: [],
      placed: [],
      now: NO_PAST_LIMIT,
      allDayBlocks: false,
    });
    expect(start).toBe(2 * 60);
  });
});

describe('longestFreeGap', () => {
  it('measures the widest unbooked run in the span', () => {
    const gap = longestFreeGap(
      '2026-08-26',
      ORDINARY_DAY,
      [],
      [{ startMin: 9 * 60, endMin: 10 * 60 }, { startMin: 11 * 60, endMin: 12 * 60 }],
      NO_PAST_LIMIT,
      false,
    );
    // 12:00–20:00 is the widest run: 480 minutes.
    expect(gap).toBe(480);
  });

  it('is 0 on a day booked solid across the span', () => {
    const gap = longestFreeGap(
      '2026-08-26',
      ORDINARY_DAY,
      [],
      [{ startMin: 0, endMin: 1440 }],
      NO_PAST_LIMIT,
      false,
    );
    expect(gap).toBe(0);
  });
});
```

Add `ORDINARY_DAY`, `longestFreeGap`, `WHOLE_DAY`, `NO_PAST_LIMIT`, `resolveSlot`, `aimFor` and `type Now` to the file's imports as needed.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/lib/slot.test.ts`
Expected: FAIL — `ORDINARY_DAY` and `longestFreeGap` are not exported, and `aimFor` still takes three arguments.

- [ ] **Step 3: Implement in `src/lib/slot.ts`**

Delete the `AvailabilityWindow` and `windowForDate` / `DEFAULT_START_MIN` imports. Import `MINUTES_PER_DAY` from `./capacity` instead of from `./availability` (Task 8 moves it; until then keep importing it from `./availability` — see the note at the end of this step).

Add above `aimFor`:

```ts
/**
 * The span an AUTOMATIC placement aims inside: 08:00–20:00.
 *
 * This is what is left of working hours, and it is deliberately the smallest
 * thing that can be left. It is NOT a fence — every manual route still passes
 * `WHOLE_DAY`, so a drag, a drawn block and a `1`-`7` keypress all land at any
 * minute of any day. It is NOT a setting: nothing in the UI edits it, because
 * a number a person can change is a number that has to be explained, drawn and
 * defended, which is the model that just got removed. And it is NOT drawn:
 * `DayColumn` marks nothing outside it.
 *
 * What it IS: the region the app searches when IT is choosing the hour — a
 * replan, a slot migration, a booking made from a distance. Without it those
 * paths would search `WHOLE_DAY` from minute 0 and cheerfully book 4am, which
 * is not a recovery, it is a prank.
 */
export const ORDINARY_DAY: Interval = Object.freeze({ startMin: 8 * 60, endMin: 20 * 60 });
```

Replace `aimFor` (keep the existing doc comment's first three paragraphs, rewriting the window references):

```ts
export function aimFor(date: string, now: Now): number {
  return date === now.date ? Math.max(ORDINARY_DAY.startMin, now.minute) : ORDINARY_DAY.startMin;
}
```

Add after `freeIntervals`:

```ts
/**
 * The widest unbooked run inside `span` on `date`, in minutes. `0` when the
 * span is entirely taken.
 *
 * This is the one measure of "does this day have room in it", and both callers
 * that ask spend it: Today's offer, deciding which day to name, and the week
 * grid's drag chip, deciding whether the bar under the cursor will fit. Two
 * surfaces answering that question with two derivations is how a header comes
 * to read `fits` above a column that refuses the drop.
 *
 * It reports a GAP and never a sum. Three separate half-hours are not an hour
 * of room, and a figure that added them up would promise a sitting that
 * cannot be placed.
 */
export function longestFreeGap(
  date: string,
  span: Interval | null,
  blocks: BusyBlock[],
  placed: PlacedSpan[],
  now: Now,
  allDayBlocks: boolean,
): number {
  return freeIntervals(date, span, blocks, placed, now, allDayBlocks)
    .reduce((widest, gap) => Math.max(widest, gap.endMin - gap.startMin), 0);
}
```

Note on `MINUTES_PER_DAY`: it still lives in `availability.ts` until Task 8. Leave the import path alone in this task.

- [ ] **Step 4: Run the slot tests**

Run: `npx vitest run src/lib/slot.test.ts`
Expected: PASS.

- [ ] **Step 5: Point every automatic path at `ORDINARY_DAY`**

`src/lib/replan.ts` — delete the `windowForDate` import and the `windows` field from `ReplanInput` and its destructure. Change the span:

```ts
        span: ORDINARY_DAY,
```

Rewrite the comment above it: it currently says "The availability window, deliberately — this is the one placement…". Replace with:

```ts
        /*
         * `ORDINARY_DAY`, deliberately. This is the app PROPOSING an hour
         * rather than a person aiming at one, and a proposal that can land at
         * 4am is not a recovery. Every manual route searches `WHOLE_DAY`
         * instead; see `scheduleNode`.
         */
```

`src/lib/migrateSlots.ts` — delete the `windowForDate` import, the `windows` parameter, and replace both uses:

```ts
    const window = ORDINARY_DAY;
```

Simplify: delete the `const window` line entirely and pass `span: ORDINARY_DAY` at the call site.

`src/state/store.ts` — in `replanNode`, replace `span: windowForDate(date, state.availability)` with `span: ORDINARY_DAY` and rewrite the comment block above it the same way. In the hydration path, change the `migrateSlots` call to drop its `availability` argument:

```ts
      const result = migrateSlots(appState.goals, appState.tasks, allDayBlocks);
```

Fix the `replanNode` doc comment: the paragraph beginning "Under the then-default Mon–Fri availability, `windowForDate` returns null for a weekend" describes a bug in a model that no longer exists. Replace that sentence with: "It used to search the availability window, which returned nothing at all on a day the user had switched off — so every Replan button failed outright on a weekend, which is exactly when a weekly review gets done."

`src/components/SchedulePopover.tsx` — drop `availability` from the store destructure if nothing else uses it, and:

```ts
  const aimOn = (date: string): number => aimFor(date, liveNow());
```

`src/views/project/TaskPage.tsx` — the `sitAgainAim` const sits ABOVE the `nowMinute` state and builds its own clock literal. Keep that literal and drop only the windows argument:

```ts
  const sitAgainAim = aimFor(todayStr(), {
    date: todayStr(),
    minute: new Date().getHours() * 60 + new Date().getMinutes(),
  });
```

Rewrite its comment: "which only ever landed sensibly because the availability window fenced `resolveSlot`" should become "which only ever landed sensibly because a window fenced `resolveSlot`; with no window, `ORDINARY_DAY` is the aim". Drop `availability` from the store destructure only if Task 7 has not already done so — the two tasks touch the same line, so re-read it.

- [ ] **Step 6: Run the suite and the typecheck**

Run: `npm test && npx tsc -b`
Expected: PASS. Fix any test that passed `windows` to `proposeReplan` or `migrateSlots` by deleting that argument.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(slot): ORDINARY_DAY replaces the window as the automatic aim

An automatic placement has to pick an hour, and the availability window
was what kept it out of the small hours. ORDINARY_DAY is what is left of
that: 08:00-20:00, never drawn, never a setting, and never a fence — a
drag still lands at 2am, because every manual route still passes
WHOLE_DAY.

longestFreeGap arrives with it as the one measure of "does this day have
room in it", so the offer and the drag chip cannot disagree.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DYoeP6Qp4yp2jA2QRDELRK
EOF
)"
```

---

### Task 4: Strip the free half of `capacityLabel`

**Files:**
- Modify: `src/views/plan/capacityLabel.ts`
- Rename: `src/views/plan/CapacityMeter.tsx` → `src/views/plan/LoadRule.tsx`; `src/views/plan/CapacityMeter.test.tsx` → `src/views/plan/LoadRule.test.tsx`
- Test: `src/views/plan/capacityLabel.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–3.
- Produces:
  - `CapacityFigures` — `{ plannedMin, backlogMin, unestimated, hasData }`. No `freeMin`.
  - `weekLoadCells(c: Pick<CapacityFigures, 'plannedMin' | 'backlogMin'>): LoadCell[]` — ONE argument.
  - `weekLoadParts(c: Pick<CapacityFigures, 'plannedMin' | 'backlogMin'>): string[]`
  - `dayLoadLabel(c: Pick<CapacityFigures, 'plannedMin' | 'backlogMin'>): string | null`
  - `LoadRule` component — same props as `CapacityMeter` minus `gauge` and `today`.
  - Deleted: `weekFreeSplit`, `isOverCommitted`, `capacityMeter`, `MeterGeometry`, `dayGaugeCells`, `DayGaugeCell`.

- [ ] **Step 1: Write the failing tests**

Replace the free-time cases in `src/views/plan/capacityLabel.test.ts` with:

```ts
describe('weekLoadCells without free time', () => {
  it('says nothing about an untouched week', () => {
    expect(weekLoadCells({ plannedMin: 0, backlogMin: 0 })).toEqual([]);
  });

  it('makes Planned the one head cell', () => {
    const cells = weekLoadCells({ plannedMin: 720, backlogMin: 180 });
    expect(cells).toEqual([
      { key: 'Planned', value: '12h', tone: 'head' },
      { key: 'To place', value: '3h', tone: 'quiet' },
    ]);
    expect(cells.filter((c) => c.tone === 'head')).toHaveLength(1);
  });

  it('still heads the readout when nothing is committed', () => {
    expect(weekLoadCells({ plannedMin: 720, backlogMin: 0 }))
      .toEqual([{ key: 'Planned', value: '12h', tone: 'head' }]);
  });
});

describe('dayLoadLabel', () => {
  it('states the planned minutes alone', () => {
    expect(dayLoadLabel({ plannedMin: 90, backlogMin: 0 })).toBe('1h 30m');
  });

  it('stays silent on a day with nothing on it', () => {
    expect(dayLoadLabel({ plannedMin: 0, backlogMin: 0 })).toBeNull();
  });

  it('reports a day that is committed but unplaced', () => {
    expect(dayLoadLabel({ plannedMin: 0, backlogMin: 60 })).toBe('0m');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/views/plan/capacityLabel.test.ts`
Expected: FAIL — `weekLoadCells` still requires `freeMin`, `days` and `today`.

- [ ] **Step 3: Rewrite `capacityLabel.ts`**

Delete these exports outright: `weekFreeSplit`, `isOverCommitted`, `capacityMeter`, `MeterGeometry`, `dayGaugeCells`, `DayGaugeCell`.

`CapacityFigures` loses `freeMin`:

```ts
export interface CapacityFigures {
  plannedMin: number;
  /** Committed but not on the calendar. See `DayCapacity.backlogMin`. */
  backlogMin: number;
  unestimated: number;
  hasData: boolean;
}
```

`loadParts` loses its leading free figure. Rewrite the doc comment's second paragraph, which is entirely about the free figure:

```ts
/**
 * The priced part of the readout: what is on the calendar, and what is
 * committed but not on it yet.
 *
 * Never fused into one number. A blended figure would read as authoritative
 * while being partly invented from work that carries no estimate (spec §4.4).
 *
 * There is no free figure here any more. Nothing in the app prices a week
 * against available hours, so this states what you have taken on and makes no
 * claim about whether it fits.
 */
export function loadParts(
  c: Pick<CapacityFigures, 'plannedMin' | 'backlogMin'>,
): string[] {
  const parts: string[] = [];
  if (c.plannedMin > 0) parts.push(`${formatMinutes(c.plannedMin)} planned`);
  // Separate from "planned", because it is exactly the work the rail beside
  // this is listing under "To plan". Folding the two together made the header
  // claim hours were scheduled onto days that were visibly empty.
  if (c.backlogMin > 0) parts.push(`${formatMinutes(c.backlogMin)} to place`);
  return parts;
}
```

`weekLoadCells` drops the tense split and the `today` argument:

```ts
/**
 * The week header's priced figures, as labelled cells on a rule.
 *
 * `head` is spent EXACTLY ONCE per readout, and it is `Planned` — the week is
 * planned against what is on it now that nothing measures what would fit. Two
 * headlines is no headline.
 *
 * An untouched week returns `[]`, and the header then draws its stamp and its
 * range alone. That is the honest answer, not a hole: there is nothing to say
 * about a week nobody has put anything in.
 *
 * This is the ONE derivation behind both the header's cells and the strings
 * `weekLoadParts` returns, so the day-heading tooltip and the Plan header
 * cannot disagree about a week.
 */
export function weekLoadCells(
  c: Pick<CapacityFigures, 'plannedMin' | 'backlogMin'>,
): LoadCell[] {
  const cells: LoadCell[] = [];
  if (c.plannedMin > 0) cells.push({ key: 'Planned', value: formatMinutes(c.plannedMin), tone: 'head' });
  if (c.backlogMin > 0) {
    cells.push({
      key: 'To place',
      value: formatMinutes(c.backlogMin),
      // `head` only when there is no Planned cell above to carry it: a week
      // whose whole commitment is unplaced still has one figure to lead with.
      tone: cells.length === 0 ? 'head' : 'quiet',
    });
  }
  return cells;
}
```

`weekLoadParts` follows:

```ts
export function weekLoadParts(
  c: Pick<CapacityFigures, 'plannedMin' | 'backlogMin'>,
): string[] {
  return weekLoadCells(c).map((cell) => `${cell.value} ${cell.key.toLowerCase()}`);
}
```

`dayLoadLabel` and `dayLoadHint`:

```ts
/**
 * The day heading's figure: the minutes ON the day.
 *
 * Null on a day with nothing planned and nothing committed — seven columns of
 * `0m` is noise, and an empty day already looks empty. It used to read
 * `1h 30m / 6h`; the denominator was free time and there is none.
 */
export function dayLoadLabel(c: Pick<CapacityFigures, 'plannedMin' | 'backlogMin'>): string | null {
  if (c.plannedMin === 0 && c.backlogMin === 0) return null;
  // The chip reports what is ON the day. Anything merely dated to it lives in
  // the rail and is named in the tooltip instead — a column heading claiming
  // hours over an empty column is the contradiction this split exists to end.
  return formatMinutes(c.plannedMin);
}

/** The same figures spelled out, for the heading's `title` tooltip. */
export function dayLoadHint(c: CapacityFigures): string {
  return capacityParts(c).join(' · ');
}
```

- [ ] **Step 4: Rename and strip the meter component**

```bash
git mv src/views/plan/CapacityMeter.tsx src/views/plan/LoadRule.tsx
git mv src/views/plan/CapacityMeter.test.tsx src/views/plan/LoadRule.test.tsx
```

In `LoadRule.tsx`: rename the export to `LoadRule`, delete the `DAY_INITIALS` constant, the `gauge` and `today` props, the `capacityMeter` import and const, the `fill`/`trail` consts, and BOTH the gauge branch and the single-bar branch — everything before the figures rule. Replace the doc comment:

```tsx
/**
 * The header's load readout: the week's figures as labelled cells on a rule.
 *
 * PRESENTATION ONLY. Every number arrives already computed by `weekLoadCells`,
 * so there is no arithmetic here that could drift from the text beside it.
 *
 * There is no bar. A bar is a share of a whole, and the whole was free time —
 * with none, the only honest denominator left would be the figures themselves,
 * which is a bar that is always full. `spanLabel` still exists for month mode,
 * where the figure covers the week rows the grid draws rather than the calendar
 * month in the title: a readout that reports a different span from the heading
 * above it has to say so.
 */
export function LoadRule({
  figures,
  cells,
  spanLabel,
  unestimatedOpen,
  onToggleUnestimated,
}: {
  figures: CapacityFigures;
  /** Already-formatted key/value pairs, e.g. `weekLoadCells(capacity)`. */
  cells: LoadCell[];
  /** What the figures cover, when that is not what the heading says. */
  spanLabel?: string;
  unestimatedOpen?: boolean;
  /** Omitted where there is nowhere to open the list (tests, future hosts). */
  onToggleUnestimated?: () => void;
}) {
  const unestimated = unestimatedLabel(figures);

  return (
    <div className="min-w-0 flex-1">
```

Keep the entire `<div className="flex items-stretch flex-wrap border-t border-line">` block below it exactly as it is, including the `spanLabel` cell, the flex spacer, and the unestimated cell. Close the wrapper with the same two closing tags.

In `LoadRule.test.tsx`: delete every test touching `week-gauge`, `gauge-cell-*`, `gauge-planned-*`, `meter-planned`, `meter-backlog` or `capacity-mark`, and rename every `CapacityMeter` reference to `LoadRule`. Keep the cell, spanLabel and unestimated tests, updating their `figures` fixtures to drop `freeMin`.

- [ ] **Step 5: Run the two test files**

Run: `npx vitest run src/views/plan/capacityLabel.test.ts src/views/plan/LoadRule.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck — expect failures in Task 5's files**

Run: `npx tsc -b`
Expected: errors in `WeekHeader.tsx`, `WeekGrid.tsx`, `MonthCell.tsx`, `MonthGutter.tsx`. That is the next task. **Do not commit yet** — fold Task 5 into this commit, because these files cannot compile apart.

---

### Task 5: The Plan surfaces

**Files:**
- Modify: `src/views/plan/WeekHeader.tsx`, `src/views/plan/WeekGrid.tsx`, `src/views/plan/DayColumn.tsx`, `src/views/plan/MonthCell.tsx`, `src/views/plan/MonthGutter.tsx`, `src/views/Plan.tsx`, `src/views/project/CalendarTab.tsx`
- Test: `src/views/plan/DayColumn.test.tsx`, `src/views/plan/WeekHeader.test.tsx`, `src/views/plan/MonthCell.test.tsx`

**Interfaces:**
- Consumes: `LoadRule`, `weekLoadCells(c)`, `dayLoadLabel(c)`, `dayLoadHint(c)` from Task 4; `longestFreeGap`, `ORDINARY_DAY`, `WHOLE_DAY` from Task 3.
- Produces: `WeekGrid` props lose `windows`, gain `dayGapMin?: number[]`. `DayColumn` props lose `availabilityWindow`.

- [ ] **Step 1: Write the failing test for the hatch removal**

Replace the hatch case in `src/views/plan/DayColumn.test.tsx`:

```tsx
  /*
   * The hatch marked the hours outside the working window. There is no window
   * now, so there is nothing to mark — and `.hatch` still means something on
   * Today's frame and the Goals board, so leaving a stray one here would say
   * "this region is unclaimed" about an ordinary Tuesday afternoon.
   */
  it('draws no hatch — every hour of every day reads the same', () => {
    const { container } = render(
      <DndContext><DayColumn date="2026-08-26" isToday={false} nowMinute={null}>{null}</DayColumn></DndContext>,
    );
    expect(container.querySelector('.hatch')).toBeNull();
  });

  it('names the day without an outside-working-hours caveat', () => {
    render(
      <DndContext><DayColumn date="2026-08-26" isToday={false} nowMinute={null}>{null}</DayColumn></DndContext>,
    );
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('26 Aug');
  });
```

Match the file's existing render helper and `fmtD` output rather than hard-coding `26 Aug` if the helper formats differently — read the neighbouring tests first.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/views/plan/DayColumn.test.tsx`
Expected: FAIL — `availabilityWindow` is still a required prop.

- [ ] **Step 3: Strip `DayColumn`**

Delete the `AvailabilityWindow` import and the `availabilityWindow` prop from both the destructure and the type. Delete the whole `{availabilityWindow && (<>…</>)}` block and its comment. Change the label and the class:

```tsx
      aria-label={`${fmtD(date)}${isToday ? ' — today' : ''}`}
```

```tsx
      className={`relative min-w-0 overflow-hidden border-l border-line-soft motion-safe:transition-[background-color,box-shadow] motion-safe:duration-[120ms] motion-safe:ease-out ${
        isToday ? 'bg-hover/40' : ''
      } ${isOver ? 'bg-accent/5 shadow-[inset_2px_0_0_theme(colors.accent/0.55)]' : ''}`}
```

Rewrite the component's doc comment — its second and third paragraphs are entirely about the window:

```tsx
/**
 * One day. Draws the now-line and nothing else — the blocks themselves arrive
 * as `children` so this file stays about geometry.
 *
 * There is no working-hours marking any more, and that is the point: every
 * hour of every day is the same ground. The hatch that used to mark the
 * margins of the day went with the model behind it; `.hatch` still means
 * "unclaimed space" on Today's frame and the Goals board, so a stray one here
 * would be saying that about an ordinary Tuesday afternoon.
 *
 * A past WEEK still refuses drops. That is a different rule and deliberately
 * untouched — it is about rescheduling history, not about working hours.
 */
```

`minuteToPx` may now be unused in this file — check and remove the import if so.

- [ ] **Step 4: Re-base the week grid**

In `src/views/plan/WeekGrid.tsx`: delete the `AvailabilityWindow` and `windowForDate` imports, the `windows` prop from both the destructure and the type, the `isOverCommitted` import, and the `availabilityWindow={...}` prop on the `DayColumn` render. Add a `dayGapMin` prop:

```tsx
  /**
   * The longest unbooked run on each day, in `days` order. Present only while
   * something is being dragged, and only on the surface that can compute it.
   *
   * It replaces `freeMin` behind the `fits` / `full` chip. A sum would have
   * been the easy substitution and the wrong one — three separate half-hours
   * are not an hour of room, and the chip would promise a drop the grid then
   * refuses. `longestFreeGap` is the same measure Today's offer spends, so the
   * two surfaces cannot disagree about whether a day has room in it.
   */
  dayGapMin?: number[];
```

Replace the heading's figure block:

```tsx
          {days.map((iso, i) => {
            const cap = dayCapacity?.[i];
            const load = cap ? dayLoadLabel(cap) : null;
            const gap = dayGapMin?.[i];
            return (
              <div key={iso} className="text-center">
                <div className={`font-mono text-tiny tracking-[.12em] uppercase ${iso === today ? 'text-accent' : 'text-muted'}`}>
                  {DOW[i]}
                </div>
                <div className={`text-body tabular-nums ${iso === today ? 'text-ink font-semibold' : 'text-ink-soft'}`}>
                  {parseD(iso).getDate()}
                </div>
                {/* Fixed-height slot whether or not the day has a figure, so one
                    busy day cannot shove the header row down relative to its
                    neighbours. */}
                <div className="h-[12px] leading-[12px]">
                  {dragDurationMin != null && gap != null ? (
                    (() => {
                      const fits = gap >= dragDurationMin;
                      return (
                        <span
                          role="status"
                          title={fits
                            ? `${gap}m clear in the longest gap`
                            : `Longest gap is ${gap}m — this needs ${dragDurationMin}m`}
                          className={`font-mono text-eyebrow tabular-nums font-semibold ${fits ? 'text-accent' : 'text-warn'}`}
                        >
                          {fits ? 'fits' : 'full'}
                        </span>
                      );
                    })()
                  ) : load ? (
                    <span
                      title={cap ? dayLoadHint(cap) : undefined}
                      className="font-mono text-eyebrow tabular-nums text-muted"
                    >
                      {load}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
```

Update the component doc comment's list of what it draws — "availability shading, off-day hatching" is now false. It draws the axis, the hour rules, the day headings and the now-line.

- [ ] **Step 5: Re-base the header**

In `src/views/plan/WeekHeader.tsx`: change the imports to `import { weekLoadCells, capacityNote } from './capacityLabel';` and `import { LoadRule } from './LoadRule';`. Delete the `gauge` const and its comment. Change the cells:

```tsx
  const cells = isMonth
    ? (monthCapacity ? weekLoadCells(monthCapacity) : [])
    : weekLoadCells(capacity);
```

Delete the comment above it about the tense split (it describes `weekFreeSplit`, which is gone). Replace the render:

```tsx
      {figures && cells.length > 0 && (
        <div className="mt-[11px]">
          <LoadRule
            figures={figures}
            cells={cells}
            spanLabel={isMonth ? monthSpanLabel : undefined}
            unestimatedOpen={unestimatedOpen}
            onToggleUnestimated={onToggleUnestimated}
          />
        </div>
      )}
```

The `today` prop is still used elsewhere in the component? Check with `grep -n "today" src/views/plan/WeekHeader.tsx`. If its only remaining use was `weekLoadCells`, keep the prop but rewrite its doc comment — `Plan.tsx` and `CalendarTab.tsx` both pass it, and removing a prop from two call sites for no gain is churn. If it is genuinely unused, remove it from the type and both call sites. Prefer removing it; state which you did in the commit body.

Note the added `cells.length > 0` guard: `LoadRule` still renders a bordered rule with a flex spacer when handed no cells, which on an untouched week would be a hairline under the heading with nothing on it — except when `unestimatedLabel` returns something, which is why the guard is on `cells` and NOT on `figures`. Re-check: an untouched week with unestimated work must still show the unestimated cell. So the guard must be:

```tsx
      {figures && (cells.length > 0 || figures.unestimated > 0) && (
```

Use that form.

- [ ] **Step 6: Re-base the month surfaces**

`src/views/plan/MonthCell.tsx` — delete the `isOverCommitted` import and the `over` const. Then:

```tsx
  const load = capacity && (capacity.plannedMin > 0 || capacity.backlogMin > 0)
    ? formatMinutes(capacity.plannedMin)
    : null;
```

and in the render, drop the `over` branch from the class:

```tsx
            className="font-mono text-micro tabular-nums text-muted"
```

Rewrite the comment above `load`: the sentence "a day with nothing planned that is not over-committed reports nothing" no longer parses — there is no over-committed.

`src/views/plan/MonthGutter.tsx` — delete the `capacityMeter` import and the `meter` const. The bar goes; the figure stays:

```tsx
  const planned = formatMinutes(row.capacity.plannedMin);
  const empty = row.capacity.plannedMin === 0 && row.capacity.backlogMin === 0;
```

```tsx
      aria-label={`Open week ${row.isoWeekLabel} — ${planned} planned`}
```

```tsx
      {!empty && (
        <span className="font-mono text-meta tabular-nums font-semibold text-ink">
          {planned}
        </span>
      )}
```

Delete the `<span aria-hidden="true" className="w-[26px] h-[3px] …">` bar entirely, and the `<>…</>` fragment that held the two together. Rewrite the doc comment's second paragraph — "which weeks am I underwater?" is a question the app can no longer answer; the row now answers "how much is on each week?".

- [ ] **Step 7: Feed the grid its gaps from `Plan.tsx`**

In `src/views/Plan.tsx`, add the memo near the existing `capacity` memo:

```tsx
  /*
   * The longest unbooked run on each day, computed only while something is in
   * the air. `WHOLE_DAY`, not `ORDINARY_DAY`: this answers a question about a
   * MANUAL drop, and a manual drop lands wherever it is aimed — measuring it
   * against the region the app aims at automatically would call a day full
   * while 21:00 sat empty under the cursor.
   */
  const dayGapMin = useMemo(
    () => (drag
      ? days.map((date) => longestFreeGap(
        date, WHOLE_DAY, [], spansOn(goals, tasks, date), NO_PAST_LIMIT, allDayBlocks,
      ))
      : undefined),
    [drag, days, goals, tasks, allDayBlocks],
  );
```

Import `longestFreeGap`, `WHOLE_DAY`, `NO_PAST_LIMIT` from `../lib/slot` and `spansOn` from `../lib/scheduled` (check which are already imported). Pass it and drop `windows`:

```tsx
          <WeekGrid
            days={days}
            today={today}
            nowMinute={nowMinute}
            scrollWindow={scrollWindow}
            readOnly={isPast}
            dayCapacity={capacity.days}
            dragDurationMin={drag?.data.durationMin ?? null}
            dayGapMin={dayGapMin}
            onCreate={(date, span) => setDraft({ date, span })}
            scrollerRef={scrollerRef}
            gridRef={gridRef}
          >
```

In `src/views/project/CalendarTab.tsx`, drop the `windows={availability}` prop from its `WeekGrid` render. It passes no `dayGapMin`, so its chip simply does not appear — that surface has no drag chip today either way; verify with `grep -n dragDurationMin src/views/project/CalendarTab.tsx` and if it does pass one, add the same memo there.

- [ ] **Step 8: Run the suite and the typecheck**

Run: `npm test && npx tsc -b`
Expected: PASS, except for failures in files Task 6 owns (`capacity.ts` still has `freeMin`, which is harmless — an extra property satisfies a narrower type). If `weekCapacity`'s callers now fail, note them and continue; if the suite is red for any other reason, fix it here.

Delete any test asserting `meter-planned`, `capacity-mark`, `week-gauge`, the `— over-committed` tooltip suffix, or the `x / y` day-load form.

- [ ] **Step 9: Commit Tasks 4 and 5 together**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(plan): the header states what you took on, not what fits

capacityLabel loses its free half — weekFreeSplit, isOverCommitted,
capacityMeter and dayGaugeCells all priced a week against hours nobody
will set any more. What is left is Planned / To place / Unestimated,
with Planned as the one head cell, and CapacityMeter renamed LoadRule
because it no longer draws a meter.

The day heading's fits/full chip survives on longestFreeGap instead of
freeMin: a sum would have been the easy substitution and the wrong one,
since three half-hours are not an hour of room. DayColumn's hatch is
gone with the window it marked.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DYoeP6Qp4yp2jA2QRDELRK
EOF
)"
```

---

### Task 6: `capacity.ts` drops `freeMin`

**Files:**
- Modify: `src/lib/capacity.ts`, `src/views/plan/monthCapacity.ts`, `src/lib/agentReads.ts`, `src/views/Plan.tsx`, `src/views/project/CalendarTab.tsx`
- Test: `src/lib/capacity.test.ts`, `src/views/plan/monthCapacity.test.ts`, `src/lib/agentReads.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `DayCapacity` — `{ date, plannedMin, backlogMin, unestimated, blockedBy, hasData }`.
  - `WeekCapacity` — `{ days, plannedMin, backlogMin, unestimated, hasData }`.
  - `CapacityInput` — no `windows` field.
  - Deleted from `capacity.ts`: `remainingSpan`, `remainingWindow`, `freeMinutes`, `capacityBefore`, `MAX_FORECAST_DAYS`.
  - **`NO_PAST_LIMIT` stays.** It is the clock every manual placement path passes.

- [ ] **Step 1: Write the failing test**

Replace the free-minute cases in `src/lib/capacity.test.ts` with:

```ts
describe('weekCapacity without a window', () => {
  it('reports what is on the week and makes no claim about room', () => {
    const cap = weekCapacity({
      week: '2026-08-17',
      blocks: [],
      leaves: [],
      tasks: [],
      now: { date: '2026-08-19', minute: 10 * 60 },
      allDayBlocks: false,
      hasData: false,
    });
    expect(cap.days).toHaveLength(7);
    expect(cap.plannedMin).toBe(0);
    expect(cap.backlogMin).toBe(0);
    expect(cap).not.toHaveProperty('freeMin');
    expect(cap.days[0]).not.toHaveProperty('freeMin');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/lib/capacity.test.ts`
Expected: FAIL — `windows` is still a required field of `CapacityInput`.

- [ ] **Step 3: Strip `capacity.ts`**

Delete `remainingSpan`, `remainingWindow`, `freeMinutes`, `capacityBefore` and `MAX_FORECAST_DAYS`, plus the `AvailabilityWindow` / `windowForDate` imports.

Keep `NO_PAST_LIMIT` and rewrite its doc comment so it stops describing free minutes:

```ts
/**
 * The clock a placement passes when the past is not a constraint.
 *
 * A drag onto this morning is allowed — it is how you record what actually
 * happened — and resizing a block that started an hour ago is an ADJUSTMENT,
 * not a new booking. Both pass this rather than the real clock, so
 * `freeIntervals` does not clip away the part of the day that has already gone.
 */
export const NO_PAST_LIMIT: Now = { date: '1970-01-01', minute: 0 };
```

Move `MINUTES_PER_DAY` in from `availability.ts`:

```ts
/** A day, in minutes. A fact about a day, not about anyone's working hours. */
export const MINUTES_PER_DAY = 1440;
```

`DayCapacity` and `WeekCapacity` lose `freeMin`; `CapacityInput` loses `windows`. Inside `weekCapacity`, delete the per-day `freeMin` computation and the week-level sum. Replace the long tense-sensitivity comment block — it is entirely about the free figure — with:

```ts
  /*
   * Every figure here is a COMMITMENT, so tense does not enter into it: a
   * Monday you have already spent still had two hours of work planned onto it,
   * and that stays true on Thursday.
   *
   * The free figure this used to carry was the one tense-sensitive number in
   * the app, and it is gone with the availability windows that priced it.
   */
```

- [ ] **Step 4: Follow the shape through its callers**

`src/views/plan/monthCapacity.ts` — drop `windows` from `MonthCapacityInput` and from the `weekCapacity` call; drop `freeMin` from any total it accumulates.

`src/lib/agentReads.ts` — drop `windows: state.availability` from `capacityInput`. Rewrite the `week` case's comment, which names `isOverCommitted`:

```ts
    case 'week': {
      // The whole object, no verdict. There is no over-commitment verdict left
      // to pass: nothing prices a week against available hours. What this
      // carries is what has been taken on — planned, to place, unestimated —
      // and the caller reads it as such.
      const now = nowOf();
      return okResponse({ capacity: weekCapacity(capacityInput(state, now)) });
    }
```

`src/views/Plan.tsx` and `src/views/project/CalendarTab.tsx` — drop `windows: availability` from their `weekCapacity` calls.

Grep for stragglers:

```bash
grep -rn "freeMin\|capacityBefore\|freeMinutes\|remainingWindow\|remainingSpan\|MAX_FORECAST_DAYS" src
```

Every hit must be gone or in a test being deleted.

- [ ] **Step 5: Run the suite and the typecheck**

Run: `npm test && npx tsc -b`
Expected: PASS. In `src/views/project/Project.progress.test.tsx`, replace the `MAX_FORECAST_DAYS` reference in the comment with a plain date and delete the import if present.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(capacity): drop freeMin

Every function that priced a day against a window goes with it —
remainingSpan, remainingWindow, freeMinutes, capacityBefore. What
weekCapacity reports now is commitment alone, which is why the long
tense-sensitivity comment goes too: a Monday you have spent still had
two hours planned onto it, and that stays true on Thursday.

NO_PAST_LIMIT stays. It reads like part of the free-minutes tense rule
and it was, but it is also the clock every manual placement path passes,
and without it resizing a block that started an hour ago would start
refusing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DYoeP6Qp4yp2jA2QRDELRK
EOF
)"
```

---

### Task 7: Today's offer, re-based on gaps

**Files:**
- Modify: `src/lib/todayPlan.ts`, `src/lib/executionAdvisor.ts`, `src/views/Today.tsx`, `src/views/project/TaskPage.tsx`, `src/views/project/ProposalPanel.tsx`, `src/components/assistant/AssistantHost.tsx`, `src/lib/agentReads.ts`
- Test: `src/lib/todayPlan.test.ts`, `src/lib/executionAdvisor.test.ts`

**Interfaces:**
- Consumes: `longestFreeGap`, `ORDINARY_DAY` from Task 3.
- Produces:
  - `FreeDay` — `{ date: string; gapMin: number }`.
  - `nextFreeDay(today, blocks, placedOn, allDayBlocks, now): FreeDay | null` where `placedOn: (date: string) => PlacedSpan[]`.
  - `TodayPlan` — `{ kind: 'none' } | { kind: 'offer'; date; today; gapMin; rows }`. No `no-hours`.
  - `offerHeading(offer: { date; today; gapMin }, today): string`
  - `TodayPlanInput` — no `availability`; gains `placedOn`.
  - `ExecutionAdviceInput` — no `availability`; gains `placedOn`. `ExecutionAdvice` no longer carries `noHours`.

- [ ] **Step 1: Write the failing tests**

Replace the `no-hours` and free-minute cases in `src/lib/todayPlan.test.ts` with:

```ts
describe('nextFreeDay on gaps', () => {
  const NOW: Now = { date: '2026-08-24', minute: 9 * 60 };

  it('names today when the ordinary day still has a run in it', () => {
    const day = nextFreeDay('2026-08-24', [], () => [], false, NOW);
    expect(day).toEqual({ date: '2026-08-24', gapMin: 11 * 60 });
  });

  it('rolls forward past a day booked solid across the ordinary day', () => {
    const placedOn = (date: string) =>
      date === '2026-08-24' ? [{ startMin: 0, endMin: 1440 }] : [];
    const day = nextFreeDay('2026-08-24', [], placedOn, false, NOW);
    expect(day?.date).toBe('2026-08-25');
  });

  it('returns null when every day in the horizon is solid', () => {
    const day = nextFreeDay('2026-08-24', [], () => [{ startMin: 0, endMin: 1440 }], false, NOW);
    expect(day).toBeNull();
  });
});

describe('todayPlan without working hours', () => {
  it('has no no-hours verdict left to reach', () => {
    const plan = todayPlan({
      goals: [], tasks: [], blocks: [], placedOn: () => [], allDayBlocks: false,
      today: '2026-08-24', week: '2026-08-24', now: { date: '2026-08-24', minute: 9 * 60 },
    });
    expect(plan.kind).toBe('none');
  });
});

describe('offerHeading', () => {
  it('names the run it found on today', () => {
    expect(offerHeading({ date: '2026-08-24', today: true, gapMin: 150 }, '2026-08-24'))
      .toBe('2h 30m open today');
  });

  it('sends you to another day when today is booked solid', () => {
    expect(offerHeading({ date: '2026-08-25', today: false, gapMin: 720 }, '2026-08-24'))
      .toBe('Today is booked — tomorrow has 12h open');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/lib/todayPlan.test.ts`
Expected: FAIL — `nextFreeDay` still takes `windows`.

- [ ] **Step 3: Rewrite `todayPlan.ts`**

Delete the `AvailabilityWindow` and `freeMinutes` imports; import `longestFreeGap, ORDINARY_DAY, type PlacedSpan` from `./slot`.

```ts
export interface FreeDay {
  date: string;
  /** The widest unbooked run inside the ordinary day. See `nextFreeDay`. */
  gapMin: number;
}

export type TodayPlan =
  /** Nothing to offer, or nowhere inside the horizon to put it. */
  | { kind: 'none' }
  | { kind: 'offer'; date: string; today: boolean; gapMin: number; rows: ProposalRow[] };

/**
 * The first day from `today` onward with an unbooked run long enough to sit
 * down in.
 *
 * `ORDINARY_DAY` and not `WHOLE_DAY`, deliberately. This is the app CHOOSING a
 * day on your behalf, and the button on the row it produces places the work
 * automatically — so the region it measures has to be the region that
 * placement aims at, or the offer names a day whose only room is at 3am.
 * A manual drag is measured against `WHOLE_DAY` instead; see `Plan.tsx`.
 *
 * `MIN_SITTING_MIN` is what stops a fifteen-minute crack between two meetings
 * counting as "room": an offer you cannot act on is worse than no offer.
 */
export const MIN_SITTING_MIN = 30;

export function nextFreeDay(
  today: string,
  blocks: BusyBlock[],
  placedOn: (date: string) => PlacedSpan[],
  allDayBlocks: boolean,
  now: Now,
): FreeDay | null {
  for (let i = 0; i < PLAN_DAY_HORIZON; i++) {
    const date = addDays(today, i);
    const gapMin = longestFreeGap(date, ORDINARY_DAY, blocks, placedOn(date), now, allDayBlocks);
    if (gapMin >= MIN_SITTING_MIN) return { date, gapMin };
  }
  return null;
}
```

`offerHeading`:

```ts
/**
 * The one sentence above the rows.
 *
 * It always names the day the click will book, because the offer's whole claim
 * is that it knows where the work is going. It reports a RUN and never a sum:
 * three separate half-hours are not an hour of room, and the figure has to
 * mean "you could sit down for this long".
 */
export function offerHeading(
  offer: { date: string; today: boolean; gapMin: number },
  today: string,
): string {
  if (offer.today) return `${fmtMinutes(offer.gapMin)} open today`;
  return `Today is booked — ${dayLabel(offer.date, today)} has ${fmtMinutes(offer.gapMin)} open`;
}
```

`TodayPlanInput` and `todayPlan`:

```ts
export interface TodayPlanInput {
  goals: Goal[];
  tasks: Task[];
  blocks: BusyBlock[];
  /** The sittings already on a date. `spansOn(goals, tasks, date)`, curried by the caller. */
  placedOn: (date: string) => PlacedSpan[];
  allDayBlocks: boolean;
  today: string;
  week: string;
  now: Now;
  /** Keys (`${kind}:${id}`) the caller is already showing. */
  exclude?: ReadonlySet<string>;
}

export function todayPlan(input: TodayPlanInput): TodayPlan {
  const { goals, tasks, blocks, placedOn, allDayBlocks, today, week, now, exclude } = input;

  const rows = proposalRows(goals, tasks, week, today, exclude);
  if (rows.length === 0) return { kind: 'none' };

  const day = nextFreeDay(today, blocks, placedOn, allDayBlocks, now);
  if (!day) return { kind: 'none' };

  return { kind: 'offer', date: day.date, today: day.date === today, gapMin: day.gapMin, rows };
}
```

- [ ] **Step 4: Follow it through the advisor and the views**

`src/lib/executionAdvisor.ts` — drop the `AvailabilityWindow` import, the `availability` field and destructure, and add `placedOn: (date: string) => PlacedSpan[]` to `ExecutionAdviceInput`.

Delete the `| { kind: 'needs-hours' }` member of `ExecutionAdvice` and the comment above it. Change `orderedCandidates` to return the pool alone:

```ts
function orderedCandidates(input: ExecutionAdviceInput): { pool: Candidate[] } {
```

```ts
  return { pool };
```

and its caller:

```ts
  const { pool } = orderedCandidates(input);
  if (pool.length === 0) return { kind: 'clear' };
```

`src/components/assistant/AssistantSurface.tsx` — delete the whole `if (advice.kind === 'needs-hours') { … }` branch at line ~796 and the comment above it. `beyondFocus` keeps the "a missing model is not a zero" idea alive on that surface, so nothing is lost that the shelf still needs to say.

Pass the new field through to `todayPlan`:

```ts
  const plan = todayPlan({
    goals, tasks, blocks, placedOn, allDayBlocks, today, week, now,
```

`src/views/Today.tsx` — build the curried accessor once and pass it to both calls:

```tsx
  const placedOn = useCallback(
    (date: string) => spansOn(goals, tasks, date),
    [goals, tasks],
  );
```

Import `spansOn` from `../lib/scheduled` and `useCallback` from React if not already present. Replace `availability` with `placedOn` in the `executionAdvice` input and the `todayPlan` input, and drop `availability` from the store destructure and every memo dependency array in the file. Delete the whole `{offer.kind === 'no-hours' && (…)}` block and its comment. Its `onClick={onOpenSettings}` at line ~549 is the prop's ONLY consumer (verified), so also delete `onOpenSettings` from `Today`'s destructure and its prop type, and remove `onOpenSettings={actions.openSettings}` from `App.tsx`'s `<Today>` render.

`src/views/project/ProposalPanel.tsx` — change `freeDay?: { date: string; freeMin: number }` to `freeDay?: { date: string; gapMin: number }` and the render to `<span className="tabular-nums">{fmtMinutes(freeDay.gapMin)}</span> open`. Rewrite the prop's comment: "Absent when no availability is set" is no longer a reachable state — it is absent when no day in the horizon has a sitting-sized run.

`src/views/project/TaskPage.tsx` — it destructures `goals` but NOT `tasks`, so add `tasks` to the store read at line ~92. A loose task's sittings occupy the same day as a goal's, and leaving them out would offer a day that is already booked.

```tsx
  const { goals, tasks, sessions, allDayBlocks, actions } = useAppStore();
```

```tsx
  const freeDay = useMemo(
    () => nextFreeDay(today, [], (date) => spansOn(goals, tasks, date), allDayBlocks, { date: today, minute: nowMinute }),
    [today, goals, tasks, allDayBlocks, nowMinute],
  );
```

Rewrite the comment above it: "Null when no availability is set" is not a reachable state — it is null when no day in the horizon has a sitting-sized run.

`src/components/assistant/AssistantHost.tsx` and `src/lib/agentReads.ts` — replace `availability: state.availability` with `placedOn: (date: string) => spansOn(state.goals, state.tasks, date)` in the `ExecutionAdviceInput` they build, importing `spansOn`.

Grep for `noHours`:

```bash
grep -rn "noHours\|no-hours\|needs-hours" src
```

`AssistantSurface.tsx` may render a needs-hours notice — delete that branch and its comment if so.

- [ ] **Step 5: Run the suite and the typecheck**

Run: `npm test && npx tsc -b`
Expected: PASS. Delete every test asserting `no-hours`, `noHours`, or `No working hours set`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(today): the free-time offer runs on gaps

"A day with room" is now "a day with an unbooked run long enough to sit
down in" — longestFreeGap over ORDINARY_DAY, which is the region the
offer's own button places into, so the sentence and the placement cannot
name different days.

It reports a RUN and never a sum: three separate half-hours are not an
hour of room. no-hours is gone, because the state it named is gone —
what is left is a day booked solid, which the heading says in words.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DYoeP6Qp4yp2jA2QRDELRK
EOF
)"
```

---

### Task 8: The grid's initial scroll

**Files:**
- Modify: `src/lib/grid.ts`, `src/views/Plan.tsx`, `src/views/project/CalendarTab.tsx`
- Test: `src/lib/grid.test.ts` (create if absent)

**Interfaces:**
- Consumes: `ORDINARY_DAY` from Task 3, `MINUTES_PER_DAY` from Task 6.
- Produces: `initialScrollWindow(dates: string[], spansFor: (date: string) => PlacedSpan[]): Interval`

- [ ] **Step 1: Write the failing test**

Create or append to `src/lib/grid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialScrollWindow } from './grid';

describe('initialScrollWindow', () => {
  it('opens on the ordinary day when the week is empty', () => {
    expect(initialScrollWindow(['2026-08-24', '2026-08-25'], () => []))
      .toEqual({ startMin: 8 * 60, endMin: 20 * 60 });
  });

  it('widens to reach an early block', () => {
    const spans = (date: string) =>
      date === '2026-08-25' ? [{ startMin: 6 * 60 + 30, endMin: 7 * 60 }] : [];
    expect(initialScrollWindow(['2026-08-24', '2026-08-25'], spans).startMin).toBe(6 * 60);
  });

  it('widens to reach a late block', () => {
    const spans = (date: string) =>
      date === '2026-08-24' ? [{ startMin: 21 * 60, endMin: 22 * 60 + 15 }] : [];
    expect(initialScrollWindow(['2026-08-24'], spans).endMin).toBe(23 * 60);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/lib/grid.test.ts`
Expected: FAIL — `initialScrollWindow` still takes `AvailabilityWindow[]`.

- [ ] **Step 3: Rewrite it**

```ts
/**
 * Where to scroll the grid on mount: the ordinary day, widened to whole hours
 * around anything already placed in the week.
 *
 * This is NOT geometry — nothing positions against it, and every minute of the
 * day is reachable by scrolling regardless. It used to be the union of the
 * week's availability windows; with none, the honest starting point is the
 * span the app itself aims at, opened out far enough that a 6:30am sitting is
 * not below the fold on a grid that appears to start at eight.
 */
export function initialScrollWindow(
  dates: string[],
  spansFor: (date: string) => PlacedSpan[],
): Interval {
  let startMin = ORDINARY_DAY.startMin;
  let endMin = ORDINARY_DAY.endMin;

  for (const date of dates) {
    for (const span of spansFor(date)) {
      startMin = Math.min(startMin, span.startMin);
      endMin = Math.max(endMin, span.endMin);
    }
  }

  return {
    startMin: Math.max(DAY_START_MIN, floorToHour(startMin)),
    endMin: Math.min(DAY_END_MIN, ceilToHour(endMin)),
  };
}
```

Swap the `AvailabilityWindow` / `windowForDate` imports for `ORDINARY_DAY, type PlacedSpan` from `./slot`, and take `MINUTES_PER_DAY` from `./capacity`. Delete `MIN_VISIBLE_START` / `MIN_VISIBLE_END` if `ORDINARY_DAY` now covers them and nothing else uses them.

**Watch for an import cycle:** `slot.ts` imports from `capacity.ts`; `grid.ts` importing from `slot.ts` is fine as long as `slot.ts` does not import `grid.ts`. Verify with `grep -n "from './grid'" src/lib/slot.ts` — expect no output.

- [ ] **Step 4: Update both call sites**

`src/views/Plan.tsx`:

```tsx
  const scrollWindow = useMemo(
    () => initialScrollWindow(days, (date) => spansOn(goals, tasks, date)),
    [days, goals, tasks],
  );
```

`src/views/project/CalendarTab.tsx` — the same, matching whatever `goals`/`tasks` it has in scope:

```tsx
            scrollWindow={initialScrollWindow(days, (date) => spansOn(goals, tasks, date))}
```

- [ ] **Step 5: Run the suite and the typecheck**

Run: `npm test && npx tsc -b`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(grid): scroll to the work, not to the window

The mount scroll was the union of the week's availability windows. With
none, the honest starting point is the span the app aims at, opened out
around anything already placed — so a 6:30am sitting is not below the
fold on a grid that appears to start at eight.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DYoeP6Qp4yp2jA2QRDELRK
EOF
)"
```

---

### Task 9: Delete the model

**Files:**
- Delete: `src/lib/availability.ts`, `src/lib/availability.test.ts`, `src/views/plan/AvailabilityModal.tsx`, `src/views/plan/AvailabilitySettings.tsx`, `src/views/plan/timeInput.ts`, `src/views/plan/timeInput.test.ts`
- Modify: `src/db/types.ts`, `src/db/db.ts`, `src/state/store.ts`, `src/components/SettingsModal.tsx`, `src/components/Icons.tsx`, `src/lib/commands.ts`, `src/lib/planHint.ts`, `src/lib/agentReads.ts`, `src/views/plan/PlanNotice.tsx`, `src/views/Plan.tsx`, `CLAUDE.md`
- Test: `src/lib/planHint.test.ts`, `src/views/plan/PlanNotice.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: no `AvailabilityWindow` type anywhere; `AppState` has no `availability`; `showPlanHint(goals, tasks)` takes two arguments; `PlanNotice({ showHint })` takes one prop.

- [ ] **Step 1: Confirm nothing outside this task still reads the model**

Run: `grep -rn "AvailabilityWindow\|windowForDate\|parseAvailability\|DEFAULT_AVAILABILITY\|serializeAvailability\|dowOf" src`
Expected: hits ONLY in the files this task deletes or modifies. Anything else means an earlier task was left half-done — go back and finish it rather than patching here.

- [ ] **Step 2: Write the failing test for the narrowed hint**

In `src/lib/planHint.test.ts`, replace the working-hours case:

```ts
  it('shows once there is something to place and nothing placed', () => {
    expect(showPlanHint([goalWithOpenTask()], [])).toBe(true);
  });

  it('retires itself the moment anything is placed', () => {
    expect(showPlanHint([goalWithPlacedTask()], [])).toBe(false);
  });

  it('says nothing on an empty database', () => {
    expect(showPlanHint([], [])).toBe(false);
  });
```

Reuse the fixtures already in that file rather than inventing `goalWithOpenTask` if equivalents exist.

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run src/lib/planHint.test.ts`
Expected: FAIL — `showPlanHint` still requires a third argument.

- [ ] **Step 4: Delete the files**

```bash
rm src/lib/availability.ts src/lib/availability.test.ts
rm src/views/plan/AvailabilityModal.tsx src/views/plan/AvailabilitySettings.tsx
rm src/views/plan/timeInput.ts src/views/plan/timeInput.test.ts
rm -f src/views/plan/AvailabilitySettings.test.tsx
```

- [ ] **Step 5: Strip the model from types, store and db**

`src/db/types.ts` — delete the `AvailabilityWindow` interface and the comment above it.

`src/state/store.ts` — delete the `DEFAULT_AVAILABILITY, parseAvailability, windowForDate` import, the `availability` field from `AppState` and from the initial state, the `availability` binding in the hydration `Promise.all` destructure and in the `set({...})` that follows, the `loadAvailability` call in that `Promise.all`, the whole `setAvailability` action, and `state.availability` from the `exportState` call. Update the comment at line ~360 listing what rides in `settings` so it no longer names availability.

`src/db/db.ts` — delete the `parseAvailability, serializeAvailability` import, `loadAvailability`, `saveAvailability`, the `availability` parameter of `exportState` and the key it writes, and the `availability` field of the import shape. In `importBackup`, delete the line that parses it. Leave a comment where the parse was:

```ts
  // An old backup may still carry an `availability` key. It is ignored rather
  // than migrated: the model it described is gone, and a stale settings row is
  // inert — the same licence a dangling `Session.nodeId` has.
```

- [ ] **Step 6: Strip the surfaces**

`src/components/SettingsModal.tsx` — delete the `AvailabilitySettings` import, the `Working hours` `<h3>`, its `<p>`, and the `<AvailabilitySettings />` render. Rewrite the component's doc comment, whose whole first paragraph is about working hours:

```tsx
/**
 * Where the low-frequency system operations live.
 *
 * A dialog earns itself here for the reason §14 gives: this is provider-style
 * configuration, not routine editing, and it is reached deliberately from the
 * utility menu or `⌘K`, never stumbled into. Naming your lives belongs to the
 * same class — done once a semester, and it costs the board no chrome.
 */
```

`src/components/Modal.tsx` — its doc comment at line ~18 names `AvailabilityModal` as one of the dialogs still wearing the card frame. That file no longer exists; drop the name from the list, leaving `SettingsModal` and the week planner.

`src/components/Icons.tsx` — `IconClock` stays (`App.tsx` and `TaskPage` use it). Change only its doc comment to `/** A clock. */`.

`src/lib/commands.ts` — relabel the verb:

```ts
  { id: 'settings', label: 'Settings', keywords: ['settings', 'preferences', 'lives', 'shortcut'], group: 'view' },
```

`src/lib/planHint.ts` — drop the `hasAvailability` parameter and its guard, and the third bullet of the doc comment (the one beginning "Working hours exist").

`src/views/plan/PlanNotice.tsx` — drop the `needsHours` and `onOpenSettings` props and the whole `if (needsHours)` branch. Rewrite the doc comment: the `needsHours` paragraph goes entirely, and the "It still outranks the hint" paragraph with it.

```tsx
/**
 * The plan view's one notice slot.
 *
 * There used to be two, wearing the same border and the same tone, and nothing
 * stopped them stacking — which pushed the calendar down by two rows and made
 * the page's first impression a pile of advice. One of the two was about
 * working hours and went with them; what is left is the drag gesture, taught
 * once.
 *
 * Not dismissible, and it does not need to be: it retires itself the moment
 * anything is placed.
 */
export function PlanNotice({ showHint }: { showHint: boolean }) {
  if (!showHint) return null;
```

`src/views/Plan.tsx` — drop `availability` from the store destructure, fix the hint memo and the notice:

```tsx
  const planHint = useMemo(() => showPlanHint(goals, tasks), [goals, tasks]);
```

```tsx
          <PlanNotice showHint={planHint} />
```

Then check whether `Plan`'s own `onOpenSettings` prop still has a consumer:

```bash
grep -n "onOpenSettings" src/views/Plan.tsx
```

If not, remove it from the signature and from `App.tsx`'s `<Plan>` render.

`src/lib/agentReads.ts` — delete `availability: state.availability` from any remaining state projection, and remove `availability` from the `FullState` type if it declares one.

- [ ] **Step 7: Run the suite and the typecheck**

Run: `npm test && npx tsc -b`
Expected: PASS. Then confirm the model is gone:

```bash
grep -rn "availability\|Availability\|working hours\|Working hours" src
```

Expected: only prose in comments that deliberately explains what was removed. Any live identifier is a miss.

- [ ] **Step 8: Rewrite CLAUDE.md**

Four bullets become false. Rewrite, do not delete:

1. **"Availability is a DENOMINATOR and an AIM. It is not a fence."** → Replace with a bullet on `ORDINARY_DAY`: what it is (the region an automatic placement aims inside), what it is not (a fence, a setting, a drawn thing), and that every manual path still passes `WHOLE_DAY`. Keep the paragraph about collision handling verbatim — none of it changed.
2. **"The capacity BAR and the capacity TEXT are one derivation."** → The bar is gone. Keep the rule it existed to protect: two numbers that get compared to each other have to cover the same days, and a readout and the thing beside it have to be one derivation. Cite `longestFreeGap` as the current instance — Today's offer and the drag chip spend the same function.
3. **"The Plan header is an instrument, and the gauge is the bar restated per day."** → Three bands, not four: stamp, range, figures rule. Drop the gauge paragraph. Keep the `weekLoadParts`-is-a-map-over-`weekLoadCells` rule and the month-mode `spanLabel` rule.
4. **"The day gauge draws; it does not judge."** → Delete the bullet, and add one line where it stood recording that the gauge went with the working-hours model, so the next reader does not go looking for `lib/dayGauge.ts`.

Then unpick the `no-forecast` / `no-hours` distinction from the three bullets that cite it: the `todayPlan` offer bullet, the `focusLens` bullet, and the goal-header effort/health pair. In each, the distinction survives as a general rule ("a missing model and a zero are different sentences") but its `no-hours` example is gone — `beyondFocus` is the surviving instance and should be named instead.

Also update:
- The `PLANNING_HORIZONS` / `weekCapacity` bullet, which says blocked-but-scheduled work is "still booked time" — true, but its `weekCapacity` reference to `freeMin` is not.
- The `"Free" is tense-sensitive` bullet — delete it. Nothing is tense-sensitive any more; `NO_PAST_LIMIT` survives for a different reason, which the `ORDINARY_DAY` bullet should state.
- The month-capacity bullet's `270h free` paragraph — the failure it describes cannot happen now. Keep the "sum the drawn rows" rule and the `spanLabel` rule; drop the tense paragraph.
- The goal-header bullet naming `health.ts` as "the goal header's two answers" — it is one answer now, `effort.ts`.

- [ ] **Step 9: Final verification**

Run: `npm test && npx tsc -b && npm run build`
Expected: all three green.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(availability): delete the model

AvailabilityWindow, the seven per-day windows, the Settings section and
the persistence all go. Nothing reads them any more — the eight tasks
before this one moved every consumer off, so this commit removes a type
with no callers.

SettingsModal survives, contrary to the spec: Lives, the assistant
shortcut and launch-at-login share the dialog, and only the working
hours section was ever about hours. AvailabilityModal.tsx was already
dead and goes as unreferenced code.

CLAUDE.md loses four invariants and gains one. The rule they were all
instances of survives: two numbers that get compared to each other have
to be one derivation, and longestFreeGap is where that now lives.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DYoeP6Qp4yp2jA2QRDELRK
EOF
)"
```

---

## Manual verification

After Task 9, run the app (`npm run dev`) and check:

1. **Plan, week mode** — stamp, range, and a `Planned / To place / Unestimated` rule. No bar, no seven-cell gauge. An untouched week shows the stamp and range alone.
2. **Plan, month mode** — the gutter shows each week's planned figure with no bar, `spanLabel` still beside the figures.
3. **The week grid** — no hatch anywhere, at any hour, on any day.
4. **Drag a backlog row over the grid** — day headings show `fits` / `full` against the longest gap.
5. **Today** — no gauge; the free-time offer heads `Nh open today`; no "No working hours set" anywhere.
6. **A project header** — remaining effort, deadline and percentage, no verdict pill.
7. **Replan** from the weekly recap — lands between 08:00 and 20:00.
8. **Drag a block to 02:00** — it lands at 02:00.
9. **Settings** — Lives, assistant shortcut and launch-at-login; no Working hours section.
10. **The MCP `week` verb** — rebuild the app and restart Claude Code first, then confirm the payload has no `freeMin`.
