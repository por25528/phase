import Dexie, { type Table } from 'dexie';
import type { Goal, Habit, Task, Session, AppState, PlanReview, AvailabilityWindow } from './types';
import { todayStr } from '../lib/dates';
import { clampScale } from '../lib/timeline';
import { sanitizeBackupGoal, sanitizeBackupHabit } from '../lib/goalImport';
import { parseAvailability, serializeAvailability } from '../lib/availability';
import { migrateCheckpoints } from '../lib/migrateCheckpoints';

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

/** Which sidebar panels are expanded. The backlog is pinned and never listed. */
export type SidebarPanel = 'habits' | 'stats' | 'availability';

// Stored order — `saveSidebarPanels` writes panels in this order, so append
// new members rather than inserting them.
const SIDEBAR_PANELS: readonly SidebarPanel[] = ['habits', 'stats', 'availability'];
const SIDEBAR_PANELS_KEY = 'sidebarPanels';

/**
 * Total parse: a malformed or partly-unknown value yields the default rather
 * than a half-trusted list, mirroring `parseAvailability`. Collapsing every
 * panel is a harmless fallback — the backlog, the only section that matters
 * for placing work, is pinned open regardless.
 */
function parseSidebarPanels(raw: string | undefined): SidebarPanel[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const kept = SIDEBAR_PANELS.filter((panel) => value.includes(panel));
  return [...kept];
}

export async function loadSidebarPanels(): Promise<SidebarPanel[]> {
  const row = await db.settings.get(SIDEBAR_PANELS_KEY);
  return parseSidebarPanels(row?.value);
}

export async function saveSidebarPanels(panels: SidebarPanel[]): Promise<void> {
  const clean = SIDEBAR_PANELS.filter((panel) => panels.includes(panel));
  await db.settings.put({ key: SIDEBAR_PANELS_KEY, value: JSON.stringify(clean) });
}

// One-shot flag for the calendar-slot migration (see lib/migrateSlots.ts).
// Not a Dexie version: the migration adds optional fields to existing objects,
// which changes no store and no index.
const SLOT_MIGRATION_KEY = 'slotMigrationDone';
const SLOT_SNAPSHOT_KEY = 'preSlotMigrationSnapshot';
const CHECKPOINT_MIGRATION_KEY = 'checkpointMigrationDone';
const CHECKPOINT_SNAPSHOT_KEY = 'preCheckpointMigrationSnapshot';

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

/**
 * The pre-migration copy of goals and tasks, or null if none was taken or the
 * row is unreadable. A corrupt row must not throw: this is a recovery path,
 * and failing loudly here would block the very export that rescues the data.
 */
export async function loadSlotMigrationSnapshot(): Promise<{ goals: Goal[]; tasks: Task[] } | null> {
  const row = await db.settings.get(SLOT_SNAPSHOT_KEY);
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as { goals?: Goal[]; tasks?: Task[] };
    if (!Array.isArray(parsed.goals) || !Array.isArray(parsed.tasks)) return null;
    return { goals: parsed.goals, tasks: parsed.tasks };
  } catch {
    return null;
  }
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

// One-shot flag for the milestone-to-checkpoint migration (see
// lib/migrateCheckpoints.ts). Like the slot migration, this changes object
// fields only and therefore does not need a Dexie schema version.
export async function isCheckpointMigrationDone(): Promise<boolean> {
  const row = await db.settings.get(CHECKPOINT_MIGRATION_KEY);
  return row?.value === 'true';
}

/**
 * Write-once copy of goals before milestone conversion. This is the sole
 * recovery record for the pre-checkpoint generation. The existing-row check
 * is inside the same transaction as the write so a retry after a crash cannot
 * replace the original goals with already-converted ones.
 */
export async function saveCheckpointMigrationSnapshot(goals: Goal[]): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const existing = await db.settings.get(CHECKPOINT_SNAPSHOT_KEY);
    if (existing) return;
    await db.settings.put({ key: CHECKPOINT_SNAPSHOT_KEY, value: JSON.stringify({ goals }) });
  });
}

/** The pre-checkpoint copy, or null when absent or unreadable. */
export async function loadCheckpointMigrationSnapshot(): Promise<{ goals: Goal[] } | null> {
  const row = await db.settings.get(CHECKPOINT_SNAPSHOT_KEY);
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as { goals?: Goal[] };
    if (!Array.isArray(parsed.goals)) return null;
    return { goals: parsed.goals };
  } catch {
    return null;
  }
}

export async function markCheckpointMigrationDone(): Promise<void> {
  await db.settings.put({ key: CHECKPOINT_MIGRATION_KEY, value: 'true' });
}

/** Clear both rows so an imported backup is a new migration generation. */
export async function resetCheckpointMigration(): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    await db.settings.delete(CHECKPOINT_MIGRATION_KEY);
    await db.settings.delete(CHECKPOINT_SNAPSHOT_KEY);
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
  // Persisted like availability and allDayBlocks, and it was the one device
  // preference the backup left out — so "the backup contains everything
  // persisted" was not true, and the next preference added would have copied
  // the omission.
  sidebarPanels: SidebarPanel[],
  preSlotMigrationSnapshot?: { goals: Goal[]; tasks: Task[] } | null,
  preCheckpointMigrationSnapshot?: { goals: Goal[] } | null,
): void {
  const backup = {
    ...state,
    pxPerDay,
    availability,
    allDayBlocks,
    sidebarPanels,
    ...(planReview ? { planReview } : {}),
    ...(preSlotMigrationSnapshot ? { preSlotMigrationSnapshot } : {}),
    ...(preCheckpointMigrationSnapshot ? { preCheckpointMigrationSnapshot } : {}),
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
): Promise<AppState & {
  pxPerDay: number;
  availability: AvailabilityWindow[];
  allDayBlocks: boolean;
  sidebarPanels: SidebarPanel[];
}> {
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
      sidebarPanels?: unknown;
      // Present on backups exported by this feature, but deliberately NOT part
      // of the type below and never read: it records a PREVIOUS DEVICE's
      // pre-migration state. Importing it must never overwrite this device's
      // own snapshot (see saveSlotMigrationSnapshot's write-once contract) —
      // this device's snapshot, if any, is the only one that protects THIS
      // device's data, and resetSlotMigration (below) clears it deliberately
      // so a fresh one can be taken for the just-imported data on next launch.
      preSlotMigrationSnapshot?: unknown;
      // Same rule for the checkpoint migration: this belongs to the exporting
      // device's generation and must never become this device's recovery copy.
      preCheckpointMigrationSnapshot?: unknown;
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
  // Same absent-vs-malformed rule as availability above: an absent key means
  // the backup is silent about this preference, so keep what this device has.
  // Re-stringified so it goes through the SAME total validator the settings row
  // uses: `parseSidebarPanels` takes the stored JSON string, while a backup
  // carries a real array. Anything malformed (null, a string, unknown panel
  // names) collapses to `[]` in there rather than being half-trusted here.
  const sidebarPanels = raw.sidebarPanels === undefined
    ? await loadSidebarPanels()
    : parseSidebarPanels(JSON.stringify(raw.sidebarPanels));
  const sanitizedGoals = (raw.goals ?? []).map(sanitizeBackupGoal);
  // Imported data must never enter the running store with the retired field:
  // converting before persist also makes a crash before resetCheckpointMigration
  // safe, because the done-flag cannot strand the just-imported milestones.
  const { goals } = migrateCheckpoints(sanitizedGoals);
  const parsed: AppState = {
    goals,
    habits: (raw.habits ?? []).map(sanitizeBackupHabit),
    tasks: raw.tasks ?? [],
    sessions: raw.sessions ?? [],
  };
  await persist(parsed);
  await saveScale(pxPerDay);
  await saveAvailability(availability);
  await saveAllDayBlocks(allDayBlocks);
  await saveSidebarPanels(sidebarPanels);
  // Every backup predates the calendar-grid migration, and this device's own
  // done-flag (already true from its own first launch) would otherwise skip
  // it for the just-imported data. Re-arm it so the NEXT hydration — the next
  // time `initStore` runs, i.e. the next app launch — migrates the imported
  // goals/tasks exactly as it did the original data. The CURRENT session
  // keeps running on the un-migrated shapes it just loaded; this only
  // guarantees the migration is not skipped forever.
  await resetSlotMigration();
  // The imported data is a new generation for checkpoint migration too. Do not
  // adopt a snapshot from the exporting device; take this device's own copy on
  // the next hydration instead. Keep clearing both rows even though conversion
  // happened during import: the done-flag and snapshot belong to the replaced
  // pre-import generation, not the data just written.
  await resetCheckpointMigration();
  // Optional: restore the week-review snapshot if the backup carries a sane one.
  const pr = (raw as { planReview?: PlanReview }).planReview;
  if (pr && typeof pr.week === 'string' && Array.isArray(pr.entries) && typeof pr.reviewed === 'boolean') {
    await savePlanReview(pr);
  } else {
    await db.planReview.clear();
  }
  return { ...parsed, pxPerDay, availability, allDayBlocks, sidebarPanels };
}
