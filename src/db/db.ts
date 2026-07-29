import Dexie, { type Table } from 'dexie';
import type { Goal, Habit, Task, Session, AppState, PlanReview, AvailabilityWindow } from './types';
import { todayStr } from '../lib/dates';
import { clampScale } from '../lib/timeline';
import { sanitizeBackupGoal } from '../lib/goalImport';
import { parseAvailability, serializeAvailability } from '../lib/availability';

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

export async function loadAvailability(): Promise<AvailabilityWindow[]> {
  const row = await db.settings.get('availability');
  return parseAvailability(row?.value);
}

export async function saveAvailability(windows: AvailabilityWindow[]): Promise<void> {
  await db.settings.put({ key: 'availability', value: serializeAvailability(windows) });
}

// Defaults ON: an all-day event usually does consume the day.
export async function loadAllDayBlocks(): Promise<boolean> {
  const row = await db.settings.get('allDayBlocks');
  return row?.value !== 'false';
}

export async function saveAllDayBlocks(value: boolean): Promise<void> {
  await db.settings.put({ key: 'allDayBlocks', value: String(value) });
}

// One-shot flag for the calendar-slot migration (see lib/migrateSlots.ts).
// Not a Dexie version: the migration adds optional fields to existing objects,
// which changes no store and no index.
const SLOT_MIGRATION_KEY = 'slotMigrationDone';
const SLOT_SNAPSHOT_KEY = 'preSlotMigrationSnapshot';

export async function isSlotMigrationDone(): Promise<boolean> {
  const row = await db.settings.get(SLOT_MIGRATION_KEY);
  return row?.value === 'true';
}

/**
 * Pre-migration copy of the two tables the migration rewrites. Kept in the
 * settings table rather than downloaded, so the safety net costs the user no
 * interaction on first launch.
 *
 * Write-once: this row is the SOLE record of the user's pre-migration
 * scheduling. The caller re-enters this block whenever the done-flag reads
 * false, including after a crash or a failed settings write that lands
 * between a successful migration and `markSlotMigrationDone`. On such a
 * re-entry the goals/tasks handed in here would already be migrated, so an
 * unconditional `put` would overwrite the only original copy with a copy of
 * already-rewritten data. Reading first and returning early if a snapshot
 * already exists makes that impossible — PROVIDED the check and the write
 * are atomic. The tab-lock gate makes two contexts both believing they own
 * the lock unlikely but not unreachable (acquireTabLock degrades to "owned"
 * when navigator.locks is absent or errors), so the get-then-put runs inside
 * a single rw transaction rather than as two independent calls a second
 * writer could interleave with.
 */
export async function saveSlotMigrationSnapshot(goals: Goal[], tasks: Task[]): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const existing = await db.settings.get(SLOT_SNAPSHOT_KEY);
    if (existing) return;
    await db.settings.put({ key: SLOT_SNAPSHOT_KEY, value: JSON.stringify({ goals, tasks }) });
  });
}

export async function markSlotMigrationDone(): Promise<void> {
  await db.settings.put({ key: SLOT_MIGRATION_KEY, value: 'true' });
}

/**
 * Re-arm the slot migration so an imported backup is migrated exactly like the
 * original data was at first hydration.
 *
 * Every backup in existence predates the calendar-grid branch, so an imported
 * goals/tasks pair is pre-migration shape (Any-day steps, tasks with no
 * startMin, etc.) even though the done-flag from THIS device's own history
 * already reads true. Without clearing it, `initStore` would never call
 * `migrateSlots` over the imported data and the pre-migration shapes would
 * resurface everywhere `plannedStartMin`/`startMin` is assumed once a day is
 * set.
 *
 * The snapshot row is cleared too, not just the done-flag. `saveSlotMigrationSnapshot`
 * is write-once BY DESIGN (see its own doc comment) so a crash mid-migration can't
 * clobber the one pre-migration copy with a partially-migrated one — but that
 * guard is scoped to protecting a single generation of data. The imported
 * goals/tasks are a NEW generation the moment they land: they are what the
 * next hydration will migrate, so they are what the snapshot must protect if
 * that migration needs to be undone. Leaving the old snapshot row in place
 * would silently block the new one from ever being written (the existing-row
 * check would see a row and return early), leaving the newly-imported
 * pre-migration data with no safety net at all. Clearing both rows together
 * is what makes import behave like a fresh first launch for migration
 * purposes.
 */
export async function resetSlotMigration(): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    await db.settings.delete(SLOT_MIGRATION_KEY);
    await db.settings.delete(SLOT_SNAPSHOT_KEY);
  });
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

export function exportState(
  state: AppState,
  pxPerDay: number,
  planReview: PlanReview | null,
  availability: AvailabilityWindow[],
  allDayBlocks: boolean,
): void {
  const backup = {
    ...state,
    pxPerDay,
    availability,
    allDayBlocks,
    ...(planReview ? { planReview } : {}),
  };
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

export async function importStateFromFile(
  file: File,
): Promise<AppState & { pxPerDay: number; availability: AvailabilityWindow[]; allDayBlocks: boolean }> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error('Could not read that file.');
  }

  let raw: Partial<
    AppState & {
      pxPerDay?: number;
      zoom?: string;
      availability?: unknown;
      allDayBlocks?: unknown;
    }
  >;
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
  // Old backups predate availability/allDayBlocks entirely — an ABSENT key
  // means the backup says NOTHING about this device preference, which is not
  // the same as the backup saying "use the default". Leave the current
  // persisted value alone in that case. A PRESENT-but-malformed value still
  // goes through `parseAvailability`, which is total validation: malformed or
  // hand-edited windows collapse to DEFAULT_AVAILABILITY.
  const availability =
    raw.availability === undefined ? await loadAvailability() : parseAvailability(raw.availability);
  // Mirrors loadAllDayBlocks (`row?.value !== 'false'`): a PRESENT value of
  // anything but the literal false (string 'false' from an old settings-table
  // dump, or an actual JSON `false` written by the current exportState) means
  // on. An ABSENT key means the backup is silent, so keep the current setting.
  const allDayBlocks =
    raw.allDayBlocks === undefined
      ? await loadAllDayBlocks()
      : raw.allDayBlocks !== 'false' && raw.allDayBlocks !== false;
  const parsed: AppState = {
    goals: (raw.goals ?? []).map(sanitizeBackupGoal),
    habits: raw.habits ?? [],
    tasks: raw.tasks ?? [],
    sessions: raw.sessions ?? [],
  };
  await persist(parsed);
  await saveScale(pxPerDay);
  await saveAvailability(availability);
  await saveAllDayBlocks(allDayBlocks);
  // Every backup predates the calendar-grid migration, and this device's own
  // done-flag (already true from its own first launch) would otherwise skip
  // it for the just-imported data. Re-arm it so the NEXT hydration — the next
  // time `initStore` runs, i.e. the next app launch — migrates the imported
  // goals/tasks exactly as it did the original data. The CURRENT session
  // keeps running on the un-migrated shapes it just loaded; this only
  // guarantees the migration is not skipped forever.
  await resetSlotMigration();
  // Optional: restore the week-review snapshot if the backup carries a sane one.
  const pr = (raw as { planReview?: PlanReview }).planReview;
  if (pr && typeof pr.week === 'string' && Array.isArray(pr.entries) && typeof pr.reviewed === 'boolean') {
    await savePlanReview(pr);
  } else {
    await db.planReview.clear();
  }
  return { ...parsed, pxPerDay, availability, allDayBlocks };
}
