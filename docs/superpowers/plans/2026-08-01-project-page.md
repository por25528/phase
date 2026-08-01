# Project Page Implementation Plan (1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the modal project drawer with a tabbed full page, with no change to any data or any user-visible behaviour beyond the container.

**Architecture:** `ViewName` gains `'project'`. The existing `DrawerHeader`, `StepsSection`, `MilestonesSection` and `NotesSection` are moved out of `GoalDrawer.tsx` into `src/views/project/*` unchanged, then reassembled by a new `src/views/Project.tsx` that adds a breadcrumb and a two-tab bar. `GoalDrawer.tsx` is deleted along with its hand-rolled focus trap, scroll lock and `aria-modal` — a page needs none of them.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, Vitest (`node` env by default; component tests opt into jsdom per file).

**Source spec:** `docs/superpowers/specs/2026-08-01-project-page-and-notes-design.md` Part 1.

**This is plan 1 of 3.** Plan 2 (step panel + checkpoint migration) and plan 3 (notes editor + assets) are separate documents written after this one lands, because their tasks reference files this plan creates. This plan ships and is useful on its own.

## Global Constraints

- Run `npm test` and `npx tsc -b` before every commit (`CLAUDE.md`, Conventions).
- Visual identity is locked. No new colours, no literal hex, no arbitrary `text-[Nrem]` — `designScale.test.ts` fails the build on all three. Reuse existing theme tokens and the classes already present in `GoalDrawer.tsx`.
- Hover-revealed controls use `.quiet-control`, never a hand-rolled `opacity-0 group-hover:opacity-100`. It needs a literal `group` ancestor (`group/name` does not match).
- Views never call `db` directly. All mutations go through `actions`.
- New pure logic goes in `src/lib` with a sibling `*.test.ts`.
- Component tests must click the child a person actually hits, never the row element.
- This plan changes **no** persisted data and **no** type in `src/db/types.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/state/store.ts` (modify) | `'project'` view, `projectTab`, `openStepId`, `focusNodeId`; `openProject`/`closeProject`/`setProjectTab` |
| `src/views/project/ProjectHeader.tsx` (create) | Title, dates, progress, pace line — moved verbatim from `DrawerHeader` |
| `src/views/project/StepsTab.tsx` (create) | The step tree + add-step + subtask modal — moved verbatim from `StepsSection` |
| `src/views/project/NotesTab.tsx` (create) | Milestones + notes textarea — moved verbatim, replaced wholesale by plan 3 |
| `src/views/Project.tsx` (create) | Breadcrumb, tab bar, body — assembles the three above |
| `src/App.tsx` (modify) | Render `Project` for `view === 'project'`; stop rendering `GoalDrawer`; Escape handling |
| `src/components/GoalDrawer.tsx` (delete) | — |
| `src/views/project/Project.progress.test.tsx` (create) | Replaces `GoalDrawer.progress.test.tsx` |

Call sites updated in task 6: `src/views/Goals.tsx`, `src/views/timeline/GoalRow.tsx`, `src/views/timeline/NodeLane.tsx`, `src/views/plan/RecapPanel.tsx`, `src/App.tsx`.

---

## Task 1: Store — the `project` view and its navigation actions

**Files:**
- Modify: `src/state/store.ts:49` (`ViewName`), `:52-76` (`UIState`), `:86-100` (initial state), `:1672-1689` (`openDrawer`/`closeDrawer`)
- Test: `src/state/store.test.ts:1614-1662` (rewrite the `openDrawer node focus (T8)` block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type ViewName = 'plan' | 'goals' | 'timeline' | 'project'`
  - `openProject(goalId: string, nodeId?: string): void` — sets `view: 'project'`, `openGoalId`, `focusNodeId`, `openStepId`, and expands ancestors
  - `closeProject(): void` — returns to `view: 'goals'`, clears `openGoalId`/`focusNodeId`/`openStepId`
  - `setProjectTab(tab: ProjectTab): void`
  - `type ProjectTab = 'steps' | 'notes'`
  - State fields `projectTab: ProjectTab`, `openStepId: string | null`, `focusNodeId: string | null`

Note: `openStepId` is set by `openProject` and cleared by `closeProject` in this plan, but nothing reads it until plan 2. It is introduced here so the navigation contract is settled in one place.

- [ ] **Step 1: Write the failing tests**

Replace the whole `describe('openDrawer node focus (T8)', ...)` block at `src/state/store.test.ts:1614` with:

```ts
describe('openProject node focus (T8)', () => {
  const nested: Goal = {
    id: 'gp', title: 'Project', start: '2026-01-01', deadline: '2026-12-31', column: 0,
    nodes: [
      { id: 'root-a', title: 'Root A', children: [
        { id: 'mid', title: 'Mid', children: [{ id: 'leaf', title: 'Leaf', done: false }] },
      ] },
    ],
  };

  it('focuses a node: switches view, sets openGoalId + focusNodeId + openStepId, re-expands ancestors', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.toggleExpand('root-a'); // collapse what addGoals auto-expanded
    actions.toggleExpand('mid');
    expect(getState().expanded.has('root-a')).toBe(false);

    actions.openProject('gp', 'leaf');
    const s = getState();
    expect(s.view).toBe('project');
    expect(s.openGoalId).toBe('gp');
    expect(s.focusNodeId).toBe('leaf');
    expect(s.openStepId).toBe('leaf');
    expect(s.projectTab).toBe('steps');
    expect(s.expanded.has('root-a')).toBe(true);
    expect(s.expanded.has('mid')).toBe(true);
  });

  it('opens at the root when no node is given', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp');
    const s = getState();
    expect(s.view).toBe('project');
    expect(s.openGoalId).toBe('gp');
    expect(s.focusNodeId).toBeNull();
    expect(s.openStepId).toBeNull();
  });

  it('ignores an unknown node id but still opens the project', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp', 'ghost');
    const s = getState();
    expect(s.view).toBe('project');
    expect(s.openGoalId).toBe('gp');
    expect(s.focusNodeId).toBeNull();
    expect(s.openStepId).toBeNull();
  });

  it('always opens on the steps tab, even after the notes tab was last used', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp');
    actions.setProjectTab('notes');
    expect(getState().projectTab).toBe('notes');
    actions.closeProject();
    actions.openProject('gp');
    expect(getState().projectTab).toBe('steps');
  });

  it('closeProject returns to the board and clears project state', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp', 'leaf');
    actions.closeProject();
    const s = getState();
    expect(s.view).toBe('goals');
    expect(s.openGoalId).toBeNull();
    expect(s.focusNodeId).toBeNull();
    expect(s.openStepId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/state/store.test.ts -t "openProject node focus"`
Expected: FAIL — `actions.openProject is not a function`.

- [ ] **Step 3: Widen `ViewName` and add the state fields**

At `src/state/store.ts:49`, replace:

```ts
export type ViewName = 'plan' | 'goals' | 'timeline';
```

with:

```ts
export type ViewName = 'plan' | 'goals' | 'timeline' | 'project';

/** Which tab the project page is showing. */
export type ProjectTab = 'steps' | 'notes';
```

In `interface UIState`, replace the `drawerFocusNodeId` field and its comment:

```ts
  drawerFocusNodeId: string | null; // node the drawer should scroll to + highlight
  // Task/habit the Plan view should scroll to + highlight — the same idea as
  // `drawerFocusNodeId`, for the two kinds that have no drawer of their own.
  revealItem: RevealTarget | null;
```

with:

```ts
  // Node the project page should scroll to + pulse. One-shot: it is a pointer
  // to a MOMENT, and the page clears it once the pulse has run.
  focusNodeId: string | null;
  // Node whose detail panel is open. Distinct from `focusNodeId` and longer
  // lived: this one persists until the panel is closed. Read from plan 2 on.
  openStepId: string | null;
  projectTab: ProjectTab;
  // Task/habit the Plan view should scroll to + highlight — the same idea as
  // `focusNodeId`, for the two kinds that have no page of their own.
  revealItem: RevealTarget | null;
```

In the `let state: FullState = {` initialiser, replace `drawerFocusNodeId: null,` with:

```ts
  focusNodeId: null,
  openStepId: null,
  projectTab: 'steps',
```

- [ ] **Step 4: Replace `openDrawer`/`closeDrawer` with `openProject`/`closeProject`/`setProjectTab`**

At `src/state/store.ts:1672`, replace the whole `openDrawer`/`closeDrawer` pair with:

```ts
  /**
   * Navigate to a project's page, optionally pointed at one node.
   *
   * A node focus expands the node's ancestor containers so the row is on-screen
   * for the page to scroll to; an unknown node falls back to the project root.
   * It also sets `openStepId`, so arriving from ⌘K on a step lands you IN that
   * step rather than merely beside a highlighted row.
   *
   * Always opens on the steps tab. The tab is a property of the visit, not of
   * the project — landing on notes because that is where you were last time is
   * a surprise, and steps are what the page is for.
   */
  openProject(goalId: string, nodeId?: string) {
    const base = { view: 'project' as const, openGoalId: goalId, projectTab: 'steps' as const };
    if (!nodeId) {
      set({ ...base, focusNodeId: null, openStepId: null });
      return;
    }
    const path = findNodePath(state.goals, nodeId);
    if (!path) {
      set({ ...base, focusNodeId: null, openStepId: null });
      return;
    }
    const expanded = new Set(state.expanded);
    for (const id of path.slice(0, -1)) expanded.add(id); // ancestor containers
    set({ ...base, focusNodeId: nodeId, openStepId: nodeId, expanded });
  },

  /** Leave the project page for the board it was opened from. */
  closeProject() {
    set({ view: 'goals', openGoalId: null, focusNodeId: null, openStepId: null });
  },

  setProjectTab(tab: ProjectTab) {
    set({ projectTab: tab });
  },
```

- [ ] **Step 5: Fix the remaining `drawerFocusNodeId` references in the store**

Run: `grep -n "drawerFocusNodeId" src/state/store.ts`

Rename every hit to `focusNodeId`. Expect hits around `:55-57` (already done in step 3) and in `resetForImport`/`importBackup` around `:1713`. Then run `grep -n "drawerFocusNodeId" src/state/store.ts` again and confirm zero output.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/state/store.test.ts -t "openProject node focus"`
Expected: PASS, 5 tests.

The rest of the suite and the app still reference `openDrawer` and will not typecheck yet — that is task 6. Do not run `tsc -b` at this step.

- [ ] **Step 7: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(store): add the project view and its navigation actions"
```

---

## Task 2: Move `DrawerHeader` to `src/views/project/ProjectHeader.tsx`

A verbatim move. No behaviour changes, no restyling — the pace line is the best information design in the app and this task must not touch it.

**Files:**
- Create: `src/views/project/ProjectHeader.tsx`
- Modify: `src/components/GoalDrawer.tsx` (import from the new location)

**Interfaces:**
- Consumes: nothing from task 1.
- Produces: `export function ProjectHeader({ goal, actions }: { goal: Goal; actions: ReturnType<typeof useAppStore>['actions'] }): JSX.Element`

- [ ] **Step 1: Create the file**

Create `src/views/project/ProjectHeader.tsx` containing, in order:

1. The import block from `GoalDrawer.tsx:1-22`, with every `'../db/types'` rewritten to `'../../db/types'`, `'../state/store'` to `'../../state/store'`, `'../lib/…'` to `'../../lib/…'`, and `'./ProgressBar'` / `'./InlineEdit'` / `'./DateField'` to `'../../components/…'`. Drop the imports only `GoalTree`, `SubtaskAiModal`, `MilestonesSection` and `NotesSection` need: `GoalTree`, `SubtaskAiModal`, `firstOpenLeaf` is still needed, `leafCount` is still needed.
2. The `Dot` helper from `GoalDrawer.tsx:34-36`, verbatim.
3. The whole `DrawerHeader` function from `GoalDrawer.tsx:143-372`, renamed `ProjectHeader` and exported.

Change nothing inside the function body.

- [ ] **Step 2: Point `GoalDrawer` at it**

In `src/components/GoalDrawer.tsx`, delete the `Dot` helper and the entire `DrawerHeader` function, and add:

```ts
import { ProjectHeader } from '../views/project/ProjectHeader';
```

Then at `:602` replace `<DrawerHeader goal={goal} actions={actions} />` with `<ProjectHeader goal={goal} actions={actions} />`.

- [ ] **Step 3: Verify nothing changed**

Run: `npx tsc -b && npm test`
Expected: PASS. `GoalDrawer.progress.test.tsx` still passes because the rendered output is identical.

If `tsc` reports unused imports in `GoalDrawer.tsx`, delete those import lines — the header's dependencies moved with it.

- [ ] **Step 4: Commit**

```bash
git add src/views/project/ProjectHeader.tsx src/components/GoalDrawer.tsx
git commit -m "refactor: move DrawerHeader to views/project/ProjectHeader"
```

---

## Task 3: Move `StepsSection` and the notes/milestones column into tab components

Two more verbatim moves, same discipline as task 2.

**Files:**
- Create: `src/views/project/StepsTab.tsx`, `src/views/project/NotesTab.tsx`
- Modify: `src/components/GoalDrawer.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function StepsTab({ goal, actions, focusNodeId }: { goal: Goal; actions: ReturnType<typeof useAppStore>['actions']; focusNodeId?: string | null }): JSX.Element`
  - `export function NotesTab({ goal, actions }: { goal: Goal; actions: ReturnType<typeof useAppStore>['actions'] }): JSX.Element`

`NotesTab` is a holding pen. Plan 2 deletes its milestones half; plan 3 replaces its textarea half.

- [ ] **Step 1: Create `StepsTab.tsx`**

Move `StepsSection` (`GoalDrawer.tsx:375-449`) verbatim into `src/views/project/StepsTab.tsx`, renamed `StepsTab` and exported. It needs these imports, with paths rewritten for the new depth:

```ts
import { useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import type { Goal } from '../../db/types';
import { GoalTree } from '../../components/GoalTree';
import { SubtaskAiModal } from '../../components/SubtaskAiModal';
import { leafCount } from '../../lib/board';
```

- [ ] **Step 2: Create `NotesTab.tsx`**

Move `SectionLabel` (`GoalDrawer.tsx:26-32`), `MilestonesSection` (`:38-138`) and `NotesSection` (`:452-473`) verbatim into `src/views/project/NotesTab.tsx`, keeping all three private, and add an exported wrapper that renders the two sections in the order the drawer showed them:

```ts
export function NotesTab({
  goal,
  actions,
}: {
  goal: Goal;
  actions: ReturnType<typeof useAppStore>['actions'];
}) {
  return (
    <div className="flex flex-col gap-[26px] max-w-[720px]">
      <MilestonesSection goal={goal} actions={actions} />
      <NotesSection goal={goal} actions={actions} />
    </div>
  );
}
```

Imports needed:

```ts
import { useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import type { Goal } from '../../db/types';
import { DateField } from '../../components/DateField';
import { InlineEdit } from '../../components/InlineEdit';
import { todayStr } from '../../lib/dates';
```

- [ ] **Step 3: Point `GoalDrawer` at both**

In `src/components/GoalDrawer.tsx`, delete `SectionLabel`, `MilestonesSection`, `StepsSection` and `NotesSection`, add:

```ts
import { StepsTab } from '../views/project/StepsTab';
import { NotesTab } from '../views/project/NotesTab';
```

and replace the body grid at `:604-610` with:

```tsx
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-[30px] md:gap-[34px]">
                <StepsTab goal={goal} actions={actions} focusNodeId={focusNodeId} />
                <NotesTab goal={goal} actions={actions} />
              </div>
```

Delete any import lines `tsc` now reports as unused.

- [ ] **Step 4: Verify nothing changed**

Run: `npx tsc -b && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/project src/components/GoalDrawer.tsx
git commit -m "refactor: move the drawer body into StepsTab and NotesTab"
```

---

## Task 4: Build `src/views/Project.tsx`

**Files:**
- Create: `src/views/Project.tsx`
- Test: `src/views/project/Project.progress.test.tsx`

**Interfaces:**
- Consumes: `openProject`, `closeProject`, `setProjectTab`, `projectTab`, `focusNodeId` (task 1); `ProjectHeader` (task 2); `StepsTab`, `NotesTab` (task 3).
- Produces: `export function Project(): JSX.Element | null` — reads everything it needs from `useAppStore()`, takes no props.

- [ ] **Step 1: Write the failing test**

Create `src/views/project/Project.progress.test.tsx`. **The harness matters:** the store touches IndexedDB on import, so `../../db/db` must be mocked with `vi.hoisted` and the store imported dynamically after `vi.resetModules()` — the same pattern `GoalDrawer.progress.test.tsx` uses. `window.matchMedia` must be stubbed too, because the page's pulse effect calls it. A static `import { actions } from '../../state/store'` will not work.

```tsx
// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Goal } from '../../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[] }> => ({
    goals: [], habits: [], tasks: [], sessions: [],
  })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async () => []),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  saveSidebarPanels: vi.fn(async () => {}),
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
  isSlotMigrationDone: vi.fn(async () => true),
  saveSlotMigrationSnapshot: vi.fn(async () => {}),
  loadSlotMigrationSnapshot: vi.fn(async () => null),
  markSlotMigrationDone: vi.fn(async () => {}),
}));
vi.mock('../../db/db', () => dbMocks);
vi.mock('../../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => cleanup());

const seed: Goal = {
  id: 'g1', title: 'Studying Roblox', column: 0,
  start: '2026-01-01', deadline: '2026-12-31',
  nodes: [
    { id: 'n1', title: 'Define the topics', done: false },
    { id: 'n2', title: 'Order the topics', done: false },
  ],
  notes: 'Existing note text',
};

type Store = typeof import('../../state/store');

/** Boot a store holding `seed`, open its page, and render it. */
async function mountPage(nodeId?: string): Promise<Store> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(seed)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../../state/store');
  await store.initStore();
  store.actions.openProject('g1', nodeId);
  const { Project } = await import('../Project');
  const Host = () => {
    store.useAppStore(); // subscribe so tab switches re-render
    return createElement(Project);
  };
  render(createElement(Host));
  return store;
}

describe('Project page', () => {
  it('renders the project title and its progress', async () => {
    await mountPage();
    expect(screen.getByRole('button', { name: /Rename project "Studying Roblox"/ })).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('opens on the steps tab and lists the steps', async () => {
    await mountPage();
    expect(screen.getByRole('tab', { name: 'Steps' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Define the topics')).toBeTruthy();
  });

  it('switches to the notes tab and back', async () => {
    const store = await mountPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(store.getState().projectTab).toBe('notes');
    expect(screen.queryByText('Define the topics')).toBeNull();
    expect(screen.getByLabelText('Project notes')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Steps' }));
    expect(screen.getByText('Define the topics')).toBeTruthy();
  });

  it('the breadcrumb returns to the board', async () => {
    const store = await mountPage();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Projects' }));
    expect(store.getState().view).toBe('goals');
    expect(store.getState().openGoalId).toBeNull();
  });

  it('renders nothing once the project is closed', async () => {
    const store = await mountPage();
    expect(screen.queryByRole('tab', { name: 'Steps' })).toBeTruthy();
    store.actions.closeProject();
    cleanup();
    const { Project } = await import('../Project');
    const Host = () => { store.useAppStore(); return createElement(Project); };
    const { container } = render(createElement(Host));
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/views/project/Project.progress.test.tsx`
Expected: FAIL — cannot resolve `../Project`.

- [ ] **Step 3: Write `src/views/Project.tsx`**

```tsx
import { useEffect } from 'react';
import { useAppStore, type ProjectTab } from '../state/store';
import { ProjectHeader } from './project/ProjectHeader';
import { StepsTab } from './project/StepsTab';
import { NotesTab } from './project/NotesTab';

const TABS: ReadonlyArray<readonly [ProjectTab, string]> = [
  ['steps', 'Steps'],
  ['notes', 'Notes'],
];

/**
 * A project's own page.
 *
 * This replaced a centred `role="dialog"` that hand-rolled a focus trap, a body
 * scroll lock and Tab cycling — all of which existed only because it was a
 * modal. A page needs none of them, so none of them are here.
 */
export function Project() {
  const { goals, openGoalId, projectTab, focusNodeId, actions } = useAppStore();
  const goal = openGoalId ? goals.find((g) => g.id === openGoalId) : null;

  // A project deleted while its page is open (undo toast, another surface)
  // leaves nothing to render. Go back rather than showing an empty shell.
  useEffect(() => {
    if (openGoalId && !goal) actions.closeProject();
  }, [openGoalId, goal, actions]);

  if (!goal) return null;

  return (
    <div className="max-w-[1100px] mx-auto">
      <button
        type="button"
        onClick={() => actions.closeProject()}
        aria-label="Back to Projects"
        className="text-meta text-muted hover:text-ink px-[7px] py-[4px] -ml-[7px] min-h-[24px] inline-flex items-center gap-[6px] rounded-[6px] hover:bg-hover"
      >
        <span aria-hidden="true">‹</span> Projects
      </button>

      <ProjectHeader goal={goal} actions={actions} />

      <div role="tablist" aria-label="Project sections" className="flex gap-[2px] mt-[18px] border-b border-line">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={projectTab === key}
            onClick={() => actions.setProjectTab(key)}
            className={`text-ui px-[12px] py-[7px] -mb-px border-b-2 ${
              projectTab === key
                ? 'text-ink font-semibold border-accent'
                : 'text-muted font-medium border-transparent hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pt-[22px] pb-[60px]">
        {projectTab === 'steps' ? (
          <StepsTab goal={goal} actions={actions} focusNodeId={focusNodeId} />
        ) : (
          <NotesTab goal={goal} actions={actions} />
        )}
      </div>
    </div>
  );
}
```

`ProjectHeader` still carries the drawer's `flex-none px-[30px] pt-[26px] pb-[18px] border-b border-line` wrapper. Change that one line in `src/views/project/ProjectHeader.tsx` to `pt-[10px] pb-[4px]` — on a page the horizontal padding and the bottom rule belong to the page and the tab bar, not to the header.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/views/project/Project.progress.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/views/Project.tsx src/views/project/Project.progress.test.tsx src/views/project/ProjectHeader.tsx
git commit -m "feat(project): add the tabbed project page"
```

---

## Task 5: Move the node-focus pulse onto the page

The drawer scrolled a focused row into view and pulsed it (`GoalDrawer.tsx:541-563`), scoped to `#drawerBody`. That behaviour moves to the page, and gains the one-shot clear its comment always implied.

**Files:**
- Modify: `src/views/Project.tsx`, `src/state/store.ts`
- Test: `src/state/store.test.ts`

**Interfaces:**
- Consumes: `focusNodeId` (task 1), `Project` (task 4).
- Produces: `clearFocusNode(): void` on `actions`.

- [ ] **Step 1: Write the failing test**

Append to the `describe('openProject node focus (T8)', ...)` block in `src/state/store.test.ts`:

```ts
  it('clearFocusNode drops the pulse pointer without leaving the page', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp', 'leaf');
    actions.clearFocusNode();
    const s = getState();
    expect(s.focusNodeId).toBeNull();
    expect(s.view).toBe('project');
    expect(s.openGoalId).toBe('gp');
    expect(s.openStepId).toBe('leaf');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/state/store.test.ts -t "clearFocusNode"`
Expected: FAIL — `actions.clearFocusNode is not a function`.

- [ ] **Step 3: Add the action**

In `src/state/store.ts`, directly after `setProjectTab`:

```ts
  /**
   * Drop the pulse pointer once the page has used it. `focusNodeId` names a
   * MOMENT, not a selection: left set, collapsing and re-expanding the tree
   * would replay the highlight for a navigation that happened minutes ago.
   */
  clearFocusNode() {
    if (state.focusNodeId === null) return;
    set({ focusNodeId: null });
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/state/store.test.ts -t "clearFocusNode"`
Expected: PASS.

- [ ] **Step 5: Add the pulse effect to the page**

In `src/views/Project.tsx`, add `id="projectBody"` to the `<div className="pt-[22px] pb-[60px]">` wrapper, and insert this effect after the existing `useEffect`:

```tsx
  // Scroll a focused row into view and pulse it. Done through the DOM so the
  // shared GoalTree needs no focus-aware prop, exactly as the drawer did.
  useEffect(() => {
    if (!focusNodeId || projectTab !== 'steps') return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => {
      const row = document.querySelector<HTMLElement>(
        `#projectBody [data-node-id="${CSS.escape(focusNodeId)}"]`,
      );
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        if (!reduced && typeof row.animate === 'function') {
          row.animate(
            [
              { boxShadow: '0 0 0 2px rgb(var(--c-accent))', borderRadius: '6px' },
              { boxShadow: '0 0 0 2px rgba(0,0,0,0)', borderRadius: '6px' },
            ],
            { duration: 1400, easing: 'ease-out' },
          );
        }
      }
      actions.clearFocusNode();
    }, 70); // let expand/fade-in settle before measuring
    return () => clearTimeout(t);
  }, [focusNodeId, projectTab, actions]);
```

The `rgb(var(--c-accent))` string is carried over verbatim from the drawer; it is a CSS variable reference, not a literal hex, so `designScale.test.ts` is satisfied.

- [ ] **Step 6: Verify**

Run: `npx vitest run src/views/project/Project.progress.test.tsx src/state/store.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/views/Project.tsx src/state/store.ts src/state/store.test.ts
git commit -m "feat(project): move the node-focus pulse onto the page"
```

---

## Task 6: Wire `App.tsx` and update every call site

This is the task that makes the app compile again.

**Files:**
- Modify: `src/App.tsx:3-5` (imports), `:60` (destructure), `:136-142` (keyboard), `:325-346` (view switch), `:380` (drawer render), `:390` (palette)
- Modify: `src/views/Goals.tsx:444,446,452`
- Modify: `src/views/timeline/GoalRow.tsx:105,132,140`
- Modify: `src/views/timeline/NodeLane.tsx:81,130,167`
- Modify: `src/views/plan/RecapPanel.tsx:101`

**Interfaces:**
- Consumes: `openProject`, `closeProject` (task 1); `Project` (task 4).
- Produces: nothing new.

- [ ] **Step 1: Rename every call site**

Run: `grep -rn "actions.openDrawer" src --include=*.tsx`

Expect 8 hits across `Goals.tsx`, `GoalRow.tsx`, `NodeLane.tsx`, `RecapPanel.tsx` and `App.tsx:390`. Replace `actions.openDrawer` with `actions.openProject` at every one. The signature is identical, so no other edit is needed at any site.

- [ ] **Step 2: Import and render the page in `App.tsx`**

Add to the imports at `src/App.tsx:5`:

```ts
import { Project } from './views/Project';
```

Delete the `GoalDrawer` import.

At `:60`, replace `drawerFocusNodeId` in the destructure with nothing — the page reads it from the store itself.

In the view switch at `:335-346`, insert a `project` branch before the `Goals` fallback:

```tsx
        ) : view === 'timeline' ? (
          <div className="w-full px-[16px] sm:px-[36px] py-[32px]">
            <Timeline />
          </div>
        ) : view === 'project' ? (
          <div className="w-full px-[16px] sm:px-[36px] py-[28px] pb-[90px]">
            <Project />
          </div>
        ) : (
```

Delete the `<GoalDrawer … />` element at `:380`.

- [ ] **Step 3: Update the keyboard handling**

At `src/App.tsx:136`, replace:

```ts
      if (command === 'close-drawer') actions.closeDrawer();
```

with:

```ts
      // Escape on the project page goes back to the board. `close-drawer` is
      // the command's historical name; the drawer it referred to is gone.
      if (command === 'close-drawer' && view === 'project') actions.closeProject();
```

Add `view` to the effect's dependency array at `:146`, and remove `openGoalId` if `tsc` reports it unused.

- [ ] **Step 4: Mark the project page in the nav**

`NAV_TABS` has no `project` entry, so both nav bars will show nothing as current while the page is open. Add an `aria-current` fallback so `Projects` stays lit. At `:177` and `:360`, replace `view === key` inside the `aria-current` expression with `(view === key || (view === 'project' && key === 'goals'))`.

Leave the `className` comparisons alone — the underline following the literal view is correct; only the accessible current-page marker needs the fallback.

- [ ] **Step 5: Verify the whole app compiles and the suite passes**

Run: `npx tsc -b`
Expected: PASS with no errors.

Run: `npm test`
Expected: PASS except `src/components/GoalDrawer.progress.test.tsx`, which still renders the old component. That is task 7.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/views/Goals.tsx src/views/timeline/GoalRow.tsx src/views/timeline/NodeLane.tsx src/views/plan/RecapPanel.tsx
git commit -m "feat: route to the project page and retire openDrawer"
```

---

## Task 7: Delete `GoalDrawer.tsx`

**Files:**
- Delete: `src/components/GoalDrawer.tsx`, `src/components/GoalDrawer.progress.test.tsx`
- Modify: `src/views/project/Project.progress.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Salvage the drawer's test coverage**

`GoalDrawer.progress.test.tsx` is the only coverage of the pace line — the "no project schedule" fallback, the weighted-vs-equal basis disclosure, and the calibration figure. None of that is duplicated in `Project.progress.test.tsx`, and all of it must survive.

Port every `describe` block from it into `src/views/project/Project.progress.test.tsx`, with exactly these mechanical changes:

- `vi.mock('../db/db', …)` → `vi.mock('../../db/db', …)`; same for `../lib/tabLock` and every `import` of `../db/types`, `../lib/dates`, `../state/store`.
- Its `mountDrawer(goal, sessions)` helper becomes:

```tsx
async function mountGoal(goal: Goal, sessions: Session[] = []): Promise<Store> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(goal)], habits: [], tasks: [], sessions,
  });
  const store = await import('../../state/store');
  await store.initStore();
  store.actions.openProject(goal.id);
  const { Project } = await import('../Project');
  const Host = () => { store.useAppStore(); return createElement(Project); };
  render(createElement(Host));
  return store;
}
```

  The `Host` no longer passes `goal` or `actions` — the page takes no props — and `openProject` replaces mounting the component directly.
- Keep every assertion string byte-identical. These tests exist to pin exact copy; rewording one silently drops the guarantee.

Add `Session` and `GoalNode` to the type import once ported.

- [ ] **Step 2: Confirm nothing still imports the drawer**

Run: `grep -rn "GoalDrawer" src`
Expected: hits only in the two files about to be deleted. If anything else appears, fix it before continuing.

- [ ] **Step 3: Delete**

```bash
git rm src/components/GoalDrawer.tsx src/components/GoalDrawer.progress.test.tsx
```

- [ ] **Step 4: Verify**

Run: `npx tsc -b && npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Manually confirm the page in the running app**

Run: `npm run dev`

Check each of these by hand:
1. Projects board → click a card → the project page opens, board is gone.
2. `‹ Projects` returns to the board; Escape does the same.
3. Steps/Notes tabs switch; the step tree and the notes textarea both work.
4. ⌘K → pick a step → lands on the project page with that row pulsed.
5. Timeline → a project's warning chip → opens the page on the right node.
6. Narrow the window below 768px: the bottom tab bar still shows `Projects` as current while the page is open.

- [ ] **Step 6: Commit**

```bash
git commit -am "refactor: delete GoalDrawer"
```

---

## Task 8: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (Layers section)

- [ ] **Step 1: Record the new view**

In the Layers section, the line describing views reads:

```
- `src/views/<View>.tsx` orchestrates a top-level view; its components live in a per-view subfolder (`today/`, `timeline/`, `goals/`).
```

Replace the subfolder list with `` (`plan/`, `timeline/`, `goals/`, `project/`) ``.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the project view in CLAUDE.md"
```

---

## Self-review notes

Checked against spec Part 1:

| Spec requirement | Task |
|---|---|
| §1.1 `ViewName` gains `'project'`, no router | 1 |
| §1.1 `projectTab`, `openStepId`, `focusNodeId` rename | 1 |
| §1.1 `openStepId` and `focusNodeId` are distinct | 1 (comments), 5 (one-shot clear) |
| §1.1 `openProject` sets both fields when given a node | 1 |
| §1.1 signature-compatible rename at every call site | 6 |
| §1.1 breadcrumb and Escape return to the board | 4, 6 |
| §1.1 `GoalDrawer` deleted with its trap and scroll lock | 7 |
| §1.2 sticky header, content unchanged | 2, 4 |
| §1.2 two-tab bar | 4 |
| §1.2 mobile bottom tab bar keeps working | 6 |
| §1.3 no Timeline tab | not built, by design |

**Deliberately deferred, and where it lands:** restoring board scroll position and focusing the originating card (spec §1.1) is not implemented here. `closeProject` returns to the board correctly, but the board remounts at the top. This needs the board to own a scroll ref and is a distinct concern from the page; it is task 1 of plan 2 rather than a loose end in this one.
