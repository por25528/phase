# Goal Page Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move a task row's metadata from a far-right column to a second line under its own title, give the goal header one focal object, move Focus into the status popover, and settle on one verb for adding a task.

**Architecture:** The placement decision becomes a pure function in `src/lib/rowMeta.ts` with a sibling test, per the repo convention. `GoalTree.tsx`'s row becomes a two-column grid — leading controls in column one, title-plus-metadata stacked in column two — with one `LeafMeta` component rendered in either of two positions so the two can never drift. The header and popover changes are local edits to `ProjectHeader.tsx` and `GoalMetaPopover.tsx`.

**Tech Stack:** React 19, TypeScript, Tailwind, Vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-08-16-goal-page-density-design.md`

## Global Constraints

- Run `npm test` and `npx tsc -b` before every commit.
- No literal hex colours, no arbitrary `text-[Nrem]`. `designScale.test.ts` fails the build on both.
- Permitted corner radii only: `[4px]`, `[6px]`, `rounded-field` (8px), `rounded-card` (12px), `rounded-full`.
- `border-dashed` is reserved for the drop preview and guessed-hour calendar blocks. Do not use it.
- No uppercase in the UI face. All-caps travels with `font-mono` only.
- Hover-revealed controls carry the `@media (hover: hover)` gate and a 24px target floor. Never hand-roll `opacity-0 group-hover:opacity-100`.
- `.quiet-control` requires a **literal** `.group` ancestor. `group/name` does not match it (`index.css:240`).
- Do not modify `HEALTH_TONE` (`src/lib/health.ts:38–44`) or any tone in `src/lib/rowSchedule.ts`. Those colours are already correct.
- The canonical verb for adding a task is **`Add task`**, matching `src/lib/rowActions.ts:79`.
- Views stay thin and delegate to `actions`. New pure logic goes in `src/lib` with a sibling `*.test.ts`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/rowMeta.ts` (create) | `metaPlacement(node, today)` — the sole decision of where a leaf's metadata renders. |
| `src/lib/rowMeta.test.ts` (create) | Unit tests for the above. |
| `src/components/GoalTree.tsx` (modify) | Row becomes a two-column grid; new `LeafMeta` component; nested add input reveals on subtree hover/focus; copy fix. |
| `src/components/GoalTree.meta.test.tsx` (create) | Placement rendering, keyboard reachability, copy consistency. |
| `src/index.css` (modify) | `.subtree-reveal` — the hover/focus gate for the nested add input. |
| `src/views/project/ProjectHeader.tsx` (modify) | Health pill; remove the demand control. |
| `src/views/project/GoalMetaPopover.tsx` (modify) | Add the Focus row as an inline segmented control. |
| `src/views/project/GoalMetaPopover.test.tsx` (create) | Focus sets demand, Escape does not close, completed goal withholds it. |

---

### Task 1: `metaPlacement` — the placement decision

**Files:**
- Create: `src/lib/rowMeta.ts`
- Test: `src/lib/rowMeta.test.ts`

**Interfaces:**
- Consumes: `scheduleCell(n: GoalNode, today: string): ScheduleCell | null` from `src/lib/rowSchedule.ts`; `stepStatus(n): StepStatus` from `src/lib/status.ts`.
- Produces: `export type MetaPlacement = 'below' | 'inline'` and `export function metaPlacement(n: GoalNode, today: string): MetaPlacement`. Task 2 imports both.

- [ ] **Step 1: Write the failing test**

Create `src/lib/rowMeta.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GoalNode } from '../db/types';
import { metaPlacement } from './rowMeta';

const TODAY = '2026-08-16';
const leaf = (extra: Partial<GoalNode> = {}): GoalNode => ({ id: 'a', title: 'a', ...extra });

describe('metaPlacement', () => {
  it('is "inline" for a leaf carrying nothing to say', () => {
    expect(metaPlacement(leaf(), TODAY)).toBe('inline');
  });

  it('is "below" for a leaf committed to a week', () => {
    expect(metaPlacement(leaf({ plannedWeek: '2026-08-10' }), TODAY)).toBe('below');
  });

  it('is "below" for a leaf with a deadline', () => {
    expect(metaPlacement(leaf({ deadline: '2026-08-20' }), TODAY)).toBe('below');
  });

  it('is "below" for a leaf with a placed sitting', () => {
    const n = leaf({ blocks: [{ id: 'b1', date: '2026-08-18', startMin: 540, minutes: 60 }] });
    expect(metaPlacement(n, TODAY)).toBe('below');
  });

  it('is "below" for a leaf with an estimate and nothing else', () => {
    expect(metaPlacement(leaf({ estimateMin: 45 }), TODAY)).toBe('below');
  });

  it('is "below" for a leaf whose demand is SET on the node', () => {
    expect(metaPlacement(leaf({ demand: 'deep' }), TODAY)).toBe('below');
  });

  it('is "below" for a blocked leaf that names its reason', () => {
    expect(metaPlacement(leaf({ status: 'blocked', blockedOn: 'waiting on Sam' }), TODAY)).toBe('below');
  });

  it('is "inline" for a blocked leaf with no reason typed', () => {
    expect(metaPlacement(leaf({ status: 'blocked' }), TODAY)).toBe('inline');
  });

  // scheduleCell returns null for a done leaf (rowSchedule.ts:65) — a finished
  // task's schedule is history. The estimate is not, so it still earns line 2.
  it('is "inline" for a DONE leaf whose only metadata was its schedule', () => {
    expect(metaPlacement(leaf({ status: 'done', plannedWeek: '2026-08-10' }), TODAY)).toBe('inline');
  });

  it('is "below" for a DONE leaf that still carries an estimate', () => {
    expect(metaPlacement(leaf({ status: 'done', estimateMin: 30 }), TODAY)).toBe('below');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rowMeta.test.ts`
Expected: FAIL — `Failed to resolve import "./rowMeta"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/rowMeta.ts`:

```ts
import type { GoalNode } from '../db/types';
import { scheduleCell } from './rowSchedule';
import { stepStatus } from './status';

/**
 * Where a leaf's metadata renders — and therefore why the row has no column
 * headers.
 *
 * The row used to pin WHEN and the estimate to the right edge at `w-[92px]`
 * and `w-[56px]` while the title took `flex-1`, so a short title left ~700px
 * of nothing between a task and its own figures. `2h25` at the far edge needs
 * a caption; `Aug 13 11:20am · 2h25` directly under its own title does not.
 *
 * A leaf with NOTHING to say is the load-bearing case. It still needs its
 * scheduling affordance, and if that appeared as a second LINE on hover, every
 * row you passed would grow and shove the list down. So it renders `inline`,
 * on the line that already exists, and the row never changes height on hover.
 */
export type MetaPlacement = 'below' | 'inline';

/**
 * Leaves only. A container's `pct`, derived `blocked` word and demand chip stay
 * on line 1 and it has no line 2 — it carries no estimate and no schedule of
 * its own by design (`setNodeEstimate` refuses one; a group is scheduled
 * through its tasks).
 */
export function metaPlacement(n: GoalNode, today: string): MetaPlacement {
  if (scheduleCell(n, today) !== null) return 'below';
  if (n.estimateMin !== undefined) return 'below';
  // The RAW field, never the resolved value: `demandIndex` inherits a goal's
  // value onto every leaf, and thirty rows saying "Deep" is a column that says
  // one word thirty times.
  if (n.demand !== undefined) return 'below';
  if (stepStatus(n) === 'blocked' && n.blockedOn) return 'below';
  return 'inline';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/rowMeta.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b
git add src/lib/rowMeta.ts src/lib/rowMeta.test.ts
git commit -m "feat(tree): one function decides where a leaf's metadata sits"
```

---

### Task 2: The row becomes two lines

**Files:**
- Modify: `src/components/GoalTree.tsx` — the `NodeRow` return block (currently `741–992`) and `ROW_CLS` (`737–739`)
- Test: `src/components/GoalTree.meta.test.tsx` (create)

**Interfaces:**
- Consumes: `metaPlacement`, `MetaPlacement` from Task 1.
- Produces: a module-local `LeafMeta` component. Not exported; no later task depends on it.

**A note on what can and cannot be tested here.** The guarantee is "a bare row does not change height on hover." jsdom reports zero layout, so this **cannot** be asserted as a pixel measurement. The structural property that produces it is testable and is what we assert: a bare row renders **no second-line element at all**, and its schedule trigger is a descendant of the line-1 element. If that holds, there is no element whose appearance could change the row's height. Do not write a test that reads `offsetHeight` — it will pass vacuously at 0.

- [ ] **Step 1: Write the failing test**

Create `src/components/GoalTree.meta.test.tsx`. The mock block is copied verbatim from `GoalTree.demand.test.tsx:17–63` — the store imports `db/db` and `lib/tabLock` at module load and both must be mocked before `initStore`.

```tsx
// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, GoalNode } from '../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[] }> => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async (): Promise<AvailabilityWindow[]> => [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, startMin: 540, endMin: 1080 }))),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  saveSidebarPanels: vi.fn(async () => {}),
  loadPlanMode: vi.fn(async () => 'week' as const),
  savePlanMode: vi.fn(async () => {}),
  loadGoalsMode: vi.fn(async (): Promise<'board' | 'timeline'> => 'board'),
  saveGoalsMode: vi.fn(async () => {}),
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
  isSlotMigrationDone: vi.fn(async () => true),
  saveSlotMigrationSnapshot: vi.fn(async () => {}),
  loadSlotMigrationSnapshot: vi.fn(async () => null),
  markSlotMigrationDone: vi.fn(async () => {}),
  isCheckpointMigrationDone: vi.fn(async () => true),
  saveCheckpointMigrationSnapshot: vi.fn(async () => {}),
  loadCheckpointMigrationSnapshot: vi.fn(async () => null),
  markCheckpointMigrationDone: vi.fn(async () => {}),
  loadActiveFocusSession: vi.fn(async () => null),
  saveActiveFocusSession: vi.fn(async () => {}),
  loadAssistantAccelerator: vi.fn(async () => 'Command+Space'),
  saveAssistantAccelerator: vi.fn(async () => {}),
  loadStoredTimeLevel: vi.fn(async () => null),
  saveStoredTimeLevel: vi.fn(async () => {}),
  loadStoredFocusLevel: vi.fn(async () => null),
  saveStoredFocusLevel: vi.fn(async () => {}),
}));
vi.mock('../db/db', () => dbMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

async function renderTree(nodes: GoalNode[]): Promise<void> {
  vi.resetModules();
  const goal: Goal = { id: 'g', title: 'Systems', column: 0, nodes: structuredClone(nodes) };
  dbMocks.loadState.mockResolvedValueOnce({ goals: [goal], habits: [], tasks: [], sessions: [] });
  const store = await import('../state/store');
  await store.initStore();
  store.actions.openProject('g');
  const { GoalTree } = await import('./GoalTree');
  const TreeHost = () => {
    const { goals } = store.useAppStore();
    return createElement(GoalTree, { nodes: goals[0].nodes });
  };
  render(createElement(TreeHost));
}

const row = (title: string) => screen.getByText(title).closest('[data-row]') as HTMLElement;

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('a leaf with metadata', () => {
  it('renders its schedule on the second line, not in a right-edge cell', async () => {
    await renderTree([{ id: 'a', title: 'Ship it', plannedWeek: '2026-08-10' }]);
    const meta = within(row('Ship it')).getByTestId('row-meta-below');
    expect(within(meta).getByRole('button', { name: /Schedule|Scheduled/ })).toBeTruthy();
  });

  it('puts the estimate on that same second line', async () => {
    await renderTree([{ id: 'a', title: 'Ship it', estimateMin: 45 }]);
    const meta = within(row('Ship it')).getByTestId('row-meta-below');
    expect(within(meta).getByText(/45m/)).toBeTruthy();
  });
});

describe('a leaf with nothing to say', () => {
  // The reflow guarantee. jsdom has no layout, so we assert the STRUCTURE that
  // produces it: there is no second-line element, so nothing can appear below
  // the title and push the list down.
  it('renders NO second line at all', async () => {
    await renderTree([{ id: 'a', title: 'Bare task' }]);
    expect(within(row('Bare task')).queryByTestId('row-meta-below')).toBeNull();
  });

  it('carries its schedule control inline, on the line that already exists', async () => {
    await renderTree([{ id: 'a', title: 'Bare task' }]);
    const inline = within(row('Bare task')).getByTestId('row-meta-inline');
    expect(within(inline).getByRole('button', { name: /Schedule/ })).toBeTruthy();
  });

  // The whole point of one component in two positions: hovering a bare row must
  // reveal the SAME controls a populated row shows, not a reduced set.
  //
  // Asserted as "both kinds of control are present in both placements", NOT as
  // string equality of their labels. The labels SHOULD differ — an unset
  // control says `Schedule "X"` / `Set estimate for "X"` while a set one says
  // `Scheduled This week. Change it` / `Estimate for "X": 45m. Change it`,
  // because each names its own state. A test demanding they match would be
  // asserting a bug.
  it('offers the same two controls in both placements', async () => {
    await renderTree([{ id: 'a', title: 'Bare task' }, { id: 'b', title: 'Full task', estimateMin: 45 }]);
    const bare = within(row('Bare task')).getByTestId('row-meta-inline');
    const full = within(row('Full task')).getByTestId('row-meta-below');

    expect(within(bare).getByRole('button', { name: /^Schedule "/ })).toBeTruthy();
    expect(within(bare).getByRole('button', { name: /^Set estimate for "/ })).toBeTruthy();

    expect(within(full).getByRole('button', { name: /^Schedule "/ })).toBeTruthy();
    expect(within(full).getByRole('button', { name: /^Estimate for ".*": 45m/ })).toBeTruthy();

    // Neither placement holds a control the other lacks.
    expect(within(bare).getAllByRole('button')).toHaveLength(within(full).getAllByRole('button').length);
  });
});

describe('a container', () => {
  it('keeps its percentage on line 1 and has no second line', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    const parent = row('Parent');
    expect(within(parent).getByText('0%')).toBeTruthy();
    expect(within(parent).queryByTestId('row-meta-below')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/GoalTree.meta.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="row-meta-below"]`.

- [ ] **Step 3: Add the `LeafMeta` component**

In `src/components/GoalTree.tsx`, add the import at the top alongside the existing `scheduleCell` import (line 30):

```ts
import { metaPlacement, type MetaPlacement } from '../lib/rowMeta';
```

Then add this component immediately above `function AddChildInput` (near line 1043):

```tsx
/**
 * A leaf's metadata — demand, WHEN, estimate, blocked reason — in ONE component
 * rendered in either of two positions.
 *
 * One component and not two so the placements cannot drift in what they hold.
 * The point of the inline case is that hovering a bare row reveals exactly the
 * controls a populated row already shows; two components would let that
 * quietly stop being true.
 */
function LeafMeta({
  node: n,
  goalId,
  when,
  placement,
  scheduleRef,
  estimateOpen,
  onEstimate,
}: {
  node: GoalNode;
  goalId: string;
  when: ReturnType<typeof scheduleCell>;
  placement: MetaPlacement;
  scheduleRef: React.RefObject<HTMLButtonElement | null>;
  estimateOpen: number;
  onEstimate: (minutes: number | undefined) => void;
}) {
  const inline = placement === 'inline';
  return (
    <span
      data-testid={inline ? 'row-meta-inline' : 'row-meta-below'}
      className={
        inline
          ? 'flex-none flex items-center gap-[2px]'
          : 'flex items-center gap-[6px] flex-wrap min-w-0'
      }
      onClick={(e) => e.stopPropagation()}
    >
      {/* The chip marks a CHANGE in demand, never a repetition — the condition
          is the RAW field, so a `deep` goal draws zero chips on its leaves. */}
      {n.demand !== undefined && (
        <span className="text-meta text-muted flex-none truncate">{DEMAND_WORD[n.demand]}</span>
      )}

      <Popover
        label={when?.text ? `Scheduled ${when.text}. Change it` : `Schedule "${n.title}"`}
        role="menu"
        align={inline ? 'end' : 'start'}
        panelWidth={188}
        triggerRef={scheduleRef}
        triggerClassName={`text-meta tabular-nums truncate rounded-[4px] px-[5px] py-[3px] min-h-[24px] inline-flex items-center hover:bg-hover hover:text-ink ${
          when?.tone === 'warn' ? 'text-warn' : when?.text ? 'text-muted' : 'text-faint quiet-control'
        }`}
        trigger={when?.text ?? 'plan'}
      >
        {(close) => <ScheduleMenu goalId={goalId} node={n} close={close} />}
      </Popover>

      <EstimateControl
        minutes={n.estimateMin}
        label={n.title}
        openRequest={estimateOpen}
        onChange={onEstimate}
      />

      {/* Why a blocked leaf is stuck. It stays OUT of the status control:
          hiding it behind the thing that set the status would let the row say
          "blocked" without ever saying what by. */}
      {stepStatus(n) === 'blocked' && n.blockedOn && (
        <span className="text-meta text-muted truncate max-w-[220px]" title={n.blockedOn}>
          {n.blockedOn}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Restructure the row into two columns**

In `NodeRow`, add this line next to the existing `const when = scheduleCell(n, todayStr());` (line 484):

```ts
const placement: MetaPlacement = hasKids ? 'inline' : metaPlacement(n, todayStr());
```

Replace `ROW_CLS` (lines 737–739) with:

```ts
// The row is a two-column grid now, not one flex line. Column 1 holds the
// leading controls; column 2 stacks the title over its metadata, which is what
// deletes the ~700px gutter the pinned right-edge cells used to leave.
//
// `items-start`, so the leading controls stay aligned to line 1 rather than
// centring themselves across a two-line row.
// `group` stays LITERAL: `.quiet-control` matches `.group`, not `group/name`.
const ROW_CLS =
  'grid grid-cols-[auto_1fr] gap-x-[9px] items-start px-[6px] py-[4px] rounded-[6px] hover:bg-hover group cursor-pointer ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-0';
```

Now replace the row's children. The opening `<div>` with all its ARIA and handlers (lines 748–772) is **unchanged**. Replace everything from the drag-handle button (line 776) through the closing `</span>` of `RowActions` (line 992) with:

```tsx
        {/* ── column 1: leading controls, pinned to line 1 ── */}
        <div className="flex items-center gap-[9px] min-h-[26px]">
          {/* Drag handle — {listeners} here, NOT on the whole row, to avoid
              colliding with row-level Space/Arrow handlers. */}
          <button
            type="button"
            {...attributes}
            {...listeners}
            tabIndex={-1}
            aria-label="Drag to reorder"
            onClick={(e) => e.stopPropagation()}
            className="quiet-control w-[24px] h-[24px] -mx-[5px] flex-shrink-0 text-faint cursor-grab active:cursor-grabbing"
          >
            <IconGrip size={13} />
          </button>

          {hasKids ? (
            <button
              type="button"
              aria-expanded={isOpen}
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              tabIndex={-1}
              className="w-[24px] h-[24px] -mx-[5px] flex-shrink-0 grid place-items-center text-faint transition-transform duration-150 rounded-[4px] hover:bg-hover"
              style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
              onClick={(e) => {
                e.stopPropagation();
                actions.toggleExpand(n.id);
              }}
            >
              <IconChevronRight size={13} />
            </button>
          ) : (
            <span className="w-[14px] h-[14px] flex-shrink-0" aria-hidden="true" />
          )}

          {!hasKids && (
            <LeafStatusBox
              status={stepStatus(n)}
              onToggle={() => actions.toggleLeaf(n.id)}
              label={`Mark "${n.title}" as done`}
            />
          )}

          {n.checkpoint && (
            <span className="text-accent flex-shrink-0 inline-flex" aria-hidden="true">
              <IconDiamond size={9} />
            </span>
          )}
        </div>

        {/* ── column 2: the title, and under it what the task says about itself ── */}
        <div className="min-w-0">
          <div className="flex items-center gap-[9px] min-h-[26px]">
            {/* A container's demand chip has no line 2 to go to. */}
            {hasKids && n.demand !== undefined && (
              <span className="text-meta text-muted flex-none truncate">{DEMAND_WORD[n.demand]}</span>
            )}

            {editing ? (
              <InlineEdit
                value={n.title}
                className={`flex-1 text-lead ${
                  hasKids ? 'font-semibold text-ink' : isDone(n) ? 'line-through text-muted' : 'text-ink-soft'
                }`}
                onCommit={commitRename}
                onCancel={() => setEditing(false)}
              />
            ) : (
              /* The title lets its clicks through: under a row click that merely
                 opens the inspector there is nothing to defend against, and
                 swallowing it would make the largest part of the row the one
                 part that does not open it. `truncate` because the title is the
                 one user string here with no bound. */
              <span
                className={`flex-1 min-w-0 truncate text-lead select-none ${
                  hasKids
                    ? 'font-semibold text-ink'
                    : isDone(n)
                      ? 'line-through text-muted'
                      : 'text-ink-soft'
                }`}
                title={n.title}
                onDoubleClick={() => setEditing(true)}
              >
                {n.title}
              </span>
            )}

            {hasKids && (
              <span className="text-compact text-muted tabular-nums flex-shrink-0">
                {Math.round(nodePct(n))}%
              </span>
            )}

            {/* A container's status is DERIVED, never stored — see containerStatus. */}
            {hasKids && containerStatus(n) === 'blocked' && (
              <span className="text-meta text-warn flex-shrink-0">blocked</span>
            )}

            {/* A container's read-only WHEN readout keeps its place: it has no
                second line, and it is narrow enough not to leave a gutter. */}
            {hasKids && when?.text && (
              <span
                className={`text-meta tabular-nums truncate flex-none px-[5px] py-[3px] ${
                  when.tone === 'warn' ? 'text-warn' : 'text-muted'
                }`}
                title={when.hint}
              >
                {when.text}
              </span>
            )}

            {/* A bare leaf's metadata rides HERE — on the line that already
                exists — so hovering it reveals controls without changing the
                row's height. */}
            {!hasKids && placement === 'inline' && (
              <LeafMeta
                node={n}
                goalId={goalId}
                when={when}
                placement="inline"
                scheduleRef={scheduleRef}
                estimateOpen={estimateOpen}
                onEstimate={(minutes) => actions.setNodeEstimate(n.id, minutes)}
              />
            )}

            {/* Cycle status — leaves only. The one control that stayed on the
                row while rename, add-subtask and delete moved into `⋯`, because
                it is the only one of the four that is also a READOUT. */}
            {!hasKids && (
              <button
                type="button"
                tabIndex={-1}
                className="quiet-control flex-none"
                aria-label={`Change status of "${n.title}"`}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.setNodeStatus(n.id, cycleStatus(stepStatus(n)));
                }}
              >
                ◐
              </button>
            )}

            <span onClick={(e) => e.stopPropagation()} className="flex-none">
              <RowActions
                node={n}
                isFirstSibling={isFirstSibling}
                depth={depth}
                onRename={() => setEditing(true)}
                onEstimate={() => setEstimateOpen((c) => c + 1)}
                onSchedule={() => scheduleRef.current?.click()}
              />
            </span>
          </div>

          {!hasKids && placement === 'below' && (
            <div className="mt-[1px]">
              <LeafMeta
                node={n}
                goalId={goalId}
                when={when}
                placement="below"
                scheduleRef={scheduleRef}
                estimateOpen={estimateOpen}
                onEstimate={(minutes) => actions.setNodeEstimate(n.id, minutes)}
              />
            </div>
          )}
        </div>
```

- [ ] **Step 5: Run the new test**

Run: `npx vitest run src/components/GoalTree.meta.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the whole suite — this is the step that matters**

Run: `npm test`

Expected: PASS. Four existing suites touch this row and are the real gate:
`GoalTree.demand.test.tsx`, `GoalTree.rowActions.test.tsx`, `GoalTree.selection.test.tsx`, `GoalTree.status.test.tsx`.

If a selection test fails, check the capture-phase handler first: `handleRowClickCapture` must still be on the outer row div, and the two new column `<div>`s must **not** stop propagation — only `LeafMeta` and the `RowActions` wrapper do. If a test that dispatched at a right-edge cell fails, it is asserting the old column layout; update it to query by role/name rather than by position.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc -b
git add src/components/GoalTree.tsx src/components/GoalTree.meta.test.tsx
git commit -m "feat(tree): a task's metadata sits under its title, not 700px away"
```

---

### Task 3: The nested add input reveals, and one verb replaces three

**Files:**
- Modify: `src/index.css` — add `.subtree-reveal` beside `.quiet-control` (after line 241)
- Modify: `src/components/GoalTree.tsx:1027–1031` (the `role="group"` wrapper and `AddChildInput` call)
- Modify: `src/views/project/StepsTab.tsx:83`
- Test: `src/components/GoalTree.meta.test.tsx` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: CSS class `.subtree-reveal`, applied to an element inside a `.subtree` ancestor.

**Why a new class and not `group/sub`.** `.quiet-control`'s gate is written in raw CSS as `.group:not(:hover) .quiet-control` (`index.css:240`) — it matches the literal `.group` class only. The row already declares `group`, and Tailwind's bare `group` does not nest, so a second `group` on the subtree wrapper would be shadowed by the row's. Routing the add input through `.quiet-control` would also be wrong: it would reveal on ROW hover, not subtree hover. A separate class pair is the smallest correct answer and mirrors the existing gate exactly, including the `@media (hover: hover)` clause that keeps it reachable on touch.

- [ ] **Step 1: Write the failing test**

Append to `src/components/GoalTree.meta.test.tsx`:

```tsx
describe('adding a task', () => {
  it('spells the verb the same way everywhere', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    // The nested input, inside the expanded container.
    expect(screen.getByPlaceholderText('+ Add task')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/add item/i)).toBeNull();
  });

  // opacity:0 elements stay in the a11y tree and stay focusable, which is the
  // whole reason the gate is opacity and not `display:none` or conditional
  // rendering. Hover alone would strand this input for keyboard users.
  it('leaves the nested input reachable by keyboard, not hover alone', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    const input = screen.getByPlaceholderText('+ Add task');
    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it('gates the nested input on subtree hover, not row hover', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    const input = screen.getByPlaceholderText('+ Add task');
    const wrap = input.closest('.subtree-reveal');
    expect(wrap).not.toBeNull();
    expect(wrap!.closest('.subtree')).not.toBeNull();
    // Never the row's own gate — that would reveal on the wrong hover.
    expect(input.closest('.quiet-control')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/GoalTree.meta.test.tsx -t "adding a task"`
Expected: FAIL — `Unable to find an element with the placeholder text of: + Add task`.

- [ ] **Step 3: Add the CSS gate**

In `src/index.css`, immediately after the `.quiet-control` block's closing `}` (line 241), add:

```css
  /* The nested "+ Add task" input, gated on its SUBTREE rather than its row.
     A separate class pair because `.quiet-control` matches the literal `.group`
     the row already owns — reusing it would reveal this input on row hover,
     which is the wrong hover, and Tailwind's bare `group` does not nest.
     `:focus-within` and opacity (rather than `display:none`) are what keep the
     input reachable by keyboard; the hover gate is what keeps it visible on
     touch, where `:hover` never resolves. */
  .subtree-reveal {
    opacity: 1;
    transition: opacity .12s;
  }
  @media (hover: hover) {
    .subtree:not(:hover) .subtree-reveal:not(:focus-within) { opacity: 0; }
  }
```

- [ ] **Step 4: Apply it in the tree**

In `src/components/GoalTree.tsx`, change the `role="group"` wrapper (line 1013) to carry the `subtree` class:

```tsx
          <div role="group" id={groupId} className="subtree">
```

and change the `AddChildInput` call (lines 1027–1031) to:

```tsx
            <AddChildInput
              indent={(depth + 1) * 22}
              placeholder="+ Add task"
              className="subtree-reveal"
              onAdd={(title) => actions.addChild(n.id, title)}
            />
```

Then give `AddChildInput` (line 1047) the new prop:

```tsx
function AddChildInput({
  indent,
  placeholder,
  className,
  onAdd,
}: {
  indent: number;
  placeholder: string;
  className?: string;
  onAdd: (title: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ marginLeft: indent }} className={`px-[6px] py-[2px] ${className ?? ''}`}>
      <input
        ref={ref}
        className="ghost-in w-full text-body"
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && ref.current) {
            const v = ref.current.value.trim();
            if (v) {
              onAdd(v);
              ref.current.value = '';
            }
          }
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Fix the root input's copy**

In `src/views/project/StepsTab.tsx`, change line 83 from:

```tsx
            placeholder={hasSteps ? '+ add task…' : '+ add the first task…'}
```

to:

```tsx
            placeholder={hasSteps ? '+ Add task' : '+ Add the first task'}
```

The root input keeps no reveal gate — it is the page's one standing invitation, and a goal with no tasks has no subtree to hover.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/GoalTree.meta.test.tsx`
Expected: PASS, 9 tests.

Run: `npm test`
Expected: PASS. Any suite querying `+ add task…` or `+ add item…` needs its string updated.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc -b
git add src/index.css src/components/GoalTree.tsx src/components/GoalTree.meta.test.tsx src/views/project/StepsTab.tsx
git commit -m "feat(tree): one verb for adding a task, and no ghost input per container"
```

---

### Task 4: The header's health becomes one object

**Files:**
- Modify: `src/views/project/ProjectHeader.tsx:120–124` (the pill) and `163–194` (remove the demand control)
- Test: `src/views/project/ProjectHeader.test.tsx` (append)

**Interfaces:**
- Consumes: `HEALTH_TONE`, `HEALTH_WORD` from `src/lib/health.ts` — **unmodified**.
- Produces: nothing consumed by later tasks. Task 5 depends on the demand control being gone from here.

**The pill earns focus through weight and ground, never hue.** `HEALTH_TONE` maps `on-track` and `tight` to `text-ink-soft` and only `at-risk`/`blocked` to `text-warn`. That restraint is already correct and is not touched: on a healthy goal the header stays entirely neutral, and colour arrives only when the verdict turns.

- [ ] **Step 1: Write the failing test**

Append to `src/views/project/ProjectHeader.test.tsx` (reuse whatever render helper that file already defines — do not add a second one):

```tsx
describe('the header after the density pass', () => {
  it('no longer carries a demand control — that is a property, and it lives with the properties', async () => {
    await renderHeader({ id: 'g', title: 'Systems', column: 0, nodes: [] });
    expect(screen.queryByRole('button', { name: /Focus needed/ })).toBeNull();
  });

  it('states health as one object', async () => {
    await renderHeader({ id: 'g', title: 'Systems', column: 0, nodes: [] });
    const pill = screen.getByTestId('health-pill');
    expect(pill.className).toContain('rounded-[4px]');
    expect(pill.className).toContain('font-semibold');
  });

  it('paints no warning colour on a goal that is not at risk', async () => {
    await renderHeader({ id: 'g', title: 'Systems', column: 0, nodes: [] });
    expect(screen.getByTestId('health-pill').className).not.toContain('text-warn');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/project/ProjectHeader.test.tsx -t "density pass"`
Expected: FAIL — `Unable to find an element by: [data-testid="health-pill"]`.

- [ ] **Step 3: Make the health word a pill**

Replace lines 122–124 of `src/views/project/ProjectHeader.tsx`:

```tsx
          <span className={`font-semibold whitespace-nowrap ${HEALTH_TONE[verdict.health]}`}>
            {HEALTH_WORD[verdict.health]}
          </span>
```

with:

```tsx
          {/* One object, not the first link in a four-fact chain. It earns the
              eye through weight and ground — never hue: HEALTH_TONE already
              reserves colour for at-risk and blocked, so a healthy goal's
              header stays entirely neutral and colour means something when it
              finally arrives. */}
          <span
            data-testid="health-pill"
            className={`font-semibold whitespace-nowrap px-[7px] py-[2px] rounded-[4px] bg-hover ${HEALTH_TONE[verdict.health]}`}
          >
            {HEALTH_WORD[verdict.health]}
          </span>
```

- [ ] **Step 4: Remove the demand control from the header**

Delete lines 158–194 entirely — the comment block beginning `{/* The whole project's demand, ...` through the closing `)}` of the `!isCompleted &&` guard around the `Popover`.

Then remove the now-unused imports. `DEMANDS`, `DEMAND_WORD`, `Popover` and `PropertyOption` move to `GoalMetaPopover` in Task 5. Delete these three lines (11–13):

```ts
import { DEMANDS, DEMAND_WORD } from '../../lib/demand';
import { Popover } from '../../components/Popover';
import { PropertyOption } from '../../components/PropertyRow';
```

`npx tsc -b` will fail loudly if any of them is still referenced.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/views/project/ProjectHeader.test.tsx`
Expected: PASS. If an existing test asserts the `Focus` trigger, delete that test — Task 5 rewrites the same assertion against the popover, so the coverage moves rather than disappears.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -b
git add src/views/project/ProjectHeader.tsx src/views/project/ProjectHeader.test.tsx
git commit -m "feat(project): health is one object, and Focus leaves the header line"
```

---

### Task 5: Focus lands in `GoalMetaPopover` as an inline control

**Files:**
- Modify: `src/views/project/GoalMetaPopover.tsx` — add a `goalCompleted`-aware Focus row above the `dl` (line 165)
- Test: `src/views/project/GoalMetaPopover.test.tsx` (create)

**Interfaces:**
- Consumes: `DEMANDS`, `DEMAND_WORD`, `type Demand` from `src/lib/demand.ts`; `actions.setGoalDemand(goalId, demand | null)`.
- Produces: nothing consumed later. Final task.

**It is an inline segmented control, and that is forced, not stylistic.** `GoalMetaPopover` is a hand-rolled `role="dialog"` registering its own capture-phase Escape listener on `window` (lines 63–72). A `Popover` opened inside it would register a **second** capture listener on the same node, and capture listeners on one node fire in registration order — the meta popover always registers first, because it opened first. `stopPropagation` does not reach a sibling listener on the same target. One Escape would therefore close both. This is exactly the failure CLAUDE.md documents for `Modal`, and the `data-popover-open` mechanism that solves it lives in `Modal`, not here. Three values plus "Not set" do not need a disclosure, so the correct answer is to have no second popover at all.

- [ ] **Step 1: Write the failing test**

Create `src/views/project/GoalMetaPopover.test.tsx`. Copy the `dbMocks` hoisted block and the two `vi.mock` calls verbatim from `src/components/GoalTree.demand.test.tsx:17–55` — this file needs the same store bootstrap.

```tsx
// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal } from '../../db/types';

// ── paste dbMocks + the two vi.mock calls from GoalTree.demand.test.tsx here,
//    changing the mock paths to '../../db/db' and '../../lib/tabLock' ──

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

async function renderPopover(goal: Goal) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({ goals: [goal], habits: [], tasks: [], sessions: [] });
  const store = await import('../../state/store');
  await store.initStore();
  const { GoalMetaPopover } = await import('./GoalMetaPopover');
  const { goalEffort } = await import('../../lib/effort');
  const { goalHealth } = await import('../../lib/health');
  const onClose = vi.fn();
  const effort = goalEffort(goal);
  const Host = () => {
    const { goals } = store.useAppStore();
    const g = goals[0];
    return createElement(GoalMetaPopover, {
      goal: g,
      actions: store.actions,
      effort,
      verdict: goalHealth({ goal: g, effort, today: '2026-08-16', windows: [], blocks: [], allDayBlocks: true }),
      draftStart: '', draftDeadline: '',
      onDraftChange: () => {}, onClose,
    });
  };
  render(createElement(Host));
  return { store, onClose };
}

const OPEN: Goal = { id: 'g', title: 'Systems', column: 0, nodes: [] };

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('Focus, inside the status popover', () => {
  it('sets the goal demand', async () => {
    const { store } = await renderPopover(OPEN);
    fireEvent.click(screen.getByRole('radio', { name: 'Deep' }));
    expect(store.getState().goals[0].demand).toBe('deep');
  });

  it('offers Not set, and clearing writes null', async () => {
    const { store } = await renderPopover({ ...OPEN, demand: 'deep' });
    fireEvent.click(screen.getByRole('radio', { name: 'Not set' }));
    expect(store.getState().goals[0].demand).toBeUndefined();
  });

  // The regression the inline control exists to prevent. A nested Popover would
  // register a SECOND capture-phase Escape listener on window, behind this
  // dialog's own, and one press would close both.
  it('does not close the popover when Escape is pressed inside the Focus control', async () => {
    const { onClose } = await renderPopover(OPEN);
    const radio = screen.getByRole('radio', { name: 'Deep' });
    radio.focus();
    fireEvent.keyDown(radio, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });
    // One Escape, one dismissal — never two surfaces for one press.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('withholds the control on a completed goal, like every other editor', async () => {
    await renderPopover({ ...OPEN, completedAt: '2026-08-01' });
    expect(screen.queryByRole('radiogroup', { name: 'Focus needed' })).toBeNull();
  });
});
```

`getState(): FullState` is the store's read outside a component (`src/state/store.ts:703`). There is no `getSnapshot` export — do not reach for one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/project/GoalMetaPopover.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "radio"`.

- [ ] **Step 3: Add the import**

At the top of `src/views/project/GoalMetaPopover.tsx`, beside the other lib imports:

```ts
import { DEMANDS, DEMAND_WORD } from '../../lib/demand';
```

- [ ] **Step 4: Add the Focus row**

Insert this immediately before the `<dl ...>` (line 165), so Focus sits between the dates block and the read-only figures — an editor among editors, above the things that only report:

```tsx
      {/* Focus needed — an INLINE segmented control, never a nested Popover.
          This dialog registers its own capture-phase Escape listener on window
          (above); a Popover inside it would register a second one on the same
          node, capture listeners on one node fire in registration order, and
          this one always registers first because it opened first. One Escape
          would close both. Three values plus "Not set" do not need a
          disclosure, so the fix is to have no second popover at all.

          Withheld on a completed goal, like every other editor that writes to
          a frozen project — the header gated this and the gate has to travel
          with the control. */}
      {!g.completedAt && (
        <div className="mt-[12px] pt-[12px] border-t border-line">
          <div className="text-meta font-[550] text-muted mb-[6px]">Focus needed</div>
          <div role="radiogroup" aria-label="Focus needed" className="flex flex-wrap gap-[4px]">
            {DEMANDS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={g.demand === d}
                onClick={() => actions.setGoalDemand(g.id, d)}
                className={`text-meta px-[8px] min-h-[24px] inline-flex items-center rounded-field ${
                  g.demand === d
                    ? 'bg-accent-tint text-accent-deep font-semibold'
                    : 'text-muted hover:bg-hover hover:text-ink'
                }`}
              >
                {DEMAND_WORD[d]}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={g.demand === undefined}
              onClick={() => actions.setGoalDemand(g.id, null)}
              className={`text-meta px-[8px] min-h-[24px] inline-flex items-center rounded-field ${
                g.demand === undefined
                  ? 'bg-accent-tint text-accent-deep font-semibold'
                  : 'text-muted hover:bg-hover hover:text-ink'
              }`}
            >
              Not set
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/views/project/GoalMetaPopover.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Full suite and typecheck**

Run: `npm test && npx tsc -b`
Expected: PASS across the board.

- [ ] **Step 7: Commit**

```bash
git add src/views/project/GoalMetaPopover.tsx src/views/project/GoalMetaPopover.test.tsx
git commit -m "feat(project): Focus is a property, so it lives with the properties"
```

---

### Task 6: See it in the real app

**Files:** none — this is a verification task, and it exists because every test above runs in jsdom, which has no layout.

- [ ] **Step 1: Build and launch**

```bash
npm run build && npm run app:dev
```

- [ ] **Step 2: Check the four things jsdom could not**

Open a goal with a mix of scheduled and bare tasks, on the Tasks tab.

1. **Hover slowly down the list.** Nothing below the cursor may shift. This is the guarantee Task 2's structural test only approximates — it is the single most important check here.
2. **Drag a two-line row past a one-line row and back.** dnd-kit measures at drag start; confirm the drop indicator lands where it looks like it will.
3. **Hover a container's subtree.** `+ Add task` appears. Tab into it from the last child row — it must become visible on focus, not stay at `opacity: 0`.
4. **Open the status popover and press Escape once inside the Focus control.** Exactly one thing closes.

- [ ] **Step 3: Check both themes**

Toggle dark. The health pill's `bg-hover` ground must remain visible against `#1E1D1B` panel without reading as a button.

- [ ] **Step 4: Report**

Note anything that needs adjusting. Row metrics (`min-h-[26px]`, `mt-[1px]`) are the likely candidates — they are the one part of this plan chosen by eye rather than derived, and they should be tuned against the real thing.

---

## Self-Review

**Spec coverage.** Every section maps to a task: §1 row/two-line → Tasks 1–2; §2 header pill → Task 4; §3 Focus → Task 5; §4 copy and clutter → Task 3 (truncation folded into Task 2 Step 4, where the title is already being rewritten); §5 out-of-scope → nothing built, and no task adds a footer, column header, progress bar or typed confirmation. The three §Risks are covered by Task 6 steps 2.1, 2.2 and Task 3's `.subtree-reveal` design note.

**Type consistency.** `metaPlacement` and `MetaPlacement` are named identically in Task 1's implementation and Task 2's import. `LeafMeta`'s `when` prop is typed `ReturnType<typeof scheduleCell>` (i.e. `ScheduleCell | null`), matching what `NodeRow` already holds. `AddChildInput` gains `className?: string` in Task 3 and both call sites are updated in the same step.

**Known soft spots, stated rather than hidden.**
- Task 2 Step 6 anticipates existing suites breaking. That is expected, not a defect — four suites assert against a row layout this task rewrites. The step says which and how to tell a real regression from a stale positional query.
- `min-h-[26px]` and `mt-[1px]` are eyeballed. Task 6 Step 4 exists to correct them.
