import Dexie, { type Table } from 'dexie';
import type { Goal, Habit, Task, Session, AppState, PlanReview } from './types';
import { todayStr } from '../lib/dates';
import { clampScale } from '../lib/timeline';

class PhaseDB extends Dexie {
  goals!: Table<Goal, string>;
  habits!: Table<Habit, string>;
  tasks!: Table<Task, string>;
  sessions!: Table<Session, string>;
  settings!: Table<{ key: string; value: string }, string>;
  planReview!: Table<PlanReview, string>;

  constructor() {
    super('phase');
    this.version(1).stores({
      goals: 'id',
      habits: 'id',
      tasks: 'id',
    });
    this.version(2).stores({
      goals: 'id',
      habits: 'id',
      tasks: 'id',
      settings: 'key',
    });
    this.version(3).stores({
      goals: 'id',
      habits: 'id',
      tasks: 'id',
      settings: 'key',
      sessions: 'id',
    });
    this.version(4).stores({
      goals: 'id',
      habits: 'id',
      tasks: 'id',
      settings: 'key',
      sessions: 'id',
      planReview: 'week',
    });
  }
}

export const db = new PhaseDB();

export async function loadState(): Promise<AppState> {
  const [goals, habits, tasks, sessions] = await Promise.all([
    db.goals.toArray(),
    db.habits.toArray(),
    db.tasks.toArray(),
    db.sessions.toArray(),
  ]);
  return { goals, habits, tasks, sessions };
}

export async function persist(state: AppState): Promise<void> {
  // One rw transaction: either every table reflects `state`, or none does.
  // (The previous Promise.all of independent clear→bulkPut chains could leave
  // the DB partially wiped if one chain failed mid-flight.)
  await db.transaction('rw', db.goals, db.habits, db.tasks, db.sessions, async () => {
    await Promise.all([
      db.goals.clear().then(() => db.goals.bulkPut(state.goals)),
      db.habits.clear().then(() => db.habits.bulkPut(state.habits)),
      db.tasks.clear().then(() => db.tasks.bulkPut(state.tasks)),
      db.sessions.clear().then(() => db.sessions.bulkPut(state.sessions)),
    ]);
  });
}

// Map a legacy zoom-level string (including the long-retired 'year') to its
// px-per-day scale. Fallback is the quarter preset.
function legacyZoomToScale(v: string | undefined): number {
  if (v === 'week') return 130;
  if (v === 'month') return 40;
  return 13; // 'quarter', 'year', or anything else
}

export async function loadScale(): Promise<number> {
  const row = await db.settings.get('pxPerDay');
  const n = Number(row?.value);
  if (Number.isFinite(n) && n > 0) return clampScale(n);
  // Migrate from the discrete-zoom era ('week' | 'month' | 'quarter' | 'year')
  const legacy = await db.settings.get('zoom');
  return legacyZoomToScale(legacy?.value);
}

export async function saveScale(pxPerDay: number): Promise<void> {
  await db.settings.put({ key: 'pxPerDay', value: String(pxPerDay) });
}

// Single-row table: the one previous-week snapshot. clear+put inside a
// transaction so a crash can't leave two rows.
export async function loadPlanReview(): Promise<PlanReview | null> {
  const rows = await db.planReview.toArray();
  return rows[0] ?? null;
}

export async function savePlanReview(review: PlanReview): Promise<void> {
  await db.transaction('rw', db.planReview, async () => {
    await db.planReview.clear();
    await db.planReview.put(review);
  });
}

export function exportState(state: AppState, pxPerDay: number, planReview: PlanReview | null): void {
  const backup = { ...state, pxPerDay, ...(planReview ? { planReview } : {}) };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `phase-goals-${todayStr()}.json`;
  a.click();
}

function isEntityArray(v: unknown): boolean {
  return Array.isArray(v) && v.every(
    (x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string',
  );
}

export async function importStateFromFile(file: File): Promise<AppState & { pxPerDay: number }> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error('Could not read that file.');
  }

  let raw: Partial<AppState & { pxPerDay?: number; zoom?: string }>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }

  const tables = ['goals', 'habits', 'tasks', 'sessions'] as const;
  const present = raw && typeof raw === 'object' ? tables.filter((t) => raw[t] !== undefined) : [];
  if (present.length === 0 || present.some((t) => !isEntityArray(raw[t]))) {
    throw new Error("That file doesn't look like a Phase backup.");
  }

  const pxPerDay =
    Number.isFinite(raw.pxPerDay) && (raw.pxPerDay as number) > 0
      ? clampScale(raw.pxPerDay as number)
      : legacyZoomToScale(raw.zoom); // old backups carry a zoom string
  const parsed: AppState = {
    goals: raw.goals ?? [],
    habits: raw.habits ?? [],
    tasks: raw.tasks ?? [],
    sessions: raw.sessions ?? [],
  };
  await persist(parsed);
  await saveScale(pxPerDay);
  // Optional: restore the week-review snapshot if the backup carries a sane one.
  const pr = (raw as { planReview?: PlanReview }).planReview;
  if (pr && typeof pr.week === 'string' && Array.isArray(pr.entries) && typeof pr.reviewed === 'boolean') {
    await savePlanReview(pr);
  } else {
    await db.planReview.clear();
  }
  return { ...parsed, pxPerDay };
}
