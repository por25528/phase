import { useState, useRef, useEffect, useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { GoalNode, Session } from '../db/types';
import { useAppStore } from '../state/store';
import { nodePct } from '../lib/pct';
import { IconChevronRight, IconDiamond, IconGrip, IconPencil, IconX } from './Icons';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { InlineEdit } from './InlineEdit';
import { EstimateControl } from './EstimateControl';
import { LogTimeControl } from './LogTimeControl';
import { loggedForNode } from '../lib/actuals';
import { pruneSelection, rangeBetween, visibleRowIds } from '../lib/selection';
import { isDone, stepStatus, containerStatus, cycleStatus, STATUS_WORD, type StepStatus } from '../lib/status';
import { scheduleCell } from '../lib/rowSchedule';
import { todayStr } from '../lib/dates';

// ── Hooks ────────────────────────────────────────────────────────────────────

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

// ── Shared primitives ─────────────────────────────────────────────────────────

// STATUS_WORD is imported from src/lib/status.ts — do NOT redeclare it here.
// The tree label, the panel radio group and the board chip must name a state
// the same way.
const STATUS_BOX: Record<StepStatus, string> = {
  todo: 'border-check group-hover/cb:border-muted',
  doing: 'border-accent',
  blocked: 'border-warn bg-warn-tint',
  done: 'bg-accent border-accent',
};

function LeafStatusBox({
  status,
  onToggle,
  label,
}: {
  status: StepStatus;
  onToggle: () => void;
  label: string;
}) {
  return (
    // The 17px box sits inside a 24×24 button: WCAG 2.2 AA wants a 24px target,
    // but a 24px box would overpower the row. `border-check` clears 1.4.11's 3:1.
    <button
      type="button"
      role="checkbox"
      aria-checked={status === 'done'}
      aria-label={`${label} — ${STATUS_WORD[status]}`}
      // -1 like every other control on the row. It was the one tabbable child,
      // so focus landed on it between rows — and from there the row's
      // `e.target !== e.currentTarget` guard swallowed ↑/↓ and ⌘]/⌘[. The row
      // itself is the focusable unit and handles Space, so nothing is lost.
      tabIndex={-1}
      className="w-[24px] h-[24px] -m-[3px] flex-shrink-0 grid place-items-center group/cb"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      <span
        className={`w-[17px] h-[17px] border-[1.5px] rounded-[6px] grid place-items-center transition-all duration-100 ${STATUS_BOX[status]}`}
      >
        {status === 'done' && (
          <svg viewBox="0 0 12 12" className="w-[11px] h-[11px] stroke-accent-contrast fill-none" strokeWidth={2.4}>
            <path d="M2 6.2 4.6 9 10 3" />
          </svg>
        )}
        {status === 'doing' && (
          <span className="w-[7px] h-[7px] rounded-full bg-accent" aria-hidden="true" />
        )}
        {status === 'blocked' && (
          <svg viewBox="0 0 12 12" className="w-[11px] h-[11px] stroke-warn fill-none" strokeWidth={2}>
            <path d="M2.5 9.5 9.5 2.5" />
          </svg>
        )}
      </span>
    </button>
  );
}

// ── Expand animation ──────────────────────────────────────────────────────────

// Fades in on mount; no close animation (children unmount immediately on collapse
// so [data-row] queries only hit visible rows during arrow navigation).
function FadeIn({ reducedMotion, children }: { reducedMotion: boolean; children: ReactNode }) {
  const [opacity, setOpacity] = useState(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) {
      setOpacity(1);
      return;
    }
    const id = requestAnimationFrame(() => setOpacity(1));
    return () => cancelAnimationFrame(id);
  }, [reducedMotion]);
  return (
    <div style={{ opacity, transition: reducedMotion ? undefined : 'opacity 150ms ease' }}>
      {children}
    </div>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

// Guard: only reorder if active and over are direct siblings in the same parent list.
function findSiblings(nodes: GoalNode[], aId: string, bId: string): boolean {
  const ids = nodes.map((n) => n.id);
  if (ids.includes(aId) && ids.includes(bId)) return true;
  for (const node of nodes) {
    if (node.children && findSiblings(node.children, aId, bId)) return true;
  }
  return false;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Actions = ReturnType<typeof useAppStore>['actions'];

interface SharedProps {
  depth: number;
  expanded: Set<string>;
  actions: Actions;
  reducedMotion: boolean;
  /** The step just created by Enter — it opens ready to type. */
  newNodeId: string | null;
  /** Multi-selection, for bulk complete/delete. Empty for the ordinary case. */
  selected: Set<string>;
  /** How a row reports a click or a shift-arrow to the tree that owns the set. */
  onSelect: (id: string, mode: SelectMode) => void;
  /** Runs the selection's bulk action from a row's keyboard handler. */
  onBulk: (action: 'complete' | 'delete') => void;
  /** The whole ledger; each leaf sums its own. Small enough that filtering per
   *  row is cheaper than building a map on every store notification. */
  sessions: Session[];
}

/**
 * `toggle` — Cmd/Ctrl-click, add or remove one row.
 * `range`  — Shift-click / Shift+Arrow, the run from the anchor to here.
 * `clear`  — a plain click while a selection exists: dismiss it and do nothing
 *            else, so the click that ends a selection cannot also tick a box.
 */
export type SelectMode = 'toggle' | 'range' | 'clear';

// ── SelectionBar ──────────────────────────────────────────────────────────────

/**
 * What a multi-selection can do, and how many rows it holds.
 *
 * Always mounted, height-collapsed when empty, so the `aria-live` region below
 * is present in the accessibility tree before the first row is picked — a live
 * region that appears at the same moment as its own first message is not
 * reliably announced.
 *
 * "Delete" is styled as the destructive one and sits last, away from the button
 * a hand is already on. There is no confirmation dialog because there is a real
 * undo: the toast names the subtree count and holds for 15 seconds, which is
 * this app's established trade everywhere else.
 */
function SelectionBar({
  count,
  onComplete,
  onSetStatus,
  onDelete,
  onClear,
}: {
  count: number;
  onComplete: () => void;
  onSetStatus: (next: StepStatus) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div
      className={`overflow-hidden transition-[max-height,opacity] duration-150 ${
        count > 0 ? 'max-h-[48px] opacity-100 mb-[6px]' : 'max-h-0 opacity-0'
      }`}
    >
      <div className="flex items-center gap-[8px] px-[8px] py-[6px] rounded-field border border-line-2 bg-field">
        {/* Named, because dnd-kit mounts its own unnamed `role="status"` live
            region for drag announcements — two anonymous status regions on one
            page are indistinguishable to anything reading them. */}
        <span
          role="status"
          aria-live="polite"
          aria-label="Selection"
          className="text-ui text-ink-soft flex-1 min-w-0"
        >
          {count > 0 && `${count} task${count === 1 ? '' : 's'} selected`}
        </span>
        {/* Conditionally rendered, not just untabbable. `max-h-0 opacity-0`
            clips the bar visually and hides it from nobody: a screen reader in
            browse mode still finds "Complete", "Delete" and "Clear" sitting
            there permanently, and `tabIndex={-1}` only keeps them out of the
            TAB order. The live region above stays mounted either way, which is
            the part that has to exist before its first message. */}
        {count > 0 && (
          <>
            <button
              type="button"
              onClick={onComplete}
              className="text-compact font-semibold text-accent-deep px-[8px] py-[4px] min-h-[24px] inline-flex items-center rounded-field hover:bg-accent-tint"
            >
              Complete
            </button>
            {/* Native <select> — no outside-click/Escape wiring to duplicate,
                and it applies the moment a status is picked. Resets to the
                placeholder afterwards since the selection holds a mix of
                statuses, not one shared value to keep shown as selected. */}
            <select
              value=""
              onChange={(e) => {
                const next = e.target.value as StepStatus;
                if (next) onSetStatus(next);
                e.target.value = '';
              }}
              aria-label="Set status"
              className="text-compact font-medium text-ink-soft px-[8px] py-[4px] min-h-[24px] rounded-field border border-line-2 bg-transparent hover:bg-hover focus-visible:border-accent"
            >
              <option value="" disabled>Set status…</option>
              {(['todo', 'doing', 'blocked', 'done'] as const).map((s) => (
                <option key={s} value={s}>{STATUS_WORD[s]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={onDelete}
              className="text-compact font-semibold text-warn px-[8px] py-[4px] min-h-[24px] inline-flex items-center rounded-field hover:bg-warn-tint"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={onClear}
              className="text-compact font-medium text-muted px-[8px] py-[4px] min-h-[24px] inline-flex items-center rounded-field hover:bg-hover hover:text-ink"
            >
              Clear
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── GoalTree (public export, owns DndContext) ─────────────────────────────────

export function GoalTree({ nodes, depth = 0 }: { nodes: GoalNode[]; depth?: number }) {
  const { expanded, actions, newNodeId, sessions } = useAppStore();
  const reducedMotion = usePrefersReducedMotion();

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Where a shift-range measures from. Held separately from the set because the
  // set has no order and a range needs a fixed end to grow away from.
  const anchor = useRef<string | null>(null);

  /*
   * A selection outlives the data it points at — a delete removes rows and an
   * undo brings them back, and switching projects re-renders this tree with a
   * completely different set of ids. `pruneSelection` returns the SAME Set when
   * nothing was lost, so this settles immediately instead of looping.
   */
  useEffect(() => {
    setSelected((current) => pruneSelection(nodes, current));
  }, [nodes]);

  const visible = visibleRowIds(nodes, expanded);

  function clearSelection(): void {
    anchor.current = null;
    setSelected(new Set());
  }

  function onSelect(id: string, mode: SelectMode): void {
    if (mode === 'clear') {
      clearSelection();
      return;
    }
    if (mode === 'toggle') {
      anchor.current = id;
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    // range: with no anchor yet, a shift-click behaves as a plain first pick.
    const from = anchor.current ?? id;
    const run = rangeBetween(visible, from, id);
    // `pruneSelection` prunes the SET; nothing prunes this ref. Once the anchor
    // left the visible list — collapsed, deleted, or a different project loaded
    // into the still-mounted tree — `rangeBetween` returned `[]` and re-writing
    // the same dead anchor made every later Shift-click select exactly one row,
    // permanently. Re-anchor on the row that was actually clicked instead.
    anchor.current = run.length > 0 ? from : id;
    setSelected(new Set(run.length > 0 ? run : [id]));
  }

  function onBulk(action: 'complete' | 'delete'): void {
    const ids = [...selected];
    if (ids.length === 0) return;
    const wrote = action === 'complete' ? actions.completeNodes(ids) : actions.removeNodes(ids);
    // Only clear if something actually happened. Both actions refuse silently —
    // a frozen (completed) project, or a selection whose leaves are all done
    // already — and dropping the bar and the highlights anyway read as "done"
    // when nothing had been.
    if (wrote) clearSelection();
  }

  function onSetStatus(next: StepStatus): void {
    const ids = [...selected];
    if (ids.length === 0) return;
    // ONE write, ONE undo entry — setNodesStatus refuses (false) when nothing
    // in the selection actually changes, same silent-refusal contract as
    // complete/delete above.
    if (actions.setNodesStatus(ids, next)) clearSelection();
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const aId = String(active.id);
    const oId = String(over.id);
    // Only reorder within the same sibling list — never cross-parent.
    if (findSiblings(nodes, aId, oId)) {
      actions.reorderSiblingNodes(aId, oId);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {/* The rows are `role="treeitem"`, which is only meaningful inside a
          `tree`. Nested levels are wrapped in `role="group"` by GoalTreeNode. */}
      <SelectionBar
        count={selected.size}
        onComplete={() => onBulk('complete')}
        onSetStatus={onSetStatus}
        onDelete={() => onBulk('delete')}
        onClear={clearSelection}
      />
      {/* `aria-multiselectable` is a capability, so it is static — flipping it
          on only once a selection exists would describe the tree as
          single-select right up until the moment it wasn't. It is also what
          makes the per-row `aria-selected` mean "one of several" rather than
          "the cursor is here". */}
      <div role="tree" aria-label="Tasks" aria-multiselectable="true">
        <GoalSiblingList
          nodes={nodes}
          depth={depth}
          expanded={expanded}
          actions={actions}
          reducedMotion={reducedMotion}
          newNodeId={newNodeId}
          selected={selected}
          onSelect={onSelect}
          onBulk={onBulk}
          sessions={sessions}
        />
      </div>
    </DndContext>
  );
}

// ── GoalSiblingList — one level with its own SortableContext ──────────────────

function GoalSiblingList({ nodes, ...shared }: { nodes: GoalNode[] } & SharedProps) {
  return (
    <SortableContext items={nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
      {nodes.map((n) => (
        <GoalTreeNode key={n.id} n={n} {...shared} />
      ))}
    </SortableContext>
  );
}

// ── GoalTreeNode — sortable, keyboard-aware row ───────────────────────────────

function GoalTreeNode({
  n,
  depth,
  expanded,
  actions,
  reducedMotion,
  newNodeId,
  selected,
  onSelect,
  onBulk,
  sessions,
}: { n: GoalNode } & SharedProps) {
  // A row created by Enter mounts straight into its editor, so the sequence is
  // "Enter, type, Enter" rather than "Enter, hunt for the row, double-click,
  // type". The initialiser runs once per mount and the flag is cleared below,
  // so collapsing and re-expanding never reopens an old editor.
  // Stable id so the row can `aria-owns` its children group, which the DOM
  // renders as a sibling rather than a descendant.
  const groupId = useId();
  const isNew = n.id === newNodeId;
  const [editing, setEditing] = useState(isNew);
  useEffect(() => {
    if (isNew) actions.clearNewNode();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one shot, on mount
  }, []);
  const hasKids = Boolean(n.children && n.children.length > 0);
  const isOpen = hasKids && expanded.has(n.id);
  const when = scheduleCell(n, todayStr());
  const ind = depth * 22;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition: dndTransition,
  } = useSortable({ id: n.id });

  // Only apply transform/transition during an active drag; otherwise leave the
  // element in normal flow (avoids spurious stacking-context / z-index side-effects).
  const sortableStyle: CSSProperties = transform
    ? {
        transform: CSS.Transform.toString(transform),
        transition: reducedMotion ? undefined : (dndTransition ?? undefined),
        zIndex: 1,
        position: 'relative',
      }
    : {};

  function commitRename(v: string) {
    if (v && v !== n.title) actions.renameNode(n.id, v);
    setEditing(false);
  }

  /**
   * A plain click OPENS the row. It does not complete it and it does not
   * expand it.
   *
   * The row used to run a "primary action" that depended on what the row was:
   * completion on a leaf, expand/collapse on a container. Efficient once
   * memorised, and unusually dangerous — the single most consequential action
   * in the product, the one that moves every number, was bound to the largest
   * click target on the page, on the object people click at to read it. A
   * mis-aimed click on a title checked work off.
   *
   * So the row behaves the way a row behaves everywhere else: clicking it makes
   * it the subject. The checkbox completes, the chevron expands, and each of
   * those is a deliberate 24px target that says what it does.
   */
  /**
   * Modifier clicks are caught on the way DOWN, before any child sees them.
   *
   * Bubbling does not work here. Nearly every pixel of a row is covered by a
   * child that deliberately stops propagation — the title span (so a rename
   * double-click cannot rewrite `doneAt`), the drag handle, the checkbox, and
   * the three hover controls. A real browser click therefore lands on one of
   * them and never reaches the row, so Cmd-click and Shift-click selected
   * nothing anywhere on the row. (Tests that dispatch straight at the row
   * element cannot see this: `e.target` is then the row itself.)
   *
   * Capture also gives the right semantics for the controls: Cmd-clicking the
   * ✕ adds the row to the selection instead of deleting it.
   */
  function handleRowClickCapture(e: React.MouseEvent) {
    if (editing) return;
    if (!(e.metaKey || e.ctrlKey || e.shiftKey)) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(n.id, e.metaKey || e.ctrlKey ? 'toggle' : 'range');
  }

  function handleRowClick(e: React.MouseEvent) {
    if (editing) return;
    // Modifiers are handled in the capture phase above and never arrive here.
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    // A plain click while a selection is up dismisses it and stops there — the
    // click people use to "get out" must not also do something to a row.
    if (selected.size > 0) { onSelect(n.id, 'clear'); return; }
    actions.openStep(n.id);
  }

  // Move focus to the next/previous VISIBLE row in DOM order. Because children
  // are unmounted when collapsed ({isOpen && ...}), only visible rows appear in
  // querySelectorAll('[data-row]').
  function focusNeighbor(dir: 'up' | 'down'): string | null {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-row]'));
    const idx = rows.findIndex((r) => r.dataset.nodeId === n.id);
    if (idx === -1) return null;
    const neighbor = dir === 'down' ? rows[idx + 1] : rows[idx - 1];
    if (!neighbor) return null;
    neighbor.focus();
    return neighbor.dataset.nodeId ?? null;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Only keys aimed at the ROW itself. `keydown` bubbles, so without this
    // every key pressed inside the rename input reached the handlers below:
    // Tab re-parented the node mid-rename, and ArrowDown threw focus to the
    // next row and abandoned the edit.
    if (e.target !== e.currentTarget) return;

    /*
     * Indent / outdent live on Cmd/Ctrl+] and Cmd/Ctrl+[ — NOT on Tab.
     *
     * Tab used to restructure the project, which made this a keyboard trap in
     * the WCAG 2.1.2 sense: every row is `tabIndex={0}`, so once focus entered
     * the tree neither Tab nor Shift+Tab could move it out, and the drawer's
     * Notes, checkpoints and "+ add step" were unreachable without a mouse. It
     * was destructive with it: the second Tab a user pressed re-parented a
     * step, `indentNode` strips the new parent's `done` and planned slot, and
     * none of it is undoable. On the first sibling it silently did nothing, so
     * people pressed it again on the second row and watched the tree reshape.
     *
     * Notion's real rule is Tab-while-editing-text; its documented alternative
     * is exactly this chord, and a chord cannot be hit by someone trying to
     * leave the tree.
     */
    if ((e.metaKey || e.ctrlKey) && (e.key === ']' || e.key === '[')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === ']') actions.indentNode(n.id);
      else actions.outdentNode(n.id);
      return;
    }
    // Every branch below is a BARE key. `appKeyboard.ts` screens modifiers for
    // exactly this reason: without it ⌘→ collapsed a container and swallowed
    // the platform shortcut, and ⌥⌫ deleted the focused row.
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    // Right/Left → expand/collapse, per the ARIA treeview pattern.
    if (plain && e.key === 'ArrowRight' && hasKids && !isOpen) {
      e.preventDefault();
      actions.toggleExpand(n.id);
      return;
    }
    if (plain && e.key === 'ArrowLeft' && hasKids && isOpen) {
      e.preventDefault();
      actions.toggleExpand(n.id);
      return;
    }
    // Arrow keys → roving focus, or Shift+Arrow to grow the selection with it.
    if (plain && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      // The row must be IN the selection before the range extends, or the first
      // Shift+Arrow selects only the row you arrive at and leaves the one you
      // started from behind.
      if (e.shiftKey && selected.size === 0) onSelect(n.id, 'toggle');
      const landed = focusNeighbor(e.key === 'ArrowDown' ? 'down' : 'up');
      if (e.shiftKey && landed) onSelect(landed, 'range');
      return;
    }
    // Select every row on screen. Scoped to the tree because focus is in it —
    // the browser's own Select All is not useful over a list of steps.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-row]'));
      const first = rows[0]?.dataset.nodeId;
      const last = rows[rows.length - 1]?.dataset.nodeId;
      // `toggle` plants the anchor, `range` grows to the far end. Both run in
      // one tick; the range's `setSelected` replaces the toggle's, which is
      // exactly the intended end state.
      if (first && last) { onSelect(first, 'toggle'); onSelect(last, 'range'); }
      return;
    }
    // Escape clears the selection and goes NO further: App's global handler
    // reads Escape as "close the drawer", and losing the whole drawer because
    // you wanted to drop a selection is a poor trade.
    if (plain && e.key === 'Escape' && selected.size > 0) {
      e.preventDefault();
      e.stopPropagation();
      onSelect(n.id, 'clear');
      return;
    }
    // Delete — the selection if there is one, otherwise the focused row. There
    // was no delete key at all before; both routes are undoable.
    if (plain && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      if (selected.size > 0) onBulk('delete');
      else actions.removeNode(n.id);
      return;
    }
    // Space adds the focused row to the selection, per the ARIA treeview
    // pattern and per every list this product is trying to feel like. It used
    // to complete a leaf — the keyboard twin of the row click, and dangerous
    // for the same reason, on the key most likely to be pressed by someone who
    // thought they were scrolling.
    //
    // Always prevented: on a container it previously fell through and scrolled
    // the page, which is a key that both does nothing and does something wrong.
    if (plain && e.key === ' ' && !editing) {
      e.preventDefault();
      onSelect(n.id, 'toggle');
      return;
    }
    // X completes — the selection if there is one, otherwise this row. A letter
    // rather than Space, because completion is the one keystroke here that
    // moves a number and it should take an aimed press.
    if (plain && (e.key === 'x' || e.key === 'X') && !editing) {
      e.preventDefault();
      if (selected.size > 0) onBulk('complete');
      else if (!hasKids) actions.toggleLeaf(n.id);
      return;
    }
    // S cycles a leaf's status: todo → doing → blocked → todo. `done` is
    // deliberately unreachable from here — the checkbox is the only route to
    // it, so ticking it remains the one action that moves the pct roll-up.
    if (plain && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (hasKids) return; // a container's status is derived, never set
      actions.setNodeStatus(n.id, cycleStatus(stepStatus(n)));
      return;
    }
    // ⌘Enter → a new task directly below this one, opened ready to type.
    //
    // `insertSiblingAfter` works off the row's own sibling list, so it needs no
    // parent id and behaves the same at every depth — unlike the
    // `addChild(parentId)` this began as, which pushed onto the END of the
    // parent's list and did nothing at all at root level.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !editing) {
      e.preventDefault();
      actions.insertSiblingAfter(n.id);
      return;
    }
    // Enter → edit the title. Double-click was the only route to a rename for
    // a long time, which is an invisible affordance on the most common edit
    // there is; on the keyboard there was none at all.
    if (plain && e.key === 'Enter' && !editing) {
      e.preventDefault();
      setEditing(true);
    }
  }

  const ROW_CLS =
    'flex items-center gap-[9px] px-[6px] py-[4px] rounded-[6px] hover:bg-hover group cursor-pointer ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-0';

  return (
    <div ref={setNodeRef} style={sortableStyle}>
      {/* ── row ── */}
      {/* Nesting IS the model here, so the row has to say how deep it is and
          whether it is open. Without these a screen reader heard a flat run of
          titles — the `aria-expanded` that existed lived on the twirl button,
          which is `tabIndex={-1}` and never announced with the row. */}
      <div
        // The hover tint has to lose to the selection tint, not sit on top of
        // it: `hover:bg-hover` is a later utility than `bg-accent-tint`, so a
        // selected row under the cursor went neutral grey and read as
        // deselected exactly while you were pointing at it.
        className={`${ROW_CLS} ${selected.has(n.id) ? 'bg-accent-tint hover:bg-accent-tint' : ''}`}
        style={{ marginLeft: ind }}
        data-row=""
        data-node-id={n.id}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={hasKids ? isOpen : undefined}
        aria-owns={hasKids && isOpen ? groupId : undefined}
        aria-selected={selected.has(n.id)}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onClickCapture={handleRowClickCapture}
        onClick={handleRowClick}
      >
        {/* Drag handle — {listeners} here, NOT on the whole row, to avoid
            colliding with row-level Space/Arrow handlers. tabIndex={-1} keeps
            it out of the tab order (the row itself is the focusable unit). */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          tabIndex={-1}
          aria-label="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
          className="quiet-control w-[24px] h-[24px] -mx-[5px] flex-shrink-0 text-faint cursor-grab active:cursor-grabbing"
        >
          {/* The plan sidebar already drew this handle properly; the tree used
              `⠿` — a BRAILLE PATTERN — for the same affordance. */}
          <IconGrip size={13} />
        </button>

        {/* Twirl (container) or fixed-width spacer (leaf) */}
        {hasKids ? (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            tabIndex={-1}
            className="w-[24px] h-[24px] -mx-[5px] flex-shrink-0 grid place-items-center text-faint transition-transform duration-150 rounded-[4px] hover:bg-hover"
            style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
            onClick={(e) => {
              e.stopPropagation();
              actions.toggleExpand(n.id);
            }}
          >
            <IconChevronRight size={13} />
          </button>
        ) : (
          <span className="w-[14px] h-[14px] flex-shrink-0" aria-hidden="true" />
        )}

        {/* Status box on leaves only. Click/Space still only toggle done — the
            other two states are set via `S` or the hover control below. */}
        {!hasKids && (
          <LeafStatusBox
            status={stepStatus(n)}
            onToggle={() => actions.toggleLeaf(n.id)}
            label={`Mark "${n.title}" as done`}
          />
        )}

        {n.checkpoint && (
          <span className="text-accent flex-shrink-0 inline-flex" aria-hidden="true">
            <IconDiamond size={9} />
          </span>
        )}

        {/* Title */}
        {editing ? (
          <InlineEdit
            value={n.title}
            className={`flex-1 text-lead ${
              hasKids ? 'font-semibold text-ink' : isDone(n) ? 'line-through text-faint' : 'text-ink-soft'
            }`}
            onCommit={commitRename}
            onCancel={() => setEditing(false)}
          />
        ) : (
          /*
           * The title lets its clicks through now.
           *
           * It used to stop them, because underneath was a completion toggle
           * and a rename double-click therefore ticked the box off and on
           * again — net zero for `done` but NOT for `doneAt`, so renaming a
           * pset you finished last Tuesday silently rewrote when you finished
           * it. Under a row click that merely opens the inspector there is
           * nothing left to defend against, and swallowing the click would make
           * the largest part of the row the one part that does not open it.
           */
          <span
            className={`flex-1 text-lead select-none ${
              hasKids
                ? 'font-semibold text-ink'
                : isDone(n)
                  ? 'line-through text-faint'
                  : 'text-ink-soft'
            }`}
            onDoubleClick={() => setEditing(true)}
          >
            {n.title}
          </span>
        )}

        {/* Why a blocked leaf is stuck — the status box already names "blocked"
            in its label; this is the reason a person typed in. */}
        {!hasKids && stepStatus(n) === 'blocked' && n.blockedOn && (
          <span className="text-meta text-muted truncate max-w-[180px] flex-shrink" title={n.blockedOn}>
            {n.blockedOn}
          </span>
        )}

        {/* Progress % (containers only) */}
        {hasKids && (
          <span className="text-compact text-muted tabular-nums flex-shrink-0">
            {Math.round(nodePct(n))}%
          </span>
        )}

        {/* A container's status is DERIVED, never stored — see containerStatus. */}
        {hasKids && containerStatus(n) === 'blocked' && (
          <span className="text-meta text-warn flex-shrink-0">blocked</span>
        )}

        {/* WHEN — one cell, fixed width, so the column is a column.
            `GoalNode` carries `plannedStartMin`, `plannedDay`, `plannedWeek`
            and `deadline`, and the row used to show none of them; four
            separate cells would be four columns of mostly-empty metadata, so
            `scheduleCell` picks the most specific one. The placeholder keeps
            the estimate beside it aligned across rows that have no date. */}
        <span
          className={`hidden sm:block w-[92px] flex-none text-right text-meta tabular-nums truncate ${
            when?.tone === 'warn' ? 'text-warn' : 'text-muted'
          }`}
          title={when?.hint}
        >
          {when?.text ?? ''}
        </span>

        {/* Estimate — LEAVES only, matching `setNodeEstimate`'s own guard: a
            container's duration is the sum of its children's, not a figure of
            its own, and `addChild` deletes `estimateMin` when a leaf becomes a
            container for exactly that reason.

            This is the point of decomposition, and until now it was the one
            place you could NOT say how long a step takes — the rail was the
            sole host, and it shows only unplaced work from Now/Next projects.
            So a Later project's steps, and anything already on the calendar,
            had no estimate route at all. */}
        <span className="w-[56px] flex-none flex justify-end">
          {!hasKids && (
            <EstimateControl
              minutes={n.estimateMin}
              label={n.title}
              onChange={(minutes) => actions.setNodeEstimate(n.id, minutes)}
            />
          )}
        </span>

        {/* Actual time, beside the estimate that predicted it — the other half
            of the loop. Explicit only: nothing infers minutes from a scheduled
            block, because a block is what you set aside, not what you spent. */}
        {!hasKids && (
          <LogTimeControl
            loggedMin={loggedForNode(sessions, n.id)}
            estimateMin={n.estimateMin}
            label={n.title}
            onLog={(minutes) => actions.logSession('step', n.id, minutes)}
            onClear={() => actions.clearSessionsFor('step', n.id)}
          />
        )}

        {/* Rename. Double-clicking the title still works, but it was the ONLY
            route — an invisible affordance on the single most common edit, and
            the one place a hover control was missing while drag, + sub and
            delete all had one. The Habits rail already uses this pencil. */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Rename "${n.title}"`}
          title="Rename"
          className="quiet-control text-faint flex-shrink-0 rounded-[4px] hover:text-accent hover:bg-hover"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          <IconPencil size={13} />
        </button>

        {/* + sub — consistent on every row (leaf: converts to container; container: adds child) */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Add sub-item to "${n.title}"`}
          title="+ sub"
          className="quiet-control text-faint text-compact flex-shrink-0 rounded-[4px] hover:text-accent hover:bg-hover"
          onClick={(e) => {
            e.stopPropagation();
            actions.addChild(n.id);
          }}
        >
          + sub
        </button>

        {/* Cycle status — leaves only, same rule as `S`: a container's status
            is derived and never stored. */}
        {!hasKids && (
          <button
            type="button"
            tabIndex={-1}
            className="quiet-control"
            aria-label={`Change status of "${n.title}"`}
            onClick={(e) => {
              e.stopPropagation();
              actions.setNodeStatus(n.id, cycleStatus(stepStatus(n)));
            }}
          >
            ◐
          </button>
        )}

        {/* Delete */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Delete ${n.title}`}
          className="quiet-control text-faint flex-shrink-0 rounded-[4px] hover:text-warn hover:bg-hover"
          onClick={(e) => {
            e.stopPropagation();
            actions.removeNode(n.id);
          }}
        >
          <IconX size={13} />
        </button>
      </div>

      {/* ── children (fade in on expand; unmount on collapse for clean DOM) ── */}
      {hasKids && isOpen && (
        <FadeIn reducedMotion={reducedMotion}>
          {/*
            `group`, not a second `tree`: a nested level of an ARIA treeview is
            a group inside the one tree.

            It is `aria-owns`ed by the row above rather than nested inside it,
            because the DOM cannot express that here — the row and this group
            are siblings under the sortable wrapper. Left as a plain sibling,
            the row's `aria-expanded="true"` announced an expansion whose
            children assistive tech had no way to locate. `aria-owns` is the
            documented mechanism for exactly this shape.

            `AddChildInput` sits INSIDE the group for the same reason: a `tree`
            may only own `treeitem`s and `group`s, and a bare `<input>` as a
            direct descendant of the tree satisfies neither. A `group` has no
            required children, so it is at home here.
          */}
          <div role="group" id={groupId}>
            <GoalSiblingList
              nodes={n.children!}
              depth={depth + 1}
              expanded={expanded}
              actions={actions}
              reducedMotion={reducedMotion}
              newNodeId={newNodeId}
              selected={selected}
              onSelect={onSelect}
              onBulk={onBulk}
              sessions={sessions}
            />
            <AddChildInput
              indent={(depth + 1) * 22}
              placeholder="+ add item…"
              onAdd={(title) => actions.addChild(n.id, title)}
            />
          </div>
        </FadeIn>
      )}
    </div>
  );
}

// ── AddChildInput ─────────────────────────────────────────────────────────────

function AddChildInput({
  indent,
  placeholder,
  onAdd,
}: {
  indent: number;
  placeholder: string;
  onAdd: (title: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ marginLeft: indent }} className="px-[6px] py-[2px]">
      <input
        ref={ref}
        className="ghost-in w-full text-body"
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && ref.current) {
            const v = ref.current.value.trim();
            if (v) {
              onAdd(v);
              ref.current.value = '';
            }
          }
        }}
      />
    </div>
  );
}
