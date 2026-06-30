import { useRef } from 'react';
import type { GoalNode } from '../db/types';
import { useAppStore } from '../state/store';
import { Checkbox } from './Checkbox';
import { nodePct } from '../lib/pct';

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
  const ind = depth * 22;
  const hasKids = n.children && n.children.length > 0;
  const isOpen = expanded.has(n.id);

  function handleRename() {
    const v = prompt('Rename:', n.title);
    if (v && v.trim()) actions.renameNode(n.id, v.trim());
  }

  if (hasKids) {
    return (
      <div>
        <div
          className="flex items-center gap-[9px] px-[6px] py-[4px] rounded-[6px] hover:bg-hover group"
          style={{ marginLeft: ind }}
        >
          <span
            className="w-[14px] h-[14px] grid place-items-center text-faint text-[9px] cursor-pointer select-none transition-transform duration-150"
            style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
            onClick={() => actions.toggleExpand(n.id)}
          >
            ▶
          </span>
          <span
            className="flex-1 text-[.9rem] font-medium text-ink cursor-default"
            onDoubleClick={handleRename}
          >
            {n.title}
          </span>
          <span className="text-[.74rem] text-muted tabular-nums">
            {Math.round(nodePct(n))}%
          </span>
          <button
            className="text-faint text-[.8rem] opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
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
      <span className="w-[14px] h-[14px]" style={{ visibility: 'hidden' }}>▶</span>
      <Checkbox checked={!!n.done} onClick={() => actions.toggleLeaf(n.id)} />
      <span
        className={`flex-1 text-[.9rem] cursor-default ${n.done ? 'line-through text-faint' : 'text-ink-soft'}`}
        onDoubleClick={handleRename}
      >
        {n.title}
      </span>
      <button
        className="text-faint text-[.74rem] opacity-0 group-hover:opacity-100 transition-opacity"
        title="break into items"
        onClick={() => actions.addChild(n.id)}
      >
        ⊕
      </button>
      <button
        className="text-faint text-[.8rem] opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
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
