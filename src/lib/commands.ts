import type { SearchEntry } from './search';

/**
 * The palette's verbs.
 *
 * It used to hold three navigation rows and call itself a command palette. A
 * user coming from anything Linear-shaped types "new goal", "complete" or
 * "schedule" within the first minute and finds a finder, which is worse than
 * having no palette at all: it teaches that the keyboard route does not exist.
 *
 * This module is only the *description* of the commands — ids, labels, the
 * words people will actually type looking for them. The handlers live in the
 * component, because they need the store; keeping them apart is what lets the
 * matching be tested without mounting anything.
 */
export type CommandGroup = 'create' | 'navigate' | 'view' | 'data';

export interface Command {
  id: string;
  label: string;
  /**
   * Words that should find this command but are not in its label. Nobody types
   * "Reclaim space" looking for storage cleanup; they type "delete", "unused",
   * "images". A label is one guess at how a thing is named.
   */
  keywords?: string[];
  /** A key hint, where the command also has a shortcut. */
  hint?: string;
  group: CommandGroup;
}

export const COMMANDS: Command[] = [
  { id: 'add-task', label: 'Add a task', keywords: ['new', 'capture', 'todo'], hint: '⌘N', group: 'create' },
  { id: 'new-goal', label: 'New goal', keywords: ['create', 'project', 'add'], group: 'create' },
  { id: 'import-goal', label: 'Import a goal from text', keywords: ['paste', 'json', 'ai'], group: 'create' },

  { id: 'nav-plan', label: 'Go to Plan', keywords: ['calendar', 'week', 'schedule'], hint: '1', group: 'navigate' },
  { id: 'nav-goals', label: 'Go to Goals', keywords: ['projects', 'board', 'portfolio'], hint: '2', group: 'navigate' },
  { id: 'nav-timeline', label: 'Go to Timeline', keywords: ['gantt', 'spans', 'semester'], group: 'navigate' },

  { id: 'theme', label: 'Switch theme', keywords: ['dark', 'light', 'appearance', 'system'], group: 'view' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', keywords: ['keys', 'help', 'cheat sheet'], hint: '?', group: 'view' },

  { id: 'export', label: 'Export a backup', keywords: ['download', 'save', 'json', 'data'], group: 'data' },
  { id: 'import', label: 'Import a backup', keywords: ['restore', 'upload', 'data'], group: 'data' },
  { id: 'reclaim', label: 'Reclaim space', keywords: ['storage', 'unused', 'images', 'clean'], group: 'data' },
];

/** The rows the palette shows before anything has been typed. */
export const DEFAULT_COMMAND_IDS = ['add-task', 'new-goal', 'nav-plan', 'nav-goals'];

function norm(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * Rank commands against a query.
 *
 * Label prefix beats label substring beats keyword, so typing "go" surfaces the
 * three Go to… rows above "New goal", which merely contains the letters.
 */
export function matchCommands(query: string, commands: readonly Command[] = COMMANDS): Command[] {
  const q = norm(query);
  if (!q) return commands.filter((c) => DEFAULT_COMMAND_IDS.includes(c.id));

  const scored: { command: Command; score: number }[] = [];
  for (const command of commands) {
    const label = norm(command.label);
    let score = 0;
    if (label.startsWith(q)) score = 3;
    else if (label.includes(q)) score = 2;
    else if (command.keywords?.some((k) => norm(k).includes(q))) score = 1;
    if (score > 0) scored.push({ command, score });
  }
  // Stable within a tier: the registry's own order is deliberate.
  return scored
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.command);
}

/**
 * `>` puts the palette in command mode, the way every palette that has one
 * does it. Returns the remaining query, or null when the string is not a
 * command query at all.
 */
export function commandModeQuery(raw: string): string | null {
  return raw.startsWith('>') ? raw.slice(1) : null;
}

// ── Object actions ────────────────────────────────────────────────────────────

/**
 * What you can DO to a thing you just found.
 *
 * Search used to be navigation-only: every result opened a location and left
 * you to find the control. Marking something done from the palette is the
 * single most common thing a person wants after searching for it, and it was
 * four interactions away.
 */
export type ObjectActionId =
  | 'open'
  | 'complete'
  | 'reopen'
  | 'schedule-today'
  | 'schedule-tomorrow'
  | 'unschedule';

export interface ObjectAction {
  id: ObjectActionId;
  label: string;
}

export function actionsFor(entry: SearchEntry): ObjectAction[] {
  if (entry.kind === 'project') {
    return [{ id: 'open', label: 'Open goal' }];
  }
  // A container has no status and no estimate — there is nothing to complete
  // and nothing to place on a calendar. Offering the verbs anyway would mean
  // rows that silently do nothing.
  if (entry.container) {
    return [{ id: 'open', label: 'Open in its goal' }];
  }
  if (entry.kind === 'habit') {
    // A habit is checked off on the day it belongs to, and the calendar is the
    // only place that day exists. There is nothing honest to offer here but
    // taking you there.
    return [{ id: 'open', label: 'Show in Plan' }];
  }

  const open: ObjectAction[] = [
    { id: 'open', label: entry.kind === 'step' ? 'Open in its goal' : 'Show in Plan' },
  ];
  if (entry.done) return [...open, { id: 'reopen', label: 'Mark as not done' }];
  return [
    ...open,
    { id: 'complete', label: 'Mark as done' },
    { id: 'schedule-today', label: 'Schedule today' },
    { id: 'schedule-tomorrow', label: 'Schedule tomorrow' },
    { id: 'unschedule', label: 'Clear its schedule' },
  ];
}
