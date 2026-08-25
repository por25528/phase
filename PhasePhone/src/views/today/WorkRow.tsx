import type { StepStatus } from '@app/db/types';
import type { DailyWorkItem } from '@app/lib/dailyWork';
import { StatusBox } from './StatusBox';

/**
 * One piece of work, on a phone.
 *
 * Two gestures and no more: the box ticks, the button parks. There is no row
 * tap that opens something — the companion has nowhere to open TO, and a row
 * that swallows a tap without a destination is the worst kind of affordance.
 *
 * Park is offered for STEPS only. A loose `Task` has no `status` field, so
 * there is nothing on it to park; that is the same rule the desktop's backlog
 * rail holds, for the same reason.
 */
export function WorkRow({
  item,
  status,
  note,
  onTick,
  onPark,
}: {
  item: DailyWorkItem;
  status: StepStatus;
  /** A short right-hand fact — how long ago a carry-over slipped. */
  note?: string | null;
  onTick?: () => void;
  onPark?: () => void;
}) {
  const parked = status === 'parked';
  return (
    <li className="flex items-start gap-[12px] px-[18px] py-[13px] border-b border-line">
      <StatusBox status={status} label={item.title} onTick={onTick} />
      <span className="flex-1 min-w-0">
        <span
          className={`block text-body leading-[1.35] ${
            status === 'done' ? 'text-muted line-through' : 'text-ink'
          }`}
        >
          {item.title}
        </span>
        {(item.goalTitle || note) && (
          <span className="mt-[2px] flex items-center gap-[8px] text-meta text-muted">
            {item.goalTitle && <span className="truncate">{item.goalTitle}</span>}
            {note && <span className="flex-none tabular-nums">{note}</span>}
          </span>
        )}
      </span>
      {onPark && (
        <button
          type="button"
          // The label is the VERB, not the state: a control named "Parked"
          // reads as a readout, and this one is the only route back.
          aria-label={`${parked ? 'Unpark' : 'Park'} “${item.title}”`}
          className="flex-none -my-[11px] -mr-[6px] h-[44px] px-[10px] grid place-items-center text-meta text-muted active:opacity-60"
          onClick={onPark}
        >
          {parked ? 'Unpark' : 'Park'}
        </button>
      )}
    </li>
  );
}
