import type { WeekCapacity } from '../../lib/capacity';
import { fmtD, addDays } from '../../lib/dates';
import { capacityParts, capacityNote, isOverCommitted } from './capacityLabel';

/**
 * The week calendar's header: date range, capacity readout, and week
 * navigation. A past week is shown read-only here (label only) — the actual
 * enforcement is the disabled droppable threaded through WeekGrid/DayColumn
 * in Plan.tsx; this component only reflects that state, it does not create it.
 */
export function WeekHeader({
  weekStart, isPast, capacity, onPrev, onNext, onToday,
}: {
  weekStart: string;
  isPast: boolean;
  capacity: WeekCapacity;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const note = capacityNote(capacity);
  return (
    <div className="flex items-baseline gap-[10px] mb-[10px] flex-wrap">
      <h3 className="font-mono text-[.58rem] tracking-[.13em] uppercase text-muted font-semibold">
        {fmtD(weekStart)} – {fmtD(addDays(weekStart, 6))}
      </h3>
      <span className={`text-[.78rem] tabular-nums ${isOverCommitted(capacity) ? 'text-warn' : 'text-muted'}`}>
        {capacityParts(capacity).join(' · ')}
      </span>
      {note && (
        <span className="text-[.56rem] text-faint truncate max-w-[240px]" title={note}>{note}</span>
      )}
      {isPast && (
        <span className="text-[.7rem] text-faint italic">past week — read only</span>
      )}
      <span className="flex-1" />
      <button type="button" onClick={onPrev} aria-label="Previous week" className="text-muted hover:text-ink px-[6px]">‹</button>
      <button type="button" onClick={onToday} className="text-[.72rem] text-muted hover:text-ink">today</button>
      <button type="button" onClick={onNext} aria-label="Next week" className="text-muted hover:text-ink px-[6px]">›</button>
    </div>
  );
}
