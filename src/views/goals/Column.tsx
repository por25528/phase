import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { NOW_WIP_LIMIT } from '../../lib/plan';

// Column hints for the quiet horizons — they explain *why* the schedule signals
// go silent there (horizon gating, spec §2.2), so the calm reads as intentional.
const HINTS: Record<number, string> = {
  2: 'Quiet by design — schedule pressure is hidden off Now / Next.',
  3: 'Ideas — no "define a step" nag until you commit them.',
};

export function Column({
  col,
  index,
  ids,
  children,
  solo,
}: {
  col: { id: string; label: string };
  index: number;
  ids: string[];
  children: React.ReactNode;
  solo?: boolean; // rendered alone in the narrow horizon switcher → full width, no divider
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const isNow = index === 0;
  const over = isNow && ids.length > NOW_WIP_LIMIT;
  const hint = HINTS[index];

  return (
    <section className={solo ? 'w-full' : `min-w-0 ${index > 0 ? 'border-l border-line pl-[14px] xl:pl-[18px]' : ''}`}>
      <header className="flex items-baseline gap-[8px] mb-[12px] px-[2px]">
        <span
          className={`text-ui font-medium tracking-[.01em] ${
            isNow ? 'text-ink' : 'text-muted'
          }`}
        >
          {col.label}
        </span>
        <span
          className={`font-mono text-chip tabular-nums ml-auto ${
            over ? 'text-warn font-semibold' : 'text-muted'
          }`}
        >
          {isNow ? `${ids.length} / ${NOW_WIP_LIMIT}` : ids.length}
        </span>
      </header>
      {hint && (
        <p className="text-kbd text-muted italic px-[2px] -mt-[6px] mb-[12px] leading-[1.4]">{hint}</p>
      )}
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`flex flex-col gap-[11px] min-h-[140px] rounded-card p-[6px] -m-[6px] transition-colors ${
            isOver ? 'bg-hover' : ''
          }`}
        >
          {children}
          {ids.length === 0 && (
            <div className="grid place-items-center min-h-[110px] rounded-card border border-dashed border-line-2 text-muted text-compact px-[10px] text-center">
              Drop a project here
            </div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}
