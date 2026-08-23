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
| `get_note` | `ref` (`{ kind: 'step' \| 'project', id }`) | The markdown note on a step or project, with its title; `''` when there is none |
| `propose_replan` | — | Where each slipped sitting would go within `REPLAN_HORIZON_DAYS`, and which will not fit — `proposeReplan`, as Today's Replan strip calls it |
| `time_log` | `ref` | Minutes logged against a task or step — the same total `TaskPage` prints — and the entries behind it |

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
| `set_life` | `goalId`, `life` (or `null`) | `setGoalLife` | By NAME, not id — naming one that does not exist answers with the ones that do |
| `set_horizon` | `goalId`, `horizon` | `moveGoalToColumn` | `now`/`next`/`later`/`someday` — capitalised spellings are accepted too, because `list_projects` answers with the capitalised labels; returns `nowCount`, and never enforces the WIP cap the board only reports |
| `complete_task` | `ref` | `toggleLeaf` / `toggleTask` | The same function the checkbox calls |
| `schedule` | `ref`, `day`, `startMin?` | `scheduleNode` / `scheduleTask` | Books a sitting; see the length limit below |
| `delete` | `ref` | `removeNodes` / `removeTask` | Reversible — see `undo_last` |
| `undo_last` | — | `undoLastDelete` | Names what it reversed, or says nothing was pending |
| `set_note` | `ref`, `markdown` | `setNodeNotes` / `setGoalNotes` | Replaces; `''` clears. See the editor caveat below |
| `append_note` | `ref`, `markdown` | `setNodeNotes` / `setGoalNotes` | Adds a paragraph at the end — ONE write, so nothing typed between a read and a write is lost |
| `log_time` | `ref`, `minutes`, `date?` | `logSession` | After the fact, never a running timer; `date` defaults to today and may not be in the future |
| `clear_time` | `ref` | `clearSessionsFor` | Discards every entry on the item; refuses when there was none |
| `apply_replan` | `moves` | `applyReplan` | Any subset of `propose_replan`'s moves, as `{ kind, id, blockId, goalId, to, startMin }`; one undoable write — see below |

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

### What bounds `undo_last`

It reverses the last change by popping the same stack in-app `⌘Z` pops, and
answers with the label of what it restored. Two things bound it — and, notably,
a clock is not one of them:

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

**It does not expire with the toast.** An earlier version gated on
`pendingUndo`, which the toast timer nulls after 5 seconds (15 for a
destructive edit) — giving the agent a *narrower* window than the `⌘Z` sitting
in the same app, which inverts the reason the verb exists. A terminal is the
one caller that never saw the toast; a faded toast must not mean a refused
undo. `undoLastDelete` returns the label it restored, so the tool reads the
stack directly and still names what it reversed.

Which writes arm an undo entry at all:

| Arms one | Arms nothing |
|---|---|
| `delete` (15s), `complete_task`, `set_status` → `done`, `set_horizon`, `estimate`, `schedule`, `log_time`, `clear_time`, `apply_replan` | `create_project`, `add_task`, `rename`, `set_life`, `set_status` → `todo`/`doing`/`blocked`/`parked`, `set_note`, `append_note` |

`schedule` arms one because it has no `blockId`: a booking made from a distance
is not direct manipulation, and a press you did not watch land needs a way back.

### Notes and an open editor

Before answering ANY request the renderer flushes the one mounted note editor
(`actions.flushNote`), so `get_note` sees what was typed a second ago and a
`set_note`/`append_note` is built on the current document, not the last
autosave. What it cannot do is reach INTO that editor: if the note you write
from a terminal is the one open on screen, the editor keeps its own buffer and
its next save wins. Same rule an import already lives with. Loose tasks have
no notes field and get no note verb.

### There is no running timer

`log_time` writes the ledger after the fact. The shelf's live session
(`startFocus`/`completeFocus`) is deliberately not exposed: a terminal cannot
watch a timer, a session it started would run unattended, and the shelf's
"was that real work?" question would have no one to answer it.

### A replan proposes; `apply_replan` takes the proposal back

`propose_replan` is a read. `apply_replan` takes its moves — any subset,
unchanged — and joins each to the sitting that actually slipped by `blockId`:
the caller says where it goes, the app restates what it is (title, length,
origin). A move naming a sitting that never slipped, or one moved since, or a
destination in the past, refuses the WHOLE call, because the write is one undo
entry. Days and minutes are passed through exactly as proposed, never
re-resolved — the invariant Today's strip holds, for the same reason.

### Prompts and resources

The four no-argument reads are also resources — `phase://today`,
`phase://week`, `phase://backlog`, `phase://projects` — for clients that want
the day as context without a tool call. Three prompts open a conversation:
`plan-my-day` (proposes ≤3 placements and books nothing until told),
`review-week` (reads the week; suggests, never acts) and
`log-session(task, minutes)` (finds the work by title, logs, reads back the
total). The text lives in `src/lib/agentPrompts.ts`; `server.js` carries a
copy, pinned line for line by `agentProtocol.test.ts`.

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

### How the socket is found

Electron main creates it at `path.join(app.getPath('userData'), 'agent.sock')`
with mode `0600`. There is no port and no token: the socket sits inside
`userData`, which is itself `drwx------`, and filesystem permissions **are** the
boundary.

`mcp/server.js` resolves the path per call, in this order:

1. **`PHASE_SOCKET`**, if set — an absolute override. This is also how an
   end-to-end check points at a throwaway `--user-data-dir` rather than your
   real database.
2. The first of these that exists, for the current platform:

   | Platform | Directory |
   |---|---|
   | macOS | `~/Library/Application Support/{Phase,phase}` |
   | Linux | `$XDG_CONFIG_HOME` or `~/.config`, then `{Phase,phase}` |
   | Windows | `%APPDATA%\{Phase,phase}` |

3. Failing that, the first candidate — a missing socket and a wrong guess give
   the identical "Phase is not running" answer, so the fallback loses nothing.

**Both casings are probed because the app has two names.** A packaged build uses
electron-builder's `productName` (`Phase`); `npm run app:dev` has no
`productName` and falls back to package.json's `name` (`phase`). On a default
case-insensitive macOS volume those are one directory, which is why a single
hardcoded casing appeared to work; on a case-sensitive volume, or on Linux, they
are two.

Resolution happens on every call rather than at startup, so a server spawned
while Phase was closed connects as soon as you launch it — no restart needed.

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
| `src/lib/agentPrompts.ts` | The prompt texts — the one place this surface states policy, kept where it can be tested |

The design argument is in
[`docs/superpowers/specs/2026-08-14-phase-mcp-server-design.md`](superpowers/specs/2026-08-14-phase-mcp-server-design.md).
