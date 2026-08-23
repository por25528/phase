import { useSyncExternalStore, useCallback } from 'react';
import type { Goal, GoalNode, Habit, AppState, PlanReview, Task, Session, AvailabilityWindow, Asset, Life } from '../db/types';
import {
  loadState, persist, exportState, importStateFromFile, loadScale, saveScale,
  loadPlanReview, savePlanReview, loadAvailability, saveAvailability,
  loadAllDayBlocks, saveAllDayBlocks,
  loadSidebarPanels, saveSidebarPanels, type SidebarPanel,
  loadPlanMode, savePlanMode, type PlanMode,
  loadGoalsMode, saveGoalsMode, type GoalsMode,
  isSlotMigrationDone, saveSlotMigrationSnapshot, markSlotMigrationDone, loadSlotMigrationSnapshot,
  isCheckpointMigrationDone, saveCheckpointMigrationSnapshot, markCheckpointMigrationDone,
  loadCheckpointMigrationSnapshot, type ImportedBackupState, type AssetImportFailure,
  loadActiveFocusSession, saveActiveFocusSession,
  loadAssistantAccelerator, saveAssistantAccelerator,
  loadStoredTimeLevel, saveStoredTimeLevel,
  loadStoredFocusLevel, saveStoredFocusLevel,
} from '../db/db';
import { allAssetIds, deleteAssets, getAsset, putAsset } from '../db/assets';
import { clampScale } from '../lib/timeline';
import { DEFAULT_AVAILABILITY, parseAvailability, windowForDate } from '../lib/availability';
import { todayStr, addDays, fmtD } from '../lib/dates';
import { clampSpan } from '../lib/timeline';
import { isValidLocalDate, projectDateError, confirmableDateGoalIds } from '../lib/schedule';
import { weekOf, plannedLeaves, walkLeaves } from '../lib/plan';
import { HORIZON_LABELS, HORIZON_COUNT } from '../lib/horizons';
import type { RevealKind, RevealTarget } from '../lib/reveal';
import { deferOpenWork } from '../lib/deferWork';
import { backlogGroups } from '../lib/backlog';
import { topLevelSelection, openLeavesUnder, allLeavesUnder, selectionRemovalCount } from '../lib/selection';
import { migrateSlots, describeMigration } from '../lib/migrateSlots';
import { migrateCheckpoints } from '../lib/migrateCheckpoints';
import { migrateWorkBlocks } from '../lib/migrateWorkBlocks';
import { sampleProject } from '../lib/sampleProject';
import { weaveHidden, leafCount, rankMoveTarget } from '../lib/board';
import { goalsInScope, resolveScope, type LifeScope } from '../lib/lifeScope';
import { acquireTabLock } from '../lib/tabLock';
import { normalizeEstimate, type Now } from '../lib/capacity';
import { formatEstimateValue } from '../lib/estimateInput';
import { resolveSlot, durationOf, freeIntervals, NO_PAST_LIMIT, WHOLE_DAY } from '../lib/slot';
import { spansOn } from '../lib/scheduled';
import { assetIdsInMarkdown } from '../lib/notes';
import { addPlannedSlot, clampResize, setPlannedSlot, clearPlannedSlot } from './scheduleActions';
import { addBlock, blocksOf, clearBlocks, makeBlock, removeBlock, replaceBlock, setOnlyBlock } from '../lib/blocks';
import type { ReplanMove } from '../lib/replan';
import { MAX_IMAGE_EDGE, scaledDimensions } from '../lib/imageScale';
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
  insertSiblingAfter as treeInsertSiblingAfter,
} from '../lib/tree';
import { applyStatus, isDone, stepStatus, type StepStatus } from '../lib/status';
import {
  startFocusSession, pauseFocusSession, resumeFocusSession, finishFocusSession,
  discardFocusSession, type ActiveFocusSession,
} from '../lib/focusSession';
import {
  DEFAULT_TIME_LEVEL, timeLevelFor, isTimeLevel, type TimeLevel,
} from '../lib/timeLens';
import {
  DEFAULT_FOCUS_LEVEL, focusLevelFor, isFocusLevel, type FocusLevel,
} from '../lib/focusLens';
import { DEMAND_WORD, type Demand } from '../lib/demand';
import type { ExpectedTime, WorkRef } from '../lib/expectedTime';
import {
  DEFAULT_ASSISTANT_ACCELERATOR, isValidAccelerator, type ShortcutStatus,
} from '../lib/assistantAccelerator';
import { canAddLife, nextLifeOrder } from '../lib/lives';

/**
 * Write a status onto a node of an already-cloned tree.
 *
 * `applyStatus` is pure and returns a copy, so assigning it over the live node
 * would keep any key the copy DROPPED — unticking a step would leave its
 * `doneAt` behind, and `doneAt` is what the week recap reads.
 */
function writeStatus(n: GoalNode, next: StepStatus, today: string, blockedOn?: string): void {
  const updated = applyStatus(n, next, today, blockedOn);
  for (const key of ['status', 'blockedOn', 'doneAt'] as const) {
    if (updated[key] === undefined) delete n[key];
    else (n[key] as unknown) = updated[key];
  }
}

export type ViewName = 'today' | 'plan' | 'goals' | 'project';

export const VIEW_LABELS = {
  today: 'Today',
  plan: 'Plan',
  goals: 'Goals',
} as const;

/**
 * Which goal composer is up, if any.
 *
 * It lives in the store rather than in `Goals.tsx` local state because the
 * command palette can now ask for one from anywhere in the app — and a modal
 * that only its own page can open is a modal the palette has to lie about.
 */
export type GoalModal = 'new' | 'import' | null;

/**
 * Which tab the goal workspace is showing.
 *
 * `'steps'` keeps its stored name so no persisted or in-flight value has to be
 * migrated for a rename; it is labelled Tasks.
 */
export type ProjectTab = 'overview' | 'steps' | 'board' | 'calendar' | 'notes';

/**
 * A milestone's own tabs.
 *
 * Three, not the goal's five. A Board over one container's descendants is a
 * board with one column's worth of work in it, and a Calendar over them is the
 * goal's calendar filtered to a subset nobody asked to filter — both would be
 * tabs that exist only because the parent has them.
 */
export type AreaTab = 'overview' | 'steps' | 'notes';

interface UIState {
  view: ViewName;
  projectReturnView: ViewName;
  selDate: string;
  openGoalId: string | null;
  /**
   * The container being shown as its own workspace, INSIDE the open goal.
   *
   * A second id rather than a second view: a milestone is not a destination of
   * its own, it is a lens on the goal already open, so `openGoalId` stays set
   * and the breadcrumb above it stays true. Clearing this returns to the goal
   * without touching anything else, which is what "Back preserves context"
   * means here.
   */
  openAreaId: string | null;
  areaTab: AreaTab;
  /**
   * The tab each goal was last left on.
   *
   * Keyed by goal because the answer is per goal: a study goal is read on
   * Overview and a build is worked on Tasks, and one global "last tab" makes
   * every second goal open on the wrong one. Ephemeral — it is a convenience
   * within a session, not a preference worth a row in the database.
   */
  projectTabByGoal: Record<string, ProjectTab>;
  // Node the project page should scroll to + pulse. One-shot: it is a pointer
  // to a MOMENT, and the page clears it once the pulse has run.
  focusNodeId: string | null;
  // Node whose detail panel is open. Distinct from `focusNodeId` and longer
  // lived: this one persists until the panel is closed. Read from plan 2 on.
  openStepId: string | null;
  projectTab: ProjectTab;
  goalModal: GoalModal;
  settingsOpen: boolean;              // the Settings dialog — in the store so any surface can open it
  // Task/habit the Plan view should scroll to + highlight — the same idea as
  // `focusNodeId`, for the two kinds that have no page of their own.
  revealItem: RevealTarget | null;
  // A step that was just created and should open ready to type. One-shot: the
  // row clears it as it mounts, so collapsing and re-expanding cannot reopen it.
  newNodeId: string | null;
  expanded: Set<string>;
  toast: string | null;
  pendingUndo: { label: string } | null;
  pxPerDay: number; // timeline scale — continuous, gesture-driven
  hydration: 'loading' | 'ready' | 'error';
  secondTab: boolean;
  // A write to IndexedDB has failed and no later write has succeeded. Latched,
  // not a toast: the whole point is that it outlives the moment.
  persistFailed: boolean;
  dateReviewDismissed: boolean;
  theme: Theme; // per-device UI preference (localStorage, not Dexie)
  planReview: PlanReview | null; // previous-week snapshot — review metadata, not app data
  availability: AvailabilityWindow[]; // per-weekday planning window (device preference)
  allDayBlocks: boolean;              // do all-day calendar events consume the day?
  sidebarPanels: SidebarPanel[];      // which Plan-view sidebar panels are expanded (device preference)
  planMode: PlanMode;                 // week or month shape for the Plan view (device preference)
  goalsMode: GoalsMode;               // board or timeline shape for the Goals view (device preference)
  activeHorizon: number;              // narrow Projects-board horizon (UI only)
  /**
   * Which life the Goals board is showing. In-memory only — no settings row,
   * no `ifOwner` write, and every load starts at `'all'`.
   *
   * It is `activeHorizon`, not `goalsMode`. A switcher is a mode, and the
   * failure `ideas/vision.md` D-7 named was *a mode to be lost in* — a danger
   * in proportion to how long you can sit in one without having chosen it. A
   * scope you picked this session is one you remember picking; a scope
   * restored silently from a fortnight ago is one you can mistake for the
   * whole board, and the mistake it produces is believing you have no startup
   * work.
   */
  activeLifeId: LifeScope;
  /**
   * The in-progress focus draft, or null. In UIState rather than AppState
   * deliberately: it is device-local working state, persisted surgically to
   * its own settings row on TRANSITIONS only — never on a timer tick, and
   * never inside `persist()`'s four-table write.
   */
  activeFocusSession: ActiveFocusSession | null;
  /** The assistant's global shortcut — a device preference, like `planMode`. */
  assistantAccelerator: string;
  /**
   * How long the user last said they had, in the dial's three positions.
   * The number is one you SET, never one Phase predicts: a gap computed
   * from a calendar is wrong exactly when the day goes sideways, which is
   * when you most need the answer.
   *
   * Reset to `medium` when the stored date is not today, evaluated on hydrate.
   * A window left open across midnight keeps the level until it reloads: that
   * is the deliberate cost of having no timer, and the same trade `focusSession`
   * makes by banking timestamps instead of ticking.
   */
  timeLevel: TimeLevel;
  /**
   * How much focus the room supports. Persisted with a daily reset, exactly as
   * `timeLevel` is — a person who says they are fried at 09:00 is still fried at
   * 09:20, and re-asking on every open is how a dial gets left at its default
   * forever. The reset is what stops it becoming a setting.
   */
  focusLevel: FocusLevel;
  /**
   * What the OS said when the chord was registered. Ephemeral and
   * Electron-only: null in the browser, where there is no global shortcut to
   * register and so nothing honest to report.
   */
  assistantShortcut: ShortcutStatus | null;
}

// Exported for the agent surface: `agentReads`/`agentWrites` are handed the
// value of `getState()` so they stay pure and testable with a fixture, and a
// handler cannot name its own argument without this.
export interface FullState extends AppState, UIState {}

let state: FullState = {
  goals: [],
  habits: [],
  tasks: [],
  sessions: [],
  lives: [],
  view: 'today',
  projectReturnView: 'goals',
  selDate: todayStr(),
  openGoalId: null,
  focusNodeId: null,
  openStepId: null,
  projectTab: 'steps',
  openAreaId: null,
  areaTab: 'steps',
  projectTabByGoal: {},
  goalModal: null,
  settingsOpen: false,
  revealItem: null,
  newNodeId: null,
  expanded: new Set(),
  toast: null,
  pendingUndo: null,
  pxPerDay: 13, // quarter preset until the persisted scale loads
  hydration: 'loading',
  secondTab: false,
  persistFailed: false,
  dateReviewDismissed: false,
  planReview: null,
  availability: DEFAULT_AVAILABILITY,
  allDayBlocks: true,
  sidebarPanels: [],
  planMode: 'week',
  goalsMode: 'board',
  activeHorizon: 0,
  activeLifeId: 'all',
  activeFocusSession: null,
  assistantAccelerator: DEFAULT_ASSISTANT_ACCELERATOR,
  timeLevel: DEFAULT_TIME_LEVEL,
  focusLevel: DEFAULT_FOCUS_LEVEL,
  assistantShortcut: null,
  // Read synchronously at module load so the header toggle shows the correct
  // state immediately (the no-FOUC script already painted <html>). 'system' in
  // non-DOM contexts (tests).
  theme: readStoredTheme(),
};

let initialized = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
/** Monotonic, so revealing the same row twice is still two distinct events. */
let revealNonce = 0;
let undoTimer: ReturnType<typeof setTimeout> | null = null;
let scaleTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Undo history, newest last. It used to be a single `restoreFn`, which any
 * subsequent undoable action overwrote — so deleting a project and then ticking
 * a checkbox inside the toast window destroyed the project permanently with no
 * warning. Keeping a short stack means ⌘Z still walks back to it, which is also
 * the only recovery path once the toast has faded.
 */
interface UndoEntry {
  label: string;
  restore: () => void;
  /**
   * True when the restore is SURGICAL — it reapplies just the thing that
   * changed against whatever the state is now (e.g. re-splicing one deleted
   * task), so replaying it later cannot clobber unrelated edits.
   *
   * False for a whole-slice snapshot, which reverts everything written to that
   * slice since. Those must be dropped as soon as any other write lands.
   */
  surgical: boolean;
}

let undoStack: UndoEntry[] = [];
/**
 * Whether the entry the visible Undo toast refers to is surgical — i.e. whether
 * it survives `setAndPersist`'s stale-restore sweep. Tracked separately from
 * the stack because `pendingUndo` holds only a label, and the toast has to
 * retire in lockstep with the restore it offers.
 */
let armedSurgical = false;
const UNDO_DEPTH = 20;
/**
 * True only while withUndo / a restore is doing its own write, so
 * `setAndPersist` can tell an undoable edit from every other mutation and drop
 * stale restores for the latter. See the note in setAndPersist.
 */
let writingUndoableEdit = false;
/**
 * Whether this tab holds the single-writer lock.
 *
 * Optimistic until the lock resolves: the Web Lock settles long before a human
 * can reach a control, and defaulting to "blocked" would make the sole tab
 * refuse a write during hydration.
 */
let ownsTabLock = true;

let activeNoteFlush: (() => void) | null = null;

/** Register the one mounted note editor so destructive snapshots can flush it. */
export function registerPendingNoteFlush(flush: () => void): () => void {
  activeNoteFlush = flush;
  return () => {
    if (activeNoteFlush === flush) activeNoteFlush = null;
  };
}

function flushPendingNote(): void {
  activeNoteFlush?.();
}

/**
 * Run a settings write only if this tab owns the single-writer lock.
 *
 * `setAndPersist`'s guard covers the four main tables. Every OTHER write to
 * IndexedDB — the timeline scale, availability, the all-day preference, the
 * sidebar layout, the week-review snapshot — went straight through, so a
 * non-owning tab still overwrote the owner's settings, and `ensureWeekRollover`
 * (which runs unconditionally at the end of `initStore`) stamped its own
 * `planReview` over the owner's on every launch. "A tab that lost the lock must
 * never re-run the migration (or any other write)" now means what it says.
 */
function ifOwner(write: () => Promise<unknown>): void {
  if (!ownsTabLock) return;
  void write().catch(() => {});
}

/**
 * The one seam every focus transition goes through: in-memory state first, then
 * the surgical settings write, gated on lock ownership exactly as every other
 * settings write is. Reads of elapsed time never come here — they are pure
 * arithmetic over the draft's timestamps, which is what keeps a ticking clock
 * from ever touching Dexie.
 */
function setFocusDraft(draft: ActiveFocusSession | null): void {
  set({ activeFocusSession: draft });
  ifOwner(() => saveActiveFocusSession(draft));
}

export interface EncodedAssetImage {
  bytes: Blob;
  width: number;
  height: number;
}

export type AssetEncoder = (file: Blob) => Promise<EncodedAssetImage>;

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  if (typeof document === 'undefined' || typeof Image === 'undefined'
    || typeof URL.createObjectURL !== 'function') {
    throw new Error('This browser cannot decode pasted images.');
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Could not decode the pasted image.'));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function encodeAssetImage(file: Blob): Promise<EncodedAssetImage> {
  if (typeof document === 'undefined') {
    throw new Error('Pasted image encoding requires a browser.');
  }

  const decoded = await decodeImage(file);
  try {
    const { width, height } = scaledDimensions(decoded.width, decoded.height, MAX_IMAGE_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot draw pasted images.');
    context.drawImage(decoded.source, 0, 0, width, height);

    const encoded = await new Promise<Blob>((resolve, reject) => {
      if (typeof canvas.toBlob !== 'function') {
        reject(new Error('This browser cannot encode pasted images.'));
        return;
      }
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Could not encode the pasted image.')),
        'image/webp',
        0.82,
      );
    });
    if (encoded.type !== 'image/webp') {
      throw new Error('This browser cannot encode WebP images.');
    }
    return {
      bytes: encoded,
      width,
      height,
    };
  } finally {
    decoded.close();
  }
}

function ownerAssetWrite<T>(write: () => Promise<T>): Promise<T> {
  let invoked = false;
  let rejectResult: (reason?: unknown) => void = () => {};
  const result = new Promise<T>((resolve, reject) => {
    rejectResult = reject;
    ifOwner(async () => {
      invoked = true;
      try {
        resolve(await write());
      } catch (error) {
        reject(error);
      }
    });
  });
  if (!invoked) rejectResult(new Error('Phase is open in another tab.'));
  return result;
}

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
  // An undo entry is a snapshot of a WHOLE slice, so replaying it also reverts
  // anything written after it. Most mutations (rename, add child, move horizon,
  // reorder, schedule) are not undoable and land here directly — so once one
  // happens, every armed restore is stale and must be dropped. Without this,
  // ⌘Z after "delete a project, then move another to Someday" silently undid
  // the move as well.
  //
  // Dropping the restore has to drop the OFFER with it. The toast ran on its
  // own timer, so "Deleted 'Psets' and its 40 steps — Undo" stayed on screen,
  // and clickable, for the rest of its 15 seconds after its restore had already
  // been discarded — and typing one step title or ticking one checkbox is
  // enough to discard it. Pressing Undo then popped an empty stack and cleared
  // the toast, which is indistinguishable from having worked. A recovery
  // promise that is already void must stop being displayed.
  let retire: Partial<UIState> | undefined;
  if (!writingUndoableEdit) {
    undoStack = undoStack.filter((entry) => entry.surgical);
    if (!armedSurgical && state.pendingUndo) {
      if (undoTimer) {
        clearTimeout(undoTimer);
        undoTimer = null;
      }
      retire = { pendingUndo: null };
    }
  }
  const next = { ...state, ...retire, ...uiPatch, ...patch };
  state = next;
  notify();
  /*
   * A tab that does not hold the lock never writes.
   *
   * Every `persist` is a full `clear()` + `bulkPut()` of all four tables from
   * THIS tab's in-memory snapshot, so a single write from a stale second tab
   * rewrites the whole database from its stale view — ticking one habit in tab
   * B deleted the three steps just added in tab A. The banner has always been
   * shown; the clobbering happened anyway, which made CLAUDE.md's "a second tab
   * gets a warning banner instead of silently clobbering the first" false, and
   * `initStore`'s "a tab that lost the lock must never re-run the migration (or
   * any other write)" only half-implemented.
   *
   * In-memory state still advances, deliberately: freezing the UI would look
   * like breakage, and leaving it live keeps Export working, which is the one
   * way to rescue anything typed here. The banner says plainly that it is not
   * being saved.
   */
  if (!ownsTabLock) return;
  /*
   * A failed write used to be a 1.9-second toast and nothing else. In-memory
   * state advanced as if it had succeeded, so the realistic sequence — quota
   * exceeded or disk full mid-session, user looks away for three seconds —
   * left someone working for an hour against state that existed only in RAM,
   * then closing the tab. The toast even told them to export a backup, which
   * is right, and then took the advice off screen before they looked back.
   *
   * So the failure also latches into a banner that stays until a write
   * succeeds. A later success clears it honestly: Dexie serialises its
   * transactions, so "the most recent write landed" is the true state of the
   * database, not a guess.
   */
  persist({ goals: next.goals, habits: next.habits, tasks: next.tasks, sessions: next.sessions, lives: next.lives }).then(
    () => {
      if (state.persistFailed) set({ persistFailed: false });
    },
    () => {
      actions.showToast('Saving failed — export a backup now');
      if (!state.persistFailed) set({ persistFailed: true });
    },
  );
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
  // Capture the promise once so the migration block below can await actual
  // ownership. Phase assumes a single writer: a tab that lost the lock must
  // still load and render normally, it just must never re-run the migration
  // (or any other write) alongside the owning tab.
  const tabLock = acquireTabLock();
  void tabLock.then((owned) => {
    ownsTabLock = owned;
    if (!owned) set({ secondTab: true });
  });
  try {
    const [appState, pxPerDay, planReview, availability, allDayBlocks, sidebarPanels, planMode, goalsMode, activeFocusSession, assistantAccelerator, storedTimeLevel, storedFocusLevel] = await Promise.all([
      loadState(), loadScale(), loadPlanReview(), loadAvailability(), loadAllDayBlocks(), loadSidebarPanels(), loadPlanMode(), loadGoalsMode(), loadActiveFocusSession(), loadAssistantAccelerator(), loadStoredTimeLevel(), loadStoredFocusLevel(),
    ]);

    // One-shot: give every day-committed step and task a real start minute.
    // Snapshot BEFORE, mark done only AFTER a successful persist — a failure
    // here leaves the flag unset so the next launch retries cleanly rather
    // than stranding half-rewritten data behind a "done" marker. Gated on
    // actually owning the tab lock — a non-owning tab must never write.
    let migrated = appState;
    let migrationToast: string | null = null;
    const ownsMigrationLock = await tabLock;
    if (ownsMigrationLock && !(await isSlotMigrationDone())) {
      await saveSlotMigrationSnapshot(appState.goals, appState.tasks);
      const result = migrateSlots(appState.goals, appState.tasks, allDayBlocks);
      migrated = { ...appState, goals: result.goals, tasks: result.tasks };
      await persist(migrated);
      // A failure to record the flag is non-fatal: the data above is already
      // correct and persisted, and migrateSlots is idempotent — the only
      // cost of losing this write is that the next launch re-runs the
      // (harmless) migration. Only `persist` failing should fail hydration.
      try {
        await markSlotMigrationDone();
      } catch {
        // swallowed intentionally — see comment above
      }
      migrationToast = describeMigration(result.report);
    }

    // One-shot: turn legacy milestones into real checkpoint leaves. Snapshot
    // BEFORE conversion, persist the whole state once, and only then record the
    // done flag. A retry after a crash is safe because the snapshot is write-once
    // and migrateCheckpoints removes the legacy field as it converts it.
    if (ownsMigrationLock && !(await isCheckpointMigrationDone())) {
      await saveCheckpointMigrationSnapshot(migrated.goals);
      const result = migrateCheckpoints(migrated.goals);
      migrated = { ...migrated, goals: result.goals };
      await persist(migrated);
      // The data is already correct if this settings write fails. Re-running the
      // idempotent migration on the next launch is harmless.
      try {
        await markCheckpointMigrationDone();
      } catch {
        // swallowed intentionally; see the comment above
      }
    }

    /*
     * Blocks last, and unconditionally.
     *
     * It follows `migrateSlots`, which repairs pre-slot data by writing the
     * very `plannedDay`/`plannedStartMin` pair this consumes — the other order
     * leaves the repair with nothing to read. No done-flag and no snapshot,
     * unlike the two above: this is a pure re-shaping that computes nothing and
     * is idempotent by construction (a row that already has `blocks` is left
     * alone), so running it every launch costs one walk and cannot double-apply.
     */
    const blocked = migrateWorkBlocks(migrated.goals, migrated.tasks);
    migrated = { ...migrated, goals: blocked.goals, tasks: blocked.tasks };

    state = {
      ...state,
      ...migrated,
      pxPerDay,
      planReview,
      availability,
      allDayBlocks,
      sidebarPanels,
      planMode,
      goalsMode,
      activeFocusSession,
      assistantAccelerator,
      timeLevel: timeLevelFor(storedTimeLevel, todayStr()),
      focusLevel: focusLevelFor(storedFocusLevel, todayStr()),
      hydration: 'ready',
      expanded: collectContainers(migrated.goals),
    };
    notify();
    ensureWeekRollover();
    if (migrationToast) actions.showToast(migrationToast);
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

/** A cheap toggle is reversible by repeating it; a structural delete is not. */
const UNDO_MS = 5000;
const DESTRUCTIVE_UNDO_MS = 15000;

/**
 * Undo-toast wording for a batch status change. Distinct register from
 * `STATUS_WORD` in `src/lib/status.ts`, which names a single state for a
 * button or an accessible label rather than phrasing a toast.
 */
const STATUS_LABEL: Record<StepStatus, (n: number) => string> = {
  todo: (n) => `Reset ${n} task${n === 1 ? '' : 's'}`,
  doing: (n) => `Marked ${n} task${n === 1 ? '' : 's'} in progress`,
  blocked: (n) => `Blocked ${n} task${n === 1 ? '' : 's'}`,
  done: (n) => `Completed ${n} task${n === 1 ? '' : 's'}`,
};

/**
 * Arm an undo and show its toast.
 *
 * The timer only hides the TOAST. The restore itself stays on `undoStack`, so
 * ⌘Z reaches it afterwards — five seconds is below the time it takes to notice
 * a misclick, let alone move the mouse to a toast.
 */
function scheduleUndo(
  label: string,
  restore: () => void,
  ttlMs = UNDO_MS,
  surgical = false,
): void {
  if (undoTimer) clearTimeout(undoTimer);
  undoStack.push({ label, restore, surgical });
  if (undoStack.length > UNDO_DEPTH) undoStack.shift();
  armedSurgical = surgical;
  set({ pendingUndo: { label } });
  undoTimer = setTimeout(() => {
    undoTimer = null;
    set({ pendingUndo: null });
  }, ttlMs);
}

// Snapshot state[key], arm its restoration, then persist `next` — the shared
// seam behind every undoable edit (deletes, date edits). Callers compute
// `next` from the pre-write state and hand it in; the snapshot below is taken
// before that value lands, so restore always replays the prior slice.
/**
 * An undoable write across SEVERAL slices.
 *
 * `withUndo` below snapshots exactly one, which was enough while every
 * undoable edit touched one table — and is why deleting a step deliberately
 * leaves its sessions behind: a restore that could only bring back one of the
 * two would return the step with its history silently gone.
 *
 * A replan is the first edit that genuinely spans two. It moves goal tasks and
 * loose tasks in the same breath, and undoing half of it would leave the user
 * looking at a week that is neither the old one nor the new one — the worst of
 * the three possible outcomes.
 */
function withUndoSlices(
  label: string,
  next: Partial<AppState>,
  ttlMs = UNDO_MS,
  uiPatch?: Partial<UIState>,
): void {
  const snapshot: Partial<AppState> = {};
  for (const key of Object.keys(next) as (keyof AppState)[]) {
    // `as never` only to satisfy the index write; the key and the value come
    // from the same `AppState`, so the pairing is sound.
    snapshot[key] = structuredClone(state[key]) as never;
  }
  scheduleUndo(label, () => withoutClearingUndo(() => {
    setAndPersist(snapshot);
  }), ttlMs);
  withoutClearingUndo(() => setAndPersist(next, uiPatch));
}

function withUndo<K extends keyof AppState>(
  label: string,
  key: K,
  next: AppState[K],
  ttlMs = UNDO_MS,
  // Same-tick UI change to fold into the write, exactly as `setAndPersist`
  // takes one — structural edits move `expanded` alongside the tree, and doing
  // that in a separate `set` would paint the tree twice per keystroke.
  // Deliberately NOT restored on undo: which containers are open is a view
  // preference, not data, and snapping it back would fight the user.
  uiPatch?: Partial<UIState>,
): void {
  withUndoSlices(label, { [key]: next } as Partial<AppState>, ttlMs, uiPatch);
}

/** Run a write that must not invalidate the armed undo history. */
function withoutClearingUndo(write: () => void): void {
  writingUndoableEdit = true;
  try {
    write();
  } finally {
    writingUndoableEdit = false;
  }
}


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

function nodeContains(ancestorId: string, descendantId: string): boolean {
  const ancestorPath = findNodePath(state.goals, ancestorId);
  const descendantPath = findNodePath(state.goals, descendantId);
  return ancestorPath !== null
    && descendantPath !== null
    && ancestorPath.length <= descendantPath.length
    && ancestorPath.every((id, index) => id === descendantPath[index]);
}

// Minutes-since-midnight for the live clock — the one place the store reads it.
function nowMoment(): Now {
  const d = new Date();
  return { date: todayStr(), minute: d.getHours() * 60 + d.getMinutes() };
}

// "1h 30m" / "45m" — used only in refusal toasts.
function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// The refusal toast must be actionable: naming the longest free stretch tells
// the user what WOULD fit, not just that this attempt failed. Deliberately the
// longest single stretch, not total free minutes — three scattered 15-minute
// gaps summing to 45m would read as "45m free" while nothing 45m long actually
// fits, and the longest stretch is the number that predicts whether a retry
// will succeed. A day with no free stretch at all gets its own wording rather
// than a misleading "longest free stretch is 0m".
//
// This is now a COLLISION refusal and only that. It used to fire mostly for
// the availability fence — "no free time left that day" about a Saturday that
// was simply switched off — and Job 1 removed that gate; every manual
// placement searches `WHOLE_DAY`. So the gaps it describes are the day's real
// gaps between real blocks, all 24 hours of them, and the second branch means
// the day is booked end to end rather than closed for business. The function
// keeps all three of its callers and fires far more rarely, which is the
// point: a refusal that only happens when the minutes genuinely are not there
// is a refusal worth reading.
function describeNoRoom(durationMin: number, gaps: { startMin: number; endMin: number }[]): string {
  const longest = gaps.reduce((max, g) => Math.max(max, g.endMin - g.startMin), 0);
  const need = `No ${formatDuration(durationMin)} gap left that day`;
  return longest > 0
    ? `${need} — longest free stretch is ${formatDuration(longest)}`
    : `${need} — that day is booked solid`;
}

// Same voice as describeNoRoom: a refused resize (clampResize returned null)
// means either the request itself was nonsense or the block's own slot no
// longer sits in any free gap — say so instead of leaving the drag to
// silently snap back with no explanation.
/** How far ahead "Replan" will look for a day that can take the work. */
const REPLAN_HORIZON_DAYS = 14;

function describeResizeRefused(title: string): string {
  return `Can't resize "${title}" — it no longer fits a free slot that day`;
}

/**
 * The undo label for an estimate edit. Names the OLD value when there was one,
 * because the thing being offered back is the number that was just overwritten
 * — "Changed X to 2h" tells you what happened, "was 45m" tells you what Undo
 * would give you back, and only the second is decision-relevant.
 *
 * Never ends in the word "Undo": the toast renders a real Undo button beside
 * this string (see undoLabels.test.ts).
 *
 * `before` is normalised before formatting because it is the RAW stored value,
 * and an imported file can carry a fractional one. `formatEstimateValue(90.4)`
 * renders "1h30.399999999999999".
 */
function describeEstimateChange(
  title: string,
  rawBefore: number | undefined,
  next: number | undefined,
): string {
  const before = normalizeEstimate(rawBefore);
  if (next === undefined) return `Cleared the estimate on "${title}" (was ${formatEstimateValue(before)})`;
  if (before === undefined) return `Estimated "${title}" at ${formatEstimateValue(next)}`;
  return `"${title}" is now ${formatEstimateValue(next)} (was ${formatEstimateValue(before)})`;
}

/**
 * The undo label for a demand edit. Names what changed, and what the value is
 * now — the same register `describeEstimateChange` uses. Clearing names the
 * thing that was just stripped, because that is what Undo would give back.
 */
function describeDemandChange(title: string, next: Demand | undefined): string {
  return next === undefined
    ? `Cleared focus needed on "${title}"`
    : `Set "${title}" to ${DEMAND_WORD[next]}`;
}

/**
 * Warn when a new estimate makes an already-placed item outgrow the gap it
 * sits in.
 *
 * The estimate is a fact about the WORK, so unlike a resize it is not clamped —
 * refusing to record "this pset is really six hours" because Tuesday is busy
 * would be the tool arguing with reality. But block height is
 * `durationOf(estimateMin)`, so raising it silently stretched the block over
 * its neighbours and past the end of the day's window: the one thing
 * `resolveSlot` gatekeeps every drop against, reachable from a field that gave
 * no feedback at all. `assignLanes` at least renders the collision side by
 * side, so the result is visible and fixable rather than lost — what was
 * missing was being told.
 */
/**
 * Which of an item's own sittings the slot search must ignore.
 *
 * Moving one bar vacates that bar. A REPLACE vacates all of them, because every
 * one is about to be removed — leave them in and the task collides with the
 * self it is in the middle of vacating, and a re-drop at 10:30 slides past its
 * own aim to 11:00. An ADD vacates nothing: the existing sittings stay, so the
 * new one has to find room beside them.
 */
function vacating(
  item: GoalNode | Task,
  opts: { blockId?: string; mode?: 'replace' | 'add' },
): string | ReadonlySet<string> | undefined {
  if (opts.blockId) return opts.blockId;
  if (opts.mode === 'add') return undefined;
  return new Set(blocksOf(item).map((b) => b.id));
}

/**
 * Where a manual placement of `item` on `date` would actually land.
 *
 * The ONE resolution. `scheduleNode`, `scheduleTask` and `previewPlacement`
 * all call it, which is what makes "the preview and the write agree about
 * where things land" true by construction rather than by a test keeping two
 * copies of the arithmetic in step — the same rule `proposeReplan` already
 * holds itself to, and the reason a replan uses the days and minutes the user
 * already saw instead of recomputing at apply time.
 *
 * `startMin === null` means the day is booked solid: every gap clear of
 * existing work is shorter than the block. It does NOT mean "outside your
 * working hours" — `WHOLE_DAY` and `NO_PAST_LIMIT` are the unfenced manual
 * region, and the two automatic replan paths deliberately do not come through
 * here (they pass `windowForDate` and the real clock, because they are the app
 * choosing an hour on your behalf).
 *
 * It raises no toast and writes nothing. The callers that need a refusal
 * message build it from `placed`, which is returned for exactly that — so the
 * refusal describes the same gaps the search was allowed to use.
 */
function resolvePlacement(
  item: GoalNode | Task,
  date: string,
  aimMin: number,
  opts: { blockId?: string; mode?: 'replace' | 'add' },
): { startMin: number | null; durationMin: number; placed: ReturnType<typeof spansOn> } {
  const moving = opts.blockId ? blocksOf(item).find((b) => b.id === opts.blockId) : undefined;
  // The sitting keeps its own length when it moves; a fresh one is sized from
  // the estimate, which is the only thing there is to go on.
  const durationMin = moving?.minutes ?? durationOf(item.estimateMin);
  const placed = spansOn(state.goals, state.tasks, date, vacating(item, opts));
  const startMin = resolveSlot({
    date,
    aimMin,
    durationMin,
    span: WHOLE_DAY,
    blocks: [], // slice 2 supplies real busy blocks
    placed,
    now: NO_PAST_LIMIT,
    allDayBlocks: state.allDayBlocks,
  });
  return { startMin, durationMin, placed };
}

/**
 * Where a drag currently in the air WOULD land — a dry run of the write.
 *
 * `store.ts` says of its scheduling actions that "views never call
 * resolveSlot", and that rule stands: this is the store answering, not the
 * view resolving. What it buys is the landing outline the week grid draws
 * under a dragged block, which has to name the minute the drop will actually
 * take rather than the minute the pointer is over. Those differ the moment the
 * day has anything on it — `resolveSlot` slides a block to the nearest gap
 * that fits — and an outline showing the raw aim would be a promise the drop
 * then breaks, which is the exact failure `proposeReplan` exists to avoid on
 * the other surface.
 *
 * It writes nothing, arms no undo and raises no toast. `null` covers three
 * cases the caller treats identically, because all three mean "do not draw an
 * outline": the item is gone, its project is frozen, or the day is booked
 * solid. The last one is already stated in words by the day heading's `full`
 * chip, so nothing is lost by the outline simply not appearing.
 *
 * `blockId` is the only option it takes, and deliberately: the sole caller is
 * `Plan.tsx`'s `handleDragMove`, and a drag is either moving an existing bar
 * (`blockId` set) or placing a rail row for the first time (absent). It used to
 * accept `mode` as well, "so an Option-drag previews against the right
 * occupancy" — but no Option-drag exists, no caller ever passed it, and the two
 * real `mode: 'add'` sites (`SchedulePopover`, `TaskPage`) are menu items that
 * write straight away and preview nothing. A parameter that can only ever be
 * `undefined` is a comment promising a feature, which is worse than no comment.
 * If an Option-drag is ever built, `vacating` already knows what an ADD means:
 * thread the mode through then, with a caller behind it.
 */
export function previewPlacement(
  target: { kind: 'step' | 'task'; id: string; goalId: string | null },
  date: string,
  aimMin: number,
  opts: { blockId?: string } = {},
): { startMin: number; durationMin: number } | null {
  if (!isValidLocalDate(date)) return null;

  let item: GoalNode | Task | null = null;
  if (target.kind === 'task') {
    item = state.tasks.find((t) => t.id === target.id) ?? null;
  } else if (target.goalId && isActiveGoal(target.goalId)) {
    const goal = state.goals.find((g) => g.id === target.goalId);
    const node = goal ? findNode(goal.nodes, target.id) : null;
    // A container is not schedulable, exactly as `scheduleNode` refuses one.
    item = node && !node.children ? node : null;
  }
  if (!item) return null;

  const { startMin, durationMin } = resolvePlacement(item, date, aimMin, opts);
  return startMin === null ? null : { startMin, durationMin };
}

/*
 * `warnIfEstimateOverflows` lived here.
 *
 * It fired when a new estimate made a block taller than its gap — which could
 * only happen while a block's height WAS the estimate. A sitting owns its own
 * `minutes` now, so changing an estimate moves nothing on the calendar and
 * there is nothing left to warn about. The discrepancy it was really groping
 * at — planned sittings adding up to more or less than the estimate — is
 * `planVsEstimate` in lib/blocks.ts, which states it rather than refusing it.
 */

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
  ifOwner(() => savePlanReview(review));
}

function isAssetImportFailure(error: unknown): error is AssetImportFailure {
  if (!(error instanceof Error)) return false;
  const candidate = error as Partial<AssetImportFailure>;
  return candidate.code === 'asset-import-failed' && candidate.imported !== undefined;
}

async function applyImportedBackup(appState: ImportedBackupState): Promise<void> {
  const planReview = await loadPlanReview();
  // An import is a generation boundary: nothing armed against the previous
  // dataset can mean anything against this one.
  undoStack = [];
  armedSurgical = false;
  if (undoTimer) {
    clearTimeout(undoTimer);
    undoTimer = null;
  }
  set({
    ...appState,
    planReview,
    expanded: collectContainers(appState.goals),
    pendingUndo: null,
    // The generation boundary applies to where the user is standing too.
    ...(state.view === 'project' ? { view: 'goals' as const } : {}),
    openGoalId: null,
    focusNodeId: null,
    openStepId: null,
  });
  ensureWeekRollover();
}

/**
 * The `Session` one log would write, and the title its label needs — or null
 * if the target refuses one.
 *
 * Extracted so `logSession` and `finishWork` cannot drift about what a logged
 * sitting IS. The second builds the same row inside a multi-slice write, and a
 * second copy of these preconditions would be a second opinion about whether a
 * frozen project can be logged against.
 */
function sessionFor(
  kind: 'step' | 'task',
  id: string,
  minutes: number,
  date: string,
  focus?: 'low',
): { session: Session; title: string } | null {
  const normalized = normalizeEstimate(minutes);
  if (normalized === undefined || !isValidLocalDate(date)) return null;

  let title: string;
  let goalId: string | null;
  if (kind === 'step') {
    // Frozen on a completed project, exactly as `setNodeEstimate` is. The
    // drawer already blocks the whole tree with `pointer-events-none`, so this
    // is unreachable from the UI today — but the two controls sit on the same
    // row and must not disagree about whether the project is editable the
    // moment any other surface calls in.
    if (!isActiveNode(id)) return null;
    const goal = goalOfNode(id);
    const node = goal ? findNode(goal.nodes, id) : null;
    // Containers hold no estimate (see `addChild`), so there is nothing for
    // logged time to be measured against.
    if (!goal || !node || node.children) return null;
    title = node.title;
    goalId = goal.id;
  } else {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return null;
    title = task.title;
    goalId = task.goalId;
  }

  return {
    title,
    session: {
      id: uid(),
      goalId,
      date,
      minutes: normalized,
      note: '',
      ...(kind === 'step' ? { nodeId: id } : { taskId: id }),
      ...(focus === undefined ? {} : { focus }),
    },
  };
}

export type FinishWorkResult =
  | { outcome: 'done'; label: string }
  | { outcome: 'needs-confirmation'; label: string }
  | { outcome: 'refused' };

// ---- actions ----
export const actions = {
  // Goals / nodes
  toggleLeaf(nodeId: string) {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (!node || node.children?.length) return;
    const wasDone = isDone(node);
    writeStatus(node, wasDone ? 'todo' : 'done', todayStr());
    if (wasDone) {
      // Unchecking lands on 'todo' unconditionally — a 'doing' step ticked
      // then unticked does not come back 'doing' — but nothing undo-worthy is
      // lost by that, and the row stays visible either way, so still no undo
      // toast.
      setAndPersist({ goals });
    } else {
      // Completion makes the row vanish from Next up, AND — for a 'blocked'
      // step — discards its `blockedOn` (applyStatus clears it on any
      // transition away from 'blocked'). Either reason alone would justify
      // the undo window.
      withUndo(`Completed "${node.title}"`, 'goals', goals);
    }
  },

  /**
   * Set one leaf's status. Containers are refused for the same reason they
   * carry no `done`: a container's state is derived from its children, and
   * storing one would be a second source of truth about the same work.
   */
  setNodeStatus(nodeId: string, next: StepStatus, blockedOn?: string): boolean {
    if (!isActiveNode(nodeId)) return false; // frozen on a completed project
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (!node || node.children?.length) return false;
    if (stepStatus(node) === next && (next !== 'blocked' || node.blockedOn === blockedOn?.trim())) {
      return false;
    }
    writeStatus(node, next, todayStr(), blockedOn);
    setAndPersist({ goals });
    return true;
  },

  /**
   * Set a whole selection in ONE write, arming ONE undo entry. A loop over
   * `setNodeStatus` would arm an entry per node and each write's sweep would
   * discard the ones before it, leaving an Undo button that restores only the
   * last step.
   *
   * A selected id can be a container — `completeNodes` expands one to its open
   * leaves via `openLeavesUnder` rather than matching ids directly, and this
   * has to do the same: matching ids straight against `walkLeaves` (which only
   * ever yields leaves) meant a selected container never matched anything, so
   * "Set status" silently no-opped on it while "Complete" on the identical
   * selection reached its children fine.
   *
   * Unlike `completeNodes`, this expands via `allLeavesUnder`, not
   * `openLeavesUnder` — a done leaf is a legitimate target here. The bulk
   * bar's "Set status…" select offers `'to do'` alongside the others, and a
   * done step moved back to `'todo'` is exactly what that option means;
   * filtering it out the way `completeNodes` correctly does made the option
   * a silent no-op on the one selection it would ever matter for.
   */
  setNodesStatus(ids: string[], next: StepStatus): boolean {
    const wanted = new Set(ids.filter((id) => isActiveNode(id)));
    if (wanted.size === 0) return false;
    const goals = cloneGoals(state.goals);
    const leafIds = new Set(allLeavesUnder(goals.flatMap((g) => g.nodes), wanted));
    const today = todayStr();
    let count = 0;
    for (const g of goals) {
      walkLeaves(g, (n) => {
        if (!leafIds.has(n.id) || stepStatus(n) === next) return;
        writeStatus(n, next, today);
        count++;
      });
    }
    if (count === 0) return false;
    withUndo(STATUS_LABEL[next](count), 'goals', goals);
    return true;
  },

  /**
   * The bulk form of `setNodeDemand`: ONE write and ONE undo entry for N
   * nodes. Never a loop over the single-node action — each call would arm its
   * own undo and each write's sweep would discard the one before it. Same
   * absence of a leaves-only guard as the single form: the bulk bar selects
   * containers too, and a container's demand is inherited by its subtree.
   */
  setNodesDemand(ids: string[], next: Demand | null): boolean {
    const wanted = new Set(ids.filter((id) => isActiveNode(id)));
    if (wanted.size === 0) return false;
    const goals = cloneGoals(state.goals);
    const value = next === null ? undefined : next;
    let count = 0;
    for (const g of goals) {
      const visit = (nodes: GoalNode[]): void => {
        for (const n of nodes) {
          if (wanted.has(n.id) && n.demand !== value) {
            if (value === undefined) delete n.demand;
            else n.demand = value;
            count++;
          }
          if (n.children?.length) visit(n.children);
        }
      };
      visit(g.nodes);
    }
    if (count === 0) return false;
    withUndo(
      value === undefined
        ? `Cleared focus needed on ${count} task${count === 1 ? '' : 's'}`
        : `Set ${count} task${count === 1 ? '' : 's'} to ${DEMAND_WORD[value]}`,
      'goals',
      goals,
    );
    return true;
  },

  toggleCheckpoint(nodeId: string): void {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const goals = state.goals.map((g) => ({ ...g, nodes: structuredClone(g.nodes) }));
    const node = findInAll(goals, nodeId);
    if (!node) return;
    const isLeaf = !node.children || node.children.length === 0;
    if (!isLeaf) return;
    if (node.checkpoint) delete node.checkpoint;
    else node.checkpoint = true;
    setAndPersist({ goals });
  },

  toggleExpand(nodeId: string) {
    const expanded = new Set(state.expanded);
    expanded.has(nodeId) ? expanded.delete(nodeId) : expanded.add(nodeId);
    set({ expanded });
  },

  addChild(nodeId: string, title = 'New item') {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    // `cloneGoals`, not a shallow `{ ...g, nodes: [...g.nodes] }`. That spread
    // copies the arrays and SHARES the node objects, so the `delete node.status`
    // below reached straight into live state — which meant the undo snapshot
    // taken a few lines later was of the already-mutated tree, and restoring it
    // left the new child in place. `setNodeEstimate` already clones properly.
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (!node) return;
    // Whether this add CONVERTS a leaf, and whether that leaf was carrying
    // anything worth mourning. Adding to an existing container, or to a bare
    // untouched leaf, loses nothing and must not interrupt with a toast — the
    // common case is typing out a list.
    // `children: []` is a LEAF — `removeNode` splices and leaves the array
    // behind, `GoalTree` renders such a node with a checkbox, and `toggleLeaf`
    // will happily tick it. An empty array is truthy, so `!node.children` alone
    // reported "not a conversion" for exactly the node this guard exists to
    // protect, while the `delete`s below ran anyway — losing the completion AND
    // the armed undo in one click. Same trap as `hasLeaf` in lib/plan.ts.
    const converts = !node.children || node.children.length === 0;
    const carried = converts
      && (isDone(node) || node.plannedWeek !== undefined
        || node.estimateMin !== undefined || node.checkpoint === true);
    if (!node.children) node.children = [];
    node.children.push({ id: uid(), title });
    delete node.status;
    delete node.blockedOn;
    delete node.doneAt;
    delete node.checkpoint;
    clearPlannedSlot(node); // a container can never carry a planned slot
    delete node.estimateMin;
    const expanded = new Set(state.expanded);
    expanded.add(nodeId);
    // "+ sub" is a hover affordance two pixels from ✕. On a step that was
    // finished and scheduled it silently un-completed it and pulled it off the
    // calendar, with no confirmation and — through bare `setAndPersist` — no
    // way back. Only that case arms an undo, and the label says what went.
    if (carried) {
      withUndo(`"${node.title}" became a group — its plan was cleared`, 'goals', goals, UNDO_MS, { expanded });
    } else {
      setAndPersist({ goals }, { expanded });
    }
  },

  // Batch add (the AI daily-subtasks helper): append several children to a node
  // at once, converting a leaf into a container. Same freeze + field-clearing as
  // addChild; blanks are dropped and an all-blank list is a no-op.
  /**
   * `titles` may carry estimates.
   *
   * A proposal arrives as "Read chapter 7 — 45m", and dropping the 45 on the
   * way in would mean the user re-typing every duration the proposal already
   * stated — on the surface whose whole point is that the breakdown arrives
   * priced. Plain strings still work; every existing caller passes them.
   */
  addChildren(nodeId: string, titles: ReadonlyArray<string | { title: string; estimateMin?: number }>) {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const clean = titles
      .map((t) => (typeof t === 'string' ? { title: t.trim() } : { ...t, title: t.title.trim() }))
      .filter((t) => t.title.length > 0);
    if (clean.length === 0) return;
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (!node) return;
    const converts = !node.children || node.children.length === 0;
    const carried = converts
      && (isDone(node) || node.plannedWeek !== undefined
        || node.estimateMin !== undefined || node.checkpoint === true);
    if (!node.children) node.children = [];
    for (const child of clean) {
      const estimate = normalizeEstimate(child.estimateMin);
      node.children.push({
        id: uid(),
        title: child.title,
        ...(estimate === undefined ? {} : { estimateMin: estimate }),
      });
    }
    delete node.status;
    delete node.blockedOn;
    delete node.doneAt;
    delete node.checkpoint;
    clearPlannedSlot(node); // a container can never carry a planned slot
    delete node.estimateMin;
    const expanded = new Set(state.expanded);
    expanded.add(nodeId);
    if (carried) {
      withUndo(`"${node.title}" became a group — its plan was cleared`, 'goals', goals, UNDO_MS, { expanded });
    } else {
      setAndPersist({ goals }, { expanded });
    }
  },

  /**
   * Add a step directly BELOW `nodeId` and open it for typing.
   *
   * Enter in the tree used to call `addChild(parentId)`, which pushes onto the
   * end of the parent's list — so on the first of ten psets the new row landed
   * tenth, unfocused and titled "New item", and the real sequence for adding a
   * sibling became: Enter, scroll to the bottom, find it, double-click, type.
   * At root level `parentId` is null, so Enter did nothing whatsoever, and a
   * fresh project's steps are ALL root-level.
   */
  insertSiblingAfter(nodeId: string, title = 'New task') {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const result = treeInsertSiblingAfter(state.goals, nodeId, title);
    if (!result) return;
    setAndPersist({ goals: result.goals }, { newNodeId: result.newId });
  },

  /** The new row calls this as it mounts, so the flag fires exactly once. */
  clearNewNode() {
    if (state.newNodeId !== null) set({ newNodeId: null });
  },

  /**
   * A task at the end of a goal's root list.
   *
   * An EMPTY title is the "open it ready to type" case — the header's `+ Add`
   * on a goal page, which has no field of its own to type into. It arms
   * `newNodeId` so the row mounts straight into its editor, exactly as ⌘Enter
   * does through `insertSiblingAfter`. A titled call is the tab's own add
   * field, which has already collected the words and wants no editor.
   */
  addRootNode(goalId: string, title: string) {
    if (!isActiveGoal(goalId)) return; // frozen on a completed project
    const id = uid();
    const goals = state.goals.map((g) =>
      g.id === goalId
        ? { ...g, nodes: [...g.nodes, { id, title }] }
        : g
    );
    setAndPersist({ goals }, title === '' ? { newNodeId: id } : undefined);
  },

  /**
   * Several root tasks at once — how a template lands.
   *
   * One write rather than a loop over `addRootNode`: each of those persists,
   * so accepting a five-area template would be five writes and five renders of
   * a growing tree. Not undoable, deliberately, and for the same reason
   * `addRootNode` is not: adding is the one edit that discards nothing, and
   * every row it creates is a click away from being deleted.
   */
  addRootNodes(goalId: string, titles: string[]) {
    if (!isActiveGoal(goalId)) return;
    const clean = titles.map((t) => t.trim()).filter(Boolean);
    if (clean.length === 0) return;
    const goals = state.goals.map((g) =>
      g.id === goalId
        ? { ...g, nodes: [...g.nodes, ...clean.map((title) => ({ id: uid(), title }))] }
        : g
    );
    setAndPersist({ goals });
  },

  renameNode(nodeId: string, title: string) {
    // Deep clone for the same reason as `addChild`: the shallow spread shared
    // every node object with live state, so this wrote the new title into the
    // current tree before `setAndPersist` was ever called.
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (node) node.title = title;
    setAndPersist({ goals });
  },

  /**
   * Set or clear a leaf's estimate.
   *
   * Undoable, because clearing one destroys a number the user typed and
   * overwriting one destroys the number that was there before — and this is now
   * reachable from the drawer's step tree as well as the rail, i.e. from the
   * surface where people are typing fast and mis-clicking. A no-op change arms
   * nothing: re-picking the preset a step already carries must not burn the undo
   * slot that is holding a delete.
   */
  setNodeEstimate(nodeId: string, minutes: number | null): void {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const goals = state.goals.map((g) => ({ ...g, nodes: structuredClone(g.nodes) }));
    const node = findInAll(goals, nodeId);
    if (!node || node.children) return; // leaves only
    const before = node.estimateMin;
    const next = minutes === null ? undefined : normalizeEstimate(minutes);
    if (before === next) return;
    if (next === undefined) delete node.estimateMin;
    else node.estimateMin = next;
    withUndo(describeEstimateChange(node.title, before, next), 'goals', goals);
  },

  setTaskEstimate(taskId: string, minutes: number | null): void {
    const next = minutes === null ? undefined : normalizeEstimate(minutes);
    const target = state.tasks.find((t) => t.id === taskId);
    if (!target || target.estimateMin === next) return;
    const tasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const copy = { ...t };
      if (next === undefined) delete copy.estimateMin;
      else copy.estimateMin = next;
      return copy;
    });
    withUndo(describeEstimateChange(target.title, target.estimateMin, next), 'tasks', tasks);
  },

  /**
   * A node's own demand. Containers included — a container's value is what the
   * whole subtree inherits, and that is the gesture that keeps this from being
   * a field filled in by hand for every task.
   *
   * Unlike `setNodeEstimate` there is no leaves-only guard, and that absence is
   * the point.
   */
  setNodeDemand(nodeId: string, next: Demand | null): void {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const goals = state.goals.map((g) => ({ ...g, nodes: structuredClone(g.nodes) }));
    const node = findInAll(goals, nodeId);
    if (!node) return;
    const before = node.demand;
    const value = next === null ? undefined : next;
    if (before === value) return;
    if (value === undefined) delete node.demand;
    else node.demand = value;
    withUndo(describeDemandChange(node.title, value), 'goals', goals);
  },

  setGoalDemand(goalId: string, next: Demand | null): void {
    const target = state.goals.find((g) => g.id === goalId);
    const value = next === null ? undefined : next;
    if (!target || target.demand === value) return;
    const goals = state.goals.map((g) => {
      if (g.id !== goalId) return g;
      const copy = { ...g };
      if (value === undefined) delete copy.demand;
      else copy.demand = value;
      return copy;
    });
    withUndo(describeDemandChange(target.title, value), 'goals', goals);
  },

  setTaskDemand(taskId: string, next: Demand | null): void {
    const target = state.tasks.find((t) => t.id === taskId);
    const value = next === null ? undefined : next;
    if (!target || target.demand === value) return;
    const tasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const copy = { ...t };
      if (value === undefined) delete copy.demand;
      else copy.demand = value;
      return copy;
    });
    withUndo(describeDemandChange(target.title, value), 'tasks', tasks);
  },

  removeNode(nodeId: string) {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    flushPendingNote();
    const node = findInAll(state.goals, nodeId);
    const title = node?.title ?? 'item';
    const clearsOpenStep = state.openStepId !== null && nodeContains(nodeId, state.openStepId);
    const goals = state.goals.map((g) => {
      const nodes = structuredClone(g.nodes);
      removeNode(nodes, nodeId);
      return { ...g, nodes };
    });
    withUndo(
      `Deleted "${title}"`,
      'goals',
      goals,
      DESTRUCTIVE_UNDO_MS,
      clearsOpenStep ? { openStepId: null } : undefined,
    );
  },

  /**
   * Delete a whole selection of steps in ONE undoable write.
   *
   * Looping `removeNode` would be wrong twice over: each call arms its own undo
   * entry, so the toast would name only the last step and ⌘Z would walk back
   * one row at a time through a gesture the user performed once — and each call
   * is a separate `setAndPersist`, whose sweep would discard the entries armed
   * before it. A batch is one action.
   *
   * `topLevelSelection` is what makes nesting safe: selecting a group AND
   * something inside it asks for one removal, not two, and the second splice
   * would be hunting for a node that no longer exists. `selectionRemovalCount`
   * is read BEFORE the write so the toast names what actually went — a subtree
   * count, not a row count.
   */
  removeNodes(ids: string[]): boolean {
    const wanted = new Set(ids.filter((id) => isActiveNode(id)));
    if (wanted.size === 0) return false;
    flushPendingNote();
    const goals = cloneGoals(state.goals);
    const roots = goals.flatMap((g) => g.nodes);
    const targets = topLevelSelection(roots, wanted);
    if (targets.length === 0) return false;
    const removed = selectionRemovalCount(roots, wanted);
    const openStepId = state.openStepId;
    const clearsOpenStep = openStepId !== null
      && targets.some((id) => nodeContains(id, openStepId));
    for (const g of goals) for (const id of targets) removeNode(g.nodes, id);
    withUndo(
      `Deleted ${removed} task${removed === 1 ? '' : 's'}`,
      'goals',
      goals,
      DESTRUCTIVE_UNDO_MS,
      clearsOpenStep ? { openStepId: null } : undefined,
    );
    return true;
  },

  /**
   * Tick off every open leaf at or under a selection, in ONE undoable write.
   *
   * Leaves, not the selected rows: a container carries no `done` of its own
   * (`pct.ts` derives it), so "complete this group" can only mean the open work
   * inside it. Already-finished leaves are skipped rather than re-stamped, so a
   * batch never rewrites a `doneAt`.
   */
  completeNodes(ids: string[]): boolean {
    const wanted = new Set(ids.filter((id) => isActiveNode(id)));
    if (wanted.size === 0) return false;
    const goals = cloneGoals(state.goals);
    const leafIds = new Set(openLeavesUnder(goals.flatMap((g) => g.nodes), wanted));
    if (leafIds.size === 0) return false;
    const today = todayStr();
    for (const g of goals) {
      walkLeaves(g, (n) => {
        if (!leafIds.has(n.id)) return;
        writeStatus(n, 'done', today);
      });
    }
    const count = leafIds.size;
    withUndo(`Completed ${count} task${count === 1 ? '' : 's'}`, 'goals', goals);
    return true;
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

  // Convenience wrapper (tests, callers with only a title): a bare goal in the
  // highest column.
  addGoal(title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    actions.addGoals([{ id: uid(), title: trimmed, nodes: [], column: 0, datesConfirmed: true }]);
  },

  /**
   * Create a life. Returns false when refused, so a caller never reports
   * success on a refusal — the same contract the bulk edits already keep.
   */
  addLife(title: string): boolean {
    const clean = title.trim();
    if (clean === '') return false;
    if (!canAddLife(state.lives)) return false;
    const life: Life = { id: uid(), title: clean, order: nextLifeOrder(state.lives) };
    setAndPersist({ lives: [...state.lives, life] });
    return true;
  },

  renameLife(id: string, title: string) {
    const clean = title.trim();
    if (clean === '') return;
    if (!state.lives.some((l) => l.id === id)) return;
    setAndPersist({ lives: state.lives.map((l) => (l.id === id ? { ...l, title: clean } : l)) });
  },

  /**
   * Delete a life WITHOUT touching the goals in it.
   *
   * Their `lifeId` is left pointing at the deleted row; `lifeOf` reads that
   * as unassigned. Undo then restores the life and every goal is back in
   * it, because no goal was ever rewritten. The snapshot still spans both
   * slices so the guarantee does not depend on a reader proving `goals` was
   * untouched.
   */
  removeLife(id: string) {
    const life = state.lives.find((l) => l.id === id);
    if (!life) return;
    withUndoSlices(
      `Deleted "${life.title}"`,
      { lives: state.lives.filter((l) => l.id !== id), goals: state.goals },
      DESTRUCTIVE_UNDO_MS,
    );
  },

  setGoalLife(goalId: string, lifeId: string | null) {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal) return;
    if (lifeId !== null && !state.lives.some((l) => l.id === lifeId)) return;
    setAndPersist({
      goals: state.goals.map((g) => {
        if (g.id !== goalId) return g;
        if (lifeId === null) {
          // Absent, never `undefined` left in place — the field's absence IS
          // "unassigned", and a key holding undefined survives structuredClone
          // into the undo snapshot as a difference nobody asked for.
          const { lifeId: _drop, ...rest } = g;
          return rest;
        }
        return { ...g, lifeId };
      }),
    });
  },

  // Priority board: commit an entire column layout. `columns[c]` is the ordered
  // list of goal ids in column c (0 = leftmost/highest). Rebuilds the goals
  // array in column-major order and stamps each goal's `column`.
  setGoalBoard(columns: string[][]) {
    // Weave hidden projects — completed, or outside the active life scope — back
    // into their column at the position they held, before the rebuild — so a
    // drag never appends them to the end and loses their place (spec §2.5).
    const woven = weaveHidden(state.goals, columns);
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
    const moved = state.goals.find((g) => g.id === goalId);
    if (!moved) return;
    // An archived project IS movable, deliberately: it keeps a column so that
    // reopening restores its place (spec §2.5). The rebuild below skips
    // archived projects when collecting `cols` and then pushes this one in
    // anyway, which looks like a duplicate — `setGoalBoard`'s `seen` dedupe and
    // `weaveHidden` are what make that correct rather than accidental.
    const target = Math.min(Math.max(column, 0), HORIZON_COUNT - 1);
    // Choosing the horizon it is already in is not a move. Without this it
    // toasted "Moved X to Now" and armed a whole-goals-slice undo for a write
    // that changed nothing — and that undo then displaced whatever real one was
    // armed before it.
    if (Math.min(Math.max(moved.column ?? 0, 0), HORIZON_COUNT - 1) === target) return;
    const cols: string[][] = Array.from({ length: HORIZON_COUNT }, () => []);
    for (const g of state.goals) {
      if (g.completedAt || g.id === goalId) continue;
      const c = Math.min(Math.max(g.column ?? 0, 0), HORIZON_COUNT - 1);
      cols[c].push(g.id);
    }
    cols[target].push(goalId);
    const before = structuredClone(state.goals);
    actions.setGoalBoard(cols);
    /*
     * Say what happened, and offer it back.
     *
     * This was the one board action that spoke at all: adding, importing and
     * completing a project each raise a toast, and a horizon move — reached
     * from a ⋯ menu, so entirely blind — raised nothing and had no undo. Below
     * 920px only one horizon renders at a time and this does not change which,
     * so the card simply left the screen with no acknowledgement at all. That
     * narrow layout is also where drag is unavailable, making the ⋯ menu the
     * ONLY route between horizons.
     */
    scheduleUndo(
      `Moved "${moved.title}" to ${HORIZON_LABELS[target]}`,
      () => withoutClearingUndo(() => setAndPersist({ goals: before })),
    );
  },

  /**
   * Move a project up or down within its own horizon — the keyboard equivalent
   * of dragging it past a neighbour.
   *
   * Height within a column IS the rank, so this is a real priority edit, and
   * until now the only way to make one was a pointer drag: the ⋯ menu offers
   * horizons but no ordering, so ranking was mouse-only.
   *
   * Archived projects are left out of `cols` — they are not on the board, and
   * `weaveHidden` restores them around whatever the live order becomes. So
   * "the neighbour" means the next LIVE project, which is the one on screen.
   */
  moveGoalRank(goalId: string, delta: number): boolean {
    const moved = state.goals.find((g) => g.id === goalId);
    if (!moved || moved.completedAt || delta === 0) return false;
    const col = Math.min(Math.max(moved.column ?? 0, 0), HORIZON_COUNT - 1);
    const cols: string[][] = Array.from({ length: HORIZON_COUNT }, () => []);
    for (const g of state.goals) {
      if (g.completedAt) continue;
      cols[Math.min(Math.max(g.column ?? 0, 0), HORIZON_COUNT - 1)].push(g.id);
    }
    const list = cols[col];
    /*
     * Neighbours are what the reader can SEE.
     *
     * This used to step through every active goal, so under a life scope
     * `Alt+↑` swapped the card with one that is not on screen — the card
     * visibly did not move, and the toast said it did. `rankMoveTarget`
     * returns the full-list index of the neighbouring VISIBLE card, so every
     * hidden goal keeps its place and the move is exactly one slot.
     */
    const scope = resolveScope(state.activeLifeId, state.lives);
    const visibleIds = new Set(goalsInScope(state.goals, scope, state.lives).map((g) => g.id));
    const from = list.indexOf(goalId);
    const to = rankMoveTarget(list, visibleIds, goalId, delta);
    // Already against the end it is being pushed towards: silent, so holding
    // the chord down cannot spray toasts or arm undo entries for nothing.
    // Reported as `false` rather than merely being quiet, because the caller
    // rings the card — highlight, scroll, focus — and a ring for a write that
    // never happened is the bug `moveToHorizon` guards against above.
    if (from === -1 || to === null) return false;
    list.splice(to, 0, ...list.splice(from, 1));
    const before = structuredClone(state.goals);
    actions.setGoalBoard(cols);
    scheduleUndo(
      `Moved "${moved.title}" ${delta < 0 ? 'up' : 'down'} in ${HORIZON_LABELS[col]}`,
      () => withoutClearingUndo(() => setAndPersist({ goals: before })),
    );
    return true;
  },

  renameGoal(goalId: string, title: string) {
    const goals = state.goals.map((g) => (g.id === goalId ? { ...g, title } : g));
    setAndPersist({ goals });
  },

  setGoalNotes(goalId: string, notes: string) {
    if (!state.goals.some((g) => g.id === goalId)) return;
    const goals = state.goals.map((g) => (g.id === goalId ? { ...g, notes } : g));
    setAndPersist({ goals });
  },

  setNodeNotes(nodeId: string, markdown: string): void {
    const goals = cloneGoals(state.goals);
    const node = findInAll(goals, nodeId);
    if (!node) return;
    if (markdown === '') delete node.notes;
    else node.notes = markdown;
    setAndPersist({ goals });
  },

  async addAsset(file: Blob, encoder: AssetEncoder = encodeAssetImage): Promise<string> {
    // Do not decode or allocate image data in a tab that cannot write it.
    if (!ownsTabLock) {
      return ownerAssetWrite(async () => {
        throw new Error('Phase is open in another tab.');
      });
    }

    // Encoding is separate from the DB write so an unavailable canvas is not
    // mistaken for a failed persistence operation. Tests can inject this
    // browser boundary without pretending jsdom has a working canvas.
    const encoded = await encoder(file);
    const id = `a_${uid()}`;
    const asset: Asset = {
      id,
      mime: 'image/webp',
      bytes: encoded.bytes,
      width: encoded.width,
      height: encoded.height,
      createdAt: todayStr(),
    };

    return ownerAssetWrite(async () => {
      try {
        await putAsset(asset);
      } catch (error) {
        actions.showToast('Saving failed — export a backup now');
        if (!state.persistFailed) set({ persistFailed: true });
        throw error;
      }
      return id;
    });
  },

  async reclaimSpace(): Promise<{ count: number; bytes: number } | { deferred: true }> {
    // Reclamation is deliberately explicit and never part of note edits. An
    // orphaned asset is safe to keep, while deleting it eagerly would let undo
    // restore a note that points at a missing blob.
    if (!ownsTabLock) return { count: 0, bytes: 0 };
    return ownerAssetWrite(async () => {
      if (undoStack.length > 0 || state.pendingUndo !== null) return { deferred: true };
      const referenced = new Set<string>();
      const collect = (markdown: string | undefined) => {
        if (markdown !== undefined) {
          assetIdsInMarkdown(markdown).forEach((id) => referenced.add(id));
        }
      };
      const visit = (nodes: Goal['nodes']) => {
        for (const node of nodes) {
          collect(node.notes);
          if (node.children?.length) visit(node.children);
        }
      };

      for (const goal of state.goals) {
        collect(goal.notes);
        visit(goal.nodes);
      }

      const ids = await allAssetIds();
      const orphanIds = ids.filter((id) => !referenced.has(id));
      let bytes = 0;
      for (const id of orphanIds) {
        const asset = await getAsset(id);
        if (asset) bytes += asset.bytes.size;
      }

      try {
        await deleteAssets(orphanIds);
      } catch (error) {
        actions.showToast('Saving failed — export a backup now');
        if (!state.persistFailed) set({ persistFailed: true });
        throw error;
      }
      return { count: orphanIds.length, bytes };
    });
  },

  removeGoal(goalId: string) {
    flushPendingNote();
    const goal = state.goals.find((g) => g.id === goalId);
    const title = goal?.title ?? 'goal';
    const goals = state.goals.filter((g) => g.id !== goalId);
    // Name the cost. Deleting a project takes two clicks and can take a dozen
    // steps, checkpoints and a week of scheduling with it; "Deleted X" alone
    // gave no sense of how much was riding on the Undo button.
    const steps = goal ? leafCount(goal.nodes).total : 0;
    const label = steps > 0
      ? `Deleted "${title}" and its ${steps} task${steps === 1 ? '' : 's'}`
      : `Deleted "${title}"`;
    withUndo(label, 'goals', goals, DESTRUCTIVE_UNDO_MS);
  },

  // Completion lifecycle — explicit and reversible (spec §2.5). Completing removes
  // the project from the active board, so it is undo-aware; reopen is its exact
  // inverse and needs no undo. Both preserve the project's horizon and position.
  completeGoal(goalId: string): void {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal || goal.completedAt) return;
    const goals = state.goals.map((g) => (g.id === goalId ? { ...g, completedAt: todayStr() } : g));
    withUndo(`Completed "${goal.title}"`, 'goals', goals);
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
    const today = todayStr();
    if (!isValidLocalDate(date) || date > today) return;
    const target = state.habits.find((h) => h.id === habitId);
    if (!target || (target.createdAt && date < target.createdAt)) return;
    const cleared = target.checkins.includes(date);
    const habits = state.habits.map((h) => {
      if (h.id !== habitId) return h;
      const i = h.checkins.indexOf(date);
      const checkins =
        i >= 0
          ? [...h.checkins.slice(0, i), ...h.checkins.slice(i + 1)]
          : [...h.checkins, date];
      return { ...h, checkins };
    });
    // Today's toggle is visible on the row and instantly reversible, so it stays
    // silent. Editing a PAST day rewrites the record streaks are computed from
    // with nothing on screen to show for it — that needs an undo.
    if (date === today) {
      setAndPersist({ habits });
      return;
    }
    withUndo(
      `${cleared ? 'Cleared' : 'Marked'} "${target.title}" on ${fmtD(date)}`,
      'habits',
      habits,
    );
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
    withUndo(
      `Deleted "${title}"`,
      'habits',
      state.habits.filter((h) => h.id !== habitId),
      DESTRUCTIVE_UNDO_MS,
    );
  },

  // Tasks
  /**
   * Record time actually spent on a step or a task.
   *
   * The producer `Session` never had. The type, the table, the backup round
   * trip and `loggedTimeForWeek` all shipped and were tested, and the week
   * recap renders "You logged N minutes across M sessions" behind a
   * `logged.sessions > 0` gate — which, with nothing anywhere creating a
   * session, could never open. That branch was unreachable code guarded by a
   * passing test.
   *
   * Append-only: a second sitting on the same step is a second session, not an
   * overwrite, so `loggedForNode` sums them. Time is never INFERRED from a
   * scheduled block — a block is what you set aside, not what you spent, and
   * recording the former as the latter would invent exactly the kind of
   * authoritative-looking figure `capacityParts` refuses to produce.
   *
   * Returns whether it wrote, so callers cannot report success on a refusal.
   */
  logSession(
    kind: 'step' | 'task',
    id: string,
    minutes: number,
    date = todayStr(),
    focus?: 'low',
  ): boolean {
    const built = sessionFor(kind, id, minutes, date, focus);
    if (!built) return false;
    withUndo(
      `Logged ${formatEstimateValue(built.session.minutes)} on "${built.title}"`,
      'sessions',
      [...state.sessions, built.session],
    );
    return true;
  },

  /**
   * Discard every session recorded against one item.
   *
   * The symmetric partner to clearing an estimate: a mis-logged entry is
   * otherwise permanent, since sessions are append-only and carry no edit
   * route. Undoable like everything else that destroys a number the user typed.
   */
  clearSessionsFor(kind: 'step' | 'task', id: string): boolean {
    const key = kind === 'step' ? 'nodeId' : 'taskId';
    const remaining = state.sessions.filter((s) => s[key] !== id);
    const dropped = state.sessions.length - remaining.length;
    if (dropped === 0) return false;
    const title = kind === 'step'
      ? findInAll(state.goals, id)?.title
      : state.tasks.find((t) => t.id === id)?.title;
    // Names the item and the cost, as every other destructive label here does:
    // once the control collapses, the ledger this discards is not visible
    // anywhere, so the toast is the only chance to say what was thrown away.
    withUndo(
      `Cleared ${dropped} time entr${dropped === 1 ? 'y' : 'ies'} on "${title ?? 'that item'}"`,
      'sessions',
      remaining,
    );
    return true;
  },

  // ---- focus sessions ----

  /**
   * Begin a focus draft on one piece of work. Refused while another draft is
   * live — switching tasks is complete-then-start, composed by the caller, so
   * an unfinished session can never be silently overwritten — and refused for
   * a ref that resolves to nothing, because a phantom cannot be worked on.
   */
  startFocus(ref: WorkRef, expected: ExpectedTime, nowMs = Date.now()): boolean {
    if (state.activeFocusSession) return false;
    let title: string;
    let goalTitle: string | undefined;
    if (ref.kind === 'step') {
      const goal = state.goals.find((g) => g.id === ref.goalId);
      const node = goal ? findNode(goal.nodes, ref.id) : null;
      if (!goal || !node || node.children?.length) return false;
      title = node.title;
      goalTitle = goal.title;
    } else {
      const task = state.tasks.find((t) => t.id === ref.id);
      if (!task) return false;
      title = task.title;
      goalTitle = task.goalId
        ? state.goals.find((g) => g.id === task.goalId)?.title
        : undefined;
    }
    setFocusDraft(startFocusSession({
      ref, title, ...(goalTitle === undefined ? {} : { goalTitle }),
      expected, focusLevel: state.timeLevel, nowMs,
    }));
    return true;
  },

  pauseFocus(nowMs = Date.now()): boolean {
    const draft = state.activeFocusSession;
    if (!draft || draft.phase !== 'active') return false;
    setFocusDraft(pauseFocusSession(draft, nowMs));
    return true;
  },

  resumeFocus(nowMs = Date.now()): boolean {
    const draft = state.activeFocusSession;
    if (!draft || draft.phase !== 'break') return false;
    setFocusDraft(resumeFocusSession(draft, nowMs));
    return true;
  },

  /**
   * Complete the running session. A normal-length sitting logs through the
   * existing `logSession` — same undo contract, same Session shape — and the
   * draft is cleared only when that write was accepted. An implausibly long
   * one parks in `confirming` instead: pressing Complete is confirmation
   * enough for an ordinary sitting, but a session that "ran" nine hours is
   * more likely a laptop lid than a marathon, and history must not be
   * poisoned on that guess.
   */
  completeFocus(nowMs = Date.now()): 'logged' | 'needs-confirmation' | 'refused' {
    const draft = state.activeFocusSession;
    if (!draft || draft.phase === 'confirming') return 'refused';
    const finish = finishFocusSession(draft, nowMs);
    if (finish.kind === 'needs-confirmation') {
      setFocusDraft(finish.session);
      return 'needs-confirmation';
    }
    // The TIME level, never the display one: a session run inside a declared
    // half-hour is not evidence the work takes half an hour, while how many
    // options you were shown cannot affect how long you worked.
    if (!actions.logSession(
      draft.ref.kind, draft.ref.id, finish.minutes, todayStr(),
      draft.focusLevel === 'low' ? 'low' : undefined,
    )) return 'refused';
    setFocusDraft(null);
    return 'logged';
  },

  /**
   * Resolve a `confirming` draft: a positive duration logs exactly that many
   * minutes; null means "didn't happen" and logs nothing. Either way the
   * draft is spent.
   */
  confirmFocus(minutes: number | null): boolean {
    const draft = state.activeFocusSession;
    if (!draft || draft.phase !== 'confirming') return false;
    if (minutes === null) {
      setFocusDraft(null);
      return true;
    }
    if (!Number.isFinite(minutes) || minutes <= 0) return false;
    // The TIME level, never the display one: a session run inside a declared
    // half-hour is not evidence the work takes half an hour, while how many
    // options you were shown cannot affect how long you worked.
    if (!actions.logSession(
      draft.ref.kind, draft.ref.id, minutes, todayStr(),
      draft.focusLevel === 'low' ? 'low' : undefined,
    )) return false;
    setFocusDraft(null);
    return true;
  },

  /**
   * Mark one piece of work finished, settling any sitting running on it.
   *
   * `completeFocus` ends a SITTING; this ends the WORK. When both happen at
   * once they are ONE write across two slices: two sequential `withUndo` calls
   * would let the second's sweep discard the first, so the toast would read
   * `Completed "X"` and restore `goals` alone — un-ticking the task while
   * keeping its logged minutes, a half-undo that leaves the data in a state
   * that is neither the old one nor the new one.
   *
   * Returns the label it armed, the way `undoLastDelete` returns the one it
   * restored: the shelf's notice and the undo toast then cannot disagree about
   * what just happened.
   */
  finishWork(ref: WorkRef, nowMs = Date.now()): FinishWorkResult {
    const today = todayStr();

    // The completion slice, built the way `toggleLeaf`/`toggleTask` build it —
    // deliberately not by CALLING them, because each arms its own `withUndo`
    // and the second would sweep the first.
    let completed: Partial<AppState>;
    let title: string;
    if (ref.kind === 'step') {
      if (!isActiveNode(ref.id)) return { outcome: 'refused' };
      const goals = cloneGoals(state.goals);
      const node = findInAll(goals, ref.id);
      if (!node || node.children?.length || isDone(node)) return { outcome: 'refused' };
      writeStatus(node, 'done', today);
      title = node.title;
      completed = { goals };
    } else {
      const task = state.tasks.find((t) => t.id === ref.id);
      if (!task || task.done) return { outcome: 'refused' };
      title = task.title;
      completed = {
        tasks: state.tasks.map((t) => (
          t.id === ref.id ? { ...t, done: true, doneAt: today } : t
        )),
      };
    }

    const draft = state.activeFocusSession;
    // A draft about OTHER work is real occupancy this must not disturb, and a
    // `confirming` one is already a question awaiting its own answer.
    if (
      !draft
      || draft.phase === 'confirming'
      || draft.ref.kind !== ref.kind
      || draft.ref.id !== ref.id
    ) {
      const label = `Completed "${title}"`;
      withUndoSlices(label, completed);
      return { outcome: 'done', label };
    }

    const finish = finishFocusSession(draft, nowMs);
    if (finish.kind === 'needs-confirmation') {
      // One slice only, so undo stays whole. The minutes park in `confirming`
      // for the question the shelf already knows how to ask.
      const label = `Completed "${title}"`;
      withUndoSlices(label, completed);
      setFocusDraft(finish.session);
      return { outcome: 'needs-confirmation', label };
    }

    // The TIME level, never the display one — the same choice `completeFocus`
    // makes, for the same reason.
    const built = sessionFor(
      ref.kind, ref.id, finish.minutes, today,
      draft.focusLevel === 'low' ? 'low' : undefined,
    );
    const label = built
      ? `Completed "${title}" · logged ${formatEstimateValue(built.session.minutes)}`
      : `Completed "${title}"`;
    withUndoSlices(
      label,
      built ? { ...completed, sessions: [...state.sessions, built.session] } : completed,
    );
    setFocusDraft(null);
    return { outcome: 'done', label };
  },

  discardFocus(): boolean {
    const draft = state.activeFocusSession;
    if (!draft) return false;
    setFocusDraft(discardFocusSession(draft));
    return true;
  },

  /**
   * Change the assistant's global shortcut preference. Validation is at the
   * boundary — a chord that cannot anchor (no real modifier) is refused, not
   * stored — and the write goes through the owner gate like every settings
   * write. Actually registering it with the OS is Electron's job; the status
   * that comes back lands in `setAssistantShortcutStatus`.
   */
  setAssistantAccelerator(next: string): boolean {
    if (!isValidAccelerator(next)) return false;
    set({ assistantAccelerator: next });
    ifOwner(() => saveAssistantAccelerator(next));
    return true;
  },

  /** Ephemeral registration status from the desktop shell. Never persisted. */
  setAssistantShortcutStatus(status: ShortcutStatus | null): void {
    set({ assistantShortcut: status });
  },

  /**
   * How long the user last said they had. Reset daily by `timeLevelFor`, so
   * nobody has to remember to put the dial back.
   */
  setTimeLevel(next: TimeLevel): boolean {
    if (!isTimeLevel(next)) return false;
    set({ timeLevel: next });
    ifOwner(() => saveStoredTimeLevel({ level: next, date: todayStr() }));
    return true;
  },

  setFocusLevel(next: FocusLevel): boolean {
    if (!isFocusLevel(next)) return false;
    set({ focusLevel: next });
    ifOwner(() => saveStoredFocusLevel({ level: next, date: todayStr() }));
    return true;
  },

  /**
   * Capture a loose task.
   *
   * `date` defaults to NULL, not today. It used to default to today because the
   * only caller was a modal whose date pills could not express "not yet" —
   * so every thought captured on a Tuesday silently became a Tuesday
   * commitment, and the day filled with work nobody had decided to do.
   * `Task.date` has always been optional and the backlog rail lists a dateless
   * task under its goal, so an unscheduled capture is fully reachable.
   *
   * An invalid date string is refused rather than swapped for today: a caller
   * that miscomputed a date must not have it quietly corrected into a
   * commitment.
   */
  addTask(
    title: string,
    date: string | null = null,
    goalId: string | null = null,
    estimateMin?: number,
  ): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (date !== null && !isValidLocalDate(date)) return;
    const task: Task = { id: uid(), title: trimmed, done: false, goalId };
    if (date !== null) task.date = date;
    if (estimateMin !== undefined) task.estimateMin = estimateMin;
    setAndPersist({ tasks: [...state.tasks, task] });
  },

  toggleTask(taskId: string): void {
    const target = state.tasks.find((task) => task.id === taskId);
    if (!target) return;
    const wasDone = target.done;
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
    // The task twin of `toggleLeaf`, and it splits the same way. Completion
    // makes the row vanish from Today and the backlog rail, so it gets the undo
    // window; reopening is itself the recovery and leaves the row on screen, so
    // it stays silent.
    if (wasDone) setAndPersist({ tasks });
    else withUndo(`Completed "${target.title}"`, 'tasks', tasks);
  },

  rescheduleTask(taskId: string, date: string): void {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task || !isValidLocalDate(date) || task.date === date) return;
    const tasks = state.tasks.map((item) => {
      if (item.id !== taskId) return item;
      // A different day cannot inherit this day's minute: the new day may have
      // no room there, or no availability window at all. Clearing it returns
      // the task to that day's backlog rather than parking it in dead time.
      const moved = { ...item, date };
      clearBlocks(moved);
      return moved;
    });
    setAndPersist({ tasks });
  },

  removeTask(taskId: string): void {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const originalIndex = state.tasks.indexOf(task);
    const deletedTask = structuredClone(task);
    scheduleUndo(`Deleted "${task.title}"`, () => withoutClearingUndo(() => {
      if (state.tasks.some((item) => item.id === deletedTask.id)) return;
      const tasks = [...state.tasks];
      tasks.splice(Math.min(originalIndex, tasks.length), 0, deletedTask);
      setAndPersist({ tasks });
    }), DESTRUCTIVE_UNDO_MS, true);
    withoutClearingUndo(() => {
      setAndPersist({ tasks: state.tasks.filter((item) => item.id !== taskId) });
    });
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
      `Pushed ${count} item${count === 1 ? '' : 's'} to next week`,
      () => withoutClearingUndo(() => setAndPersist({ goals: snapGoals, tasks: snapTasks })),
    );
    withoutClearingUndo(() => setAndPersist({ goals, tasks }));
  },

  // Structural reorder / indent / outdent
  /**
   * Both restructuring moves are undoable, because both destroy data to hold
   * the leaf-XOR-container invariant.
   *
   * Indenting under a leaf turns that leaf into a container, and `treeIndentNode`
   * therefore strips its `status`, `blockedOn`, `doneAt`, planned slot and
   * `estimateMin` — so one keystroke can silently un-complete a step and take
   * it off Thursday afternoon. Outdenting the last child does the milder
   * version: the emptied parent becomes a leaf with no status key at all — an
   * absent field IS todo, so there is nothing left to reset. Neither was
   * recoverable: both went through bare `setAndPersist`, which additionally
   * swept away any restore already armed. A structural edit that discards a
    * completion has to be at least as reversible as deleting a checkpoint.
   */
  indentNode(nodeId: string): void {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const node = findInAll(state.goals, nodeId);
    // Both tree helpers return a fresh clone even when they refuse the move
    // (first sibling / already at root), so identity says nothing. Compare the
    // node's PATH instead: a real indent gains an ancestor, a real outdent
    // loses one. Without this a refused move still armed "Indented X — Undo",
    // advertising a change that never happened.
    const pathBefore = findNodePath(state.goals, nodeId)?.join('/');
    const goals = treeIndentNode(state.goals, nodeId);
    if (findNodePath(goals, nodeId)?.join('/') === pathBefore) return;
    const nodePath = findNodePath(goals, nodeId);
    const expanded = new Set(state.expanded);
    if (nodePath && nodePath.length > 1) {
      expanded.add(nodePath[nodePath.length - 2]); // new parent container
    }
    withUndo(`Indented "${node?.title ?? 'task'}"`, 'goals', goals, UNDO_MS, { expanded });
  },

  outdentNode(nodeId: string): void {
    if (!isActiveNode(nodeId)) return; // frozen on a completed project
    const node = findInAll(state.goals, nodeId);
    const oldPath = findNodePath(state.goals, nodeId);
    const goals = treeOutdentNode(state.goals, nodeId);
    if (findNodePath(goals, nodeId)?.join('/') === oldPath?.join('/')) return; // see indentNode
    const expanded = new Set(state.expanded);
    if (oldPath && oldPath.length > 1) {
      const oldParentId = oldPath[oldPath.length - 2];
      const parentInNew = findInAll(goals, oldParentId);
      if (parentInNew && !parentInNew.children?.length) {
        expanded.delete(oldParentId);
      }
    }
    withUndo(`Outdented "${node?.title ?? 'task'}"`, 'goals', goals, UNDO_MS, { expanded });
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
    scaleTimer = setTimeout(() => ifOwner(() => saveScale(state.pxPerDay)), 400);
  },

  // Availability and the all-day preference are device preferences, not app
  // data: they follow setScale/setTheme's pattern (set + persist directly),
  // never routed through setAndPersist.
  setAvailability(windows: AvailabilityWindow[]): void {
    const next = parseAvailability(windows); // reject a malformed set at the door
    set({ availability: next });
    ifOwner(() => saveAvailability(next));
  },

  setAllDayBlocks(value: boolean): void {
    if (value === state.allDayBlocks) return;
    set({ allDayBlocks: value });
    ifOwner(() => saveAllDayBlocks(value));
  },

  // A device preference, like availability and the all-day setting: set() plus
  // its own save, never setAndPersist — this is not app data.
  setSidebarPanels(panels: SidebarPanel[]): void {
    set({ sidebarPanels: panels });
    ifOwner(() => saveSidebarPanels(panels));
  },

  /** Same rule: a device preference, so set() plus its own save. */
  setPlanMode(mode: PlanMode): void {
    set({ planMode: mode });
    ifOwner(() => savePlanMode(mode));
  },

  /**
   * Same again. Timeline used to be a global destination competing with Plan
   * and Goals for a presentation people opened weekly; it is a way of looking
   * at the portfolio, so it changes the representation and nothing else.
   */
  setGoalsMode(mode: GoalsMode): void {
    set({ goalsMode: mode });
    ifOwner(() => saveGoalsMode(mode));
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
      `Confirmed dates for ${ids.length} goal${ids.length === 1 ? '' : 's'}`,
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
    withUndo(`Updated dates for "${goal.title}"`, 'goals', goals);
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
    withUndo(`Scheduled "${node.title}"`, 'goals', goals);
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
    withUndo(`Unscheduled "${node.title}"`, 'goals', goals);
  },

  // Scheduling. A view hands over WHERE THE USER POINTED; the store resolves
  // the actual slot, refuses with an explanation when nothing fits, and
  // persists. Views never call resolveSlot. Returns whether a slot was found
  // and persisted — callers must not report success on a refusal, since the
  // refusal already wrote its own explanatory toast.
  /**
   * Put a leaf's sitting on `day`.
   *
   * `blockId` names WHICH sitting is being moved — a drag of one block among
   * three must not disturb its siblings, and must not collide with itself.
   * Without one this REPLACES every sitting, which is what a drag from the rail,
   * a `1`-`7` placement and the inspector's Today button all mean: "put this
   * here", not "and also here".
   *
   * `mode: 'add'` is the third intent, for Option-drag: another sitting for the
   * same task, leaving the others where they are.
   */
  scheduleNode(
    goalId: string,
    nodeId: string,
    day: string,
    aimMin: number,
    opts: { blockId?: string; mode?: 'replace' | 'add' } = {},
  ): boolean {
    if (!isActiveGoal(goalId)) return false; // frozen on a completed project
    const source = state.goals.find((g) => g.id === goalId);
    const sourceNode = source ? findNode(source.nodes, nodeId) : null;
    if (!sourceNode || sourceNode.children) return false;

    /*
     * A manual placement lands where it is aimed, at any minute of any day.
     *
     * The search itself is `resolvePlacement` — `WHOLE_DAY` and
     * `NO_PAST_LIMIT`, the unfenced manual region — and the reason it is a
     * shared function rather than inline arithmetic is `previewPlacement`
     * below: the landing outline a drag draws has to name the minute this
     * write will choose, and two copies of the same search is how those two
     * come to disagree.
     *
     * What did NOT change is `placed`, and it is the whole of the collision
     * behaviour: the day's existing sittings are still subtracted, so
     * `resolveSlot` still slides this block to the nearest gap that fits it
     * rather than letting two bars claim the same minutes.
     */
    const { startMin, durationMin, placed } = resolvePlacement(sourceNode, day, aimMin, opts);
    if (startMin === null) {
      // Same region and `now` as the search above, or the refusal describes
      // gaps the search was never allowed to use.
      const gaps = freeIntervals(day, WHOLE_DAY, [], placed, NO_PAST_LIMIT, state.allDayBlocks);
      actions.showToast(describeNoRoom(durationMin, gaps));
      return false;
    }

    const goals = cloneGoals(state.goals);
    const node = findNode(goals.find((g) => g.id === goalId)!.nodes, nodeId)!;
    if (opts.blockId) {
      node.plannedWeek ??= weekOf(day);
      replaceBlock(node, opts.blockId, { date: day, startMin });
    } else if (opts.mode === 'add') {
      addPlannedSlot(node, day, startMin, durationMin);
    } else {
      setPlannedSlot(node, day, startMin, durationMin);
    }
    /*
     * A drag of one existing bar is DIRECT MANIPULATION: you watched it land and
     * you can drag it back, which is why `resizeNode` is silent too. Every other
     * route here books from a distance — Today's proposal row, the backlog's
     * `1`-`7` keypress, `ScheduleMenu`, TaskPage's add-a-sitting — and on Today
     * the row IS the button, so there is no way to touch that zone without
     * booking something. A press you did not mean must have a way back.
     *
     * The snapshot is the whole slice on purpose: this write sets the block AND
     * the `plannedWeek` commitment above it, and a surgical undo would have to
     * remember both, then drift the first time a third field joined them.
     */
    if (opts.blockId) setAndPersist({ goals });
    else withUndo(`Scheduled "${sourceNode.title}"`, 'goals', goals);
    return true;
  },

  /** The task twin of `scheduleNode` — same three intents, same rules. */
  scheduleTask(
    taskId: string,
    date: string,
    aimMin: number,
    opts: { blockId?: string; mode?: 'replace' | 'add' } = {},
  ): boolean {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task || !isValidLocalDate(date)) return false;

    // See `scheduleNode`: one shared search, unfenced on both axes, and
    // `placed` is what still keeps two bars off the same minutes.
    const { startMin, durationMin, placed } = resolvePlacement(task, date, aimMin, opts);
    if (startMin === null) {
      const gaps = freeIntervals(date, WHOLE_DAY, [], placed, NO_PAST_LIMIT, state.allDayBlocks);
      actions.showToast(describeNoRoom(durationMin, gaps));
      return false;
    }

    const tasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const next = { ...t, date };
      if (opts.blockId) replaceBlock(next, opts.blockId, { date, startMin });
      else if (opts.mode === 'add') addBlock(next, makeBlock(date, startMin, durationMin));
      else setOnlyBlock(next, makeBlock(date, startMin, durationMin));
      return next;
    });
    // See `scheduleNode`: a drag of one bar is direct manipulation and stays
    // silent; every other route books from a distance and gets a way back.
    if (opts.blockId) setAndPersist({ tasks });
    else withUndo(`Scheduled "${task.title}"`, 'tasks', tasks);
    return true;
  },

  /**
   * Create a loose task directly on the grid, from a canvas gesture.
   *
   * ONE write, deliberately. Composing addTask → scheduleTask →
   * setTaskEstimate arms three undo entries, and each write's sweep discards
   * the ones before it, so the toast would offer to undo only the estimate —
   * the same failure CLAUDE.md documents for bulk edits. It would also strand
   * an undated task in the backlog whenever `scheduleTask` refused, after a
   * gesture the user watched fail.
   *
   * The slot is resolved BEFORE anything is written, so a refusal creates
   * nothing at all and the caller can drop its draft.
   */
  createTaskAt(title: string, date: string, startMin: number, durationMin: number): boolean {
    const trimmed = title.trim();
    if (!trimmed || !isValidLocalDate(date)) return false;

    const minutes = normalizeEstimate(durationMin);
    if (minutes === undefined) return false;

    /*
     * Drawing a block across a morning that has already happened is now
     * ALLOWED, and it is the clearest case for allowing it: a block drawn on
     * the past is a person recording what they actually did. This used to
     * refuse, on the reasoning that a brand-new block is a new booking — true,
     * but the conclusion belonged to the automatic paths, which still hold it
     * (`todayPlan` and `proposeReplan` will not propose yesterday).
     */
    const now = NO_PAST_LIMIT;
    const placed = spansOn(state.goals, state.tasks, date);
    const resolved = resolveSlot({
      date,
      aimMin: startMin,
      durationMin: minutes,
      span: WHOLE_DAY,
      blocks: [],
      placed,
      now,
      allDayBlocks: state.allDayBlocks,
    });
    if (resolved === null) {
      // Same region and `now` as the search above, or the refusal describes
      // gaps the search was never allowed to use.
      const gaps = freeIntervals(date, WHOLE_DAY, [], placed, now, state.allDayBlocks);
      actions.showToast(describeNoRoom(minutes, gaps));
      return false;
    }

    const task: Task = {
      id: uid(),
      title: trimmed,
      date,
      blocks: [makeBlock(date, resolved, minutes)],
      done: false,
      goalId: null,
      estimateMin: minutes,
    };
    withUndo(`Created "${trimmed}"`, 'tasks', [...state.tasks, task]);
    return true;
  },

  /**
   * The weekly recap's "Replan": put a carried-over step on the next day that
   * can actually take it.
   *
   * It used to be `scheduleNode(goalId, nodeId, today, 0)`. Two things were
   * wrong with that, and they compounded. Under the then-default Mon–Fri
   * availability, `windowForDate` returns null for a weekend, so every Replan
   * button failed outright on a Saturday or Sunday — which is exactly when a
   * weekly review gets done. And on a weekday that succeeded, nothing changed
   * on screen: `weekRecap` buckets on completion, which a replan doesn't
   * touch, and `scheduleNode`'s return value was discarded, so only the FAILURE
   * path ever spoke. Success was indistinguishable from a dead button, which is
   * how you end up clicking it five times.
   *
   * The forward search is a dry run — `resolveSlot` with no write — so the
   * fourteen misses can't each raise their own refusal toast on the way past.
   */
  replanNode(goalId: string, nodeId: string): void {
    const source = state.goals.find((g) => g.id === goalId);
    const node = source ? findNode(source.nodes, nodeId) : null;
    if (!node) return;
    const durationMin = durationOf(node.estimateMin);
    const from = todayStr();
    for (let i = 0; i < REPLAN_HORIZON_DAYS; i += 1) {
      const date = addDays(from, i);
      const startMin = resolveSlot({
        date,
        aimMin: 0, // earliest gap that fits, inside the window below
        durationMin,
        /*
         * The availability window, and the real clock — the same pair
         * `proposeReplan` keeps and for the same reason. "Next free slot" is
         * the app PROPOSING an hour, not a person aiming at one, so it stays
         * inside the days and hours the user said they work and never offers
         * the past. Every manual route searches `WHOLE_DAY` instead; see
         * `scheduleNode`.
         */
        span: windowForDate(date, state.availability),
        blocks: [],
        placed: spansOn(state.goals, state.tasks, date, nodeId),
        now: nowMoment(),
        allDayBlocks: state.allDayBlocks,
      });
      if (startMin === null) continue;
      if (actions.scheduleNode(goalId, nodeId, date, startMin)) {
        actions.showToast(`Replanned "${node.title}" for ${fmtD(date)}`);
      }
      return;
    }
    actions.showToast(
      `No free slot for "${node.title}" in the next ${REPLAN_HORIZON_DAYS} days — shorten it, or open up more hours.`,
    );
  },

  /**
   * Move every slipped item to where the proposal said it would go.
   *
   * ONE write, and one undo entry covering both slices. A loop over
   * `scheduleNode`/`scheduleTask` would arm an undo per item and each write's
   * sweep would discard the one before it — so the toast would offer to undo a
   * recovery and take back only its last step.
   *
   * The store re-derives nothing here: the caller has already seen these exact
   * days and minutes in a preview and said yes to them. Recomputing slots at
   * apply time is how "nothing moves silently" turns into "it moved somewhere
   * else than the screen promised".
   */
  applyReplan(moves: ReplanMove[]): boolean {
    if (moves.length === 0) return false;
    const goals = cloneGoals(state.goals);
    let tasks = state.tasks;
    let moved = 0;

    for (const move of moves) {
      if (move.kind === 'step') {
        const goal = goals.find((g) => g.id === move.goalId);
        if (!goal || goal.completedAt) continue;
        const node = findNode(goal.nodes, move.id);
        if (!node) continue;
        // The SITTING moves, not the leaf. Only the sittings in the past
        // slipped; a later one on the same task stays where it was planned.
        replaceBlock(node, move.blockId, { date: move.to, startMin: move.startMin });
        moved += 1;
        continue;
      }
      if (!state.tasks.some((t) => t.id === move.id)) continue;
      tasks = tasks.map((t) => {
        if (t.id !== move.id) return t;
        const next = { ...t };
        replaceBlock(next, move.blockId, { date: move.to, startMin: move.startMin });
        return next;
      });
      moved += 1;
    }

    if (moved === 0) return false;
    withUndoSlices(`Replanned ${moved} task${moved === 1 ? '' : 's'}`, { goals, tasks });
    return true;
  },

  /**
   * `blockId` takes ONE sitting off the calendar; without it the whole leaf
   * comes off, week commitment and all.
   *
   * The `×` on a calendar block passes the sitting it is drawn for, because
   * removing Tuesday's hour must not also remove Thursday's. The inspector's
   * Clear passes nothing, because there it means "this is not happening".
   */
  unscheduleNode(goalId: string, nodeId: string, blockId?: string): void {
    if (!isActiveGoal(goalId)) return;
    const goal = state.goals.find((g) => g.id === goalId);
    const node = goal ? findNode(goal.nodes, nodeId) : null;
    if (!goal || !node || !node.plannedWeek) return;
    const goals = cloneGoals(state.goals);
    const target = findNode(goals.find((g) => g.id === goalId)!.nodes, nodeId)!;
    if (blockId) removeBlock(target, blockId);
    else clearPlannedSlot(target);
    // "Unscheduled", matching the button that fires it — the × on a calendar
    // block and the Recap panel both say Unschedule.
    withUndo(`Unscheduled "${node.title}"`, 'goals', goals);
    // The reveal answers "where did it go?" — a question only the Plan view
    // raises, where the rail can bury an unscheduled step behind "+N more".
    // On the project page the step is still in the tree with its panel open,
    // so jumping the user to another view would be the only thing that lost
    // their place.
    if (state.view === 'plan') actions.revealInPlan('step', nodeId);
  },

  /**
   * The `×` on a task block takes it off the plan entirely — day and time —
   * exactly as `unscheduleNode` does for a step.
   *
   * This used to unpin the TIME only and keep `date`, on the grounds that "no
   * surface lists a dateless task, so dropping the date makes it unreachable".
   * That was true of the old planner and stopped being true when the backlog
   * rail shipped: `backlogGroups` lists any task without BOTH a date and a
   * start minute, filing it under its project. So the reason for the asymmetry
   * was gone, but the asymmetry stayed — and it was doing visible damage,
   * because `tasksForWeek` (which feeds the capacity readout) filters on `date`
   * alone. One unscheduled task was therefore charged to "6h planned" in the
   * week header AND listed under "To plan" in the rail at the same time: the
   * one number you plan against, contradicted by the list beside it.
   *
   * Two × buttons on the same grid must not mean two different things.
   */
  unscheduleTask(taskId: string, blockId?: string): void {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task || !(task.blocks?.length)) return;
    const tasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const cleared = { ...t };
      if (blockId) {
        removeBlock(cleared, blockId);
        return cleared;
      }
      clearBlocks(cleared);
      delete cleared.date;
      return cleared;
    });
    withUndo(`Unscheduled "${task.title}"`, 'tasks', tasks);
    // See unscheduleNode: an unscheduled task is undated, so it sorts to the
    // bottom of its group and the cap can hide it outright.
    actions.revealInPlan('task', taskId);
  },

  /**
   * Resizing a sitting changes THAT SITTING.
   *
   * It used to write `estimateMin` — so dragging Tuesday's block an inch
   * shorter re-priced the task everywhere, and with two sittings it would have
   * silently resized the other one too. An estimate is a fact about the work; a
   * sitting's length is a fact about a Tuesday.
   */
  resizeNode(nodeId: string, blockId: string, minutes: number): void {
    if (!isActiveNode(nodeId)) return;
    const goal = goalOfNode(nodeId);
    const node = goal ? findNode(goal.nodes, nodeId) : null;
    const block = node ? blocksOf(node).find((b) => b.id === blockId) : undefined;
    if (!goal || !node || !block) return;

    const clamped = clampResize({
      date: block.date,
      startMin: block.startMin,
      requestedMin: minutes,
      blocks: [],
      placed: spansOn(state.goals, state.tasks, block.date, blockId),
      allDayBlocks: state.allDayBlocks,
    });
    if (clamped === null) {
      actions.showToast(describeResizeRefused(node.title));
      return;
    }

    const goals = cloneGoals(state.goals);
    replaceBlock(findNode(goals.find((g) => g.id === goal.id)!.nodes, nodeId)!, blockId, { minutes: clamped });
    setAndPersist({ goals });
  },

  /** See `resizeNode`: this changes the sitting, never the estimate. */
  resizeTask(taskId: string, blockId: string, minutes: number): void {
    const task = state.tasks.find((t) => t.id === taskId);
    const block = task ? blocksOf(task).find((b) => b.id === blockId) : undefined;
    if (!task || !block) return;

    const clamped = clampResize({
      date: block.date,
      startMin: block.startMin,
      requestedMin: minutes,
      blocks: [],
      placed: spansOn(state.goals, state.tasks, block.date, blockId),
      allDayBlocks: state.allDayBlocks,
    });
    if (clamped === null) {
      actions.showToast(describeResizeRefused(task.title));
      return;
    }

    setAndPersist({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const next = { ...t };
        replaceBlock(next, blockId, { minutes: clamped });
        return next;
      }),
    });
  },

  markWeekReviewed(): void {
    if (!state.planReview || state.planReview.reviewed) return;
    const review = { ...state.planReview, reviewed: true };
    set({ planReview: review });
    ifOwner(() => savePlanReview(review));
  },

  ensureWeekRollover(): void {
    ensureWeekRollover();
  },

  /**
   * Pop one entry and restore it, answering WHICH one — the label the toast
   * would have shown, or null when the stack was empty.
   *
   * The return value exists for callers that cannot see the toast. `⌘Z` and
   * the toast button both ignore it, because the user watched the thing
   * happen; the agent surface spends it, because a terminal never saw the
   * toast and an "undone" with no name is not an answer. Reading
   * `pendingUndo` instead would couple those callers to the toast TIMER,
   * which is exactly what `scheduleUndo` refuses to do — the entry outlives
   * its toast on purpose.
   */
  undoLastDelete(): string | null {
    const entry = undoStack.pop();
    if (entry) entry.restore();
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    set({ pendingUndo: null });
    return entry?.label ?? null;
  },

  // UI
  setView(v: ViewName) {
    if (v === 'project') {
      set({ view: v });
      return;
    }
    set({ view: v, openGoalId: null, openStepId: null, focusNodeId: null });
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

  setActiveHorizon(horizon: number): void {
    const next = Math.min(Math.max(horizon, 0), HORIZON_COUNT - 1);
    if (next === state.activeHorizon) return;
    set({ activeHorizon: next });
  },

  setGoalScope(scope: LifeScope): void {
    const next = resolveScope(scope, state.lives);
    if (next === state.activeLifeId) return;
    set({ activeLifeId: next });
  },

  goToToday() {
    set({ selDate: todayStr() });
  },

  /**
   * Navigate to a project's page, optionally pointed at one node.
   *
   * A node focus expands the node's ancestor containers so the row is on-screen
   * for the page to scroll to; an unknown node falls back to the project root.
   * It also sets `openStepId`, so arriving from ⌘K on a step lands you IN that
   * step rather than merely beside a highlighted row.
   *
   * Returns to the tab THIS goal was last left on, defaulting to steps.
   *
   * The rule used to be "always steps", against a single global `projectTab`.
   * That was the right call for a global one — landing on Notes because some
   * OTHER goal was last read there is a surprise — but the cure also threw away
   * the case where the memory is correct: a study goal read on Overview every
   * morning reopened on Tasks every morning. Keyed by goal, the surprise cannot
   * happen, because the only tab a goal restores is one it was left on.
   *
   * A node focus still forces steps. Arriving from ⌘K on a task means being
   * pointed at a row, and the tree is the only tab that has one.
   */
  openProject(goalId: string, nodeId?: string) {
    const returnView = state.view === 'project' ? state.projectReturnView : state.view;
    const projectReturnView = returnView === 'project' ? 'goals' : returnView;
    const base = {
      view: 'project' as const,
      projectReturnView,
      openGoalId: goalId,
      // Opening a goal always leaves whatever milestone workspace was open:
      // the two are different places, and one of them is the parent.
      openAreaId: null,
    };
    if (!nodeId) {
      set({
        ...base,
        projectTab: state.projectTabByGoal[goalId] ?? 'steps',
        focusNodeId: null,
        openStepId: null,
      });
      return;
    }
    const path = findNodePath(state.goals, nodeId);
    if (!path) {
      set({ ...base, projectTab: 'steps', focusNodeId: null, openStepId: null });
      return;
    }
    const expanded = new Set(state.expanded);
    for (const id of path.slice(0, -1)) expanded.add(id); // ancestor containers
    set({ ...base, projectTab: 'steps', focusNodeId: nodeId, openStepId: nodeId, expanded });
  },

  /** Leave the project page for the view it was opened from. */
  closeProject() {
    const view = state.projectReturnView === 'project' ? 'goals' : state.projectReturnView;
    set({
      view,
      openGoalId: null,
      openAreaId: null,
      focusNodeId: null,
      openStepId: null,
    });
  },

  /**
   * Show one container as its own workspace, without leaving the goal.
   *
   * The second half of the two-level model the tree could not express: a click
   * selects a milestone and inspects it, and this OPENS it. `openGoalId` is
   * deliberately untouched — the breadcrumb, the goal's own header and the
   * return view all stay valid, so Back is one step and lands exactly where the
   * user was.
   *
   * Refuses a leaf. A task's whole content is its inspector, so a page for one
   * would be the inspector again with more chrome around it.
   */
  openArea(nodeId: string) {
    const node = findInAll(state.goals, nodeId);
    if (!node || !node.children || node.children.length === 0) return;
    set({ openAreaId: nodeId, areaTab: 'steps', openStepId: null });
  },

  /** Back out of a milestone workspace to the goal that contains it. */
  closeArea() {
    if (state.openAreaId === null) return;
    // Reselect the milestone that was open. Leaving nothing selected would
    // drop the user at the top of a tree with no trace of where they had been.
    set({ openAreaId: null, openStepId: state.openAreaId, focusNodeId: state.openAreaId });
  },

  setAreaTab(tab: AreaTab) {
    set({ areaTab: tab });
  },

  /**
   * Open (or dismiss) a goal composer, switching to Goals on the way.
   *
   * The view change is part of the action: opening the New goal dialog over the
   * Plan calendar would leave the user somewhere the thing they just created
   * does not appear.
   */
  setGoalModal(kind: GoalModal) {
    if (kind === null) {
      set({ goalModal: null });
      return;
    }
    set({ goalModal: kind, view: 'goals', openGoalId: null, openStepId: null });
  },

  openSettings(): void { set({ settingsOpen: true }); },
  closeSettings(): void { set({ settingsOpen: false }); },

  /**
   * Switch tabs, and remember the choice for THIS goal.
   *
   * The memory is written here rather than on leaving, because leaving has
   * several routes — Back, ⌘K to another goal, deleting the goal — and only
   * this one is guaranteed to see the tab the user actually chose.
   */
  setProjectTab(tab: ProjectTab) {
    if (!state.openGoalId) {
      set({ projectTab: tab });
      return;
    }
    set({
      projectTab: tab,
      projectTabByGoal: { ...state.projectTabByGoal, [state.openGoalId]: tab },
    });
  },

  /**
   * Drop the pulse pointer once the page has used it. `focusNodeId` names a
   * MOMENT, not a selection: left set, collapsing and re-expanding the tree
   * would replay the highlight for a navigation that happened minutes ago.
   */
  clearFocusNode() {
    if (state.focusNodeId === null) return;
    set({ focusNodeId: null });
  },

  /**
   * Select a step for the detail panel.
   *
   * Distinct from `openProject(goalId, nodeId)`: that is an ARRIVAL, and it
   * pulses the row and forces the steps tab because the user came from
   * somewhere else. This is a selection made by someone already on the page,
   * so it changes nothing but the selection.
   */
  openStep(nodeId: string) {
    if (!findNodePath(state.goals, nodeId)) return;
    set({ openStepId: nodeId });
  },

  closeStep() {
    if (state.openStepId === null) return;
    set({ openStepId: null });
  },

  /**
   * Send the user to the Plan view pointed at one task or habit.
   *
   * Search can find both, but neither has a detail surface, so choosing one
   * used to switch view and nothing else — for anything off the visible week
   * that was indistinguishable from the palette ignoring Enter. The view is
   * what scrolls and highlights; this only states the intent, plus the one
   * piece of setup the view cannot do for itself without fighting the user's
   * own panel preference: a habit is invisible while the Habits panel is
   * collapsed, so revealing one opens it.
   *
   * The nonce makes a repeat reveal of the same id a distinct value — object
   * identity alone would do that too, but naming it stops a future `useMemo`
   * or equality check from quietly collapsing the two.
   */
  revealInPlan(kind: RevealKind, id: string) {
    const sidebarPanels =
      kind === 'habit' && !state.sidebarPanels.includes('habits')
        ? [...state.sidebarPanels, 'habits' as SidebarPanel]
        : state.sidebarPanels;
    if (sidebarPanels !== state.sidebarPanels) ifOwner(() => saveSidebarPanels(sidebarPanels));
    set({
      view: 'plan',
      revealItem: { kind, id, nonce: revealNonce += 1 },
      sidebarPanels,
    });
  },

  /** The view calls this once the highlight has run its course. */
  clearReveal() {
    set({ revealItem: null });
  },

  /**
   * The board card's "Plan next step" — go to the calendar with this project's
   * most urgent unplanned item already picked out.
   *
   * The card computes exactly which step it means and used to throw it away:
   * `onPlan` took a `goalId`, ignored it, and called `setView('plan')`. Since
   * `cardPrimaryAction` returns 'plan' for essentially every healthy project,
   * that was the default action on most cards, and it left you to find the
   * project by hand in a rail holding a dozen others.
   *
   * The target is read from `backlogGroups`, not from a second "first open
   * leaf" walk, so the row this selects is the row the rail actually puts at
   * the top of that project — one ordering, not two that can disagree.
   */
  planNextStepFor(goalId: string) {
    const today = todayStr();
    const groups = backlogGroups(state.goals, state.tasks, weekOf(today), today);
    const first = groups.find((g) => g.goalId === goalId)?.items[0];
    // Nothing left to plan: still go to the calendar, which is what the button
    // says, rather than appearing dead.
    if (!first) {
      set({ view: 'plan' });
      return;
    }
    actions.revealInPlan(first.kind, first.id);
  },

  showToast(msg: string) {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 1900);
  },

  // IO
  async exportBackup() {
    // Non-fatal: the snapshot is a nicety, the backup is the point. A rejected
    // IndexedDB read here would otherwise skip exportState entirely — no file
    // written, no toast, and an unhandled rejection, because the call site
    // neither awaits nor catches. Degrade to "backup without a snapshot",
    // never to "no backup".
    const preSlotMigrationSnapshot = await loadSlotMigrationSnapshot().catch(() => null);
    const preCheckpointMigrationSnapshot = await loadCheckpointMigrationSnapshot().catch(() => null);
    try {
      await exportState(
        { goals: state.goals, habits: state.habits, tasks: state.tasks, sessions: state.sessions, lives: state.lives },
        state.pxPerDay,
        state.planReview,
        state.availability,
        state.allDayBlocks,
        state.sidebarPanels,
        preSlotMigrationSnapshot,
        preCheckpointMigrationSnapshot,
      );
      actions.showToast('Backup exported');
    } catch {
      actions.showToast('Could not export backup.');
    }
  },

  async importBackup(file: File) {
    // `importStateFromFile` writes all four tables plus every settings row
    // itself, so it has to be gated here rather than downstream.
    if (!ownsTabLock) {
      actions.showToast('Phase is open in another tab — close it before importing.');
      return;
    }
    try {
      const appState = await importStateFromFile(file);
      await applyImportedBackup(appState);
      actions.showToast('Backup imported');
    } catch (e) {
      if (isAssetImportFailure(e)) {
        await applyImportedBackup(e.imported);
        set({ persistFailed: true });
        actions.showToast('Import completed, but images could not be saved — export a backup now');
        return;
      }
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
