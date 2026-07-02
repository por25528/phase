import { useSyncExternalStore, useCallback } from 'react';
import type { Goal, Habit, Task, AppState, ZoomLevel } from '../db/types';
import { loadState, persist, exportState, importStateFromFile, loadZoom, saveZoom } from '../db/db';
import { todayStr, addDays } from '../lib/dates';
import { clampSpan } from '../lib/timeline';
import {
  uid, findInAll, removeNode,
  findNodePath,
  indentNode as treeIndentNode,
  outdentNode as treeOutdentNode,
  reorderSiblings,
  reorderTop,
} from '../lib/tree';

export type ViewName = 'today' | 'goals' | 'timeline';

interface UIState {
  view: ViewName;
  selDate: string;
  openGoalId: string | null;
  expanded: Set<string>;
  toast: string | null;
  pendingUndo: { label: string } | null;
  zoom: ZoomLevel;
}

interface FullState extends AppState, UIState {}

let state: FullState = {
  goals: [],
  habits: [],
  tasks: [],
  view: 'today',
  selDate: todayStr(),
  openGoalId: null,
  expanded: new Set(),
  toast: null,
  pendingUndo: null,
  zoom: 'year',
};

let initialized = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let undoTimer: ReturnType<typeof setTimeout> | null = null;
let restoreFn: (() => void) | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function set(patch: Partial<FullState>) {
  state = { ...state, ...patch };
  notify();
}

function setAndPersist(patch: Partial<AppState>) {
  const next = { ...state, ...patch };
  state = next;
  notify();
  persist({ goals: next.goals, habits: next.habits, tasks: next.tasks });
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
  const [appState, zoom] = await Promise.all([loadState(), loadZoom()]);
  state = {
    ...state,
    ...appState,
    zoom,
    expanded: collectContainers(appState.goals),
  };
  notify();
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
    state = { ...state, expanded };
    setAndPersist({ goals });
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
    const snapshot = JSON.parse(JSON.stringify(state.goals)) as Goal[];
    scheduleUndo(`Deleted "${title}" · Undo`, () => setAndPersist({ goals: snapshot }));
    const goals = state.goals.map((g) => {
      const nodes = JSON.parse(JSON.stringify(g.nodes));
      removeNode(nodes, nodeId);
      return { ...g, nodes };
    });
    setAndPersist({ goals });
  },

  addGoal(title: string, deadline: string) {
    const goal: Goal = { id: uid(), title, start: todayStr(), deadline, nodes: [] };
    setAndPersist({ goals: [...state.goals, goal] });
  },

  renameGoal(goalId: string, title: string) {
    const goals = state.goals.map((g) => (g.id === goalId ? { ...g, title } : g));
    setAndPersist({ goals });
  },

  removeGoal(goalId: string) {
    const goal = state.goals.find((g) => g.id === goalId);
    const title = goal?.title ?? 'goal';
    const snapshot = JSON.parse(JSON.stringify(state.goals)) as Goal[];
    scheduleUndo(`Deleted "${title}" · Undo`, () => setAndPersist({ goals: snapshot }));
    const goals = state.goals.filter((g) => g.id !== goalId);
    setAndPersist({ goals });
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
    const habit: Habit = { id: uid(), title, cadence, weeklyTarget, goalId: null, checkins: [] };
    setAndPersist({ habits: [...state.habits, habit] });
  },

  removeHabit(habitId: string) {
    const habit = state.habits.find((h) => h.id === habitId);
    const title = habit?.title ?? 'habit';
    const snapshot = JSON.parse(JSON.stringify(state.habits)) as Habit[];
    scheduleUndo(`Deleted "${title}" · Undo`, () => setAndPersist({ habits: snapshot }));
    setAndPersist({ habits: state.habits.filter((h) => h.id !== habitId) });
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
    const snapshot = JSON.parse(JSON.stringify(state.tasks)) as Task[];
    scheduleUndo(`Deleted "${title}" · Undo`, () => setAndPersist({ tasks: snapshot }));
    setAndPersist({ tasks: state.tasks.filter((t) => t.id !== taskId) });
  },

  moveTaskToDate(taskId: string, date: string) {
    const tasks = state.tasks.map((t) => (t.id === taskId ? { ...t, date } : t));
    setAndPersist({ tasks });
  },

  // Structural reorder / indent / outdent
  indentNode(nodeId: string): void {
    const goals = treeIndentNode(state.goals, nodeId);
    const nodePath = findNodePath(goals, nodeId);
    const expanded = new Set(state.expanded);
    if (nodePath && nodePath.length > 1) {
      expanded.add(nodePath[nodePath.length - 2]); // new parent container
    }
    state = { ...state, expanded };
    setAndPersist({ goals });
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
    state = { ...state, expanded };
    setAndPersist({ goals });
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

  // Zoom
  setZoom(z: ZoomLevel): void {
    set({ zoom: z });
    saveZoom(z);
  },

  // Goal date editing
  setGoalDates(goalId: string, start: string, deadline: string): void {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal) return;
    const clamped = clampSpan(start, deadline);
    const snapshot = JSON.parse(JSON.stringify(state.goals)) as Goal[];
    scheduleUndo(`Updated dates for "${goal.title}" · Undo`, () =>
      setAndPersist({ goals: snapshot }),
    );
    const goals = state.goals.map((g) =>
      g.id === goalId ? { ...g, start: clamped.start, deadline: clamped.deadline } : g,
    );
    setAndPersist({ goals });
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
    const snapshot = JSON.parse(JSON.stringify(state.goals)) as Goal[];
    scheduleUndo(`Deleted "${title}" · Undo`, () => setAndPersist({ goals: snapshot }));
    const goals = state.goals.map((g) =>
      g.id === goalId
        ? { ...g, milestones: (g.milestones ?? []).filter((m) => m.id !== milestoneId) }
        : g,
    );
    setAndPersist({ goals });
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
    exportState({ goals: state.goals, habits: state.habits, tasks: state.tasks }, state.zoom);
    actions.showToast('Backup exported');
  },

  async importBackup(file: File) {
    try {
      const appState = await importStateFromFile(file);
      set({ ...appState, expanded: collectContainers(appState.goals) });
      actions.showToast('Backup imported');
    } catch {
      actions.showToast('Could not read that file');
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
