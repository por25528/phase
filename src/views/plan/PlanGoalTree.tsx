import { useState } from 'react';
import type { Goal, GoalNode } from '../../db/types';
import { fmtD } from '../../lib/dates';

/**
 * Read-only, selectable tree for the week planner. Done leaves are hidden;
 * containers expand/collapse locally; clicking a leaf toggles its place in
 * the given week. Future-start leaves stay clickable (deliberate intent
 * overrides the schedule) but show their start date.
 */
export function PlanGoalTree({
  goal,
  week,
  today,
  onPlan,
  onUnplan,
}: {
  goal: Goal;
  week: string;
  today: string;
  onPlan: (nodeId: string) => void;
  onUnplan: (nodeId: string) => void;
}) {
  return (
    <div className="flex flex-col">
      {goal.nodes.map((n) => (
        <TreeNode key={n.id} n={n} depth={0} week={week} today={today} onPlan={onPlan} onUnplan={onUnplan} />
      ))}
    </div>
  );
}

function TreeNode({
  n, depth, week, today, onPlan, onUnplan,
}: {
  n: GoalNode; depth: number; week: string; today: string;
  onPlan: (nodeId: string) => void; onUnplan: (nodeId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const pad = { paddingLeft: `${depth * 14}px` };

  if (n.children && n.children.length) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-[6px] py-[3px] text-[.8rem] text-muted hover:text-ink w-full text-left"
          style={pad}
        >
          <span className="font-mono text-[.6rem]">{open ? '▾' : '▸'}</span>
          <span className="truncate">{n.title}</span>
        </button>
        {open && n.children.map((c) => (
          <TreeNode key={c.id} n={c} depth={depth + 1} week={week} today={today} onPlan={onPlan} onUnplan={onUnplan} />
        ))}
      </div>
    );
  }

  if (n.done) return null;
  const planned = n.plannedWeek === week;
  const futureStart = !!n.start && n.start > today;

  return (
    <button
      type="button"
      onClick={() => (planned ? onUnplan(n.id) : onPlan(n.id))}
      aria-pressed={planned}
      className={`group/step flex items-center gap-[8px] py-[4px] rounded-field w-full text-left text-[.84rem] hover:bg-hover px-[4px] ${
        planned ? 'text-ink font-medium' : 'text-ink-soft'
      }`}
      style={pad}
    >
      <span className="flex-1 min-w-0 truncate">{n.title}</span>
      {futureStart && (
        <span className="font-mono text-[.6rem] text-faint flex-none">starts {fmtD(n.start!)}</span>
      )}
      {/* A plan toggle, not a done-checkbox — the label says what the click does. */}
      <span
        className={`flex-none text-[.62rem] font-medium px-[7px] py-[1px] rounded-full ${
          planned
            ? 'text-accent-deep bg-accent-tint'
            : 'text-muted border border-line-2 group-hover/step:border-muted'
        }`}
      >
        {planned ? '✓ This week' : '+ Plan'}
      </span>
    </button>
  );
}
