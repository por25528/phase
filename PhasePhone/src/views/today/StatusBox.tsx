import type { StepStatus } from '@app/db/types';
import { STATUS_WORD } from '@app/lib/status';

/**
 * The app's checkbox, sized for a thumb.
 *
 * The box itself is the app's 17px so the row keeps the product's rhythm; the
 * TARGET around it is 44px, which is the phone's floor and nearly double the
 * desktop's 24. `parked` is deliberately the SAME border as `todo` and told
 * apart by the bar inside it — a parked box drawn fainter than an untouched
 * one is indistinguishable from it at rest, and parking is a decision the row
 * has to state.
 */
const STATUS_BOX: Record<StepStatus, string> = {
  todo: 'border-check',
  doing: 'border-accent',
  blocked: 'border-warn bg-warn-tint',
  parked: 'border-check',
  done: 'bg-accent border-accent',
};

export function StatusBox({
  status,
  label,
  onTick,
}: {
  status: StepStatus;
  label: string;
  /** Absent means the box is a READOUT — a finished row has no way back here. */
  onTick?: () => void;
}) {
  const box = (
    <span
      className={`w-[17px] h-[17px] border-[1.5px] rounded-[6px] grid place-items-center ${STATUS_BOX[status]}`}
    >
      {status === 'done' && (
        <svg viewBox="0 0 12 12" className="w-[11px] h-[11px] stroke-accent-contrast fill-none" strokeWidth={2.4}>
          <path d="M2 6.2 4.6 9 10 3" />
        </svg>
      )}
      {status === 'doing' && <span className="w-[7px] h-[7px] rounded-full bg-accent" aria-hidden="true" />}
      {status === 'blocked' && (
        <svg viewBox="0 0 12 12" className="w-[11px] h-[11px] stroke-warn fill-none" strokeWidth={2}>
          <path d="M2.5 9.5 9.5 2.5" />
        </svg>
      )}
      {status === 'parked' && <span className="w-[9px] h-[1.5px] rounded-full bg-muted" aria-hidden="true" />}
    </span>
  );

  if (!onTick) {
    return (
      <span
        role="checkbox"
        aria-checked={status === 'done'}
        aria-disabled="true"
        aria-label={`${label} — ${STATUS_WORD[status]}`}
        className="w-[44px] h-[44px] -my-[11px] -ml-[13px] flex-none grid place-items-center"
      >
        {box}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={status === 'done'}
      aria-label={`${label} — ${STATUS_WORD[status]}`}
      className="w-[44px] h-[44px] -my-[11px] -ml-[13px] flex-none grid place-items-center active:opacity-60"
      onClick={onTick}
    >
      {box}
    </button>
  );
}
