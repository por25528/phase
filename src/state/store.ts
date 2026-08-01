import { useSyncExternalStore, useCallback } from 'react';
import type { Goal, Habit, AppState, PlanReview, Task, Session, AvailabilityWindow } from '../db/types';
import {
  loadState, persist, exportState, importStateFromFile, loadScale, saveScale,
  loadPlanReview, savePlanReview, loadAvailability, saveAvailability,
  loadAllDayBlocks, saveAllDayBlocks,
  loadSidebarPanels, saveSidebarPanels, type SidebarPanel,
  isSlotMigrationDone, saveSlotMigrationSnapshot, markSlotMigrationDone, loadSlotMigrationSnapshot,
} from '../db/db';
import { clampScale } from '../lib/timeline';
import { DEFAULT_AVAILABILITY, parseAvailability } from '../lib/availability';
import { todayStr, addDays, fmtD } from '../lib/dates';
import { clampSpan } from '../lib/timeline';
import { isValidLocalDate, projectDateError, confirmableDateGoalIds } from '../lib/schedule';
import { weekOf, plannedLeaves, walkLeaves } from '../lib/plan';
import { HORIZON_LABELS, HORIZON_COUNT } from '../lib/horizons';
import type { RevealKind, RevealTarget } from '../lib/reveal';
import { deferOpenWork } from '../lib/deferWork';
import { backlogGroups } from '../lib/backlog';
import { topLevelSelection, openLeavesUnder, selectionRemovalCount } from '../lib/selection';
import { migrateSlots, describeMigration } from '../lib/migrateSlots';
import { sampleProject } from '../lib/sampleProject';
import { weaveCompleted, leafCount } from '../lib/board';
import { acquireTabLock } from '../lib/tabLock';
import { normalizeEstimate, type Now } from '../lib/capacity';
import { formatEstimateValue } from '../lib/estimateInput';
import { resolveSlot, durationOf, freeIntervals, NO_PAST_LIMIT, SLOT_GRANULARITY_MIN } from '../lib/slot';
import { spansOn } from '../lib/scheduled';
import { clampResize, setPlannedSlot, clearPlannedSlot } from './scheduleActions';
import {
  type Theme,
  resolveTheme,
  readStoredTheme,
  writeStoredTheme,
  applyTheme,
  systemPrefersDark,
} from '../lib/theme';
import {
  uid, findInAll, findNode, removeNode,
  findNodePath,
  indentNode as treeIndentNode,
  outdentNode as treeOutdentNode,
  reorderSiblings,
  reorderTop,
  cloneGoals,
  insertSiblingAfter as treeInsertSiblingAfter,
} from '../lib/tree';

export type ViewName = 'plan' | 'goals' | 'timeline' | 'project';

export const VIEW_LABELS = {
  plan: 'Plan',
  goals: 'Projects',
  timeline: 'Timeline',
} as const;

/** Which tab the project page is showing. */
export type ProjectTab = 'steps' | 'notes';

interface UIState {
  view: ViewName;
  projectReturnView: ViewName;
  selDate: string;
  openGoalId: string | null;
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
  // A step that was just created and should open ready to type. One-shot: the
  // row clears it as it mounts, so collapsing and re-expanding cannot reopen it.
  newNodeId: string | null;
  expanded: Set<string>;
  toast: string | null;
  pendingUndo: { label: string } | null;
  pxPerDay: number; // timeline scale — continuous, gesture-driven
  hydration: 'loading' | 'ready' | 'error';
  secondTab: boolean;
  // A write to IndexedDB has failed and no later write has succeeded. Latched,
  // not a toast: the whole point is that it outlives the moment.
  persistFailed: boolean;
  dateReviewDismissed: boolean;
  theme: Theme; // per-device UI preference (localStorage, not Dexie)
  planReview: PlanReview | null; // previous-week snapshot — review metadata, not app data
  availability: AvailabilityWindow[]; // per-weekday planning window (device preference)
  allDayBlocks: boolean;              // do all-day calendar events consume the day?
  sidebarPanels: SidebarPanel[];      // which Plan-view sidebar panels are expanded (device preference)
  activeHorizon: number;              // narrow Projects-board horizon (UI only)
}

interface FullState extends AppState, UIState {}

let state: FullState = {
  goals: [],
  habits: [],
  tasks: [],
  sessions: [],
  view: 'plan',
  projectReturnView: 'goals',
  selDate: todayStr(),
  openGoalId: null,
  focusNodeId: null,
  openStepId: null,
  projectTab: 'steps',
  revealItem: null,
  newNodeId: null,
  expanded: new Set(),
  toast: null,
  pendingUndo: null,
  pxPerDay: 13, // quarter preset until the persisted scale loads
  hydration: 'loading',
  secondTab: false,
  persistFailed: false,
  dateReviewDismissed: false,
  planReview: null,
  availability: DEFAULT_AVAILABILITY,
  allDayBlocks: true,
  sidebarPanels: [],
  activeHorizon: 0,
  // Read synchronously at module load so the header toggle shows the correct
  // state immediately (the no-FOUC script already painted <html>). 'system' in
  // non-DOM contexts (tests).
  theme: readStoredTheme(),
};

let initialized = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
/** Monotonic, so revealing the same row twice is still two distinct events. */
let revealNonce = 0;
let undoTimer: ReturnType<typeof setTimeout> | null = null;
let scaleTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Undo history, newest last. It used to be a single `restoreFn`, which any
 * subsequent undoable action overwrote — so deleting a project and then ticking
 * a checkbox inside the toast window destroyed the project permanently with no
 * warning. Keeping a short stack means ⌘Z still walks back to it, which is also
 * the only recovery path once the toast has faded.
 */
interface UndoEntry {
  label: string;
  restore: () => void;
  /**
   * True when the restore is SURGICAL — it reapplies just the thing that
   * changed against whatever the state is now (e.g. re-splicing one deleted
   * task), so replaying it later cannot clobber unrelated edits.
   *
   * False for a whole-slice snapshot, which reverts everything written to that
   * slice since. Those must be dropped as soon as any other write lands.
   */
  surgical: boolean;
}

let undoStack: UndoEntry[] = [];
/**
 * Whether the entry the visible Undo toast refers to is surgical — i.e. whether
 * it survives `setAndPersist`'s stale-restore sweep. Tracked separately from
 * the stack because `pendingUndo` holds only a label, and the toast has to
 * retire in lockstep with the restore it offers.
 */
let armedSurgical = false;
const UNDO_DEPTH = 20;
/**
 * True only while withUndo / a restore is doing its own write, so
 * `setAndPersist` can tell an undoable edit from every other mutation and drop
 * stale restores for the latter. See the note in setAndPersist.
 */
let writingUndoableEdit = false;
/**
 * Whether this tab holds the single-writer lock.
 *
 * Optimistic until the lock resolves: the Web Lock settles long before a human
 * can reach a control, and defaulting to "blocked" would make the sole tab
 * refuse a write during hydration.
 */
let ownsTabLock = true;

/**
 * Run a settings write only if this tab owns the single-writer lock.
 *
 * `setAndPersist`'s guard covers the four main tables. Every OTHER write to
 * IndexedDB — the timeline scale, availability, the all-day preference, the
 * sidebar layout, the week-review snapshot — went straight through, so a
 * non-owning tab still overwrote the owner's settings, and `ensureWeekRollover`
 * (which runs unconditionally at the end of `initStore`) stamped its own
 * `planReview` over the owner's on every launch. "A tab that lost the lock must
 * never re-run the migration (or any other write)" now means what it says.
 */
function ifOwner(write: () => Promise<unknown>): void {
  if (!ownsTabLock) return;
  void write().catch(() => {});
}
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function set(patch: Partial<FullState>) {
  state = { ...state, ...patch };
  notify();
}

// uiPatch merges in first so patch (the persisted slice) always wins on overlap;
// letting callers fold a same-tick UI change (e.g. expanded) into this single write+notify.
function setAndPersist(patch: Partial<AppState>, uiPatch?: Partial<UIState>) {
  // An undo entry is a snapshot of a WHOLE slice, so replaying it also reverts
  // anything written after it. Most mutations (rename, add child, move horizon,
  // reorder, schedule) are not undoable and land here directly — so once one
  // happens, every armed restore is stale and must be dropped. Without this,
  // ⌘Z after "delete a project, then move another to Someday" silently undid
  // the move as well.
  //
  // Dropping the restore has to drop the OFFER with it. The toast ran on its
  // own timer, so "Deleted 'Psets' and its 40 steps — Undo" stayed on screen,
  // and clickable, for the rest of its 15 seconds after its restore had already
  // been discarded — and typing one step title or ticking one checkbox is
  // enough to discard it. Pressing Undo then popped an empty stack and cleared
  // the toast, which is indistinguishable from having worked. A recovery
  // promise that is already void must stop being displayed.
  let retire: Partial<UIState> | undefined;
  if (!writingUndoableEdit) {
    undoStack = undoStack.filter((entry) => entry.surgical);
    if (!armedSurgical && state.pendingUndo) {
      if (undoTimer) {
        clearTimeout(undoTimer);
        undoTimer = null;
      }
      retire = { pendingUndo: null };
    }
  }
  const next = { ...state, ...retire, ...uiPatch, ...patch };
  state = next;
  notify();
  /*
   * A tab that does not hold the lock never writes.
   *
   * Every `persist` is a full `clear()` + `bulkPut()` of all four tables from
   * THIS tab's in-memory snapshot, so a single write from a stale second tab
   * rewrites the whole database from its stale view — ticking one habit in tab
   * B deleted the three steps just added in tab A. The banner has always been
   * shown; the clobbering happened anyway, which made CLAUDE.md's "a second tab
   * gets a warning banner instead of silently clobbering the first" false, and
   * `initStore`'s "a tab that lost the lock must never re-run the migration (or
   * any other write)" only half-implemented.
   *
   * In-memory state still advances, deliberately: freezing the UI would look
   * like breakage, and leaving it live keeps Export working, which is the one
   * way to rescue anything typed here. The banner says plainly that it is not
   * being saved.
   */
  if (!ownsTabLock) return;
  /*
   * A failed write used to be a 1.9-second toast and nothing else. In-memory
   * state advanced as if it had succeeded, so the realistic sequence — quota
   * exceeded or disk full mid-session, user looks away for three seconds —
   * left someone working for an hour against state that existed only in RAM,
   * then closing the tab. The toast even told them to export a backup, which
   * is right, and then took the advice off screen before they looked back.
   *
   * So the failure also latches into a banner that stays until a write
   * succeeds. A later success clears it honestly: Dexie serialises its
   * transactions, so "the most recent write landed" is the true state of the
   * database, not a guess.
   */
  persist({ goals: next.goals, habits: next.habits, tasks: next.tasks, sessions: next.sessions }).then(
    () => {
      if (state.persistFailed) set({ persistFailed: false });
    },
    () => {
      actions.showToast('Saving failed — export a backup now');
      if (!state.persistFailed) set({ persistFailed: true });
    },
  );
}

// Keep the goals array in column-major order (all column-0 goals in their
// vertical order, then column-1, …). Array.sort is stable, so within-column
// order is preserved. This makes flat consumers (Today, Timeline) read goals
// in true priority order for free.
function normalizeByColumn(goals: Goal[]): Goal[] {
  return [...goals]
    .map((g) => ({ ...g, column: g.column ?? 0 }))
    .sort((a, b) => (a.column ?? 0) - (b.column ?? 0));
}

// Walk all goals and collect container node ids for auto-expand on init
function collectContainers(goals: Goal[]): Set<string> {
  const ids = new Set<string>();
  function walk(nodes: typeof goals[0]['nodes']) {
    nodes.forEach((n) => {
      if (n.children && n.children.length) {
        ids.add(n.id);
        walk(n.children);
      }
    });
  }
  goals.forEach((g) => walk(g.nodes));
  return ids;
}

export async function initStore(): Promise<void> {
  if (initialized) return;
  initialized = true;
  // Capture the promise once so the migration block below can await actual
  // ownership. Phase assumes a single writer: a tab that lost the lock must
  // still load and render normally, it just must never re-run the migration
  // (or any other write) alongside the owning tab.
  const tabLock = acquireTabLock();
  void tabLock.then((owned) => {
    ownsTabLock = owned;
    if (!owned) set({ secondTab: true });
  });
  try {
    const [appState, pxPerDay, planReview, availability, allDayBlocks, sidebarPanels] = await Promise.all([
      loadState(), loadScale(), loadPlanReview(), loadAvailability(), loadAllDayBlocks(), loadSidebarPanels(),
    ]);

    // One-shot: give every day-committed step and task a real start minute.
    // Snapshot BEFORE, mark done only AFTER a successful persist — a failure
    // here leaves the flag unset so the next launch retries cleanly rather
    // than stranding half-rewritten data behind a "done" marker. Gated on
    // actually owning the tab lock — a non-owning tab must never write.
    let migrated = appState;
    let migrationToast: string | null = null;
    if ((await tabLock) && !(await isSlotMigrationDone())) {
      await saveSlotMigrationSnapshot(appState.goals, appState.tasks);
      const result = migrateSlots(appState.goals, appState.tasks, availability, allDayBlocks);
      migrated = { ...appState, goals: result.goals, tasks: result.tasks };
      await persist(migrated);
      // A failure to record the flag is non-fatal: the data above is already
      // correct and persisted, and migrateSlots is idempotent — the only
      // cost of losing this write is that the next launch re-runs the
      // (harmless) migration. Only `persist` failing should fail hydration.
      try {
        await markSlotMigrationDone();
      } catch {
        // swallowed intentionally — see comment above
      }
      migrationToast = describeMigration(result.report);
    }

    state = {
      ...state,
      ...migrated,
      pxPerDay,
      planReview,
      availability,
      allDayBlocks,
      sidebarPanels,
      hydration: 'ready',
      expanded: collectContainers(migrated.goals),
    };
    notify();
    ensureWeekRollover();
    if (migrationToast) actions.showToast(migrationToast);
  } catch {
    // IndexedDB unavailable (private mode, blocked storage) or corrupt.
    // Nothing was deleted — refuse to render an empty board that would
    // read as data loss.
    set({ hydration: 'error' });
  }
}

// ---- selectors ----
export function getState(): FullState {
  return state;
}

// ---- undo helper ----

/** A cheap toggle is reversible by repeating it; a structural delete is not. */
const UNDO_MS = 5000;
const DESTRUCTIVE_UNDO_MS = 15000;

/**
 * Arm an undo and show its toast.
 *
 * The timer only hides the TOAST. The restore itself stays on `undoStack`, so
 * ⌘Z reaches it afterwards — five seconds is below the time it takes to notice
 * a misclick, let alone move the mouse to a toast.
 */
function scheduleUndo(
  label: string,
  restore: () => void,
  ttlMs = UNDO_MS,
  surgical = false,
): void {
  if (undoTimer) clearTimeout(undoTimer);
  undoStack.push({ label, restore, surgical });
  if (undoStack.length > UNDO_DEPTH) undoStack.shift();
  armedSurgical = surgical;
  set({ pendingUndo: { label } });
  undoTimer = setTimeout(() => {
    undoTimer = null;
    set({ pendingUndo: null });
  }, ttlMs);
}

// Snapshot state[key], arm its restoration, then persist `next` — the shared
// seam behind every undoable edit (deletes, date edits). Callers compute
// `next` from the pre-write state and hand it in; the snapshot below is taken
// before that value lands, so restore always replays the prior slice.
function withUndo<K extends keyof AppState>(
  label: string,
  key: K,
  next: AppState[K],
  ttlMs = UNDO_MS,
  // Same-tick UI change to fold into the write, exactly as `setAndPersist`
  // takes one — structural edits move `expanded` alongside the tree, and doing
  // that in a separate `set` would paint the tree twice per keystroke.
  // Deliberately NOT restored on undo: which containers are open is a view
  // preference, not data, and snapping it back would fight the user.
  uiPatch?: Partial<UIState>,
): void {
  const snapshot = structuredClone(state[key]);
  scheduleUndo(label, () => withoutClearingUndo(() => {
    setAndPersist({ [key]: snapshot } as Partial<AppState>);
  }), ttlMs);
  withoutClearingUndo(() => setAndPersist({ [key]: next } as Partial<AppState>, uiPatch));
}

/** Run a write that must not invalidate the armed undo history. */
function withoutClearingUndo(write: () => void): void {
  writingUndoableEdit = true;
  try {
    write();
  } finally {
    writingUndoableEdit = false;
  }
}


// A completed project is frozen for structural edits (spec §2.5). These guards
// are the single store-level gate, so Today, the planner, and a stale drawer all
// refuse the same set; metadata and horizon moves stay allowed.
function goalOfNode(nodeId: string): Goal | undefined {
  return state.goals.find((g) => findNode(g.nodes, nodeId) != null);
}
function isActiveGoal(goalId: string): boolean {
  return !state.goals.find((g) => g.id === goalId)?.completedAt;
}
function isActiveNode(nodeId: string): boolean {
  return !goalOfNode(nodeId)?.completedAt;
}

function nodeContains(ancestorId: string, descendantId: string): boolean {
  const ancestorPath = findNodePath(state.goals, ancestorId);
  const descendantPath = findNodePath(state.goals, descendantId);
  return ancestorPath !== null
    && descendantPath !== null
    && ancestorPath.length <= descendantPath.length
    && ancestorPath.every((id, index) => id === descendantPath[index]);
}

// Minutes-since-midnight for the live clock — the one place the store reads it.
function nowMoment(): Now {
  const d = new Date();
  return { date: todayStr(), minute: d.getHours() * 60 + d.getMinutes() };
}

// "1h 30m" / "45m" — used only in refusal toasts.
function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// The refusal toast must be actionable: naming the longest free stretch tells
// the user what WOULD fit, not just that this attempt failed. Deliberately the
// longest single stretch, not total free minutes — three scattered 15-minute
// gaps summing to 45m would read as "45m free" while nothing 45m long actually
// fits, and the longest stretch is the number that predicts whether a retry
// will succeed. A day with no free stretch at all gets its own wording rather
// than a misleading "longest free stretch is 0m".
function describeNoRoom(durationMin: number, gaps: { startMin: number; endMin: number }[]): string {
  const longest = gaps.reduce((max, g) => Math.max(max, g.endMin - g.startMin), 0);
  const need = `No ${formatDuration(durationMin)} gap left that day`;
  return longest > 0
    ? `${need} — longest free stretch is ${formatDuration(longest)}`
    : `${need} — no free time left that day`;
}

// Same voice as describeNoRoom: a refused resize (clampResize returned null)
// means either the request itself was nonsense or the block's own slot no
// longer sits in any free gap — say so instead of leaving the drag to
// silently snap back with no explanation.
/** How far ahead "Replan" will look for a day that can take the work. */
const REPLAN_HORIZON_DAYS = 14;

function describeResizeRefused(title: string): string {
  return `Can't resize "${title}" — it no longer fits a free slot that day`;
}

/**
 * The undo label for an estimate edit. Names the OLD value when there was one,
 * because the thing being offered back is the number that was just overwritten
 * — "Changed X to 2h" tells you what happened, "was 45m" tells you what Undo
 * would give you back, and only the second is decision-relevant.
 *
 * Never ends in the word "Undo": the toast renders a real Undo button beside
 * this string (see undoLabels.test.ts).
 *
 * `before` is normalised before formatting because it is the RAW stored value,
 * and an imported file can carry a fractional one. `formatEstimateValue(90.4)`
 * renders "1h30.399999999999999".
 */
function describeEstimateChange(
  title: string,
  rawBefore: number | undefined,
  next: number | undefined,
): string {
  const before = normalizeEstimate(rawBefore);
  if (next === undefined) return `Cleared the estimate on "${title}" (was ${formatEstimateValue(before)})`;
  if (before === undefined) return `Estimated "${title}" at ${formatEstimateValue(next)}`;
  return `"${title}" is now ${formatEstimateValue(next)} (was ${formatEstimateValue(before)})`;
}

/**
 * Warn when a new estimate makes an already-placed item outgrow the gap it
 * sits in.
 *
 * The estimate is a fact about the WORK, so unlike a resize it is not clamped —
 * refusing to record "this pset is really six hours" because Tuesday is busy
 * would be the tool arguing with reality. But block height is
 * `durationOf(estimateMin)`, so raising it silently stretched the block over
 * its neighbours and past the end of the day's window: the one thing
 * `resolveSlot` gatekeeps every drop against, reachable from a field that gave
 * no feedback at all. `assignLanes` at least renders the collision side by
 * side, so the result is visible and fixable rather than lost — what was
 * missing was being told.
 */
function warnIfEstimateOverflows(
  title: string,
  date: string | undefined,
  startMin: number | undefined,
  nextEstimate: number | undefined,
  excludeId: string,
): void {
  if (date === undefined || startMin === undefined) return; // not on the grid
  const wanted = durationOf(nextEstimate);
  const fits = clampResize({
    date,
    startMin,
    requestedMin: wanted,
    windows: state.availability,
    blocks: [],
    placed: spansOn(state.goals, state.tasks, date, excludeId),
    allDayBlocks: state.allDayBlocks,
  });
  // Compared against the SNAPPED duration, not the raw one. `clampResize`
  // rounds to the 5-minute slot grid, so a 37-minute estimate came back as 35
  // and looked like a refusal — every estimate whose minutes fell 1 or 2 past a
  // multiple of five raised a false alarm on a completely empty day.
  const snapped = Math.round(wanted / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN;
  if (fits === null || fits < snapped) {
    actions.showToast(`"${title}" no longer fits its slot — move it or shorten the day`);
  }
}

// Snapshot the outgoing week's commitments exactly once per rollover. Entries
// are immutable after creation; a week with no commitments needs no review.
function ensureWeekRollover(): void {
  const prevWeek = addDays(weekOf(todayStr()), -7);
  if (state.planReview?.week === prevWeek) return;
  const entries = plannedLeaves(state.goals, prevWeek).map((l) => ({
    nodeId: l.nodeId, goalId: l.goalId, leafTitle: l.title, goalTitle: l.goalTitle,
  }));
  const review: PlanReview = { week: prevWeek, entries, reviewed: entries.length === 0 };
  set({ planReview: review });
  ifOwner(() => savePlanReview(review));
}

// ---- actions ----
export const actions = {
  // Goals / nodes
  toggleLeaf(nodeId: string) {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (!node || node.children?.length) return;
    if (node.done) {
      // Unchecking is self-inverse and the row stays visible — no undo toast.
      node.done = false;
      delete node.doneAt;
      setAndPersist({ goals });
    } else {
      // Completion makes the row vanish from Next up — arm the undo window.
      node.done = true;
      node.doneAt = todayStr();
      withUndo(`Completed "${node.title}"`, 'goals', goals);
    }
  },

  toggleExpand(nodeId: string) {
    const expanded = new Set(state.expanded);
    expanded.has(nodeId) ? expanded.delete(nodeId) : expanded.add(nodeId);
    set({ expanded });
  },

  addChild(nodeId: string, title = 'New item') {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    // `cloneGoals`, not a shallow `{ ...g, nodes: [...g.nodes] }`. That spread
    // copies the arrays and SHARES the node objects, so the `delete node.done`
    // below reached straight into live state — which meant the undo snapshot
    // taken a few lines later was of the already-mutated tree, and restoring it
    // left the new child in place. `setNodeEstimate` already clones properly.
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (!node) return;
    // Whether this add CONVERTS a leaf, and whether that leaf was carrying
    // anything worth mourning. Adding to an existing container, or to a bare
    // untouched leaf, loses nothing and must not interrupt with a toast — the
    // common case is typing out a list.
    // `children: []` is a LEAF — `removeNode` splices and leaves the array
    // behind, `GoalTree` renders such a node with a checkbox, and `toggleLeaf`
    // will happily tick it. An empty array is truthy, so `!node.children` alone
    // reported "not a conversion" for exactly the node this guard exists to
    // protect, while the `delete`s below ran anyway — losing the completion AND
    // the armed undo in one click. Same trap as `hasLeaf` in lib/plan.ts.
    const converts = !node.children || node.children.length === 0;
    const carried = converts
      && (node.done === true || node.plannedWeek !== undefined || node.estimateMin !== undefined);
    if (!node.children) node.children = [];
    node.children.push({ id: uid(), title });
    delete node.done;
    delete node.doneAt;
    clearPlannedSlot(node); // a container can never carry a planned slot
    delete node.estimateMin;
    const expanded = new Set(state.expanded);
    expanded.add(nodeId);
    // "+ sub" is a hover affordance two pixels from ✕. On a step that was
    // finished and scheduled it silently un-completed it and pulled it off the
    // calendar, with no confirmation and — through bare `setAndPersist` — no
    // way back. Only that case arms an undo, and the label says what went.
    if (carried) {
      withUndo(`"${node.title}" became a group — its plan was cleared`, 'goals', goals, UNDO_MS, { expanded });
    } else {
      setAndPersist({ goals }, { expanded });
    }
  },

  // Batch add (the AI daily-subtasks helper): append several children to a node
  // at once, converting a leaf into a container. Same freeze + field-clearing as
  // addChild; blanks are dropped and an all-blank list is a no-op.
  addChildren(nodeId: string, titles: string[]) {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const clean = titles.map((t) => t.trim()).filter(Boolean);
    if (clean.length === 0) return;
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (!node) return;
    if (!node.children) node.children = [];
    for (const title of clean) node.children.push({ id: uid(), title, done: false });
    delete node.done;
    delete node.doneAt;
    clearPlannedSlot(node); // a container can never carry a planned slot
    delete node.estimateMin;
    const expanded = new Set(state.expanded);
    expanded.add(nodeId);
    setAndPersist({ goals }, { expanded });
  },

  /**
   * Add a step directly BELOW `nodeId` and open it for typing.
   *
   * Enter in the tree used to call `addChild(parentId)`, which pushes onto the
   * end of the parent's list — so on the first of ten psets the new row landed
   * tenth, unfocused and titled "New item", and the real sequence for adding a
   * sibling became: Enter, scroll to the bottom, find it, double-click, type.
   * At root level `parentId` is null, so Enter did nothing whatsoever, and a
   * fresh project's steps are ALL root-level.
   */
  insertSiblingAfter(nodeId: string, title = 'New step') {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const result = treeInsertSiblingAfter(state.goals, nodeId, title);
    if (!result) return;
    setAndPersist({ goals: result.goals }, { newNodeId: result.newId });
  },

  /** The new row calls this as it mounts, so the flag fires exactly once. */
  clearNewNode() {
    if (state.newNodeId !== null) set({ newNodeId: null });
  },

  addRootNode(goalId: string, title: string) {
    if (!isActiveGoal(goalId)) return; // frozen on a completed project
    const goals = state.goals.map((g) =>
      g.id === goalId
        ? { ...g, nodes: [...g.nodes, { id: uid(), title, done: false }] }
        : g
    );
    setAndPersist({ goals });
  },

  renameNode(nodeId: string, title: string) {
    // Deep clone for the same reason as `addChild`: the shallow spread shared
    // every node object with live state, so this wrote the new title into the
    // current tree before `setAndPersist` was ever called.
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (node) node.title = title;
    setAndPersist({ goals });
  },

  /**
   * Set or clear a leaf's estimate.
   *
   * Undoable, because clearing one destroys a number the user typed and
   * overwriting one destroys the number that was there before — and this is now
   * reachable from the drawer's step tree as well as the rail, i.e. from the
   * surface where people are typing fast and mis-clicking. A no-op change arms
   * nothing: re-picking the preset a step already carries must not burn the undo
   * slot that is holding a delete.
   */
  setNodeEstimate(nodeId: string, minutes: number | null): void {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const goals = state.goals.map((g) => ({ ...g, nodes: structuredClone(g.nodes) }));
    const node = findInAll(goals, nodeId);
    if (!node || node.children) return; // leaves only
    const before = node.estimateMin;
    const next = minutes === null ? undefined : normalizeEstimate(minutes);
    if (before === next) return;
    if (next === undefined) delete node.estimateMin;
    else node.estimateMin = next;
    warnIfEstimateOverflows(node.title, node.plannedDay, node.plannedStartMin, next, nodeId);
    withUndo(describeEstimateChange(node.title, before, next), 'goals', goals);
  },

  setTaskEstimate(taskId: string, minutes: number | null): void {
    const next = minutes === null ? undefined : normalizeEstimate(minutes);
    const target = state.tasks.find((t) => t.id === taskId);
    if (!target || target.estimateMin === next) return;
    const tasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const copy = { ...t };
      if (next === undefined) delete copy.estimateMin;
      else copy.estimateMin = next;
      return copy;
    });
    warnIfEstimateOverflows(target.title, target.date, target.startMin, next, taskId);
    withUndo(describeEstimateChange(target.title, target.estimateMin, next), 'tasks', tasks);
  },

  removeNode(nodeId: string) {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const node = findInAll(state.goals, nodeId);
    const title = node?.title ?? 'item';
    const clearsOpenStep = state.openStepId !== null && nodeContains(nodeId, state.openStepId);
    const goals = state.goals.map((g) => {
      const nodes = structuredClone(g.nodes);
      removeNode(nodes, nodeId);
      return { ...g, nodes };
    });
    withUndo(
      `Deleted "${title}"`,
      'goals',
      goals,
      DESTRUCTIVE_UNDO_MS,
      clearsOpenStep ? { openStepId: null } : undefined,
    );
  },

  /**
   * Delete a whole selection of steps in ONE undoable write.
   *
   * Looping `removeNode` would be wrong twice over: each call arms its own undo
   * entry, so the toast would name only the last step and ⌘Z would walk back
   * one row at a time through a gesture the user performed once — and each call
   * is a separate `setAndPersist`, whose sweep would discard the entries armed
   * before it. A batch is one action.
   *
   * `topLevelSelection` is what makes nesting safe: selecting a group AND
   * something inside it asks for one removal, not two, and the second splice
   * would be hunting for a node that no longer exists. `selectionRemovalCount`
   * is read BEFORE the write so the toast names what actually went — a subtree
   * count, not a row count.
   */
  removeNodes(ids: string[]): boolean {
    const wanted = new Set(ids.filter((id) => isActiveNode(id)));
    if (wanted.size === 0) return false;
    const goals = cloneGoals(state.goals);
    const roots = goals.flatMap((g) => g.nodes);
    const targets = topLevelSelection(roots, wanted);
    if (targets.length === 0) return false;
    const removed = selectionRemovalCount(roots, wanted);
    const openStepId = state.openStepId;
    const clearsOpenStep = openStepId !== null
      && targets.some((id) => nodeContains(id, openStepId));
    for (const g of goals) for (const id of targets) removeNode(g.nodes, id);
    withUndo(
      `Deleted ${removed} step${removed === 1 ? '' : 's'}`,
      'goals',
      goals,
      DESTRUCTIVE_UNDO_MS,
      clearsOpenStep ? { openStepId: null } : undefined,
    );
    return true;
  },

  /**
   * Tick off every open leaf at or under a selection, in ONE undoable write.
   *
   * Leaves, not the selected rows: a container carries no `done` of its own
   * (`pct.ts` derives it), so "complete this group" can only mean the open work
   * inside it. Already-finished leaves are skipped rather than re-stamped, so a
   * batch never rewrites a `doneAt`.
   */
  completeNodes(ids: string[]): boolean {
    const wanted = new Set(ids.filter((id) => isActiveNode(id)));
    if (wanted.size === 0) return false;
    const goals = cloneGoals(state.goals);
    const leafIds = new Set(openLeavesUnder(goals.flatMap((g) => g.nodes), wanted));
    if (leafIds.size === 0) return false;
    const today = todayStr();
    for (const g of goals) {
      walkLeaves(g, (n) => {
        if (!leafIds.has(n.id)) return;
        n.done = true;
        n.doneAt = today;
      });
    }
    const count = leafIds.size;
    withUndo(`Completed ${count} step${count === 1 ? '' : 's'}`, 'goals', goals);
    return true;
  },

  // Append one or more fully-built goals (manual New Goal form or JSON import).
  // Single write path: normalize by column so the array stays priority-ordered,
  // and auto-expand any container nodes the new goals carry so their trees render
  // open in the drawer (mirrors init behavior).
  addGoals(newGoals: Goal[]) {
    if (newGoals.length === 0) return;
    const goals = normalizeByColumn([...state.goals, ...newGoals]);
    const expanded = new Set(state.expanded);
    collectContainers(newGoals).forEach((id) => expanded.add(id));
    setAndPersist({ goals }, { expanded });
  },

  // Cold-start teaching aid: drop the seeded example onto the board. Routes
  // through addGoals so it normalizes by column and auto-expands its container —
  // and is deletable like any project.
  addSampleProject() {
    actions.addGoals([sampleProject(todayStr(), uid)]);
  },

  // Convenience wrapper (tests, callers with only a title): a bare goal in the
  // highest column.
  addGoal(title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    actions.addGoals([{ id: uid(), title: trimmed, nodes: [], column: 0, datesConfirmed: true }]);
  },

  // Priority board: commit an entire column layout. `columns[c]` is the ordered
  // list of goal ids in column c (0 = leftmost/highest). Rebuilds the goals
  // array in column-major order and stamps each goal's `column`.
  setGoalBoard(columns: string[][]) {
    // Weave completed projects (hidden from the board, so absent from `columns`)
    // back into their column at the position they held, before the rebuild — so a
    // drag never appends them to the end and loses their place (spec §2.5).
    const woven = weaveCompleted(state.goals, columns);
    const byId = new Map(state.goals.map((g) => [g.id, g]));
    const seen = new Set<string>();
    const goals: Goal[] = [];
    woven.forEach((ids, col) => {
      ids.forEach((id) => {
        const g = byId.get(id);
        if (g && !seen.has(id)) {
          goals.push({ ...g, column: col });
          seen.add(id);
        }
      });
    });
    // Safety net: never drop a goal that was missing from the incoming layout.
    for (const g of state.goals) {
      if (!seen.has(g.id)) goals.push({ ...g, column: g.column ?? 0 });
    }
    setAndPersist({ goals });
  },

  // Accessible equivalent of dragging a card between horizons: move one project
  // to `column`, appended after that column's active projects. setGoalBoard weaves
  // completed projects back into place, so unrelated order stays put.
  moveGoalToColumn(goalId: string, column: number): void {
    const moved = state.goals.find((g) => g.id === goalId);
    if (!moved) return;
    // An archived project IS movable, deliberately: it keeps a column so that
    // reopening restores its place (spec §2.5). The rebuild below skips
    // archived projects when collecting `cols` and then pushes this one in
    // anyway, which looks like a duplicate — `setGoalBoard`'s `seen` dedupe and
    // `weaveCompleted` are what make that correct rather than accidental.
    const target = Math.min(Math.max(column, 0), HORIZON_COUNT - 1);
    // Choosing the horizon it is already in is not a move. Without this it
    // toasted "Moved X to Now" and armed a whole-goals-slice undo for a write
    // that changed nothing — and that undo then displaced whatever real one was
    // armed before it.
    if (Math.min(Math.max(moved.column ?? 0, 0), HORIZON_COUNT - 1) === target) return;
    const cols: string[][] = Array.from({ length: HORIZON_COUNT }, () => []);
    for (const g of state.goals) {
      if (g.completedAt || g.id === goalId) continue;
      const c = Math.min(Math.max(g.column ?? 0, 0), HORIZON_COUNT - 1);
      cols[c].push(g.id);
    }
    cols[target].push(goalId);
    const before = structuredClone(state.goals);
    actions.setGoalBoard(cols);
    /*
     * Say what happened, and offer it back.
     *
     * This was the one board action that spoke at all: adding, importing and
     * completing a project each raise a toast, and a horizon move — reached
     * from a ⋯ menu, so entirely blind — raised nothing and had no undo. Below
     * 920px only one horizon renders at a time and this does not change which,
     * so the card simply left the screen with no acknowledgement at all. That
     * narrow layout is also where drag is unavailable, making the ⋯ menu the
     * ONLY route between horizons.
     */
    scheduleUndo(
      `Moved "${moved.title}" to ${HORIZON_LABELS[target]}`,
      () => withoutClearingUndo(() => setAndPersist({ goals: before })),
    );
  },

  /**
   * Move a project up or down within its own horizon — the keyboard equivalent
   * of dragging it past a neighbour.
   *
   * Height within a column IS the rank, so this is a real priority edit, and
   * until now the only way to make one was a pointer drag: the ⋯ menu offers
   * horizons but no ordering, so ranking was mouse-only.
   *
   * Archived projects are left out of `cols` — they are not on the board, and
   * `weaveCompleted` restores them around whatever the live order becomes. So
   * "the neighbour" means the next LIVE project, which is the one on screen.
   */
  moveGoalRank(goalId: string, delta: number): void {
    const moved = state.goals.find((g) => g.id === goalId);
    if (!moved || moved.completedAt || delta === 0) return;
    const col = Math.min(Math.max(moved.column ?? 0, 0), HORIZON_COUNT - 1);
    const cols: string[][] = Array.from({ length: HORIZON_COUNT }, () => []);
    for (const g of state.goals) {
      if (g.completedAt) continue;
      cols[Math.min(Math.max(g.column ?? 0, 0), HORIZON_COUNT - 1)].push(g.id);
    }
    const list = cols[col];
    const from = list.indexOf(goalId);
    const to = from + delta;
    // Already against the end it is being pushed towards: silent, so holding
    // the chord down cannot spray toasts or arm undo entries for nothing.
    if (from === -1 || to < 0 || to >= list.length) return;
    list.splice(to, 0, ...list.splice(from, 1));
    const before = structuredClone(state.goals);
    actions.setGoalBoard(cols);
    scheduleUndo(
      `Moved "${moved.title}" ${delta < 0 ? 'up' : 'down'} in ${HORIZON_LABELS[col]}`,
      () => withoutClearingUndo(() => setAndPersist({ goals: before })),
    );
  },

  renameGoal(goalId: string, title: string) {
    const goals = state.goals.map((g) => (g.id === goalId ? { ...g, title } : g));
    setAndPersist({ goals });
  },

  setGoalNotes(goalId: string, notes: string) {
    const goals = state.goals.map((g) => (g.id === goalId ? { ...g, notes } : g));
    setAndPersist({ goals });
  },

  removeGoal(goalId: string) {
    const goal = state.goals.find((g) => g.id === goalId);
    const title = goal?.title ?? 'project';
    const goals = state.goals.filter((g) => g.id !== goalId);
    // Name the cost. Deleting a project takes two clicks and can take a dozen
    // steps, milestones and a week of scheduling with it; "Deleted X" alone
    // gave no sense of how much was riding on the Undo button.
    const steps = goal ? leafCount(goal.nodes).total : 0;
    const label = steps > 0
      ? `Deleted "${title}" and its ${steps} step${steps === 1 ? '' : 's'}`
      : `Deleted "${title}"`;
    withUndo(label, 'goals', goals, DESTRUCTIVE_UNDO_MS);
  },

  // Completion lifecycle — explicit and reversible (spec §2.5). Completing removes
  // the project from the active board, so it is undo-aware; reopen is its exact
  // inverse and needs no undo. Both preserve the project's horizon and position.
  completeGoal(goalId: string): void {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal || goal.completedAt) return;
    const goals = state.goals.map((g) => (g.id === goalId ? { ...g, completedAt: todayStr() } : g));
    withUndo(`Completed "${goal.title}"`, 'goals', goals);
  },

  reopenGoal(goalId: string): void {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal || !goal.completedAt) return;
    const goals = state.goals.map((g) => {
      if (g.id !== goalId) return g;
      const copy = { ...g };
      delete copy.completedAt;
      return copy;
    });
    setAndPersist({ goals });
  },

  // Habits
  toggleHabit(habitId: string) {
    actions.toggleHabitOn(habitId, todayStr());
  },

  // Backfill (or clear) a check-in on any past-or-present day — a missed tap
  // yesterday shouldn't permanently dent the streak. Guarded so a future day and
  // any day before the habit began can never be checked, keeping streaks honest.
  toggleHabitOn(habitId: string, date: string) {
    const today = todayStr();
    if (!isValidLocalDate(date) || date > today) return;
    const target = state.habits.find((h) => h.id === habitId);
    if (!target || (target.createdAt && date < target.createdAt)) return;
    const cleared = target.checkins.includes(date);
    const habits = state.habits.map((h) => {
      if (h.id !== habitId) return h;
      const i = h.checkins.indexOf(date);
      const checkins =
        i >= 0
          ? [...h.checkins.slice(0, i), ...h.checkins.slice(i + 1)]
          : [...h.checkins, date];
      return { ...h, checkins };
    });
    // Today's toggle is visible on the row and instantly reversible, so it stays
    // silent. Editing a PAST day rewrites the record streaks are computed from
    // with nothing on screen to show for it — that needs an undo.
    if (date === today) {
      setAndPersist({ habits });
      return;
    }
    withUndo(
      `${cleared ? 'Cleared' : 'Marked'} "${target.title}" on ${fmtD(date)}`,
      'habits',
      habits,
    );
  },

  addHabit(title: string, cadence: Habit['cadence'], weeklyTarget: number) {
    const habit: Habit = { id: uid(), title, cadence, weeklyTarget, goalId: null, checkins: [], createdAt: todayStr() };
    setAndPersist({ habits: [...state.habits, habit] });
  },

  renameHabit(habitId: string, title: string) {
    const habits = state.habits.map((h) => (h.id === habitId ? { ...h, title } : h));
    setAndPersist({ habits });
  },

  removeHabit(habitId: string) {
    const habit = state.habits.find((h) => h.id === habitId);
    const title = habit?.title ?? 'habit';
    withUndo(
      `Deleted "${title}"`,
      'habits',
      state.habits.filter((h) => h.id !== habitId),
      DESTRUCTIVE_UNDO_MS,
    );
  },

  // Tasks
  /**
   * Record time actually spent on a step or a task.
   *
   * The producer `Session` never had. The type, the table, the backup round
   * trip and `loggedTimeForWeek` all shipped and were tested, and the week
   * recap renders "You logged N minutes across M sessions" behind a
   * `logged.sessions > 0` gate — which, with nothing anywhere creating a
   * session, could never open. That branch was unreachable code guarded by a
   * passing test.
   *
   * Append-only: a second sitting on the same step is a second session, not an
   * overwrite, so `loggedForNode` sums them. Time is never INFERRED from a
   * scheduled block — a block is what you set aside, not what you spent, and
   * recording the former as the latter would invent exactly the kind of
   * authoritative-looking figure `capacityParts` refuses to produce.
   *
   * Returns whether it wrote, so callers cannot report success on a refusal.
   */
  logSession(
    kind: 'step' | 'task',
    id: string,
    minutes: number,
    date = todayStr(),
  ): boolean {
    const normalized = normalizeEstimate(minutes);
    if (normalized === undefined || !isValidLocalDate(date)) return false;

    let title: string;
    let goalId: string | null;
    if (kind === 'step') {
      // Frozen on a completed project, exactly as `setNodeEstimate` is. The
      // drawer already blocks the whole tree with `pointer-events-none`, so
      // this is unreachable from the UI today — but the two controls sit on the
      // same row and must not disagree about whether the project is editable
      // the moment any other surface calls in.
      if (!isActiveNode(id)) return false;
      const goal = goalOfNode(id);
      const node = goal ? findNode(goal.nodes, id) : null;
      // Containers hold no estimate (see `addChild`), so there is nothing for
      // logged time to be measured against.
      if (!goal || !node || node.children) return false;
      title = node.title;
      goalId = goal.id;
    } else {
      const task = state.tasks.find((t) => t.id === id);
      if (!task) return false;
      title = task.title;
      goalId = task.goalId;
    }

    const session: Session = {
      id: uid(),
      goalId,
      date,
      minutes: normalized,
      note: '',
      ...(kind === 'step' ? { nodeId: id } : { taskId: id }),
    };
    withUndo(
      `Logged ${formatEstimateValue(normalized)} on "${title}"`,
      'sessions',
      [...state.sessions, session],
    );
    return true;
  },

  /**
   * Discard every session recorded against one item.
   *
   * The symmetric partner to clearing an estimate: a mis-logged entry is
   * otherwise permanent, since sessions are append-only and carry no edit
   * route. Undoable like everything else that destroys a number the user typed.
   */
  clearSessionsFor(kind: 'step' | 'task', id: string): boolean {
    const key = kind === 'step' ? 'nodeId' : 'taskId';
    const remaining = state.sessions.filter((s) => s[key] !== id);
    const dropped = state.sessions.length - remaining.length;
    if (dropped === 0) return false;
    const title = kind === 'step'
      ? findInAll(state.goals, id)?.title
      : state.tasks.find((t) => t.id === id)?.title;
    // Names the item and the cost, as every other destructive label here does:
    // once the control collapses, the ledger this discards is not visible
    // anywhere, so the toast is the only chance to say what was thrown away.
    withUndo(
      `Cleared ${dropped} time entr${dropped === 1 ? 'y' : 'ies'} on "${title ?? 'that item'}"`,
      'sessions',
      remaining,
    );
    return true;
  },

  addTask(title: string, date = todayStr(), goalId: string | null = null): void {
    const trimmed = title.trim();
    if (!trimmed || !isValidLocalDate(date)) return;
    const task: Task = { id: uid(), title: trimmed, date, done: false, goalId };
    setAndPersist({ tasks: [...state.tasks, task] });
  },

  toggleTask(taskId: string): void {
    if (!state.tasks.some((task) => task.id === taskId)) return;
    const tasks = state.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const updated = { ...task };
      if (updated.done) {
        updated.done = false;
        delete updated.doneAt;
      } else {
        updated.done = true;
        updated.doneAt = todayStr();
      }
      return updated;
    });
    setAndPersist({ tasks });
  },

  rescheduleTask(taskId: string, date: string): void {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task || !isValidLocalDate(date) || task.date === date) return;
    const tasks = state.tasks.map((item) => {
      if (item.id !== taskId) return item;
      // A different day cannot inherit this day's minute: the new day may have
      // no room there, or no availability window at all. Clearing it returns
      // the task to that day's backlog rather than parking it in dead time.
      const moved = { ...item, date };
      delete moved.startMin;
      return moved;
    });
    setAndPersist({ tasks });
  },

  removeTask(taskId: string): void {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const originalIndex = state.tasks.indexOf(task);
    const deletedTask = structuredClone(task);
    scheduleUndo(`Deleted "${task.title}"`, () => withoutClearingUndo(() => {
      if (state.tasks.some((item) => item.id === deletedTask.id)) return;
      const tasks = [...state.tasks];
      tasks.splice(Math.min(originalIndex, tasks.length), 0, deletedTask);
      setAndPersist({ tasks });
    }), DESTRUCTIVE_UNDO_MS, true);
    withoutClearingUndo(() => {
      setAndPersist({ tasks: state.tasks.filter((item) => item.id !== taskId) });
    });
  },

  // Bulk-triage the "Needs a decision" pile onto next week in one keystroke — the
  // exam-week escape valve. Spans tasks and steps, so it snapshots both slices for
  // a single undo instead of routing through withUndo's one-key helper.
  deferOpenToNextWeek(): void {
    const today = todayStr();
    const target = addDays(weekOf(today), 7);
    const { goals, tasks, count } = deferOpenWork(state.goals, state.tasks, today, target);
    if (count === 0) return;
    const snapGoals = structuredClone(state.goals);
    const snapTasks = structuredClone(state.tasks);
    scheduleUndo(
      `Pushed ${count} item${count === 1 ? '' : 's'} to next week`,
      () => withoutClearingUndo(() => setAndPersist({ goals: snapGoals, tasks: snapTasks })),
    );
    withoutClearingUndo(() => setAndPersist({ goals, tasks }));
  },

  // Structural reorder / indent / outdent
  /**
   * Both restructuring moves are undoable, because both destroy data to hold
   * the leaf-XOR-container invariant.
   *
   * Indenting under a leaf turns that leaf into a container, and `treeIndentNode`
   * therefore strips its `done`, `doneAt`, planned slot and `estimateMin` — so
   * one keystroke can silently un-complete a step and take it off Thursday
   * afternoon. Outdenting the last child does the milder version, resetting the
   * emptied parent to `done: false`. Neither was recoverable: both went through
   * bare `setAndPersist`, which additionally swept away any restore already
   * armed. A structural edit that discards a completion has to be at least as
   * reversible as deleting a milestone.
   */
  indentNode(nodeId: string): void {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const node = findInAll(state.goals, nodeId);
    // Both tree helpers return a fresh clone even when they refuse the move
    // (first sibling / already at root), so identity says nothing. Compare the
    // node's PATH instead: a real indent gains an ancestor, a real outdent
    // loses one. Without this a refused move still armed "Indented X — Undo",
    // advertising a change that never happened.
    const pathBefore = findNodePath(state.goals, nodeId)?.join('/');
    const goals = treeIndentNode(state.goals, nodeId);
    if (findNodePath(goals, nodeId)?.join('/') === pathBefore) return;
    const nodePath = findNodePath(goals, nodeId);
    const expanded = new Set(state.expanded);
    if (nodePath && nodePath.length > 1) {
      expanded.add(nodePath[nodePath.length - 2]); // new parent container
    }
    withUndo(`Indented "${node?.title ?? 'step'}"`, 'goals', goals, UNDO_MS, { expanded });
  },

  outdentNode(nodeId: string): void {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const node = findInAll(state.goals, nodeId);
    const oldPath = findNodePath(state.goals, nodeId);
    const goals = treeOutdentNode(state.goals, nodeId);
    if (findNodePath(goals, nodeId)?.join('/') === oldPath?.join('/')) return; // see indentNode
    const expanded = new Set(state.expanded);
    if (oldPath && oldPath.length > 1) {
      const oldParentId = oldPath[oldPath.length - 2];
      const parentInNew = findInAll(goals, oldParentId);
      if (parentInNew && !parentInNew.children?.length) {
        expanded.delete(oldParentId);
      }
    }
    withUndo(`Outdented "${node?.title ?? 'step'}"`, 'goals', goals, UNDO_MS, { expanded });
  },

  reorderSiblingNodes(activeId: string, overId: string): void {
    if (!isActiveNode(activeId)) return; // frozen on a completed project
    const goals = reorderSiblings(state.goals, activeId, overId);
    setAndPersist({ goals });
  },

  reorderGoals(activeId: string, overId: string): void {
    const goals = reorderTop(state.goals, activeId, overId);
    setAndPersist({ goals });
  },

  reorderHabits(activeId: string, overId: string): void {
    const habits = reorderTop(state.habits, activeId, overId);
    setAndPersist({ habits });
  },

  // Timeline scale — updates land per gesture frame, so persistence is
  // debounced rather than written on every wheel tick.
  setScale(pxPerDay: number): void {
    const v = clampScale(pxPerDay);
    if (v === state.pxPerDay) return;
    set({ pxPerDay: v });
    if (scaleTimer) clearTimeout(scaleTimer);
    scaleTimer = setTimeout(() => ifOwner(() => saveScale(state.pxPerDay)), 400);
  },

  // Availability and the all-day preference are device preferences, not app
  // data: they follow setScale/setTheme's pattern (set + persist directly),
  // never routed through setAndPersist.
  setAvailability(windows: AvailabilityWindow[]): void {
    const next = parseAvailability(windows); // reject a malformed set at the door
    set({ availability: next });
    ifOwner(() => saveAvailability(next));
  },

  setAllDayBlocks(value: boolean): void {
    if (value === state.allDayBlocks) return;
    set({ allDayBlocks: value });
    ifOwner(() => saveAllDayBlocks(value));
  },

  // A device preference, like availability and the all-day setting: set() plus
  // its own save, never setAndPersist — this is not app data.
  setSidebarPanels(panels: SidebarPanel[]): void {
    set({ sidebarPanels: panels });
    ifOwner(() => saveSidebarPanels(panels));
  },

  // Goal date editing
  confirmGoalDates(goalId: string): void {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal || goal.datesConfirmed === true || projectDateError(goal.start, goal.deadline)) return;
    const goals = state.goals.map((g) => (
      g.id === goalId ? { ...g, datesConfirmed: true } : g
    ));
    setAndPersist({ goals });
  },

  // Clear the whole unconfirmed-dates banner in one pass (AI-import leaves every
  // project unconfirmed). Only stamps projects with a valid span — an inverted
  // start/deadline stays behind for manual review. Undoable as one batch.
  confirmAllGoalDates(): void {
    const ids = confirmableDateGoalIds(state.goals);
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const goals = state.goals.map((g) => (idSet.has(g.id) ? { ...g, datesConfirmed: true } : g));
    withUndo(
      `Confirmed dates for ${ids.length} project${ids.length === 1 ? '' : 's'}`,
      'goals',
      goals,
    );
  },

  dismissDateReview(): void {
    set({ dateReviewDismissed: true });
  },

  setGoalDates(goalId: string, start?: string, deadline?: string): boolean {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal || projectDateError(start, deadline)) return false;
    const updated = { ...goal, datesConfirmed: true };
    if (start) updated.start = start;
    else delete updated.start;
    if (deadline) updated.deadline = deadline;
    else delete updated.deadline;
    const goals = state.goals.map((g) => g.id === goalId ? updated : g);
    withUndo(`Updated dates for "${goal.title}"`, 'goals', goals);
    return true;
  },

  // Node scheduling — start/deadline are scheduling metadata only, never affect pct
  setNodeDates(goalId: string, nodeId: string, start: string, deadline: string): void {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal) return;
    const node = findNode(goal.nodes, nodeId);
    if (!node) return;
    const clamped = clampSpan(start, deadline);
    const goals = cloneGoals(state.goals);
    const clonedGoal = goals.find((g) => g.id === goalId)!;
    const clonedNode = findNode(clonedGoal.nodes, nodeId)!;
    clonedNode.start = clamped.start;
    clonedNode.deadline = clamped.deadline;
    withUndo(`Scheduled "${node.title}"`, 'goals', goals);
  },

  clearNodeDates(goalId: string, nodeId: string): void {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal) return;
    const node = findNode(goal.nodes, nodeId);
    if (!node) return;
    const goals = cloneGoals(state.goals);
    const clonedGoal = goals.find((g) => g.id === goalId)!;
    const clonedNode = findNode(clonedGoal.nodes, nodeId)!;
    delete clonedNode.start;
    delete clonedNode.deadline;
    withUndo(`Unscheduled "${node.title}"`, 'goals', goals);
  },

  // Scheduling. A view hands over WHERE THE USER POINTED; the store resolves
  // the actual slot, refuses with an explanation when nothing fits, and
  // persists. Views never call resolveSlot. Returns whether a slot was found
  // and persisted — callers must not report success on a refusal, since the
  // refusal already wrote its own explanatory toast.
  scheduleNode(goalId: string, nodeId: string, day: string, aimMin: number): boolean {
    if (!isActiveGoal(goalId)) return false; // frozen on a completed project
    const source = state.goals.find((g) => g.id === goalId);
    const sourceNode = source ? findNode(source.nodes, nodeId) : null;
    if (!sourceNode || sourceNode.children) return false;

    const durationMin = durationOf(sourceNode.estimateMin);
    const placed = spansOn(state.goals, state.tasks, day, nodeId);
    // Moving something already on the grid is an ADJUSTMENT, not a new
    // commitment against "right now" — which is the case `NO_PAST_LIMIT`'s own
    // note describes, and which `clampResize` already uses it for. With the
    // real clock, dragging a 09:00 block down to 11:00 at 2pm found the day's
    // only remaining gap at 14:00 and silently dropped the block there, and
    // dragging one onto an earlier weekday of the same week refused with "no
    // free time left that day" about a day that was nine hours empty. Both
    // outcomes came from treating a rearrangement as a fresh booking.
    const now = sourceNode.plannedDay !== undefined && sourceNode.plannedStartMin !== undefined
      ? NO_PAST_LIMIT
      : nowMoment();
    const startMin = resolveSlot({
      date: day,
      aimMin,
      durationMin,
      windows: state.availability,
      blocks: [], // slice 2 supplies real busy blocks
      placed,
      now,
      allDayBlocks: state.allDayBlocks,
    });
    if (startMin === null) {
      // Same `now` as the search above, or the refusal describes gaps the
      // search was never allowed to use.
      const gaps = freeIntervals(day, state.availability, [], placed, now, state.allDayBlocks);
      actions.showToast(describeNoRoom(durationMin, gaps));
      return false;
    }

    const goals = cloneGoals(state.goals);
    const node = findNode(goals.find((g) => g.id === goalId)!.nodes, nodeId)!;
    setPlannedSlot(node, day, startMin);
    setAndPersist({ goals });
    return true;
  },

  scheduleTask(taskId: string, date: string, aimMin: number): boolean {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task || !isValidLocalDate(date)) return false;

    const durationMin = durationOf(task.estimateMin);
    const placed = spansOn(state.goals, state.tasks, date, taskId);
    // See scheduleNode: a task already on the grid is being rearranged, not
    // booked, so the wall clock must not amputate the earlier part of its day.
    const now = task.date !== undefined && task.startMin !== undefined
      ? NO_PAST_LIMIT
      : nowMoment();
    const startMin = resolveSlot({
      date,
      aimMin,
      durationMin,
      windows: state.availability,
      blocks: [],
      placed,
      now,
      allDayBlocks: state.allDayBlocks,
    });
    if (startMin === null) {
      const gaps = freeIntervals(date, state.availability, [], placed, now, state.allDayBlocks);
      actions.showToast(describeNoRoom(durationMin, gaps));
      return false;
    }

    setAndPersist({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, date, startMin } : t)),
    });
    return true;
  },

  /**
   * The weekly recap's "Replan": put a carried-over step on the next day that
   * can actually take it.
   *
   * It used to be `scheduleNode(goalId, nodeId, today, 0)`. Two things were
   * wrong with that, and they compounded. Under the default Mon–Fri
   * availability, `windowForDate` returns null for a weekend, so every Replan
   * button failed outright on a Saturday or Sunday — which is exactly when a
   * weekly review gets done. And on a weekday that succeeded, nothing changed
   * on screen: `weekRecap` buckets on `node.done`, which a replan doesn't
   * touch, and `scheduleNode`'s return value was discarded, so only the FAILURE
   * path ever spoke. Success was indistinguishable from a dead button, which is
   * how you end up clicking it five times.
   *
   * The forward search is a dry run — `resolveSlot` with no write — so the
   * fourteen misses can't each raise their own refusal toast on the way past.
   */
  replanNode(goalId: string, nodeId: string): void {
    const source = state.goals.find((g) => g.id === goalId);
    const node = source ? findNode(source.nodes, nodeId) : null;
    if (!node) return;
    const durationMin = durationOf(node.estimateMin);
    const from = todayStr();
    for (let i = 0; i < REPLAN_HORIZON_DAYS; i += 1) {
      const date = addDays(from, i);
      const startMin = resolveSlot({
        date,
        aimMin: 0, // earliest gap that fits
        durationMin,
        windows: state.availability,
        blocks: [],
        placed: spansOn(state.goals, state.tasks, date, nodeId),
        now: nowMoment(),
        allDayBlocks: state.allDayBlocks,
      });
      if (startMin === null) continue;
      if (actions.scheduleNode(goalId, nodeId, date, startMin)) {
        actions.showToast(`Replanned "${node.title}" for ${fmtD(date)}`);
      }
      return;
    }
    actions.showToast(
      `No free slot for "${node.title}" in the next ${REPLAN_HORIZON_DAYS} days — shorten it, or open up more hours.`,
    );
  },

  unscheduleNode(goalId: string, nodeId: string): void {
    if (!isActiveGoal(goalId)) return;
    const goal = state.goals.find((g) => g.id === goalId);
    const node = goal ? findNode(goal.nodes, nodeId) : null;
    if (!goal || !node || !node.plannedWeek) return;
    const goals = cloneGoals(state.goals);
    clearPlannedSlot(findNode(goals.find((g) => g.id === goalId)!.nodes, nodeId)!);
    withUndo(`Removed "${node.title}" from plan`, 'goals', goals);
    // Point at where it landed. The rail sorts undated work last and caps each
    // project at three, so a step taken off the grid can drop straight behind
    // "+N more" — clicking × and having the row appear nowhere is the same
    // "did that work?" the reveal path exists to answer.
    actions.revealInPlan('step', nodeId);
  },

  /**
   * The `×` on a task block takes it off the plan entirely — day and time —
   * exactly as `unscheduleNode` does for a step.
   *
   * This used to unpin the TIME only and keep `date`, on the grounds that "no
   * surface lists a dateless task, so dropping the date makes it unreachable".
   * That was true of the old planner and stopped being true when the backlog
   * rail shipped: `backlogGroups` lists any task without BOTH a date and a
   * start minute, filing it under its project. So the reason for the asymmetry
   * was gone, but the asymmetry stayed — and it was doing visible damage,
   * because `tasksForWeek` (which feeds the capacity readout) filters on `date`
   * alone. One unscheduled task was therefore charged to "6h planned" in the
   * week header AND listed under "To plan" in the rail at the same time: the
   * one number you plan against, contradicted by the list beside it.
   *
   * Two × buttons on the same grid must not mean two different things.
   */
  unscheduleTask(taskId: string): void {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task || !task.date || task.startMin === undefined) return;
    const tasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const cleared = { ...t };
      delete cleared.startMin;
      delete cleared.date;
      return cleared;
    });
    withUndo(`Removed "${task.title}" from plan`, 'tasks', tasks);
    // See unscheduleNode: an unscheduled task is undated, so it sorts to the
    // bottom of its group and the cap can hide it outright.
    actions.revealInPlan('task', taskId);
  },

  resizeNode(nodeId: string, minutes: number): void {
    if (!isActiveNode(nodeId)) return;
    const goal = goalOfNode(nodeId);
    const node = goal ? findNode(goal.nodes, nodeId) : null;
    if (!goal || !node || node.plannedDay === undefined || node.plannedStartMin === undefined) return;

    const clamped = clampResize({
      date: node.plannedDay,
      startMin: node.plannedStartMin,
      requestedMin: minutes,
      windows: state.availability,
      blocks: [],
      placed: spansOn(state.goals, state.tasks, node.plannedDay, nodeId),
      allDayBlocks: state.allDayBlocks,
    });
    if (clamped === null) {
      actions.showToast(describeResizeRefused(node.title));
      return;
    }

    const goals = cloneGoals(state.goals);
    findNode(goals.find((g) => g.id === goal.id)!.nodes, nodeId)!.estimateMin = clamped;
    setAndPersist({ goals });
  },

  resizeTask(taskId: string, minutes: number): void {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task || task.date === undefined || task.startMin === undefined) return;

    const clamped = clampResize({
      date: task.date,
      startMin: task.startMin,
      requestedMin: minutes,
      windows: state.availability,
      blocks: [],
      placed: spansOn(state.goals, state.tasks, task.date, taskId),
      allDayBlocks: state.allDayBlocks,
    });
    if (clamped === null) {
      actions.showToast(describeResizeRefused(task.title));
      return;
    }

    setAndPersist({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, estimateMin: clamped } : t)),
    });
  },

  markWeekReviewed(): void {
    if (!state.planReview || state.planReview.reviewed) return;
    const review = { ...state.planReview, reviewed: true };
    set({ planReview: review });
    ifOwner(() => savePlanReview(review));
  },

  ensureWeekRollover(): void {
    ensureWeekRollover();
  },

  // Milestones — markers only, never enter pct roll-up
  addMilestone(goalId: string, title: string, date: string): void {
    const goals = state.goals.map((g) =>
      g.id === goalId
        ? { ...g, milestones: [...(g.milestones ?? []), { id: uid(), title, date }] }
        : g,
    );
    setAndPersist({ goals });
  },

  updateMilestone(
    goalId: string,
    milestoneId: string,
    patch: { title?: string; date?: string },
  ): void {
    const goals = state.goals.map((g) =>
      g.id === goalId
        ? {
            ...g,
            milestones: (g.milestones ?? []).map((m) =>
              m.id === milestoneId ? { ...m, ...patch } : m,
            ),
          }
        : g,
    );
    setAndPersist({ goals });
  },

  removeMilestone(goalId: string, milestoneId: string): void {
    const goal = state.goals.find((g) => g.id === goalId);
    const ms = goal?.milestones?.find((m) => m.id === milestoneId);
    const title = ms?.title ?? 'milestone';
    const goals = state.goals.map((g) =>
      g.id === goalId
        ? { ...g, milestones: (g.milestones ?? []).filter((m) => m.id !== milestoneId) }
        : g,
    );
    withUndo(`Deleted "${title}"`, 'goals', goals);
  },

  undoLastDelete(): void {
    const entry = undoStack.pop();
    if (entry) entry.restore();
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    set({ pendingUndo: null });
  },

  // UI
  setView(v: ViewName) {
    if (v === 'project') {
      set({ view: v });
      return;
    }
    set({ view: v, openGoalId: null, openStepId: null, focusNodeId: null });
  },

  // Theme is a per-device UI preference: persist to localStorage, apply the
  // resolved effective theme to the DOM, and update state so the header toggle
  // re-renders. Never routed through setAndPersist — it is not app data.
  setTheme(next: Theme) {
    writeStoredTheme(next);
    applyTheme(resolveTheme(next, systemPrefersDark()));
    set({ theme: next });
  },

  setSelDate(s: string) {
    set({ selDate: s });
  },

  setActiveHorizon(horizon: number): void {
    const next = Math.min(Math.max(horizon, 0), HORIZON_COUNT - 1);
    if (next === state.activeHorizon) return;
    set({ activeHorizon: next });
  },

  goToToday() {
    set({ selDate: todayStr() });
  },

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
    const returnView = state.view === 'project' ? state.projectReturnView : state.view;
    const projectReturnView = returnView === 'project' ? 'goals' : returnView;
    const base = {
      view: 'project' as const,
      projectReturnView,
      openGoalId: goalId,
      projectTab: 'steps' as const,
    };
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

  /** Leave the project page for the view it was opened from. */
  closeProject() {
    const view = state.projectReturnView === 'project' ? 'goals' : state.projectReturnView;
    set({ view, openGoalId: null, focusNodeId: null, openStepId: null });
  },

  setProjectTab(tab: ProjectTab) {
    set({ projectTab: tab });
  },

  /**
   * Drop the pulse pointer once the page has used it. `focusNodeId` names a
   * MOMENT, not a selection: left set, collapsing and re-expanding the tree
   * would replay the highlight for a navigation that happened minutes ago.
   */
  clearFocusNode() {
    if (state.focusNodeId === null) return;
    set({ focusNodeId: null });
  },

  /**
   * Send the user to the Plan view pointed at one task or habit.
   *
   * Search can find both, but neither has a detail surface, so choosing one
   * used to switch view and nothing else — for anything off the visible week
   * that was indistinguishable from the palette ignoring Enter. The view is
   * what scrolls and highlights; this only states the intent, plus the one
   * piece of setup the view cannot do for itself without fighting the user's
   * own panel preference: a habit is invisible while the Habits panel is
   * collapsed, so revealing one opens it.
   *
   * The nonce makes a repeat reveal of the same id a distinct value — object
   * identity alone would do that too, but naming it stops a future `useMemo`
   * or equality check from quietly collapsing the two.
   */
  revealInPlan(kind: RevealKind, id: string) {
    const sidebarPanels =
      kind === 'habit' && !state.sidebarPanels.includes('habits')
        ? [...state.sidebarPanels, 'habits' as SidebarPanel]
        : state.sidebarPanels;
    if (sidebarPanels !== state.sidebarPanels) ifOwner(() => saveSidebarPanels(sidebarPanels));
    set({
      view: 'plan',
      revealItem: { kind, id, nonce: revealNonce += 1 },
      sidebarPanels,
    });
  },

  /** The view calls this once the highlight has run its course. */
  clearReveal() {
    set({ revealItem: null });
  },

  /**
   * The board card's "Plan next step" — go to the calendar with this project's
   * most urgent unplanned item already picked out.
   *
   * The card computes exactly which step it means and used to throw it away:
   * `onPlan` took a `goalId`, ignored it, and called `setView('plan')`. Since
   * `cardPrimaryAction` returns 'plan' for essentially every healthy project,
   * that was the default action on most cards, and it left you to find the
   * project by hand in a rail holding a dozen others.
   *
   * The target is read from `backlogGroups`, not from a second "first open
   * leaf" walk, so the row this selects is the row the rail actually puts at
   * the top of that project — one ordering, not two that can disagree.
   */
  planNextStepFor(goalId: string) {
    const today = todayStr();
    const groups = backlogGroups(state.goals, state.tasks, weekOf(today), today);
    const first = groups.find((g) => g.goalId === goalId)?.items[0];
    // Nothing left to plan: still go to the calendar, which is what the button
    // says, rather than appearing dead.
    if (!first) {
      set({ view: 'plan' });
      return;
    }
    actions.revealInPlan(first.kind, first.id);
  },

  showToast(msg: string) {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 1900);
  },

  // IO
  async exportBackup() {
    // Non-fatal: the snapshot is a nicety, the backup is the point. A rejected
    // IndexedDB read here would otherwise skip exportState entirely — no file
    // written, no toast, and an unhandled rejection, because the call site
    // neither awaits nor catches. Degrade to "backup without a snapshot",
    // never to "no backup".
    const preSlotMigrationSnapshot = await loadSlotMigrationSnapshot().catch(() => null);
    exportState(
      { goals: state.goals, habits: state.habits, tasks: state.tasks, sessions: state.sessions },
      state.pxPerDay,
      state.planReview,
      state.availability,
      state.allDayBlocks,
      state.sidebarPanels,
      preSlotMigrationSnapshot,
    );
    actions.showToast('Backup exported');
  },

  async importBackup(file: File) {
    // `importStateFromFile` writes all four tables plus every settings row
    // itself, so it has to be gated here rather than downstream.
    if (!ownsTabLock) {
      actions.showToast('Phase is open in another tab — close it before importing.');
      return;
    }
    try {
      const appState = await importStateFromFile(file);
      const planReview = await loadPlanReview();
      // An import is a generation boundary: nothing armed against the PREVIOUS
      // dataset can mean anything against this one. Left alone, an undo armed
      // moments before (deleting a project arms a 15-second window) stayed on
      // the stack, and ⌘Z — the most natural reflex right after "I just
      // restored a backup" — replayed a whole-slice snapshot of the old data
      // over the imported data AND persisted it. The recovery mechanism
      // destroyed the recovery. `set` does not sweep the stack the way
      // `setAndPersist` does, so this has to be explicit.
      undoStack = [];
      armedSurgical = false;
      if (undoTimer) {
        clearTimeout(undoTimer);
        undoTimer = null;
      }
      set({
        ...appState,
        planReview,
        expanded: collectContainers(appState.goals),
        pendingUndo: null,
        // The generation boundary applies to where the user is STANDING too.
        // `openGoalId`/`openStepId` name rows in the PREVIOUS dataset, and an
        // import that reuses an id (exporting and re-importing the same data
        // always does) would leave the project page pointed at a node that is
        // no longer the one it was opened on. Leaving the page is the honest
        // response to the data underneath it being replaced.
        ...(state.view === 'project' ? { view: 'goals' as const } : {}),
        openGoalId: null,
        focusNodeId: null,
        openStepId: null,
      });
      ensureWeekRollover();
      actions.showToast('Backup imported');
    } catch (e) {
      actions.showToast(e instanceof Error ? e.message : 'Could not read that file.');
    }
  },
};

// ---- useSyncExternalStore hook ----
export function useAppStore(): FullState & { actions: typeof actions } {
  const snap = useSyncExternalStore(
    useCallback((cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }, []),
    () => state,
    () => state
  );
  return { ...snap, actions };
}
