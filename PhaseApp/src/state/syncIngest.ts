import { parseOpsJournal, opsAfter, opDay, type CompanionOp } from '../lib/sync/ops';
import { handleAgentWrite, type AgentWriteDeps } from '../lib/agentWrites';

/**
 * The phone's journal, ingested into the Mac's store.
 *
 * Every op goes through `handleAgentWrite` — the SAME function the MCP socket
 * spends — so undo, toasts, the persist latch and every store invariant hold
 * for free and the companion opens no new door into the data. That is the
 * whole design of this module: the phone's vocabulary was chosen as a subset
 * of the agent protocol precisely so this could be a mapping rather than a
 * second write path. `add_loose_task` is the one verb the protocol lacks (its
 * `add_task` requires a project) and it maps onto `actions.addTask` directly.
 *
 * ORDER is the journal's line order, and `id` is the idempotency key.
 * `baseGeneration` is informational and is never consulted here: it records
 * what the phone was LOOKING at, which says nothing about what this Mac has
 * already applied.
 *
 * The high-water mark advances after EACH op rather than once at the end, so
 * a crash halfway through a journal resumes where it stopped instead of
 * replaying ticks the store has already taken. That is also why a skip
 * advances it: an op whose target the Mac deleted will never apply, and
 * leaving the mark behind it would re-attempt — and re-count — it on every
 * poll for the life of the file.
 *
 * There are no toasts here. The caller owns presentation, for the same reason
 * `agentWrites` takes injected deps: this is the layer that has to be
 * testable without a renderer.
 */

export interface IngestDeps extends AgentWriteDeps {
  getIngestedThrough(): string | null;
  /** Called after EACH op, so a crash never replays what already landed. */
  setIngestedThrough(id: string): void;
}

export interface IngestResult {
  applied: number;
  skipped: number;
}

function apply(op: CompanionOp, deps: IngestDeps): boolean {
  try {
    // The op's OWN day, not this Mac's clock. An op made at 23:50 and ingested
    // at 00:10 is a record of the day it was made — and the phone has already
    // drawn it under that day, so any other answer is a row that jumps when
    // the Mac catches up.
    const write = { ...deps, today: opDay(op) };
    if (op.request.tool === 'add_loose_task') {
      // The store's own default is null, and it is passed explicitly so an
      // absent date can never read as today: capture and commitment are
      // different acts, exactly as `addTask`'s own comment argues.
      deps.actions.addTask(op.request.title, op.request.date ?? null, null);
      return true;
    }
    return handleAgentWrite(op.request, write).ok;
  } catch (err) {
    // `parseOpsJournal` checks the ENVELOPE and the verb; nothing checks the
    // payload, and `validAgentRequest` cannot be spent here without rejecting
    // `add_loose_task`, which is not one of its verbs. So a line with the
    // right verb and the wrong shape can throw inside a handler, and a throw
    // that escaped would abandon every op after it — the exact "never fatal"
    // rule the parser already keeps for a truncated line, restated one layer
    // in. It counts as skipped, which is what the toast then reports.
    console.warn('[sync] op could not be applied', op.id, err);
    return false;
  }
}

export function ingestJournal(journalText: string, deps: IngestDeps): IngestResult {
  const pending = opsAfter(parseOpsJournal(journalText), deps.getIngestedThrough());
  let applied = 0;
  let skipped = 0;
  for (const op of pending) {
    if (apply(op, deps)) applied += 1;
    else skipped += 1;
    deps.setIngestedThrough(op.id);
  }
  return { applied, skipped };
}
