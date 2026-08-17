// The stdio MCP server. It declares tools and forwards them down the socket —
// it decides nothing, because nothing under mcp/ is covered by the test suite
// (see vitest.config.ts). Any branch worth testing belongs in src/lib. What IS
// pinned is this file's TEXT: `src/lib/agentProtocol.test.ts` reads it and
// asserts every declared tool (and the horizon enum) against AGENT_TOOLS, so a
// schema and its validator cannot drift.

import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * Where Electron's `app.getPath('userData')` puts the socket.
 *
 * The directory is named for the app, and that name is NOT one string: a
 * packaged build uses electron-builder's `productName` ("Phase"), while
 * `npm run app:dev` falls back to package.json's `name` ("phase"). A single
 * hardcoded casing appears to work on macOS only because APFS is
 * case-insensitive by default — it breaks on a case-sensitive volume, and on
 * Linux, where those are simply two different directories.
 *
 * So probe the real candidates and take the one that exists. `PHASE_SOCKET`
 * overrides everything, which is also how an end-to-end check points at a
 * throwaway `--user-data-dir` instead of the real database.
 */
function socketCandidates() {
  const home = os.homedir();
  const base = process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support')
    : process.platform === 'win32'
      ? (process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'))
      : (process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'));
  return ['Phase', 'phase'].map((name) => path.join(base, name, 'agent.sock'));
}

function socketPath() {
  if (process.env.PHASE_SOCKET) return process.env.PHASE_SOCKET;
  const candidates = socketCandidates();
  // A missing socket and a wrong guess produce the identical "not running"
  // answer, so falling back to the first candidate loses nothing.
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

function ask(request) {
  return new Promise((resolve) => {
    // Resolved per call, never cached: Phase may have been closed when this
    // process started, and the socket appears the moment it launches.
    const conn = net.connect(socketPath());
    let buffer = '';
    conn.setEncoding('utf8');
    conn.on('connect', () => conn.write(`${JSON.stringify(request)}\n`));
    conn.on('data', (chunk) => {
      buffer += chunk;
      const cut = buffer.indexOf('\n');
      if (cut === -1) return;
      conn.end();
      resolve(buffer.slice(0, cut));
    });
    conn.on('error', () => resolve(JSON.stringify({
      ok: false,
      error: 'Phase is not running. Open Phase and try again.',
    })));
  });
}

const server = new McpServer({ name: 'phase', version: '0.1.0' });

const READS = {
  today: 'What to work on now, what slipped, and what was finished today.',
  week: 'Planned, committed-but-unplaced, and free minutes for the week.',
  backlog: 'Queued work, grouped by project.',
  list_projects: 'Every project with its percentage, remaining minutes and health.',
};

for (const [tool, description] of Object.entries(READS)) {
  server.tool(tool, description, {}, async () => ({
    content: [{ type: 'text', text: await ask({ tool }) }],
  }));
}

// One piece of work. `goalId` is the project holding a step, and `null` for a
// loose task — nullable rather than optional, because that is the pairing the
// app checks and a schema that let it go missing would invite a call that
// always fails.
const REF = z.object({
  kind: z.enum(['step', 'task']),
  id: z.string(),
  goalId: z.string().nullable(),
});

// One project object, or a list of them — the top level `parseGoalImport`
// accepts. The fields inside are deliberately not restated: that schema lives
// in docs/import-schema.md, the parser owns it, and a copy here would drift.
const PROJECT = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.record(z.string(), z.unknown())),
]);

// The verbs that change something. Every shape here is for the MODEL's benefit
// only — `validAgentRequest` inside the app is the validation, because a socket
// is not a trusted caller and this process is on the wrong side of that seam to
// be trusted either.
//
// `schedule` advertises no `minutes`: a fresh sitting is sized from the
// estimate, only `resize*` changes a block's own length, and that needs the id
// of a bar that already exists. The handler refuses the field and points at
// `estimate`, so a schema offering it would advertise a call that always fails.
const WRITES = {
  create_project: [
    'Create a project from a JSON tree. See docs/import-schema.md for the format.',
    { project: PROJECT },
  ],
  add_task: [
    'Add a step to a project. Pass parentId to nest it under an existing step; omit it for a top-level one.',
    { goalId: z.string(), parentId: z.string().optional(), title: z.string() },
  ],
  rename: [
    'Rename a step, or the group holding one.',
    { nodeId: z.string(), title: z.string() },
  ],
  estimate: [
    'Set how long a task should take, in minutes. Pass null to clear it.',
    { nodeId: z.string(), minutes: z.number().nullable() },
  ],
  set_status: [
    'Set a step to todo, doing, blocked or done. Pass blockedOn to say what it is blocked by.',
    {
      nodeId: z.string(),
      status: z.enum(['todo', 'doing', 'blocked', 'done']),
      blockedOn: z.string().optional(),
    },
  ],
  set_life: [
    'Move a project into a life, BY NAME (not id — an id is not visible from out here). Pass null to unassign it. Naming one that does not exist answers with the ones that do.',
    { goalId: z.string(), life: z.string().nullable() },
  ],
  set_horizon: [
    'Move a project between the board\'s four commitment horizons: now, next, later, someday. "now" is what you are actively working on, "next" is queued, "later" and "someday" are parked — the calendar rail and the daily suggestions only draw from now and next. A capitalised spelling (Now, Next, Later, Someday) is accepted too: list_projects answers with the capitalised labels. Answers with how many projects Now holds afterwards.',
    // The enum is DOUBLED rather than preprocessed: a z.preprocess pipe's input
    // side is `unknown`, and the SDK generates the tool schema with
    // `io: 'input'`, so `horizon` dropped out of the schema's `required` set —
    // the model was told an optional argument that is in fact rejected. Eight
    // literal words keep both the required marking and the advertised list.
    // `agentProtocol.test.ts` pins this enum to `HORIZON_LABELS` in both
    // casings, and this schema is the only copy the wire can see before the
    // socket.
    { goalId: z.string(), horizon: z.enum(['now', 'next', 'later', 'someday', 'Now', 'Next', 'Later', 'Someday']) },
  ],
  complete_task: [
    'Tick a task or step as done.',
    { ref: REF },
  ],
  schedule: [
    'Book a sitting for a task on a day. Its length comes from the estimate, so set that first. startMin is the minute of the day to aim for; the nearest free slot wins.',
    { ref: REF, day: z.string(), startMin: z.number().optional() },
  ],
  delete: [
    'Delete a task or step. Reversible with undo_last until the next edit inside Phase.',
    { ref: REF },
  ],
  undo_last: [
    'Reverse the last change. Only works if nothing has been edited in Phase since.',
    {},
  ],
};

// `get_project` is a READ, and it lands here because it takes an argument —
// the loop above had no schema vocabulary to express one.
const ARGUMENT_READS = {
  get_project: [
    'The full step tree for one project: statuses, estimates and scheduled sittings.',
    { goalId: z.string() },
  ],
};

for (const [tool, [description, schema]] of [
  ...Object.entries(ARGUMENT_READS),
  ...Object.entries(WRITES),
]) {
  // `tool` last: the arguments are already stripped to the schema, so this
  // cannot be overwritten by a caller, and saying so costs nothing.
  server.tool(tool, description, schema, async (args) => ({
    content: [{ type: 'text', text: await ask({ ...args, tool }) }],
  }));
}

await server.connect(new StdioServerTransport());
