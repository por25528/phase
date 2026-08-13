import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';

export function Column({
  col,
  index,
  ids,
  children,
  solo,
  slim,
  nowLimit,
}: {
  col: { id: string; label: string };
  index: number;
  ids: string[];
  children: React.ReactNode;
  solo?: boolean; // rendered alone in the narrow horizon switcher → full width, no divider
  slim?: boolean; // wide board, nothing in the column → label and count only, no message
  nowLimit: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const isNow = index === 0;
  const over = isNow && ids.length > nowLimit;

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
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`grid gap-[11px] min-h-[140px] rounded-card p-[6px] -m-[6px] transition-colors ${
            isOver ? 'bg-hover' : ''
          }`}
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(188px, 1fr))' }}
        >
          {children}
          {/* No dashed box. A dashed border is the app's DROP-TARGET signal —
              it is what `DayColumn` draws while something is in the air — and
              spending it on "nothing is here" in four columns at once is how it
              stops meaning anything. An empty column is empty. */}
          {ids.length === 0 && !slim && (
            <p className="min-h-[80px] pt-[10px] text-faint text-meta text-center px-[10px]">
              Nothing here
            </p>
          )}
        </div>
      </SortableContext>
    </section>
  );
}
