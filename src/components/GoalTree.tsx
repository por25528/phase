import { useState, useRef, useEffect } from 'react';
import type { GoalNode } from '../db/types';
import { useAppStore } from '../state/store';
import { nodePct } from '../lib/pct';

function InlineEdit({
  value,
  className,
  onCommit,
  onCancel,
}: {
  value: string;
  className: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const escaped = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function commit() {
    const v = draft.trim();
    if (v) onCommit(v);
    else onCancel();
  }

  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      className={`${className} bg-transparent outline-none p-0 min-w-0 w-full`}
      style={{ border: 'none', borderBottom: '1px solid #5D6B82' }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          escaped.current = false;
          commit();
        }
        if (e.key === 'Escape') {
          escaped.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!escaped.current) commit();
      }}
    />
  );
}

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
        checked ? 'bg-fill border-fill' : 'border-line-2 hover:border-muted'
      }`}
      onClick={onToggle}
    >
      <svg
        viewBox="0 0 12 12"
        className={`w-[11px] h-[11px] stroke-white fill-none transition-opacity duration-100 ${checked ? 'opacity-100' : 'opacity-0'}`}
        strokeWidth={2.4}
      >
        <path d="M2 6.2 4.6 9 10 3" />
      </svg>
    </button>
  );
}

export function GoalTree({ nodes, depth = 0 }: { nodes: GoalNode[]; depth?: number }) {
  const { expanded, actions } = useAppStore();
  return (
    <>
      {nodes.map((n) => (
        <GoalTreeNode key={n.id} n={n} depth={depth} expanded={expanded} actions={actions} />
      ))}
    </>
  );
}

function GoalTreeNode({
  n,
  depth,
  expanded,
  actions,
}: {
  n: GoalNode;
  depth: number;
  expanded: Set<string>;
  actions: ReturnType<typeof useAppStore>['actions'];
}) {
  const [editing, setEditing] = useState(false);
  const ind = depth * 22;
  const hasKids = n.children && n.children.length > 0;
  const isOpen = expanded.has(n.id);

  function commitRename(v: string) {
    if (v && v !== n.title) actions.renameNode(n.id, v);
    setEditing(false);
  }

  if (hasKids) {
    return (
      <div>
        <div
          className="flex items-center gap-[9px] px-[6px] py-[4px] rounded-[6px] hover:bg-hover group"
          style={{ marginLeft: ind }}
        >
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            className="w-[14px] h-[14px] flex-shrink-0 grid place-items-center text-faint text-[9px] select-none transition-transform duration-150"
            style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
            onClick={() => actions.toggleExpand(n.id)}
          >
            ▶
          </button>
          {editing ? (
            <InlineEdit
              value={n.title}
              className="flex-1 text-[.9rem] font-medium text-ink"
              onCommit={commitRename}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <span
              className="flex-1 text-[.9rem] font-medium text-ink cursor-default select-none"
              onClick={() => setEditing(true)}
            >
              {n.title}
            </span>
          )}
          <span className="text-[.74rem] text-muted tabular-nums flex-shrink-0">
            {Math.round(nodePct(n))}%
          </span>
          <button
            type="button"
            aria-label={`Delete ${n.title}`}
            className="text-faint text-[.8rem] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[#b4453a] transition-opacity flex-shrink-0"
            onClick={() => actions.removeNode(n.id)}
          >
            ✕
          </button>
        </div>
        {isOpen && (
          <>
            <GoalTree nodes={n.children!} depth={depth + 1} />
            <AddChildInput
              indent={(depth + 1) * 22}
              placeholder="+ add item…"
              onAdd={(title) => actions.addChild(n.id, title)}
            />
          </>
        )}
      </div>
    );
  }

  // Leaf
  return (
    <div
      className="flex items-center gap-[9px] px-[6px] py-[4px] rounded-[6px] hover:bg-hover group"
      style={{ marginLeft: ind }}
    >
      <span className="w-[14px] h-[14px] flex-shrink-0" aria-hidden="true" />
      <LeafCheckbox
        checked={!!n.done}
        onToggle={() => actions.toggleLeaf(n.id)}
        label={`Mark "${n.title}" as done`}
      />
      {editing ? (
        <InlineEdit
          value={n.title}
          className={`flex-1 text-[.9rem] ${n.done ? 'line-through text-faint' : 'text-ink-soft'}`}
          onCommit={commitRename}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <span
          className={`flex-1 text-[.9rem] cursor-default ${n.done ? 'line-through text-faint' : 'text-ink-soft'}`}
          onClick={() => setEditing(true)}
        >
          {n.title}
        </span>
      )}
      <button
        type="button"
        aria-label={`Break "${n.title}" into sub-items`}
        title="break into items"
        className="text-faint text-[.74rem] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex-shrink-0"
        onClick={() => actions.addChild(n.id)}
      >
        ⊕
      </button>
      <button
        type="button"
        aria-label={`Delete ${n.title}`}
        className="text-faint text-[.8rem] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-500 transition-opacity flex-shrink-0"
        onClick={() => actions.removeNode(n.id)}
      >
        ✕
      </button>
    </div>
  );
}

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
