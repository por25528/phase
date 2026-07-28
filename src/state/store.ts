import { useSyncExternalStore, useCallback } from 'react';
import type { Goal, Habit, AppState, PlanReview, Task, AvailabilityWindow } from '../db/types';
import {
  loadState, persist, exportState, importStateFromFile, loadScale, saveScale,
  loadPlanReview, savePlanReview, loadAvailability, saveAvailability,
  loadAllDayBlocks, saveAllDayBlocks,
} from '../db/db';
import { clampScale } from '../lib/timeline';
import { DEFAULT_AVAILABILITY, parseAvailability } from '../lib/availability';
import { todayStr, addDays } from '../lib/dates';
import { clampSpan } from '../lib/timeline';
import { isValidLocalDate, projectDateError, confirmableDateGoalIds } from '../lib/schedule';
import { weekOf, plannedLeaves } from '../lib/plan';
import { deferOpenWork } from '../lib/deferWork';
import { sampleProject } from '../lib/sampleProject';
import { weaveCompleted } from '../lib/board';
import { acquireTabLock } from '../lib/tabLock';
import { normalizeEstimate } from '../lib/capacity';
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
} from '../lib/tree';

export type ViewName = 'today' | 'goals' | 'timeline';

interface UIState {
  view: ViewName;
  selDate: string;
  openGoalId: string | null;
  drawerFocusNodeId: string | null; // node the drawer should scroll to + highlight
  planOpen: boolean; // the weekly Plan modal — a global overlay like the drawer
  planFocusGoalId: string | null; // board "Plan next step" deep-link target
  expanded: Set<string>;
  toast: string | null;
  pendingUndo: { label: string } | null;
  pxPerDay: number; // timeline scale — continuous, gesture-driven
  hydration: 'loading' | 'ready' | 'error';
  secondTab: boolean;
  dateReviewDismissed: boolean;
  theme: Theme; // per-device UI preference (localStorage, not Dexie)
  planReview: PlanReview | null; // previous-week snapshot — review metadata, not app data
  availability: AvailabilityWindow[]; // per-weekday planning window (device preference)
  allDayBlocks: boolean;              // do all-day calendar events consume the day?
}

interface FullState extends AppState, UIState {}

let state: FullState = {
  goals: [],
  habits: [],
  tasks: [],
  sessions: [],
  view: 'today',
  selDate: todayStr(),
  openGoalId: null,
  drawerFocusNodeId: null,
  planOpen: false,
  planFocusGoalId: null,
  expanded: new Set(),
  toast: null,
  pendingUndo: null,
  pxPerDay: 13, // quarter preset until the persisted scale loads
  hydration: 'loading',
  secondTab: false,
  dateReviewDismissed: false,
  planReview: null,
  availability: DEFAULT_AVAILABILITY,
  allDayBlocks: true,
  // Read synchronously at module load so the header toggle shows the correct
  // state immediately (the no-FOUC script already painted <html>). 'system' in
  // non-DOM contexts (tests).
  theme: readStoredTheme(),
};

let initialized = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let undoTimer: ReturnType<typeof setTimeout> | null = null;
let scaleTimer: ReturnType<typeof setTimeout> | null = null;
let restoreFn: (() => void) | null = null;
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
  const next = { ...state, ...uiPatch, ...patch };
  state = next;
  notify();
  persist({ goals: next.goals, habits: next.habits, tasks: next.tasks, sessions: next.sessions }).catch(() => {
    actions.showToast('Saving failed — export a backup now');
  });
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
  void acquireTabLock().then((owned) => {
    if (!owned) set({ secondTab: true });
  });
  try {
    const [appState, pxPerDay, planReview, availability, allDayBlocks] = await Promise.all([
      loadState(), loadScale(), loadPlanReview(), loadAvailability(), loadAllDayBlocks(),
    ]);
    state = {
      ...state,
      ...appState,
      pxPerDay,
      planReview,
      availability,
      allDayBlocks,
      hydration: 'ready',
      expanded: collectContainers(appState.goals),
    };
    notify();
    ensureWeekRollover();
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
function scheduleUndo(label: string, restore: () => void): void {
  if (undoTimer) clearTimeout(undoTimer);
  restoreFn = restore;
  set({ pendingUndo: { label } });
  undoTimer = setTimeout(() => {
    restoreFn = null;
    undoTimer = null;
    set({ pendingUndo: null });
  }, 5000);
}

// Snapshot state[key], arm its restoration, then persist `next` — the shared
// seam behind every undoable edit (deletes, date edits). Callers compute
// `next` from the pre-write state and hand it in; the snapshot below is taken
// before that value lands, so restore always replays the prior slice.
function withUndo<K extends keyof AppState>(label: string, key: K, next: AppState[K]): void {
  const snapshot = structuredClone(state[key]);
  scheduleUndo(label, () => setAndPersist({ [key]: snapshot } as Partial<AppState>));
  setAndPersist({ [key]: next } as Partial<AppState>);
}

// The four commitment horizons (Now / Next / Later / Someday).
const HORIZON_COUNT = 4;

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
  savePlanReview(review).catch(() => {});
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
      withUndo(`Completed "${node.title}" · Undo`, 'goals', goals);
    }
  },

  toggleExpand(nodeId: string) {
    const expanded = new Set(state.expanded);
    expanded.has(nodeId) ? expanded.delete(nodeId) : expanded.add(nodeId);
    set({ expanded });
  },

  addChild(nodeId: string, title = 'New item') {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const goals = state.goals.map((g) => ({ ...g, nodes: [...g.nodes] }));
    const node = findInAll(goals, nodeId);
    if (!node) return;
    if (!node.children) node.children = [];
    node.children.push({ id: uid(), title });
    delete node.done;
    delete node.doneAt;
    delete node.plannedWeek;
    delete node.plannedDay;
    delete node.estimateMin;
    const expanded = new Set(state.expanded);
    expanded.add(nodeId);
    setAndPersist({ goals }, { expanded });
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
    delete node.plannedWeek;
    delete node.plannedDay;
    delete node.estimateMin;
    const expanded = new Set(state.expanded);
    expanded.add(nodeId);
    setAndPersist({ goals }, { expanded });
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
    const goals = state.goals.map((g) => ({ ...g, nodes: [...g.nodes] }));
    const node = findInAll(goals, nodeId);
    if (node) node.title = title;
    setAndPersist({ goals });
  },

  setNodeEstimate(nodeId: string, minutes: number | null): void {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const goals = state.goals.map((g) => ({ ...g, nodes: structuredClone(g.nodes) }));
    const node = findInAll(goals, nodeId);
    if (!node || node.children) return; // leaves only
    const next = minutes === null ? undefined : normalizeEstimate(minutes);
    if (next === undefined) delete node.estimateMin;
    else node.estimateMin = next;
    setAndPersist({ goals });
  },

  setTaskEstimate(taskId: string, minutes: number | null): void {
    const next = minutes === null ? undefined : normalizeEstimate(minutes);
    const tasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const copy = { ...t };
      if (next === undefined) delete copy.estimateMin;
      else copy.estimateMin = next;
      return copy;
    });
    setAndPersist({ tasks });
  },

  removeNode(nodeId: string) {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const node = findInAll(state.goals, nodeId);
    const title = node?.title ?? 'item';
    const goals = state.goals.map((g) => {
      const nodes = structuredClone(g.nodes);
      removeNode(nodes, nodeId);
      return { ...g, nodes };
    });
    withUndo(`Deleted "${title}" · Undo`, 'goals', goals);
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

  // Convenience wrapper (QuickAdd, tests): a bare goal in the highest column.
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
    if (!state.goals.some((g) => g.id === goalId)) return;
    const target = Math.min(Math.max(column, 0), HORIZON_COUNT - 1);
    const cols: string[][] = Array.from({ length: HORIZON_COUNT }, () => []);
    for (const g of state.goals) {
      if (g.completedAt || g.id === goalId) continue;
      const c = Math.min(Math.max(g.column ?? 0, 0), HORIZON_COUNT - 1);
      cols[c].push(g.id);
    }
    cols[target].push(goalId);
    actions.setGoalBoard(cols);
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
    withUndo(`Deleted "${title}" · Undo`, 'goals', goals);
  },

  // Completion lifecycle — explicit and reversible (spec §2.5). Completing removes
  // the project from the active board, so it is undo-aware; reopen is its exact
  // inverse and needs no undo. Both preserve the project's horizon and position.
  completeGoal(goalId: string): void {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal || goal.completedAt) return;
    const goals = state.goals.map((g) => (g.id === goalId ? { ...g, completedAt: todayStr() } : g));
    withUndo(`Completed "${goal.title}" · Undo`, 'goals', goals);
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
    if (!isValidLocalDate(date) || date > todayStr()) return;
    const habits = state.habits.map((h) => {
      if (h.id !== habitId) return h;
      if (h.createdAt && date < h.createdAt) return h;
      const i = h.checkins.indexOf(date);
      const checkins =
        i >= 0
          ? [...h.checkins.slice(0, i), ...h.checkins.slice(i + 1)]
          : [...h.checkins, date];
      return { ...h, checkins };
    });
    setAndPersist({ habits });
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
    withUndo(`Deleted "${title}" · Undo`, 'habits', state.habits.filter((h) => h.id !== habitId));
  },

  // Tasks
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
    const tasks = state.tasks.map((task) => (
      task.id === taskId ? { ...task, date } : task
    ));
    setAndPersist({ tasks });
  },

  removeTask(taskId: string): void {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const originalIndex = state.tasks.indexOf(task);
    const deletedTask = structuredClone(task);
    scheduleUndo(`Deleted "${task.title}" · Undo`, () => {
      if (state.tasks.some((item) => item.id === deletedTask.id)) return;
      const tasks = [...state.tasks];
      tasks.splice(Math.min(originalIndex, tasks.length), 0, deletedTask);
      setAndPersist({ tasks });
    });
    setAndPersist({ tasks: state.tasks.filter((item) => item.id !== taskId) });
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
      `Pushed ${count} item${count === 1 ? '' : 's'} to next week · Undo`,
      () => setAndPersist({ goals: snapGoals, tasks: snapTasks }),
    );
    setAndPersist({ goals, tasks });
  },

  // Structural reorder / indent / outdent
  indentNode(nodeId: string): void {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const goals = treeIndentNode(state.goals, nodeId);
    const nodePath = findNodePath(goals, nodeId);
    const expanded = new Set(state.expanded);
    if (nodePath && nodePath.length > 1) {
      expanded.add(nodePath[nodePath.length - 2]); // new parent container
    }
    setAndPersist({ goals }, { expanded });
  },

  outdentNode(nodeId: string): void {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const oldPath = findNodePath(state.goals, nodeId);
    const goals = treeOutdentNode(state.goals, nodeId);
    const expanded = new Set(state.expanded);
    if (oldPath && oldPath.length > 1) {
      const oldParentId = oldPath[oldPath.length - 2];
      const parentInNew = findInAll(goals, oldParentId);
      if (parentInNew && !parentInNew.children?.length) {
        expanded.delete(oldParentId);
      }
    }
    setAndPersist({ goals }, { expanded });
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
    scaleTimer = setTimeout(() => saveScale(state.pxPerDay), 400);
  },

  // Availability and the all-day preference are device preferences, not app
  // data: they follow setScale/setTheme's pattern (set + persist directly),
  // never routed through setAndPersist.
  setAvailability(windows: AvailabilityWindow[]): void {
    const next = parseAvailability(windows); // reject a malformed set at the door
    set({ availability: next });
    void saveAvailability(next);
  },

  setAllDayBlocks(value: boolean): void {
    if (value === state.allDayBlocks) return;
    set({ allDayBlocks: value });
    void saveAllDayBlocks(value);
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
      `Confirmed dates for ${ids.length} project${ids.length === 1 ? '' : 's'} · Undo`,
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
    withUndo(`Updated dates for "${goal.title}" · Undo`, 'goals', goals);
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
    withUndo(`Scheduled "${node.title}" · Undo`, 'goals', goals);
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
    withUndo(`Unscheduled "${node.title}" · Undo`, 'goals', goals);
  },

  // Planning — plannedWeek/plannedDay are scheduling metadata only.
  // A provided day derives the week (they can never disagree); containers
  // and unknown ids are no-ops.
  planNode(goalId: string, nodeId: string, week: string, day?: string): void {
    if (!isActiveGoal(goalId)) return; // frozen on a completed project
    const goals = cloneGoals(state.goals);
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    const node = findNode(goal.nodes, nodeId);
    if (!node || node.children) return;
    node.plannedWeek = day ? weekOf(day) : weekOf(week);
    if (day) node.plannedDay = day;
    else delete node.plannedDay;
    setAndPersist({ goals });
  },

  unplanNode(goalId: string, nodeId: string): void {
    if (!isActiveGoal(goalId)) return; // frozen on a completed project
    const goal = state.goals.find((g) => g.id === goalId);
    const node = goal ? findNode(goal.nodes, nodeId) : null;
    if (!goal || !node || !node.plannedWeek) return;
    const goals = cloneGoals(state.goals);
    const cloned = findNode(goals.find((g) => g.id === goalId)!.nodes, nodeId)!;
    delete cloned.plannedWeek;
    delete cloned.plannedDay;
    withUndo(`Removed "${node.title}" from plan · Undo`, 'goals', goals);
  },

  markWeekReviewed(): void {
    if (!state.planReview || state.planReview.reviewed) return;
    const review = { ...state.planReview, reviewed: true };
    set({ planReview: review });
    savePlanReview(review).catch(() => {});
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
    withUndo(`Deleted "${title}" · Undo`, 'goals', goals);
  },

  undoLastDelete(): void {
    if (restoreFn) {
      restoreFn();
      restoreFn = null;
    }
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    set({ pendingUndo: null });
  },

  // UI
  setView(v: ViewName) {
    set({ view: v });
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

  shiftDay(n: number) {
    set({ selDate: addDays(state.selDate, n) });
  },

  goToToday() {
    set({ selDate: todayStr() });
  },

  // Open the project drawer, optionally focused on a node (Q10). A node focus
  // expands the node's ancestor containers so the row is on-screen for the
  // drawer to scroll to and highlight; an unknown node falls back to the root.
  openDrawer(goalId: string, nodeId?: string) {
    if (!nodeId) {
      set({ openGoalId: goalId, drawerFocusNodeId: null });
      return;
    }
    const path = findNodePath(state.goals, nodeId);
    if (!path) {
      set({ openGoalId: goalId, drawerFocusNodeId: null });
      return;
    }
    const expanded = new Set(state.expanded);
    for (const id of path.slice(0, -1)) expanded.add(id); // ancestor containers
    set({ openGoalId: goalId, drawerFocusNodeId: nodeId, expanded });
  },

  closeDrawer() {
    set({ openGoalId: null, drawerFocusNodeId: null });
  },

  // The weekly Plan modal is a global overlay (like the drawer): the header
  // button, the `4` shortcut, and the board "Plan next step" deep-link all open
  // the single App-level <PlanWeekOverlay> through here.
  openPlan(focusGoalId?: string | null) {
    set({ planOpen: true, planFocusGoalId: focusGoalId ?? null });
  },

  closePlan() {
    set({ planOpen: false, planFocusGoalId: null });
  },

  showToast(msg: string) {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 1900);
  },

  // IO
  exportBackup() {
    exportState({ goals: state.goals, habits: state.habits, tasks: state.tasks, sessions: state.sessions }, state.pxPerDay, state.planReview);
    actions.showToast('Backup exported');
  },

  async importBackup(file: File) {
    try {
      const appState = await importStateFromFile(file);
      const planReview = await loadPlanReview();
      set({ ...appState, planReview, expanded: collectContainers(appState.goals) });
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
