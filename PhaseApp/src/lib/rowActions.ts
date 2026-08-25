/**
 * What a task row's `⋯` menu offers, and nothing else.
 *
 * This mirrors `commands.ts`: the registry names the verbs and states when each
 * one applies, and the handlers live with the store in `GoalTree`. Keeping them
 * apart is what lets "does a done leaf still offer Schedule?" be a unit test
 * rather than a component test that has to mount a tree to ask.
 *
 * The menu exists because the row could not hold what it was carrying. A leaf
 * rendered a grip, a status box, a title, a schedule cell, an estimate control
 * and a log-time control at rest, then revealed rename, add-subtask, cycle-
 * status and delete on hover — ten controls to manipulate one task. Scanning a
 * list of twenty of them meant reading past sixty small glyphs. The high-
 * frequency properties stay inline and clickable; everything below that moves
 * in here.
 */

export type RowActionId =
  | 'open'
  | 'select'
  | 'add-task'
  | 'rename'
  | 'schedule'
  | 'estimate'
  | 'milestone'
  | 'park'
  | 'demand'
  | 'breakdown'
  | 'indent'
  | 'outdent'
  | 'delete';

export interface RowAction {
  id: RowActionId;
  label: string;
  /**
   * The keyboard route to the same verb. Shown in the menu so the menu teaches
   * its own shortcuts — the reason `ShortcutsOverlay` had to be opened to
   * discover that `⌘]` indents.
   */
  hint?: string;
  tone?: 'danger';
  /** Verbs sharing a number sit together; a separator falls between groups. */
  group: number;
}

export interface RowActionContext {
  /** A container is opened as its own workspace; a leaf is not. */
  isContainer: boolean;
  isDone: boolean;
  isMilestone: boolean;
  /** A leaf set aside. A container derives it and never sets it. */
  isParked: boolean;
  /** False for the first child in a sibling run — there is nothing to nest under. */
  canIndent: boolean;
  /** False at the root — there is nowhere to go. */
  canOutdent: boolean;
}

/**
 * The verbs for one row, in menu order.
 *
 * Scheduling and estimating are LEAF-only, matching the store: a container has
 * no `estimateMin` and no `blocks`, and is scheduled through its tasks. Offering
 * them on a container would be a menu item that opens a panel which then has to
 * explain why it cannot do anything.
 *
 * A DONE leaf keeps Schedule and Estimate. That looks wrong for about a second
 * and is right: completion here is a checkbox, so it is routinely ticked early
 * or by accident, and a menu that removes the repair verbs from the row you
 * just mis-ticked is a menu that makes the mistake permanent. `toggleLeaf`
 * reopens, and the properties are still the task's.
 *
 * Deliberately ABSENT: Duplicate and Move-to-goal, both of which the brief for
 * this menu suggests. Neither has a store action, and a menu item that has to
 * grow a new undoable mutation underneath it is not a menu change — it is a
 * feature wearing one. They stay out until the action exists.
 */
export function rowActions(ctx: RowActionContext): RowAction[] {
  const out: RowAction[] = [];

  if (ctx.isContainer) out.push({ id: 'open', label: 'Open', hint: 'O', group: 0 });
  // Offered on BOTH kinds of row, because the selection takes both — the bulk
  // bar expands a container through `allLeavesUnder` and always has. This is
  // the only pointer route to a selection that does not require knowing to
  // hold ⌘, and the `hint` is what teaches the key for next time; the same
  // trade that makes `⌘]` findable without opening the shortcuts overlay.
  out.push({ id: 'select', label: 'Select', hint: 'Space', group: 0 });
  out.push({ id: 'add-task', label: 'Add task', hint: '⌘↵', group: 0 });
  out.push({ id: 'rename', label: 'Rename', hint: '↵', group: 0 });

  if (!ctx.isContainer) {
    out.push({ id: 'schedule', label: 'Schedule…', hint: '⇧S', group: 1 });
    out.push({ id: 'estimate', label: 'Estimate…', hint: 'E', group: 1 });
    out.push({
      id: 'milestone',
      label: ctx.isMilestone ? 'Not a milestone' : 'Make a milestone',
      group: 1,
    });
    // Parking is a deliberate verb and not a step in the `S` cycle: cycling
    // through "not now" on the way to "blocked" would park things by accident.
    out.push({ id: 'park', label: ctx.isParked ? 'Unpark' : 'Park', hint: 'P', group: 1 });
  }

  // The first verb offered on BOTH a leaf and a container. Schedule and Estimate
  // are leaf-only because the store has no container equivalent; demand DOES
  // have one, and a container's is the whole point — it is what the subtree
  // inherits.
  out.push({ id: 'demand', label: 'Focus needed…', group: 1 });

  if (ctx.canIndent) out.push({ id: 'indent', label: 'Indent', hint: '⌘]', group: 2 });
  if (ctx.canOutdent) out.push({ id: 'outdent', label: 'Outdent', hint: '⌘[', group: 2 });

  out.push({ id: 'delete', label: 'Delete', hint: '⌫', tone: 'danger', group: 3 });
  return out;
}

/**
 * Split a verb list into the runs a separator falls between.
 *
 * Shared by the row's menu and the page's. The grouping is asserted once here,
 * so a surface that grouped by eye cannot drift the first time a verb moves.
 */
function groupByRun(actions: RowAction[]): RowAction[][] {
  const groups: RowAction[][] = [];
  for (const action of actions) {
    const last = groups.at(-1);
    if (last && last[0].group === action.group) last.push(action);
    else groups.push([action]);
  }
  return groups;
}

/** The same list, split into the runs a separator falls between. */
export function rowActionGroups(ctx: RowActionContext): RowAction[][] {
  return groupByRun(rowActions(ctx));
}

/**
 * What a task PAGE's `⋯` offers — a strict subset of the row's menu.
 *
 * Schedule, Estimate and Milestone are absent because the page renders them as
 * chips under the title: a menu item duplicating a control two inches above it
 * is the row's old ten-control problem moved indoors.
 *
 * Add task is absent for a stronger reason. It converts the leaf into a
 * container, and the page only exists for leaves — so the one gesture would
 * eject the reader from the page they are on. Converting a task into a group
 * stays a tree operation. The sanctioned route from a page is Break into
 * smaller steps, which ends in the same conversion but shows what it is about
 * to create first — and which is HERE, in its own run between Rename and the
 * move verbs. It used to be a standing button under the note, where an empty
 * task left it stranded below 220px of blank document, the only thing on the
 * page competing with the document. The oversized INVITATION is a separate
 * thing and stays inline: when the estimate says the task will not fit one
 * sitting, a sentence saying so has earned the room, and the menu is where the
 * same verb waits the rest of the time.
 *
 * It stays out of `rowActions`: `ProposalPanel` is leaf-only and lives on the
 * page, so a tree row offering it would open a surface the row cannot show.
 *
 * `open` is absent because a leaf has nothing behind it, which is exactly the
 * rule `rowActions` already applies.
 *
 * Takes only `canIndent`/`canOutdent`/`isParked` — a leaf's page always
 * passes `isContainer: false`, and `isDone`/`isMilestone` don't gate anything
 * here (see the docstring above: Schedule/Estimate/Milestone are absent
 * regardless, because the page already shows them as chips). `isParked` is
 * the exception: the page has no park chip, so — unlike Schedule/Estimate/
 * Milestone — the menu is the only route to it and it stays in, beside
 * Break into smaller steps in the same group. The full `RowActionContext`
 * would let a caller satisfy the type with values that are never read.
 */
export function taskPageActions(
  ctx: Pick<RowActionContext, 'canIndent' | 'canOutdent' | 'isParked'>,
): RowAction[] {
  const out: RowAction[] = [];
  out.push({ id: 'rename', label: 'Rename', hint: '↵', group: 0 });
  out.push({ id: 'breakdown', label: 'Break into smaller steps', group: 1 });
  out.push({ id: 'park', label: ctx.isParked ? 'Unpark' : 'Park', hint: 'P', group: 1 });
  if (ctx.canIndent) out.push({ id: 'indent', label: 'Indent', hint: '⌘]', group: 2 });
  if (ctx.canOutdent) out.push({ id: 'outdent', label: 'Outdent', hint: '⌘[', group: 2 });
  out.push({ id: 'delete', label: 'Delete', hint: '⌫', tone: 'danger', group: 3 });
  return out;
}

/** The same list, split into the runs a separator falls between. */
export function taskPageActionGroups(
  ctx: Pick<RowActionContext, 'canIndent' | 'canOutdent' | 'isParked'>,
): RowAction[][] {
  return groupByRun(taskPageActions(ctx));
}
