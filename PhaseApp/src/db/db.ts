import Dexie, { type Table } from 'dexie';
import type { Goal, Habit, Task, Session, AppState, PlanReview, Asset, CalendarCache, Life } from './types';
import { todayStr } from '../lib/dates';
import { clampScale } from '../lib/timeline';
import { sanitizeBackupGoal, sanitizeBackupHabit } from '../lib/goalImport';
import { sanitizeBackupLives } from '../lib/lives';
import { migrateCheckpoints } from '../lib/migrateCheckpoints';
import { migrateNodeStatus } from '../lib/migrateNodeStatus';
import { migrateWorkBlocks } from '../lib/migrateWorkBlocks';
import { assetIdsInMarkdown } from '../lib/notes';
import { decodeAssets, encodeAssets } from '../lib/backupAssets';
import {
  parseActiveFocusSession, serializeActiveFocusSession, type ActiveFocusSession,
} from '../lib/focusSession';
import { parseStoredAccelerator } from '../lib/assistantAccelerator';
import {
  parseCycleConfig, serializeCycleConfig, type CycleConfig,
} from '../lib/focusCycle';
import {
  parsePillPrefs, serializePillPrefs, type PillPrefs,
} from '../lib/pillPrefs';
import {
  parseShelfPrefs, serializeShelfPrefs, type ShelfPrefs,
} from '../lib/shelfPrefs';
import {
  parseStoredTimeLevel, serializeTimeLevel, type StoredTimeLevel,
} from '../lib/timeLens';
import {
  parseStoredFocusLevel, serializeFocusLevel, type StoredFocusLevel,
} from '../lib/focusLens';

/**
 * Single-row table. The fixed key is what makes "at most one cache" a schema
 * property rather than a convention every writer has to remember.
 */
export type CalendarCacheRow = CalendarCache & { key: string };
export const CALENDAR_CACHE_KEY = 'current';

class PhaseDB extends Dexie {
  goals!: Table<Goal, string>;
  habits!: Table<Habit, string>;
  tasks!: Table<Task, string>;
  sessions!: Table<Session, string>;
  settings!: Table<{ key: string; value: string }, string>;
  planReview!: Table<PlanReview, string>;
  assets!: Table<Asset, string>;
  calendarCache!: Table<CalendarCacheRow, string>;
  lives!: Table<Life, string>;

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
    this.version(5).stores({
      goals: 'id',
      habits: 'id',
      tasks: 'id',
      settings: 'key',
      sessions: 'id',
      planReview: 'week',
      assets: 'id',
    });
    this.version(6).stores({
      goals: 'id',
      habits: 'id',
      tasks: 'id',
      settings: 'key',
      sessions: 'id',
      planReview: 'week',
      assets: 'id',
      calendarCache: 'key',
    });
    this.version(7).stores({
      goals: 'id',
      habits: 'id',
      tasks: 'id',
      settings: 'key',
      sessions: 'id',
      planReview: 'week',
      assets: 'id',
      calendarCache: 'key',
      lives: 'id',
    });
  }
}

export const db = new PhaseDB();

export async function loadState(): Promise<AppState> {
  const [goals, habits, tasks, sessions, lives] = await Promise.all([
    db.goals.toArray(),
    db.habits.toArray(),
    db.tasks.toArray(),
    db.sessions.toArray(),
    db.lives.toArray(),
  ]);
  /*
   * Status only, here.
   *
   * `migrateWorkBlocks` runs in the store's `initStore` instead, AFTER
   * `migrateSlots` — which repairs pre-slot-era data by reading the very
   * `plannedDay`/`plannedStartMin` pair the block migration consumes. Running
   * the two in the other order leaves the repair with nothing to read, and it
   * needs the tab lock that only the store has.
   */
  return { goals: migrateNodeStatus(goals), habits, tasks, sessions, lives };
}

export async function persist(state: AppState): Promise<void> {
  // Assets deliberately do not belong to AppState or this transaction. This
  // is a full clear + bulkPut of the four app-data tables, so putting image
  // bytes in a goal would rewrite every screenshot on every ordinary edit.
  // Asset writes are surgical: one row at paste time, through db/assets.ts.
  // calendarCache is excluded for the same reason, and additionally because it
  // is derived device state that a backup restore must not resurrect.
  // One rw transaction: either every table reflects `state`, or none does.
  // (The previous Promise.all of independent clear→bulkPut chains could leave
  // the DB partially wiped if one chain failed mid-flight.)
  await db.transaction('rw', db.goals, db.habits, db.tasks, db.sessions, db.lives, async () => {
    await Promise.all([
      db.goals.clear().then(() => db.goals.bulkPut(state.goals)),
      db.habits.clear().then(() => db.habits.bulkPut(state.habits)),
      db.tasks.clear().then(() => db.tasks.bulkPut(state.tasks)),
      db.sessions.clear().then(() => db.sessions.bulkPut(state.sessions)),
      db.lives.clear().then(() => db.lives.bulkPut(state.lives)),
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

/**
 * The in-progress focus draft, one settings row.
 *
 * Device-local by design: an unfinished sitting on this machine is not user
 * work, so it rides in `settings` (like the timeline scale) rather than in a table,
 * and it is deliberately NOT part of backup export/import — restoring a backup
 * must not resurrect a half-run session from another day. Writes happen only
 * on state TRANSITIONS (start, pause, resume, complete), never on a timer
 * tick, and the load path is total: a malformed row reads as "no session".
 */
const ACTIVE_FOCUS_SESSION_KEY = 'activeFocusSession';

export async function loadActiveFocusSession(): Promise<ActiveFocusSession | null> {
  const row = await db.settings.get(ACTIVE_FOCUS_SESSION_KEY);
  return parseActiveFocusSession(row?.value);
}

export async function saveActiveFocusSession(value: ActiveFocusSession | null): Promise<void> {
  if (value === null) {
    await db.settings.delete(ACTIVE_FOCUS_SESSION_KEY);
    return;
  }
  await db.settings.put({
    key: ACTIVE_FOCUS_SESSION_KEY,
    value: serializeActiveFocusSession(value),
  });
}

/**
 * The assistant's global shortcut. A device/OS binding, not user work, so it
 * lives in `settings` and is deliberately NOT part of backup export/import —
 * a chord that works on this Mac may be owned by something else on the next.
 * The load is total: malformed rows read as the default.
 */
const ASSISTANT_ACCELERATOR_KEY = 'assistantAccelerator';

export async function loadAssistantAccelerator(): Promise<string> {
  const row = await db.settings.get(ASSISTANT_ACCELERATOR_KEY);
  return parseStoredAccelerator(row?.value);
}

export async function saveAssistantAccelerator(value: string): Promise<void> {
  await db.settings.put({ key: ASSISTANT_ACCELERATOR_KEY, value });
}

/**
 * Whether the floating running-session pill may show. A device preference,
 * not user work, so it lives in `settings` beside the accelerator and stays
 * out of backup export/import. Absent reads as ON — the pill is the default,
 * and only an explicit 'false' turns it off.
 */
const SHOW_OVERLAY_KEY = 'showOverlay';

export async function loadShowOverlay(): Promise<boolean> {
  const row = await db.settings.get(SHOW_OVERLAY_KEY);
  return row?.value !== 'false';
}

export async function saveShowOverlay(value: boolean): Promise<void> {
  await db.settings.put({ key: SHOW_OVERLAY_KEY, value: String(value) });
}

/**
 * Everything the floating pill is told about how to look.
 *
 * A device preference beside the accelerator, so it stays out of backup
 * export/import — how the pill looks on this Mac is not the user's data.
 *
 * ABSENT is not the same as default here: `'showOverlay'` is one boolean this
 * group absorbs, and it exists in every database that ever turned the pill
 * off. A group that silently re-showed a pill somebody had hidden would be the
 * worst first impression it could make, so an absent row seeds `show` from the
 * legacy one. The legacy row is READ and LEFT: it is one boolean, and a
 * delete-write to tidy it up buys nothing and can fail.
 */
const PILL_PREFS_KEY = 'pillPrefs';

export async function loadPillPrefs(): Promise<PillPrefs> {
  const row = await db.settings.get(PILL_PREFS_KEY);
  if (row?.value !== undefined) return parsePillPrefs(row.value);
  const legacy = await db.settings.get(SHOW_OVERLAY_KEY);
  return { ...parsePillPrefs(undefined), show: legacy?.value !== 'false' };
}

export async function savePillPrefs(prefs: PillPrefs): Promise<void> {
  await db.settings.put({ key: PILL_PREFS_KEY, value: serializePillPrefs(prefs) });
}

/**
 * How the Cmd+Space shelf is shaped. A device preference beside the pill's,
 * out of backup export/import for the same reason, and total on read.
 *
 * Unlike the pill's row there is no legacy toggle to absorb: nothing about the
 * shelf was configurable before this, so absent simply means the defaults —
 * which are the shelf as it already looked.
 */
const SHELF_PREFS_KEY = 'shelfPrefs';

export async function loadShelfPrefs(): Promise<ShelfPrefs> {
  const row = await db.settings.get(SHELF_PREFS_KEY);
  return parseShelfPrefs(row?.value);
}

export async function saveShelfPrefs(prefs: ShelfPrefs): Promise<void> {
  await db.settings.put({ key: SHELF_PREFS_KEY, value: serializeShelfPrefs(prefs) });
}

/**
 * The four numbers a pomodoro session is started with. A device preference
 * beside the accelerator and the pill's own switch, so it stays out of backup
 * export/import — the dial describes how this person works at this desk, not
 * their data. The load is total: a malformed row reads field-by-field back to
 * the defaults rather than throwing, because losing the dial must never cost
 * someone the ability to start a session.
 */
const CYCLE_CONFIG_KEY = 'cycleConfig';

export async function loadCycleConfig(): Promise<CycleConfig> {
  const row = await db.settings.get(CYCLE_CONFIG_KEY);
  return parseCycleConfig(row?.value);
}

export async function saveCycleConfig(config: CycleConfig): Promise<void> {
  await db.settings.put({ key: CYCLE_CONFIG_KEY, value: serializeCycleConfig(config) });
}

// The settings KEY keeps its original spelling: it names a row that already
// exists in every database, and renaming it would silently reset the dial.
const FOCUS_LEVEL_KEY = 'focusLevel';

export async function loadStoredTimeLevel(): Promise<StoredTimeLevel | null> {
  const row = await db.settings.get(FOCUS_LEVEL_KEY);
  return parseStoredTimeLevel(row?.value);
}

export async function saveStoredTimeLevel(stored: StoredTimeLevel): Promise<void> {
  await db.settings.put({ key: FOCUS_LEVEL_KEY, value: serializeTimeLevel(stored) });
}

/**
 * The focus dial's own row.
 *
 * A DIFFERENT key from the one above. `'focusLevel'` names the TIME dial —
 * it kept its original spelling because it names a row already present in every
 * database, and the two-dials rename deliberately moved types without moving
 * storage. Writing the focus dial there would silently reset every user's time
 * dial.
 */
const FOCUS_CAPABILITY_KEY = 'focusCapability';

export async function loadStoredFocusLevel(): Promise<StoredFocusLevel | null> {
  const row = await db.settings.get(FOCUS_CAPABILITY_KEY);
  return parseStoredFocusLevel(row?.value);
}

export async function saveStoredFocusLevel(stored: StoredFocusLevel): Promise<void> {
  await db.settings.put({ key: FOCUS_CAPABILITY_KEY, value: serializeFocusLevel(stored) });
}

// Defaults ON: an all-day event usually does consume the day.
export async function loadAllDayBlocks(): Promise<boolean> {
  const row = await db.settings.get('allDayBlocks');
  return row?.value !== 'false';
}

export async function saveAllDayBlocks(value: boolean): Promise<void> {
  await db.settings.put({ key: 'allDayBlocks', value: String(value) });
}

const CALENDAR_IDS_KEY = 'calendarIds';
/** Google's own name for the signed-in account's own calendar. */
const DEFAULT_CALENDAR_IDS = ['primary'];

/**
 * Which Google calendars a fetch queries.
 *
 * Total, and never empty: fetching zero calendars returns zero blocks, and
 * zero blocks render a fully-booked week as a free one. A malformed row, an
 * empty list, or entries of the wrong type all degrade to the primary
 * calendar rather than to silence.
 */
export async function loadCalendarIds(): Promise<string[]> {
  const row = await db.settings.get(CALENDAR_IDS_KEY);
  if (!row) return [...DEFAULT_CALENDAR_IDS];
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return [...DEFAULT_CALENDAR_IDS];
  }
  if (!Array.isArray(parsed)) return [...DEFAULT_CALENDAR_IDS];
  const ids = parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return ids.length > 0 ? ids : [...DEFAULT_CALENDAR_IDS];
}

export async function saveCalendarIds(ids: string[]): Promise<void> {
  await db.settings.put({ key: CALENDAR_IDS_KEY, value: JSON.stringify(ids) });
}

/**
 * The collapsible sections in the Plan rail.
 *
 * Down to one. Stats was an accordion of figures the week header already
 * carries, and Working hours was a settings form sitting as a peer of the one
 * section used repeatedly while planning — both left the rail on the way to
 * Settings and the header. An unknown value in a stored list is dropped by
 * `parseSidebarPanels`, so an old preference naming either of them degrades to
 * "collapsed" rather than to an error.
 */
export type SidebarPanel = 'habits';

// Stored order — `saveSidebarPanels` writes panels in this order, so append
// new members rather than inserting them.
const SIDEBAR_PANELS: readonly SidebarPanel[] = ['habits'];
const SIDEBAR_PANELS_KEY = 'sidebarPanels';

/**
 * Total parse: a malformed or partly-unknown value yields the default rather
 * than a half-trusted list. Collapsing every
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

/** Which shape the Plan view is in. A device preference, not app data. */
export type PlanMode = 'week' | 'month';

const PLAN_MODE_KEY = 'planMode';

/**
 * Total parse, like `parseSidebarPanels`: anything unrecognised yields the
 * default rather than a half-trusted value.
 *
 * Week is the default because it is the only mode that places work at a TIME,
 * which is what the view exists for — month commits to a day and leaves the
 * hour to be chosen.
 */
export async function loadPlanMode(): Promise<PlanMode> {
  const row = await db.settings.get(PLAN_MODE_KEY);
  return row?.value === 'month' ? 'month' : 'week';
}

export async function savePlanMode(mode: PlanMode): Promise<void> {
  await db.settings.put({ key: PLAN_MODE_KEY, value: mode });
}

/**
 * Which representation the Goals page is in. A device preference, like
 * `PlanMode` — list, board and timeline are ways of looking at the same
 * portfolio, not different data, so this never rides in `AppState`.
 */
export type GoalsMode = 'board' | 'timeline';

const GOALS_MODE_KEY = 'goalsMode';

/**
 * Total parse, like `parsePlanMode`. Board is the default because it is the
 * mode you can act in: a card can be dragged between horizons and opened.
 * Timeline answers "when does all of this land", which is a weekly question.
 */
export async function loadGoalsMode(): Promise<GoalsMode> {
  const row = await db.settings.get(GOALS_MODE_KEY);
  return row?.value === 'timeline' ? 'timeline' : 'board';
}

export async function saveGoalsMode(mode: GoalsMode): Promise<void> {
  await db.settings.put({ key: GOALS_MODE_KEY, value: mode });
}

/**
 * The PhasePhone sync high-water marks — one settings row.
 *
 * `generation` is the counter stamped into every `state.json` the Mac exports;
 * `ingestedThroughOpId` is the last companion op ingested, and it — never
 * generation arithmetic — is what tells the phone which of its ops have landed
 * (the Mac exports for its own edits too). Both are DEVICE facts about this
 * machine's sync relationship with the container, not user work, so they live
 * in `settings` beside the assistant accelerator and stay out of backup
 * export/import: restoring a backup onto another Mac must not claim that
 * Mac ingested ops it has never seen.
 *
 * The read is total, like `loadPlanMode`: a malformed row reads as the
 * default, because a corrupt meta that threw would take hydration with it, and
 * re-exporting from generation 0 is a phone re-read, not data loss.
 */
export interface SyncMeta {
  generation: number;
  ingestedThroughOpId: string | null;
}

const SYNC_META_KEY = 'syncMeta';

const DEFAULT_SYNC_META: SyncMeta = { generation: 0, ingestedThroughOpId: null };

function parseSyncMeta(value: string | undefined): SyncMeta {
  if (!value) return DEFAULT_SYNC_META;
  try {
    const raw: unknown = JSON.parse(value);
    if (!raw || typeof raw !== 'object') return DEFAULT_SYNC_META;
    const meta = raw as Partial<SyncMeta>;
    if (typeof meta.generation !== 'number' || !Number.isFinite(meta.generation)) return DEFAULT_SYNC_META;
    return {
      generation: meta.generation,
      ingestedThroughOpId: typeof meta.ingestedThroughOpId === 'string' ? meta.ingestedThroughOpId : null,
    };
  } catch {
    return DEFAULT_SYNC_META;
  }
}

export async function loadSyncMeta(): Promise<SyncMeta> {
  const row = await db.settings.get(SYNC_META_KEY);
  return parseSyncMeta(row?.value);
}

export async function saveSyncMeta(meta: SyncMeta): Promise<void> {
  await db.settings.put({ key: SYNC_META_KEY, value: JSON.stringify(meta) });
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

function referencedAssetIds(state: AppState): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const collect = (markdown: string | undefined) => {
    if (typeof markdown !== 'string') return;
    for (const id of assetIdsInMarkdown(markdown)) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  };
  const walk = (nodes: Goal['nodes']) => {
    for (const node of nodes) {
      collect(node.notes);
      if (node.children) walk(node.children);
    }
  };
  for (const goal of state.goals) {
    collect(goal.notes);
    walk(goal.nodes);
  }
  return ids;
}

/**
 * The backup document, as text. ONE derivation, spent by three callers.
 *
 * `exportState` hands it to a download, the automatic backup writes it to the
 * local Backups folder, and the fatal error screen writes it from whatever it
 * can still read. Building the object in each of them would be three opinions
 * about what a backup contains, and the two that were not the download would
 * be the ones nobody notices going stale — which is precisely the failure a
 * backup exists to survive. `importStateFromFile` is the only reader, so what
 * this produces has to stay exactly what that accepts.
 */
export async function buildBackupText(
  state: AppState,
  pxPerDay: number,
  planReview: PlanReview | null,
  allDayBlocks: boolean,
  // Persisted like allDayBlocks, and it was the one device
  // preference the backup left out — so "the backup contains everything
  // persisted" was not true, and the next preference added would have copied
  // the omission.
  sidebarPanels: SidebarPanel[],
  preSlotMigrationSnapshot?: { goals: Goal[]; tasks: Task[] } | null,
  preCheckpointMigrationSnapshot?: { goals: Goal[] } | null,
): Promise<string> {
  const ids = referencedAssetIds(state);
  const storedAssets = await db.assets.bulkGet(ids);
  const assets = await encodeAssets(storedAssets.filter((asset): asset is Asset => asset !== undefined));
  const backup = {
    ...state,
    pxPerDay,
    allDayBlocks,
    sidebarPanels,
    ...(planReview ? { planReview } : {}),
    ...(preSlotMigrationSnapshot ? { preSlotMigrationSnapshot } : {}),
    ...(preCheckpointMigrationSnapshot ? { preCheckpointMigrationSnapshot } : {}),
    assets,
  };
  return JSON.stringify(backup, null, 2);
}

/** Hand a built backup to the browser as a file. */
/**
 * How long the blob URL outlives the click.
 *
 * Revoking in the SAME task cancels the download in WebKit — the click starts
 * the fetch and the download reads the blob afterwards — so the choice is
 * between leaking the URL forever and holding it for a while. A minute is far
 * longer than any engine needs to begin, and the bytes were already in memory
 * to be handed over.
 */
export const BLOB_URL_REVOKE_MS = 60_000;

/**
 * Hand the file to the browser. This is a ONE-WAY gesture.
 *
 * Nothing here observes what happens next: the anchor click starts a download
 * and reports no destination, no completion, and no cancellation. A caller may
 * therefore say the download STARTED and must never say the file was saved —
 * see `ErrorBoundary`, which made exactly that claim.
 */
export function downloadBackupText(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  // In the document for the click to count in every engine, and out again
  // immediately: this runs on the fatal screen, where the tree below is gone.
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_MS);
}

export async function exportState(
  state: AppState,
  pxPerDay: number,
  planReview: PlanReview | null,
  allDayBlocks: boolean,
  sidebarPanels: SidebarPanel[],
  preSlotMigrationSnapshot?: { goals: Goal[]; tasks: Task[] } | null,
  preCheckpointMigrationSnapshot?: { goals: Goal[] } | null,
): Promise<void> {
  downloadBackupText(
    await buildBackupText(
      state, pxPerDay, planReview, allDayBlocks, sidebarPanels,
      preSlotMigrationSnapshot, preCheckpointMigrationSnapshot,
    ),
    `phase-goals-${todayStr()}.json`,
  );
}

/**
 * A backup built from the DATABASE, owing nothing to the running app.
 *
 * The fatal error screen is the one caller. By the time it renders, the store
 * is the thing that just crashed — reading state through it would be asking
 * the broken component for the data it is trying to rescue. Every value here
 * comes straight out of Dexie instead, through the same loaders hydration
 * uses, so the emergency export works in exactly the case it exists for.
 *
 * The migration snapshots are read with `.catch(() => null)` for the reason
 * `exportBackup` gives: they are a nicety, and a rejected read of one must
 * never be the reason no file is written.
 */
export async function emergencyBackupText(): Promise<string> {
  const [state, pxPerDay, planReview, allDayBlocks, sidebarPanels] = await Promise.all([
    loadState(), loadScale(), loadPlanReview(), loadAllDayBlocks(), loadSidebarPanels(),
  ]);
  const [preSlot, preCheckpoint] = await Promise.all([
    loadSlotMigrationSnapshot().catch(() => null),
    loadCheckpointMigrationSnapshot().catch(() => null),
  ]);
  return buildBackupText(state, pxPerDay, planReview, allDayBlocks, sidebarPanels, preSlot, preCheckpoint);
}

export type ImportedBackupState = AppState & {
  pxPerDay: number;
  allDayBlocks: boolean;
  sidebarPanels: SidebarPanel[];
};

export type AssetImportFailure = Error & {
  code: 'asset-import-failed';
  imported: ImportedBackupState;
};

function isEntityArray(v: unknown): boolean {
  return Array.isArray(v) && v.every(
    (x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string',
  );
}

type RawBackup = Partial<
  AppState & {
    pxPerDay?: number;
    zoom?: string;
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
    assets?: unknown;
  }
>;

/**
 * Read the file and decide whether it is a Phase backup at all. Writes nothing.
 *
 * Extracted so `validateBackupFile` and `importStateFromFile` cannot form two
 * opinions about what a backup IS — the answer to "will this import be
 * refused?" has to be the refusal itself, run early, not a second check
 * written to resemble it.
 */
async function readBackupJson(file: File): Promise<RawBackup> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error('Could not read that file.');
  }

  let raw: RawBackup;
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
  return raw;
}

/**
 * Would this file be accepted? Throws the message the import would throw.
 *
 * It exists so the caller can ask BEFORE spending anything on the import. A
 * pre-import snapshot occupies one of a bounded number of retention slots, and
 * a file that was never going to be accepted must not evict a real one — a
 * mis-picked holiday photo, tried three times, would otherwise age out three
 * genuine safety copies.
 *
 * It re-reads and re-parses the file, deliberately. That is one extra parse on
 * a once-in-a-blue-moon action behind a typed confirmation, and the price of
 * it is that the check and the import are the SAME code rather than two
 * validators that agree until one of them is edited.
 */
export async function validateBackupFile(file: File): Promise<void> {
  await readBackupJson(file);
}

export async function importStateFromFile(
  file: File,
): Promise<ImportedBackupState> {
  const raw = await readBackupJson(file);

  const pxPerDay =
    Number.isFinite(raw.pxPerDay) && (raw.pxPerDay as number) > 0
      ? clampScale(raw.pxPerDay as number)
      : legacyZoomToScale(raw.zoom); // old backups carry a zoom string
  // A backup exported before working hours were removed still carries an
  // `availability` key. It is IGNORED rather than migrated: the model it
  // described is gone, and a stale settings row is inert — the same licence a
  // dangling `Session.nodeId` has. Nothing reads it, so nothing has to be
  // taught to skip it either.
  //
  // Old backups predate allDayBlocks entirely — an ABSENT key means the backup
  // says NOTHING about this device preference, which is not the same as the
  // backup saying "use the default". Leave the current persisted value alone
  // in that case. Mirrors loadAllDayBlocks (`row?.value !== 'false'`): a PRESENT value of
  // anything but the literal false (string 'false' from an old settings-table
  // dump, or an actual JSON `false` written by the current exportState) means
  // on. An ABSENT key means the backup is silent, so keep the current setting.
  const allDayBlocks =
    raw.allDayBlocks === undefined
      ? await loadAllDayBlocks()
      : raw.allDayBlocks !== 'false' && raw.allDayBlocks !== false;
  // Same absent-vs-malformed rule: an absent key means the backup is silent
  // about this preference, so keep what this device has.
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
  // Both migrations, in this order: migrateCheckpoints can APPEND nodes built
  // from legacy milestones, and those nodes must go through the status
  // migration too rather than entering the store carrying `done`.
  const { goals: checkpointed } = migrateCheckpoints(sanitizedGoals);
  /*
   * …and the block migration last, so nodes APPENDED by migrateCheckpoints go
   * through it too rather than entering the store with a legacy placement.
   *
   * Unlike hydration there is no `migrateSlots` to run first, so a day with no
   * start minute degrades to a week commitment here. That is lossless: the rail
   * lists a week-committed leaf exactly as it listed a day-committed one.
   */
  const blocked = migrateWorkBlocks(migrateNodeStatus(checkpointed), raw.tasks ?? []);
  const parsed: AppState = {
    goals: blocked.goals,
    habits: (raw.habits ?? []).map(sanitizeBackupHabit),
    tasks: blocked.tasks,
    sessions: raw.sessions ?? [],
    // A goal whose `lifeId` names a life this backup does not carry is left
    // exactly as it is: the reference dangles and reads as unassigned. Stripping
    // it would silently rewrite user data to satisfy a constraint the read path
    // already handles.
    lives: sanitizeBackupLives((raw as { lives?: unknown }).lives),
  };
  await persist(parsed);
  let assetWriteFailed = false;
  try {
    const importedAssets = decodeAssets(raw.assets);
    // Asset storage is a generation, not ordinary app state. Replace it in one
    // transaction so old, unreferenced images never survive an import.
    await db.transaction('rw', db.assets, async () => {
      await db.assets.clear();
      await db.assets.bulkPut(importedAssets);
    });
  } catch {
    // `persist(parsed)` already landed. Continue the generation-boundary work,
    // then report the partial import explicitly rather than pretending it was
    // atomic or rolling back the app tables.
    assetWriteFailed = true;
  }
  await saveScale(pxPerDay);
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
  const imported = { ...parsed, pxPerDay, allDayBlocks, sidebarPanels };
  if (assetWriteFailed) {
    const failure = new Error('Imported goals and notes, but images could not be saved.');
    Object.assign(failure, { code: 'asset-import-failed', imported });
    throw failure as AssetImportFailure;
  }
  return imported;
}
