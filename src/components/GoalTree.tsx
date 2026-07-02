import { useState, useRef, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { GoalNode } from '../db/types';
import { useAppStore } from '../state/store';
import { nodePct } from '../lib/pct';
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

function LeafCheckbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`w-[17px] h-[17px] flex-shrink-0 border-[1.5px] rounded-[5px] grid place-items-center transition-all duration-100 ${
        checked ? 'bg-accent border-accent' : 'border-line-2 hover:border-muted'
      }`}
      onClick={onToggle}
    >
      <svg
        viewBox="0 0 12 12"
        className={`w-[11px] h-[11px] stroke-accent-contrast fill-none transition-opacity duration-100 ${
          checked ? 'opacity-100' : 'opacity-0'
        }`}
        strokeWidth={2.4}
      >
        <path d="M2 6.2 4.6 9 10 3" />
      </svg>
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
  parentId: string | null;
  expanded: Set<string>;
  actions: Actions;
  reducedMotion: boolean;
}

// ── GoalTree (public export, owns DndContext) ─────────────────────────────────

export function GoalTree({ nodes, depth = 0 }: { nodes: GoalNode[]; depth?: number }) {
  const { expanded, actions } = useAppStore();
  const reducedMotion = usePrefersReducedMotion();

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
      <GoalSiblingList
        nodes={nodes}
        depth={depth}
        parentId={null}
        expanded={expanded}
        actions={actions}
        reducedMotion={reducedMotion}
      />
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
  parentId,
  expanded,
  actions,
  reducedMotion,
}: { n: GoalNode } & SharedProps) {
  const [editing, setEditing] = useState(false);
  const hasKids = Boolean(n.children && n.children.length > 0);
  const isOpen = hasKids && expanded.has(n.id);
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

  // Move focus to the next/previous VISIBLE row in DOM order. Because children
  // are unmounted when collapsed ({isOpen && ...}), only visible rows appear in
  // querySelectorAll('[data-row]').
  function focusNeighbor(dir: 'up' | 'down') {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-row]'));
    const idx = rows.findIndex((r) => r.dataset.nodeId === n.id);
    if (idx === -1) return;
    const neighbor = dir === 'down' ? rows[idx + 1] : rows[idx - 1];
    neighbor?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Tab / Shift+Tab → indent / outdent (Notion-style)
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) actions.outdentNode(n.id);
      else actions.indentNode(n.id);
      return;
    }
    // Arrow keys → roving focus
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusNeighbor('down');
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusNeighbor('up');
      return;
    }
    // Space → toggle leaf checkbox (prevent page scroll)
    if (e.key === ' ' && !hasKids && !editing) {
      e.preventDefault();
      actions.toggleLeaf(n.id);
      return;
    }
    // Enter → add sibling below (requires knowing parent container id).
    // At root level (parentId === null) GoalTree has no goalId to call
    // addRootNode, so Enter is a no-op there. Within any container, it adds
    // a new child to the same parent, which appears below the current row.
    if (e.key === 'Enter' && !editing) {
      e.preventDefault();
      if (parentId) actions.addChild(parentId);
      // root level: no-op (user can Tab to the add-input below the tree)
    }
  }

  const ROW_CLS =
    'flex items-center gap-[9px] px-[6px] py-[4px] rounded-[6px] hover:bg-hover group ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-0';

  return (
    <div ref={setNodeRef} style={sortableStyle}>
      {/* ── row ── */}
      <div
        className={ROW_CLS}
        style={{ marginLeft: ind }}
        data-row=""
        data-node-id={n.id}
        tabIndex={0}
        onKeyDown={handleKeyDown}
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
          className="w-[14px] flex-shrink-0 text-[11px] text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-grab active:cursor-grabbing select-none transition-opacity"
        >
          ⠿
        </button>

        {/* Twirl (container) or fixed-width spacer (leaf) */}
        {hasKids ? (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            tabIndex={-1}
            className="w-[14px] h-[14px] flex-shrink-0 grid place-items-center text-faint text-[9px] select-none transition-transform duration-150"
            style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
            onClick={() => actions.toggleExpand(n.id)}
          >
            ▶
          </button>
        ) : (
          <span className="w-[14px] h-[14px] flex-shrink-0" aria-hidden="true" />
        )}

        {/* Checkbox on leaves only */}
        {!hasKids && (
          <LeafCheckbox
            checked={!!n.done}
            onToggle={() => actions.toggleLeaf(n.id)}
            label={`Mark "${n.title}" as done`}
          />
        )}

        {/* Title */}
        {editing ? (
          <InlineEdit
            value={n.title}
            className={`flex-1 text-[.9rem] ${
              hasKids ? 'font-semibold text-ink' : n.done ? 'line-through text-faint' : 'text-ink-soft'
            }`}
            onCommit={commitRename}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <span
            className={`flex-1 text-[.9rem] cursor-default select-none ${
              hasKids
                ? 'font-semibold text-ink'
                : n.done
                  ? 'line-through text-faint'
                  : 'text-ink-soft'
            }`}
            onClick={() => setEditing(true)}
          >
            {n.title}
          </span>
        )}

        {/* Progress % (containers only) */}
        {hasKids && (
          <span className="text-[.74rem] text-muted tabular-nums flex-shrink-0">
            {Math.round(nodePct(n))}%
          </span>
        )}

        {/* + sub — consistent on every row (leaf: converts to container; container: adds child) */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Add sub-item to "${n.title}"`}
          title="+ sub"
          className="text-faint text-[.74rem] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex-shrink-0 px-[2px] hover:text-accent"
          onClick={() => actions.addChild(n.id)}
        >
          + sub
        </button>

        {/* Delete */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Delete ${n.title}`}
          className="text-faint text-[.8rem] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[#b4453a] transition-opacity flex-shrink-0"
          onClick={() => actions.removeNode(n.id)}
        >
          ✕
        </button>
      </div>

      {/* ── children (fade in on expand; unmount on collapse for clean DOM) ── */}
      {hasKids && isOpen && (
        <FadeIn reducedMotion={reducedMotion}>
          <GoalSiblingList
            nodes={n.children!}
            depth={depth + 1}
            parentId={n.id}
            expanded={expanded}
            actions={actions}
            reducedMotion={reducedMotion}
          />
          <AddChildInput
            indent={(depth + 1) * 22}
            placeholder="+ add item…"
            onAdd={(title) => actions.addChild(n.id, title)}
          />
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
        className="ghost-in w-full text-[.85rem]"
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
