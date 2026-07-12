import { useSyncExternalStore, useCallback } from 'react';
import type { Goal, Habit, Task, Session, AppState } from '../db/types';
import { loadState, persist, exportState, importStateFromFile, loadScale, saveScale } from '../db/db';
import { clampScale } from '../lib/timeline';
import { todayStr, addDays } from '../lib/dates';
import { clampSpan } from '../lib/timeline';
import { acquireTabLock } from '../lib/tabLock';
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
  expanded: Set<string>;
  toast: string | null;
  pendingUndo: { label: string } | null;
  pxPerDay: number; // timeline scale — continuous, gesture-driven
  hydration: 'loading' | 'ready' | 'error';
  secondTab: boolean;
  theme: Theme; // per-device UI preference (localStorage, not Dexie)
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
  expanded: new Set(),
  toast: null,
  pendingUndo: null,
  pxPerDay: 13, // quarter preset until the persisted scale loads
  hydration: 'loading',
  secondTab: false,
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
    const [appState, pxPerDay] = await Promise.all([loadState(), loadScale()]);
    state = {
      ...state,
      ...appState,
      pxPerDay,
      hydration: 'ready',
      expanded: collectContainers(appState.goals),
    };
    notify();
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

// ---- actions ----
export const actions = {
  // Goals / nodes
  toggleLeaf(nodeId: string) {
    const goals = state.goals.map((g) => ({ ...g, nodes: [...g.nodes] }));
    const node = findInAll(goals, nodeId);
    if (node) node.done = !node.done;
    setAndPersist({ goals });
  },

  toggleExpand(nodeId: string) {
    const expanded = new Set(state.expanded);
    expanded.has(nodeId) ? expanded.delete(nodeId) : expanded.add(nodeId);
    set({ expanded });
  },

  addChild(nodeId: string, title = 'New item') {
    const goals = state.goals.map((g) => ({ ...g, nodes: [...g.nodes] }));
    const node = findInAll(goals, nodeId);
    if (!node) return;
    if (!node.children) node.children = [];
    node.children.push({ id: uid(), title });
    delete node.done;
    const expanded = new Set(state.expanded);
    expanded.add(nodeId);
    setAndPersist({ goals }, { expanded });
  },

  addRootNode(goalId: string, title: string) {
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

  removeNode(nodeId: string) {
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

  // Convenience wrapper (QuickAdd, tests): a bare goal in the highest column.
  addGoal(title: string, deadline: string) {
    actions.addGoals([{ id: uid(), title, start: todayStr(), deadline, nodes: [], column: 0 }]);
  },

  // Priority board: commit an entire column layout. `columns[c]` is the ordered
  // list of goal ids in column c (0 = leftmost/highest). Rebuilds the goals
  // array in column-major order and stamps each goal's `column`.
  setGoalBoard(columns: string[][]) {
    const byId = new Map(state.goals.map((g) => [g.id, g]));
    const seen = new Set<string>();
    const goals: Goal[] = [];
    columns.forEach((ids, col) => {
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
    const title = goal?.title ?? 'goal';
    const goals = state.goals.filter((g) => g.id !== goalId);
    withUndo(`Deleted "${title}" · Undo`, 'goals', goals);
  },

  // Habits
  toggleHabit(habitId: string) {
    const today = todayStr();
    const habits = state.habits.map((h) => {
      if (h.id !== habitId) return h;
      const i = h.checkins.indexOf(today);
      const checkins =
        i >= 0
          ? [...h.checkins.slice(0, i), ...h.checkins.slice(i + 1)]
          : [...h.checkins, today];
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
  toggleTask(taskId: string) {
    const tasks = state.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t));
    setAndPersist({ tasks });
  },

  addTask(title: string, date: string, goalId: string | null) {
    const task: Task = { id: uid(), title, date, done: false, goalId };
    setAndPersist({ tasks: [...state.tasks, task] });
  },

  removeTask(taskId: string) {
    const task = state.tasks.find((t) => t.id === taskId);
    const title = task?.title ?? 'task';
    withUndo(`Deleted "${title}" · Undo`, 'tasks', state.tasks.filter((t) => t.id !== taskId));
  },

  moveTaskToDate(taskId: string, date: string) {
    const tasks = state.tasks.map((t) => (t.id === taskId ? { ...t, date } : t));
    setAndPersist({ tasks });
  },

  // Sessions — study/work log, context only
  addSession(goalId: string | null, date: string, minutes: number, note = '') {
    if (minutes <= 0) return;
    const session: Session = { id: uid(), goalId, date, minutes, note };
    setAndPersist({ sessions: [...state.sessions, session] });
  },

  removeSession(sessionId: string) {
    const s = state.sessions.find((x) => x.id === sessionId);
    const label = s ? `Deleted ${s.minutes}m log · Undo` : 'Deleted log · Undo';
    withUndo(label, 'sessions', state.sessions.filter((x) => x.id !== sessionId));
  },

  // Structural reorder / indent / outdent
  indentNode(nodeId: string): void {
    const goals = treeIndentNode(state.goals, nodeId);
    const nodePath = findNodePath(goals, nodeId);
    const expanded = new Set(state.expanded);
    if (nodePath && nodePath.length > 1) {
      expanded.add(nodePath[nodePath.length - 2]); // new parent container
    }
    setAndPersist({ goals }, { expanded });
  },

  outdentNode(nodeId: string): void {
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

  reorderTasks(activeId: string, overId: string): void {
    const tasks = reorderTop(state.tasks, activeId, overId);
    setAndPersist({ tasks });
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

  // Goal date editing
  setGoalDates(goalId: string, start: string, deadline: string): void {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal) return;
    const clamped = clampSpan(start, deadline);
    const goals = state.goals.map((g) =>
      g.id === goalId ? { ...g, start: clamped.start, deadline: clamped.deadline } : g,
    );
    withUndo(`Updated dates for "${goal.title}" · Undo`, 'goals', goals);
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

  openDrawer(goalId: string) {
    set({ openGoalId: goalId });
  },

  closeDrawer() {
    set({ openGoalId: null });
  },

  showToast(msg: string) {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 1900);
  },

  // IO
  exportBackup() {
    exportState({ goals: state.goals, habits: state.habits, tasks: state.tasks, sessions: state.sessions }, state.pxPerDay);
    actions.showToast('Backup exported');
  },

  async importBackup(file: File) {
    try {
      const appState = await importStateFromFile(file);
      set({ ...appState, expanded: collectContainers(appState.goals) });
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
