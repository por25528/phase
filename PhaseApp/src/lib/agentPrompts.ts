/**
 * The text behind the MCP prompts `mcp/server.js` declares.
 *
 * A prompt is a conversation opener a client offers by name — nothing here
 * touches the store. It lives in `src/lib` rather than in the server because
 * the server is outside the test suite, and a prompt is the one place the
 * agent surface states POLICY ("ask before scheduling"), which is worth a
 * test. `server.js` inlines copies of these strings — the two processes
 * cannot import each other — and `agentProtocol.test.ts` pins the copy.
 */

export const PLAN_MY_DAY = [
  'Help me plan today in Phase.',
  '1. Call `today` for what is on, what slipped and where there is room, then `backlog` for what is queued.',
  '2. Propose at most three placements for today, naming the task, the project and the minute you would aim for. Prefer carried-over work, then the first item of each project.',
  '3. Do NOT call `schedule` until I say which of them to book. A sitting is a commitment and I place those.',
  '4. After booking, call `today` again and show me the day as it now reads.',
].join('\n');

export const REVIEW_WEEK = [
  'Review my week in Phase.',
  '1. Call `week` for what is planned and what is still to place, then `backlog` for the queue.',
  '2. Tell me, in a few lines: how much is on the calendar, how much is committed but unplaced, and which tasks have no estimate (`unestimated`) — those are the ones the figures cannot see.',
  '3. If something is blocked, say what on. Suggest, do not act: this is a reading of the week, not a replan.',
].join('\n');

/** `task` is a title or a fragment of one; `minutes` is what was spent. */
export function logSessionPrompt(task: string, minutes: string): string {
  return [
    `Log ${minutes} minutes on "${task}" in Phase.`,
    '1. Find the work: `backlog` and `list_projects` name projects, `get_project` shows a project\'s steps with ids. Match the title; if more than one fits, ask me which.',
    '2. Call `log_time` with its ref and the minutes (today unless I said otherwise).',
    '3. Call `time_log` on the same ref and tell me the total logged against it now.',
  ].join('\n');
}
