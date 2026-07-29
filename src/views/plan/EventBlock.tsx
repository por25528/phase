import type { Interval } from '../../lib/capacity';
import { minuteToPct } from '../../lib/grid';

/**
 * A block on the grid — either committed work or a calendar event.
 *
 * `estimated: false` means the block's height is a guess (`DEFAULT_SLOT_MIN`
 * fallback from `durationOf`), not a real estimate — rendered with a dashed
 * border so a guessed hour never reads as a real commitment.
 */
export interface GridBlock {
  key: string;
  kind: 'step' | 'task' | 'busy';
  title: string;
  startMin: number;
  endMin: number;
  done: boolean;
  estimated: boolean;
}

function timeLabel(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const suffix = h < 12 ? 'am' : 'pm';
  const display = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${display}${suffix}` : `${display}:${String(m).padStart(2, '0')}${suffix}`;
}

export function EventBlock({
  block, lane, laneCount, range, onRemove,
}: {
  block: GridBlock;
  lane: number;
  laneCount: number;
  range: Interval;
  onRemove?: () => void;
}) {
  const top = minuteToPct(block.startMin, range);
  const height = minuteToPct(block.endMin, range) - top;
  const width = 100 / laneCount;
  const isBusy = block.kind === 'busy';

  return (
    <div
      className={`absolute rounded-[6px] px-[5px] py-[2px] overflow-hidden text-[.66rem] leading-[1.2] border ${
        isBusy
          ? 'bg-hover border-line-2 text-muted italic'
          : `bg-panel border-line-2 border-l-[3px] border-l-accent text-ink ${block.done ? 'opacity-55 line-through' : ''} ${block.estimated ? '' : 'border-dashed'}`
      }`}
      style={{
        top: `${top}%`,
        height: `${Math.max(height, 1.6)}%`,
        left: `calc(${lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      }}
      title={`${block.title} · ${timeLabel(block.startMin)}–${timeLabel(block.endMin)}${block.estimated ? '' : ' · no estimate'}`}
    >
      <div className="truncate font-medium">{block.title}</div>
      <div className="truncate text-faint text-[.6rem] tabular-nums">{timeLabel(block.startMin)}</div>
      {onRemove && !isBusy && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Unschedule ${block.title}`}
          className="absolute top-0 right-[2px] text-faint hover:text-warn text-[.7rem] leading-none px-[2px]"
        >
          ×
        </button>
      )}
    </div>
  );
}
