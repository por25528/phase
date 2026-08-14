# Phase MCP server — design

**Date:** 2026-08-14
**Status:** Design approved; implementation plan not yet written.

Let Claude Code read and edit real Phase data from a terminal — "what should I
work on today", "break this goal into steps", "mark that done" — without giving
anything outside the app a second way to reach the database.

## The constraint

Phase persists to **IndexedDB inside the Electron renderer** (`src/db/db.ts`).
A separate process cannot read it, and two existing invariants make an external
writer actively dangerous rather than merely awkward:

- A single write is a **full clear + bulkPut of all four tables**. One write
  from a stale process rewrites the whole database.
- A **Web Lock** (`src/lib/tabLock.ts`) enforces a single writer, and a
  non-owner never writes at all — `persist` is gated in `setAndPersist`, every
  settings write goes through `ifOwner`, and `importBackup` refuses outright.

So this is not a file-access problem. Anything outside the app has to go
*through* the app. Moving persistence to SQLite so two processes could share it
was considered and rejected: it rewrites `db.ts`, `setAndPersist`'s persist
path and the whole lock story to buy what the bridge below gets without
touching any of them.

## Architecture

Four hops, each mirroring a pattern already in the repo:

```
Claude Code ──stdio──▶ mcp/server.js ──unix socket──▶ Electron main ──IPC──▶ renderer ──▶ actions
```

| Piece | Responsibility |
|---|---|
| `mcp/server.js` | The only new process. Spawned by Claude Code over stdio, holds no state, translates MCP tool calls into protocol messages. |
| Unix domain socket | In `userData`, mode `0600`. Not a TCP port — no listening port to discover and no token to invent; filesystem permissions are the boundary. |
| `electron/agentIpc.cjs` | The validated seam, shaped like `shellIpc.cjs`: a fixed named set of verbs, nothing renderer-supplied, no forwarding. |
| `src/lib/agentProtocol.ts` | The message vocabulary as pure, tested code — the same `assistantProtocol.ts` / `assistantIpc.cjs` split already in use. |

`mcp/server.js` lives in this repo rather than a separate one because it has to
move in lockstep with `agentProtocol.ts`.

**The renderer remains the only writer.** The Web Lock, `persist`, the undo
stack and `persistFailed` are all untouched. The MCP surface is a new *caller
of `actions`*, not a new path to the database — which is what makes the whole
design cheap and what keeps every invariant in `CLAUDE.md` true by
construction.

### The window does not have to be open

`electron/appLifecycle.cjs` hides the Hub on close rather than destroying it,
because "the Hub renderer is the single store owner that keeps the background
state alive." The MCP surface therefore works whenever Phase is **running** —
window visible or not, menu-bar item only. Only an explicit quit removes it.

## Undo

`undo_last` needs **no new store action**. Two existing facts carry it:

- `scheduleUndo`'s timer **only hides the toast** (`store.ts:710`). The restore
  stays on `undoStack` so `⌘Z` can reach it afterwards.
- `undoLastDelete()` (`store.ts:2700`) already pops that stack and restores.

This matters because a write triggered from a terminal is the ultimate distance
write: the toast may appear and expire on a window nobody is looking at, which
is exactly the "visible Undo button that does nothing" that
`setAndPersist`'s sweep exists to prevent. Exposing the *stack* rather than the
*toast* puts the reversal in the same place the mistake was made.

**`undo_last` must return the label of what it reversed, or state that nothing
was pending.** `setAndPersist`'s sweep (`store.ts:505`) drops every non-surgical
entry when an ordinary in-app edit lands — so ticking a box in Phase after
Claude Code writes genuinely leaves nothing to undo. The tool says so rather
than silently popping an older entry.

## Tool surface

The governing rule, borrowed from `todayPlan`: **every read spends the same lib
function the view spends, and re-derives nothing.** A `today` tool that
recomputed its own idea of what matters could disagree with the Today page —
the precise failure that "`todayPlan` spends `backlogGroups` and nothing else"
exists to prevent. `mcp/server.js` formats; it never decides.

### Reads

| Tool | Spends | Answers |
|---|---|---|
| `today` | `executionAdvisor`, `buildDailyWork` | now, carried over, free-time offer, finished today |
| `week` | `weekCapacity`, `isOverCommitted` | planned vs to-place vs free |
| `backlog` | `backlogGroups` | what is queued, by project |
| `list_projects` | `effort.ts`, `health.ts`, `pct.ts` | remaining minutes and a health sentence per goal |
| `get_project` | the goal tree | steps, statuses, estimates, blocks |

### Writes

Each routes to the action the UI already calls, so undo, toasts and persistence
come for free.

| Tool | Action | Note |
|---|---|---|
| `create_project` | `parseGoalImport` | Input schema **is** `docs/import-schema.md` — already published and tested. |
| `add_task` / `rename` / `estimate` | existing node actions | |
| `set_status` | `setNodesStatus` / `applyStatus` | Carries `blockedOn`; may reach `done`, as `TaskPage`'s popover does. |
| `complete_task` | `toggleLeaf` / `toggleTask` | The same function the checkbox calls. |
| `schedule` | `scheduleNode` / `scheduleTask` | No `blockId` ⇒ distance booking ⇒ arms undo and refuses via `describeNoRoom` unaided. |
| `delete` | `removeNodes` / `removeTask` | Arms the existing `DESTRUCTIVE_UNDO_MS` (15s) entry; recoverable via `undo_last`. |
| `undo_last` | `undoLastDelete` | Returns what it reversed, or reports nothing pending. |

`create_project` retires an existing workflow outright: it replaces the
`Goals → Import project` copy-prompt → paste → paste-back loop with a single
call against a schema that is already written, already the contract, and
already has a parser (`parseGoalImport`) as its single source of truth.

`delete` is included deliberately and is the highest-risk verb on the surface.
It is acceptable only because `undo_last` reaches the same stack the in-app
`⌘Z` reaches, and because `removeNodes` already snapshots and arms a
15-second entry that outlives its toast.

## Honesty at the seam

Three rules, all versions of *never report success on a refusal*:

1. **App not running** → every tool fails with "Phase isn't running." No
   auto-launch: a tool call that silently boots a desktop app is a surprise,
   and the socket's absence is already an unambiguous signal.
2. **`persistFailed` is set** → the tool reports it and names Export as the
   recovery path, exactly as the in-app banner does. In-memory state advances
   regardless of a failed write, so a tool that only checked the action's
   return value would claim success about a write that never landed.
3. **Bulk actions return whether they wrote.** `removeNodes`,
   `setNodesStatus` and `applyReplan` already do; the tool propagates that
   boolean rather than assuming.

## Testing

Follows the existing split:

- `src/lib/agentProtocol.test.ts` — the vocabulary, with nothing mounted. Does
  `complete_task` reject a container? Does `schedule` refuse a full day? This
  is the point of keeping the protocol pure and separate from the IPC.
- `electron/agentIpc.test.ts` — the seam, as `shellIpc.test.ts` and
  `assistantIpc.test.ts` already do: only the named verbs are registered, and
  everything else is refused.

## Out of scope

- **An in-app LLM.** Calling the Anthropic API from Electron main to power
  `ProposalPanel` ("break X into subtasks") is a separate subsystem with its
  own key handling, per-use cost, and a documented decision to reverse — the
  shelf's typed vocabulary was retired on the grounds that "a second parser is
  a second opinion about what a sentence means." It gets its own spec, argued
  after this one ships and it is clear what actually gets reached for.
- **Moving persistence out of IndexedDB.** Rejected above.
