import { useSyncExternalStore, useCallback } from 'react';
import type { Goal, Habit, Task, AppState } from '../db/types';
import { loadState, persist, exportState, importStateFromFile } from '../db/db';
import { todayStr, addDays } from '../lib/dates';
import { uid, findInAll, removeNode } from '../lib/tree';

export type ViewName = 'today' | 'goals' | 'timeline';

interface UIState {
  view: ViewName;
  selDate: string;
  openGoalId: string | null;
  expanded: Set<string>;
  toast: string | null;
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
};

let initialized = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
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
  const appState = await loadState();
  state = {
    ...state,
    ...appState,
    expanded: collectContainers(appState.goals),
  };
  notify();
}

// ---- selectors ----
export function getState(): FullState {
  return state;
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
    setAndPersist({ tasks: state.tasks.filter((t) => t.id !== taskId) });
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
    exportState({ goals: state.goals, habits: state.habits, tasks: state.tasks });
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
