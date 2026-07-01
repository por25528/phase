import Dexie, { type Table } from 'dexie';
import type { Goal, Habit, Task, AppState, ZoomLevel } from './types';
import { todayStr, addDays } from '../lib/dates';
import { uid } from '../lib/tree';

const YEAR = 2026;

class PhaseDB extends Dexie {
  goals!: Table<Goal, string>;
  habits!: Table<Habit, string>;
  tasks!: Table<Task, string>;
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
        title: 'CS:APP',
        start: `${YEAR}-06-30`,
        deadline: `${YEAR}-12-31`,
        nodes: csChapters,
      },
      {
        id: 'g_jp',
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
  };
}

export async function loadState(): Promise<AppState> {
  const [goals, habits, tasks] = await Promise.all([
    db.goals.toArray(),
    db.habits.toArray(),
    db.tasks.toArray(),
  ]);

  if (goals.length === 0 && habits.length === 0 && tasks.length === 0) {
    const seed = buildSeed();
    await Promise.all([
      db.goals.bulkPut(seed.goals),
      db.habits.bulkPut(seed.habits),
      db.tasks.bulkPut(seed.tasks),
    ]);
    return seed;
  }

  return { goals, habits, tasks };
}

export async function persist(state: AppState): Promise<void> {
  await Promise.all([
    db.goals.clear().then(() => db.goals.bulkPut(state.goals)),
    db.habits.clear().then(() => db.habits.bulkPut(state.habits)),
    db.tasks.clear().then(() => db.tasks.bulkPut(state.tasks)),
  ]);
}

export async function loadZoom(): Promise<ZoomLevel> {
  const row = await db.settings.get('zoom');
  const v = row?.value;
  return v === 'quarter' || v === 'month' ? v : 'year';
}

export async function saveZoom(z: ZoomLevel): Promise<void> {
  await db.settings.put({ key: 'zoom', value: z });
}

export function exportState(state: AppState, zoom: ZoomLevel): void {
  const backup = { ...state, zoom };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `phase-goals-${todayStr()}.json`;
  a.click();
}

export async function importStateFromFile(file: File): Promise<AppState & { zoom: ZoomLevel }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = async () => {
      try {
        const raw = JSON.parse(r.result as string) as Partial<AppState & { zoom?: string }>;
        const zoom: ZoomLevel =
          raw.zoom === 'quarter' || raw.zoom === 'month' ? raw.zoom : 'year';
        const parsed: AppState = {
          goals: raw.goals ?? [],
          habits: raw.habits ?? [],
          tasks: raw.tasks ?? [],
        };
        await persist(parsed);
        await saveZoom(zoom);
        resolve({ ...parsed, zoom });
      } catch {
        reject(new Error('Could not read that file'));
      }
    };
    r.onerror = () => reject(new Error('Could not read that file'));
    r.readAsText(file);
  });
}
