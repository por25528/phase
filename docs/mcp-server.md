# Phase MCP server

Phase exposes its data to Claude Code over an MCP server, so *"what's on this
week?"* or *"mark that step done"* works from a terminal and answers with what
the app itself would say.

It is not a second way into the database. `mcp/server.js` is a **client of the
running app**: it writes one line to a Unix socket, Electron main relays it to
the renderer, and the renderer — still the single store owner, still holding the
Web Lock — answers by calling the same `actions` the UI calls. Quit Phase and
every tool fails honestly rather than reaching around it.

```
Claude Code ──stdio──▶ mcp/server.js ──unix socket──▶ Electron main ──IPC──▶ renderer ──▶ actions
```

## Setup

Start Phase, then register the server once:

```bash
claude mcp add phase -- node /absolute/path/to/Phase/mcp/server.js
```

From the repo root, `claude mcp add phase -- node "$(pwd)/mcp/server.js"` fills
the path in for you. The server holds no state and takes no configuration — it
is spawned per session over stdio and finds the app through a fixed socket path.

## Phase has to be running; the window does not have to be open

The socket is created by Electron main at launch and removed when the app quits.
Closing the window only **hides** it (`electron/appLifecycle.cjs`) — the renderer
is the store owner that keeps background state alive — so the tools keep working
from the menu bar with no window on screen. Only ⌘Q takes them away, and when it
has, every tool says so:

> Phase is not running. Open Phase and try again.

There is no auto-launch. A tool call that silently booted a desktop app would be
a surprise, and the socket's absence is already an unambiguous signal.

## What it exposes

A `ref` below is one piece of work: `{ kind: 'step' | 'task', id, goalId }`,
where `goalId` is the project holding a step and `null` for a loose task.

### Reads

| Tool | Arguments | Answers |
|---|---|---|
| `today` | — | What to work on now, what slipped, the free-time offer, what was finished today |
| `week` | — | Planned, committed-but-unplaced ("to place") and free minutes for the current week |
| `backlog` | — | Queued work, grouped by project |
| `list_projects` | — | Every project with its horizon, percentage, remaining minutes and health sentence |
| `get_project` | `goalId` | The full step tree for one project: statuses, estimates and scheduled sittings |

Every read **spends the lib function its view spends and re-derives nothing** —
`today` is `executionAdvice`, `week` is `weekCapacity`, `backlog` is
`backlogGroups`, `list_projects` is `goalEffort`/`goalHealth`/`goalPct`. A tool
that computed its own idea of what matters could disagree with the Today page,
which is the exact failure the rule exists to prevent.

Two consequences worth knowing before reading a number:

- **`remainingMin` never travels alone.** `unestimated` is beside it, because
  the first is only a floor while the second is above zero.
- **`week` passes no verdict.** It returns the `WeekCapacity` object whole.
  Whether a week is over-committed is `plannedMin + backlogMin > freeMin` — the
  comparison `isOverCommitted` makes in the Plan view, which sits above this
  seam. Every figure needed to make it is in the response.

Calendar busy time is always empty here: the calendar cache lives outside
`AppState`, so `blocks` is `[]` and `hasData` is `false`, exactly as it is on
the Today and Plan pages today.

### Writes

Each write is **one call into the action the UI already calls**, so undo, toasts
and persistence come for free.

| Tool | Arguments | Calls | Notes |
|---|---|---|---|
| `create_project` | `project` | `parseGoalImport` → `addGoals` | The schema is [`docs/import-schema.md`](import-schema.md); a malformed tree is rejected with the parser's own message |
| `add_task` | `goalId`, `parentId?`, `title` | `addRootNode` / `addChild` | Returns the new `nodeId` — what you need to estimate or schedule it next |
| `rename` | `nodeId`, `title` | `renameNode` | Groups rename too |
| `estimate` | `nodeId`, `minutes` (or `null`) | `setNodeEstimate` | Tasks only — a group has no estimate of its own |
| `set_status` | `nodeId`, `status`, `blockedOn?` | `setNodeStatus`, or `toggleLeaf` for `done` | Tasks only; `blockedOn` is accepted only with `blocked` |
| `complete_task` | `ref` | `toggleLeaf` / `toggleTask` | The same function the checkbox calls |
| `schedule` | `ref`, `day`, `startMin?` | `scheduleNode` / `scheduleTask` | Books a sitting; see the length limit below |
| `delete` | `ref` | `removeNodes` / `removeTask` | Reversible — see `undo_last` |
| `undo_last` | — | `undoLastDelete` | Names what it reversed, or says nothing was pending |

Two things a write will never do:

- **Report success on a refusal.** A completed project is frozen and every node
  action no-ops on it; a task already ticked cannot be "completed" again; a full
  day refuses a sitting and the response carries the app's own *no room*
  sentence rather than a second wording of it. Where the action returns nothing
  and refuses silently, the store is re-read and the write is confirmed to have
  landed before anything is reported.
- **Hide a failed save.** `persistFailed` latches independently of any return
  value — in-memory state advances even when the write did not reach IndexedDB —
  so it is checked after every mutation and reported with Export named as the
  recovery path, exactly as the in-app banner does.

An unrecognised verb, or a well-named one with the wrong fields, never reaches
`actions` at all:

> Not a request Phase understands.

## Limits

### `undo_last` is narrow, and deliberately so

It reverses the last change by popping the same stack in-app `⌘Z` pops. Three
things bound it:

1. **An edit inside Phase clears it.** An undo entry is a snapshot of a whole
   slice, so replaying it would also revert anything written after it. When an
   ordinary edit lands, `setAndPersist`'s sweep drops the armed restore — and
   the tool says so rather than popping an older, unrelated one:

   > Nothing to undo — an edit in Phase since then cleared it.

2. **An add leaves nothing to reverse.** `add_task` and `create_project` write
   through a plain persist and arm no undo entry at all — undo is for edits that
   *discard* user data. So `undo_last` after an add correctly refuses with the
   message above. This is not a bug, and a test expecting `Added "X"` would be
   asserting one.

3. **It expires with the toast.** The tool gates on `pendingUndo`, the same
   signal the in-app Undo button is drawn from: **15 seconds** after a `delete`,
   **5 seconds** after any other undoable write. In-app `⌘Z` pops the stack
   blind and can still reach an entry after its toast has gone; from a terminal
   that would silently reverse something you cannot see, so this surface does
   not do it.

Which writes arm an undo entry at all:

| Arms one | Arms nothing |
|---|---|
| `delete` (15s), `complete_task`, `set_status` → `done`, `estimate`, `schedule` | `create_project`, `add_task`, `rename`, `set_status` → `todo`/`doing`/`blocked` |

`schedule` arms one because it has no `blockId`: a booking made from a distance
is not direct manipulation, and a press you did not watch land needs a way back.

### `schedule` takes no length

There is `day` and an optional `startMin` to aim at, and no `minutes`. A fresh
sitting is sized from the task's **estimate** — the only thing there is to go on
— and only a resize changes a block's own length, which needs the id of a bar
that already exists. Passing one is refused rather than dropped:

> A sitting is sized by the task's estimate. Set it with "estimate" first, then
> schedule.

So the order is `estimate`, then `schedule`. The tool schema does not advertise
`minutes` at all, because a schema offering a field that always fails is an
invitation to a failed call.

### The socket path is macOS-only, and hardcoded

`mcp/server.js` looks for the socket at:

```
~/Library/Application Support/Phase/agent.sock
```

Electron main creates it at `path.join(app.getPath('userData'), 'agent.sock')`
with mode `0600`. There is no port and no token: the socket is inside `userData`
and filesystem permissions **are** the boundary.

Two caveats follow from the path being a literal:

- **It is the macOS location.** Running the app elsewhere puts `userData`
  somewhere else and the server will not find it.
- **`npm run app:dev` uses `…/Application Support/phase`** (lower case — the dev
  build has no `productName`, so Electron falls back to the package name). On a
  default, case-insensitive macOS volume that is the same directory and the
  server works against either build. On a case-sensitive volume it would not.

A stale socket file left by a killed process is removed before binding, so a
crash does not need cleaning up by hand.

## The pieces

| File | Responsibility |
|---|---|
| `mcp/server.js` | The stdio MCP server. Declares tools and forwards them down the socket — it decides nothing, because nothing under `mcp/` is covered by the test suite |
| `electron/agentSocket.cjs` | The `0600` Unix socket and its newline-delimited JSON framing |
| `electron/agentIpc.cjs` | The main↔renderer relay. Never rejects — a missing renderer is an ordinary answer |
| `electron/preload.cjs` | Two fixed channels, no renderer-supplied names |
| `src/lib/agentProtocol.ts` | The vocabulary and every inbound validator. Requests are untrusted; responses are not re-validated |
| `src/lib/agentBridge.ts` | The renderer's wrapper, inert outside Electron |
| `src/lib/agentReads.ts` | Read handlers. Spends the views' own lib functions |
| `src/lib/agentWrites.ts` | Write handlers. One `actions` call each, and the honesty rules above |

The design argument is in
[`docs/superpowers/specs/2026-08-14-phase-mcp-server-design.md`](superpowers/specs/2026-08-14-phase-mcp-server-design.md).
