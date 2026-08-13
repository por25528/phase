import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

// Column hints for the quiet horizons — they explain *why* the schedule signals
// go silent there (horizon gating, spec §2.2), so the calm reads as intentional.
const HINTS: Record<number, string> = {
  2: 'Quiet by design — schedule pressure is hidden off Now / Next.',
  3: 'Ideas — no "define a task" nag until you commit them.',
};

export function Column({
  col,
  index,
  ids,
  children,
  solo,
  nowLimit,
}: {
  col: { id: string; label: string };
  index: number;
  ids: string[];
  children: React.ReactNode;
  solo?: boolean; // rendered alone in the narrow horizon switcher → full width, no divider
  nowLimit: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const isNow = index === 0;
  const over = isNow && ids.length > nowLimit;
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
          className={`font-mono text-badge tabular-nums ml-auto ${
            over ? 'text-warn font-semibold' : 'text-muted'
          }`}
        >
          {isNow ? `${ids.length} / ${nowLimit}` : ids.length}
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
          {/* No dashed box. A dashed border is the app's DROP-TARGET signal —
              it is what `DayColumn` draws while something is in the air — and
              spending it on "nothing is here" in four columns at once is how it
              stops meaning anything. An empty column is empty. */}
          {ids.length === 0 && (
            <p className="min-h-[80px] pt-[10px] text-faint text-meta text-center px-[10px]">
              Nothing here
            </p>
          )}
        </div>
      </SortableContext>
    </section>
  );
}
