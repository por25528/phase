import type { AgentRequest } from '../agentProtocol';
import { localDay, todayStr } from '../dates';
import { isValidLocalDate } from '../schedule';

/**
 * The sync contract between the Mac app and the PhasePhone companion.
 *
 * The phone never writes state. It appends CompanionOps — one JSON object per
 * line — to its own journal file in the iCloud container, and renders
 * `state.json` plus a replay of the ops the Mac has not ingested yet. The Mac
 * ingests the journal strictly in file order and maps each request onto
 * `handleAgentWrite`, so every op takes the exact code path the MCP agent
 * already takes and no new door into the store exists.
 *
 * `CompanionRequest` is a SUBSET of `AgentRequest` on purpose: the companion
 * ticks, captures, parks, logs and annotates — it never schedules, deletes,
 * renames or replans. Widening this union is a design decision, not a patch.
 * `add_loose_task` is the one verb the agent protocol lacks (its `add_task`
 * requires a project); the ingester maps it onto `actions.addTask` directly.
 */
export type CompanionRequest =
  | Extract<
      AgentRequest,
      | { tool: 'complete_task' }
      | { tool: 'set_status' }
      | { tool: 'add_task' }
      | { tool: 'log_time' }
      | { tool: 'append_note' }
    >
  | { tool: 'add_loose_task'; title: string; date?: string };

export const COMPANION_VERBS = [
  'complete_task',
  'set_status',
  'add_task',
  'log_time',
  'append_note',
  'add_loose_task',
] as const;

export interface CompanionOp {
  /** Phone-generated UUID. Ingest idempotency keys off it. */
  id: string;
  /** ISO timestamp, audit only — ordering is the journal's line order. */
  ts: string;
  /**
   * The phone's LOCAL calendar day when the op was made — `YYYY-MM-DD`.
   *
   * On the wire rather than derived, because the two sides read this op at
   * different moments and from different clocks. The phone projects it the
   * instant of the tap; the Mac ingests it whenever it is next opened, which
   * may be after a midnight the person slept through, and may be in another
   * timezone entirely. Deriving the day from `ts` would give each side its own
   * answer, and a completion the phone had already SHOWN under Tuesday would
   * land on the Mac under Wednesday.
   *
   * Optional so a journal written before this field existed still ingests —
   * `opDay` falls back for those.
   */
  day?: string;
  /** `generation` of the state file the phone was rendering when the op was made. */
  baseGeneration: number;
  request: CompanionRequest;
}

/**
 * The day an op belongs to. The ONE answer, spent by the phone's projection
 * (`replay.ts`) and by the Mac's ingest (`syncIngest.ts`) alike — they have to
 * agree or a row moves between days when the Mac catches up.
 *
 * Order of preference, and each fallback is a degradation:
 * 1. `op.day` — what the phone recorded. Correct by construction.
 * 2. The local day of `op.ts`, for a journal written before `day` existed.
 *    Correct whenever the reader shares the phone's timezone.
 * 3. Today, for an op whose timestamp is unreadable too. Stamping
 *    `Invalid Date` into a field every date comparison then fails against is
 *    the one outcome worse than being a day out.
 */
export function opDay(op: CompanionOp): string {
  if (isValidLocalDate(op.day)) return op.day;
  const at = new Date(op.ts);
  return Number.isNaN(at.getTime()) ? todayStr() : localDay(at);
}

/**
 * Rides inside `state.json` beside the five entity arrays.
 *
 * `ingestedThroughOpId` — not `baseGeneration` arithmetic — is what tells the
 * phone which of its ops are reflected: the Mac exports for its own edits too,
 * so a bumped generation alone never proves a given op was ingested.
 */
export interface StateFileMeta {
  generation: number;
  writtenAt: string;
  ingestedThroughOpId: string | null;
}

export function serializeOp(op: CompanionOp): string {
  return JSON.stringify(op);
}

function isCompanionOp(value: unknown): value is CompanionOp {
  if (!value || typeof value !== 'object') return false;
  const op = value as Partial<CompanionOp>;
  return (
    typeof op.id === 'string' &&
    typeof op.ts === 'string' &&
    typeof op.baseGeneration === 'number' &&
    !!op.request &&
    typeof op.request === 'object' &&
    (COMPANION_VERBS as readonly string[]).includes((op.request as { tool?: string }).tool ?? '')
  );
}

/**
 * A malformed or unknown-verb line is SKIPPED, never fatal: the journal may be
 * mid-append when iCloud syncs it, and one truncated tail line must not stop
 * the Mac from ingesting everything before it.
 */
export function parseOpsJournal(text: string): CompanionOp[] {
  const ops: CompanionOp[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isCompanionOp(parsed)) ops.push(parsed);
    } catch {
      // skip
    }
  }
  return ops;
}

/**
 * The ops strictly after `ingestedThroughOpId` in journal order. An unknown id
 * (the Mac ingested through an op this journal no longer carries, or null)
 * means nothing here is confirmed ingested — return everything.
 */
export function opsAfter(ops: readonly CompanionOp[], ingestedThroughOpId: string | null): CompanionOp[] {
  if (ingestedThroughOpId === null) return [...ops];
  const at = ops.findIndex((op) => op.id === ingestedThroughOpId);
  return at === -1 ? [...ops] : ops.slice(at + 1);
}
