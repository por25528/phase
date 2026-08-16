import type { StepStatus } from '../db/types';
import type { WorkRef } from './expectedTime';
import { isHorizonWord, type HorizonWord } from './horizons';

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
  | { tool: 'set_horizon'; goalId: string; horizon: HorizonWord }
  | { tool: 'complete_task'; ref: WorkRef }
  | { tool: 'schedule'; ref: WorkRef; day: string; startMin?: number; minutes?: number }
  | { tool: 'delete'; ref: WorkRef }
  | { tool: 'undo_last' };

export type AgentResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export const AGENT_TOOLS = [
  'today', 'week', 'backlog', 'list_projects', 'get_project',
  'create_project', 'add_task', 'rename', 'estimate', 'set_status',
  'set_life', 'set_horizon', 'complete_task', 'schedule', 'delete', 'undo_last',
] as const;

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
      // unusable without a second one beside it. `list_projects` already
      // answers in these words.
      return id(req.goalId) && isHorizonWord(req.horizon);
    case 'complete_task':
    case 'delete':
      return validRef(req.ref);
    case 'schedule':
      return validRef(req.ref)
        && typeof req.day === 'string' && DAY.test(req.day)
        && (req.startMin === undefined || minutes(req.startMin))
        && (req.minutes === undefined || minutes(req.minutes));
    default:
      return false;
  }
}
