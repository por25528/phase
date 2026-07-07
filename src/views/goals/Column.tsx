import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

export function Column({
  col,
  index,
  ids,
  children,
}: {
  col: { id: string; label: string };
  index: number;
  ids: string[];
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const isTop = index === 0;

  return (
    <section className={`flex-1 min-w-[236px] ${index > 0 ? 'border-l border-line pl-[18px]' : ''}`}>
      <header className="flex items-baseline gap-[8px] mb-[12px] px-[2px]">
        <span
          className={`font-disp leading-none tabular-nums ${
            isTop ? 'text-accent text-[1.15rem] font-semibold' : 'text-faint-2 text-[1.05rem]'
          }`}
        >
          {index + 1}
        </span>
        <span className={`text-[.74rem] font-medium ${isTop ? 'text-ink-soft' : 'text-muted'}`}>
          {col.label}
        </span>
        <span className="text-[.7rem] text-faint tabular-nums ml-auto">{ids.length}</span>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`flex flex-col gap-[12px] min-h-[140px] rounded-card p-[6px] -m-[6px] transition-colors ${
            isOver ? 'bg-hover' : ''
          }`}
        >
          {children}
          {ids.length === 0 && (
            <div className="grid place-items-center min-h-[110px] rounded-card border border-dashed border-line-2 text-faint text-[.74rem] px-[10px] text-center">
              Drop a goal here
            </div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}
