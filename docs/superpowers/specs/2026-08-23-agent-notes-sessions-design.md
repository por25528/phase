# Agent surface: notes, time ledger, prompts and resources

Date: 2026-08-23. Status: approved.

## Scope

Extend the MCP server (`mcp/server.js` → socket → `agentReads.ts`/`agentWrites.ts`)
with notes and the time ledger, and declare MCP prompts and resources. No in-app
agent, no live focus-session verbs (decided: a terminal cannot watch a timer, and
the shelf's "was that real?" question has no agent to answer it).

## Tools

### Notes

`NoteRef` is `{ kind: 'step' | 'project', id }`. Tasks have no notes field and get
no verb — the store has nowhere to put one.

| Tool | Args | Behaviour |
|---|---|---|
| `get_note` | `ref` | `{ title, markdown }`; `''` when unset |
| `set_note` | `ref, markdown` | replaces; `''` clears. `setNodeNotes` / `setGoalNotes` |
| `append_note` | `ref, markdown` | existing + `\n\n` + text (or just text when empty), one write |

Each calls `flushPendingNote()` before reading, so an in-app editor's unsaved
typing is persisted first. An editor still open on that note keeps its buffer and
its next save wins; documented, not guarded.

### Time ledger

`ref` is the existing `WorkRef`.

| Tool | Args | Behaviour |
|---|---|---|
| `time_log` | `ref` | `{ loggedMin, sessions: [{ id, date, minutes, note }] }` via `loggedForNode`/`loggedForTask` |
| `log_time` | `ref, minutes, date?` | `logSession`; 1–1440, `YYYY-MM-DD`, not after today; arms the UI's undo |
| `clear_time` | `ref` | `clearSessionsFor`; refuses when nothing was logged |

## Prompts and resources

Resources `phase://today`, `phase://week`, `phase://backlog`, `phase://projects`
forward to the matching read. Prompts `plan-my-day`, `review-week`,
`log-session(task, minutes)`; text lives in `src/lib/agentPrompts.ts` so it is
testable, and `agentProtocol.test.ts` asserts `server.js` declares each.

## Tests

`agentProtocol.test.ts` (validation, parity for tools/prompts/resources),
`agentWrites.test.ts` (which action ran, refusal propagation, `persistFailed`),
`agentReads.test.ts` (reads match the lib). `docs/mcp-server.md` updated.
