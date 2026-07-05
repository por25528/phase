import Dexie, { type Table } from 'dexie';
import type { Goal, Habit, Task, Session, AppState } from './types';
import { todayStr, addDays } from '../lib/dates';
import { clampScale } from '../lib/timeline';
import { uid } from '../lib/tree';

const YEAR = 2026;

class PhaseDB extends Dexie {
  goals!: Table<Goal, string>;
  habits!: Table<Habit, string>;
  tasks!: Table<Task, string>;
  sessions!: Table<Session, string>;
  settings!: Table<{ key: string; value: string }, string>;

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
  }
}

export const db = new PhaseDB();

function buildSeed(): AppState {
  const csChapters = [
    '1 · A Tour of Computer Systems',
    '2 · Representing & Manipulating Information',
    '3 · Machine-Level Representation',
    '4 · Processor Architecture',
    '5 · Optimizing Performance',
    '6 · The Memory Hierarchy',
    '7 · Linking',
    '8 · Exceptional Control Flow',
    '9 · Virtual Memory',
    '10 · System-Level I/O',
    '11 · Network Programming',
    '12 · Concurrent Programming',
  ].map((t) => ({ id: uid(), title: t, done: false }));

  const today = todayStr();

  return {
    goals: [
      {
        id: 'g_income',
        column: 0,
        title: 'First income',
        start: `${YEAR}-08-01`,
        deadline: `${YEAR}-12-31`,
        nodes: [
          { id: uid(), title: 'Pick one idea', done: false },
          { id: uid(), title: 'Talk to 2 possible buyers', done: false },
          { id: uid(), title: 'Build the first version', done: false },
          { id: uid(), title: 'Ship it publicly', done: false },
          { id: uid(), title: 'Earn first $100', done: false },
        ],
      },
      {
        id: 'g_cs',
        column: 0,
        title: 'CS:APP',
        start: `${YEAR}-06-30`,
        deadline: `${YEAR}-12-31`,
        nodes: csChapters,
      },
      {
        id: 'g_jp',
        column: 1,
        title: 'Japanese · N3',
        start: `${YEAR}-06-30`,
        deadline: `${YEAR}-12-31`,
        nodes: [
          { id: uid(), title: 'Vocabulary → ~3000 words', done: false },
          { id: uid(), title: 'Core N3 grammar', done: false },
          { id: uid(), title: 'Kanji (~350)', done: false },
          { id: uid(), title: 'Reading practice', done: false },
          { id: uid(), title: 'Listening practice', done: false },
          { id: uid(), title: 'Pass a mock test', done: false },
        ],
      },
      {
        id: 'g_fit',
        column: 1,
        title: 'Fitness',
        start: `${YEAR}-06-30`,
        deadline: `${YEAR}-12-31`,
        nodes: [
          { id: uid(), title: 'Add a pulling movement', done: false },
          { id: uid(), title: 'Add legs', done: false },
          { id: uid(), title: 'Hold 4×/week for a month', done: false },
        ],
      },
      {
        id: 'g_yt',
        column: 2,
        title: 'YouTube',
        start: `${YEAR}-07-01`,
        deadline: `${YEAR}-12-31`,
        nodes: [
          { id: uid(), title: 'Set a weekly publish cadence', done: false },
          { id: uid(), title: 'Publish first 5 videos', done: false },
          { id: uid(), title: 'Publish 5 more', done: false },
        ],
      },
    ],
    habits: [
      { id: uid(), title: 'Move the income project one step', cadence: 'daily', weeklyTarget: 4, goalId: 'g_income', checkins: [] },
      { id: uid(), title: 'Study CS:APP (90 min)', cadence: 'daily', weeklyTarget: 4, goalId: 'g_cs', checkins: [] },
      { id: uid(), title: 'Japanese cards', cadence: 'daily', weeklyTarget: 4, goalId: 'g_jp', checkins: [] },
      { id: uid(), title: 'Edit video (20 min)', cadence: 'daily', weeklyTarget: 4, goalId: 'g_yt', checkins: [] },
      { id: uid(), title: 'Full-body workout', cadence: 'weekly', weeklyTarget: 4, goalId: 'g_fit', checkins: [] },
    ],
    tasks: [
      { id: uid(), title: 'Read CS:APP chapter 1', date: today, done: false, goalId: 'g_cs' },
      { id: uid(), title: 'Anki review + 1 grammar point', date: addDays(today, 1), done: false, goalId: 'g_jp' },
    ],
    sessions: [],
  };
}

export async function loadState(): Promise<AppState> {
  const [goals, habits, tasks, sessions] = await Promise.all([
    db.goals.toArray(),
    db.habits.toArray(),
    db.tasks.toArray(),
    db.sessions.toArray(),
  ]);

  if (goals.length === 0 && habits.length === 0 && tasks.length === 0 && sessions.length === 0) {
    const seed = buildSeed();
    await Promise.all([
      db.goals.bulkPut(seed.goals),
      db.habits.bulkPut(seed.habits),
      db.tasks.bulkPut(seed.tasks),
      db.sessions.bulkPut(seed.sessions),
    ]);
    return seed;
  }

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

export function exportState(state: AppState, pxPerDay: number): void {
  const backup = { ...state, pxPerDay };
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
  return { ...parsed, pxPerDay };
}
