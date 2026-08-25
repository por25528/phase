import { parseOpsJournal, opsAfter, type CompanionOp } from '../lib/sync/ops';
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
  if (op.request.tool === 'add_loose_task') {
    // The store's own default is null, and it is passed explicitly so an
    // absent date can never read as today: capture and commitment are
    // different acts, exactly as `addTask`'s own comment argues.
    deps.actions.addTask(op.request.title, op.request.date ?? null, null);
    return true;
  }
  return handleAgentWrite(op.request, deps).ok;
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
