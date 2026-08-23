import type { StepStatus } from '../db/types';
import type { WorkRef } from './expectedTime';
import { isHorizonWord } from './horizons';

/**
 * The only verbs that may cross into the app from outside it, and the only
 * shape that may come back.
 *
 * Requests arrive from a separate process over a socket and are UNTRUSTED —
 * every field below is checked before anything reaches `actions`. Responses
 * are not validated: we generate them, and they are plain JSON for a model to
 * read.
 */

const MAX_ID = 200;
const MAX_TITLE = 500;
const MAX_MINUTES = 24 * 60;
/** A note is a document, not a title. Generous, but a socket is not a trusted caller. */
const MAX_NOTE = 200_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type AgentRequest =
  | { tool: 'today' }
  | { tool: 'week' }
  | { tool: 'backlog' }
  | { tool: 'list_projects' }
  | { tool: 'get_project'; goalId: string }
  | { tool: 'create_project'; project: unknown }
  | { tool: 'add_task'; goalId: string; parentId?: string; title: string }
  | { tool: 'rename'; nodeId: string; title: string }
  | { tool: 'estimate'; nodeId: string; minutes: number | null }
  | { tool: 'set_status'; nodeId: string; status: StepStatus; blockedOn?: string }
  | { tool: 'set_life'; goalId: string; life: string | null }
  | { tool: 'set_horizon'; goalId: string; horizon: string }
  | { tool: 'complete_task'; ref: WorkRef }
  | { tool: 'schedule'; ref: WorkRef; day: string; startMin?: number; minutes?: number }
  | { tool: 'delete'; ref: WorkRef }
  | { tool: 'undo_last' }
  | { tool: 'get_note'; ref: NoteRef }
  | { tool: 'set_note'; ref: NoteRef; markdown: string }
  | { tool: 'append_note'; ref: NoteRef; markdown: string }
  | { tool: 'time_log'; ref: WorkRef }
  | { tool: 'log_time'; ref: WorkRef; minutes: number; date?: string }
  | { tool: 'clear_time'; ref: WorkRef };

/**
 * Something that carries a note: a step (any node, group or leaf — both have
 * `notes`) or a project. NOT a loose task: `Task` has no notes field, and a
 * verb that accepted one would have nowhere to put it.
 */
export interface NoteRef {
  kind: 'step' | 'project';
  id: string;
}

export type AgentResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export const AGENT_TOOLS = [
  'today', 'week', 'backlog', 'list_projects', 'get_project',
  'create_project', 'add_task', 'rename', 'estimate', 'set_status',
  'set_life', 'set_horizon', 'complete_task', 'schedule', 'delete', 'undo_last',
  'get_note', 'set_note', 'append_note', 'time_log', 'log_time', 'clear_time',
] as const;

/**
 * The prompts and resources `mcp/server.js` declares. They have no handler on
 * this side of the socket — a resource forwards to the read named beside it
 * and a prompt is text — but the server's copy is pinned against these lists
 * by `agentProtocol.test.ts` exactly as `AGENT_TOOLS` is.
 */
export const AGENT_RESOURCES = {
  'phase://today': 'today',
  'phase://week': 'week',
  'phase://backlog': 'backlog',
  'phase://projects': 'list_projects',
} as const;

export const AGENT_PROMPTS = ['plan-my-day', 'review-week', 'log-session'] as const;

export function okResponse(data: unknown): AgentResponse {
  return { ok: true, data };
}

export function errorResponse(message: string): AgentResponse {
  return { ok: false, error: message };
}

function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID;
}

function optionalId(value: unknown): boolean {
  return value === undefined || id(value);
}

function title(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TITLE;
}

function minutes(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= 0 && value <= MAX_MINUTES;
}

function validNoteRef(value: unknown): value is NoteRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Record<string, unknown>;
  return (ref.kind === 'step' || ref.kind === 'project') && id(ref.id);
}

/** Markdown may be empty (that is how a note is cleared) but must be a string. */
function markdown(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_NOTE;
}

function validRef(value: unknown): value is WorkRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Record<string, unknown>;
  if (!id(ref.id)) return false;
  if (ref.kind === 'step') return id(ref.goalId);
  if (ref.kind === 'task') return ref.goalId === null || id(ref.goalId);
  return false;
}

export function validAgentRequest(value: unknown): value is AgentRequest {
  if (!value || typeof value !== 'object') return false;
  const req = value as Record<string, unknown>;
  switch (req.tool) {
    case 'today':
    case 'week':
    case 'backlog':
    case 'list_projects':
    case 'undo_last':
      return true;
    case 'get_project':
      return id(req.goalId);
    case 'create_project':
      // Shape is `parseGoalImport`'s contract, not ours — it owns the schema
      // (docs/import-schema.md) and rejects malformed input all-or-nothing.
      return !!req.project && typeof req.project === 'object';
    case 'add_task':
      return id(req.goalId) && optionalId(req.parentId) && title(req.title);
    case 'rename':
      return id(req.nodeId) && title(req.title);
    case 'estimate':
      return id(req.nodeId) && (req.minutes === null || minutes(req.minutes));
    case 'set_status':
      return id(req.nodeId)
        && (req.status === 'todo' || req.status === 'doing'
          || req.status === 'blocked' || req.status === 'done')
        && (req.blockedOn === undefined || title(req.blockedOn));
    case 'set_life':
      // A life is named, not id'd: an id is invisible from outside the app, so
      // `null` (unassign) is the only non-string this may carry.
      return id(req.goalId) && (req.life === null || title(req.life));
    case 'set_horizon':
      // A word, not a column: a column index is invisible from outside the app
      // and no read verb reports one, so an index-taking verb would be
      // unusable without a second one beside it. `list_projects` answers in
      // the same words CAPITALISED, and this gate accepts either casing.
      return id(req.goalId) && isHorizonWord(req.horizon);
    case 'complete_task':
    case 'delete':
      return validRef(req.ref);
    case 'schedule':
      return validRef(req.ref)
        && typeof req.day === 'string' && DAY.test(req.day)
        && (req.startMin === undefined || minutes(req.startMin))
        && (req.minutes === undefined || minutes(req.minutes));
    case 'get_note':
      return validNoteRef(req.ref);
    case 'set_note':
    case 'append_note':
      return validNoteRef(req.ref) && markdown(req.markdown);
    case 'time_log':
    case 'clear_time':
      return validRef(req.ref);
    case 'log_time':
      // Strictly positive: `logSession` refuses zero, and a zero-minute entry
      // would be a measurement nobody took. The date is a shape check here;
      // "not after today" needs a clock and is the handler's to say.
      return validRef(req.ref)
        && minutes(req.minutes) && (req.minutes as number) > 0
        && (req.date === undefined || (typeof req.date === 'string' && DAY.test(req.date)));
    default:
      return false;
  }
}
