import type { AvailabilityWindow } from '../../db/types';
import { useAppStore } from '../../state/store';
import { minutesToTimeValue, timeValueToMinutes } from './timeInput';

const DOW_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Per-weekday planning window editor. A day with no entry in `availability`
 * is a day off and contributes zero capacity — unchecking a day REMOVES its
 * entry rather than collapsing start/end to the same minute.
 *
 * Every write goes through `actions.setAvailability`, which re-validates the
 * WHOLE list via `parseAvailability` and silently resets to the default if
 * it's malformed (duplicate `dow`, or `startMin >= endMin`, etc.) — see
 * src/lib/availability.ts. So every mutation here replaces a day's entry by
 * filtering it out first and re-adding it, never appending a second entry
 * for the same `dow`; and a start/end edit that would make startMin >= endMin
 * is rejected locally before it ever reaches the store, so one bad edit can't
 * wipe every other day's settings as a side effect.
 */
export function AvailabilitySettings() {
  const { availability, allDayBlocks, actions } = useAppStore();
  const byDow = new Map(availability.map((w) => [w.dow, w]));

  function replaceDay(dow: number, next: AvailabilityWindow | null) {
    const rest = availability.filter((w) => w.dow !== dow);
    const windows = next ? [...rest, next] : rest;
    actions.setAvailability(windows.sort((a, b) => a.dow - b.dow));
  }

  function toggleDay(dow: number, on: boolean) {
    replaceDay(dow, on ? { dow, startMin: 540, endMin: 1080 } : null);
  }

  function updateStart(dow: number, window: AvailabilityWindow, value: string) {
    const startMin = timeValueToMinutes(value);
    if (startMin === undefined || startMin >= window.endMin) return; // reject nonsense locally
    replaceDay(dow, { ...window, startMin });
  }

  function updateEnd(dow: number, window: AvailabilityWindow, value: string) {
    const endMin = timeValueToMinutes(value);
    if (endMin === undefined || window.startMin >= endMin) return; // reject nonsense locally
    replaceDay(dow, { ...window, endMin });
  }

  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex flex-col gap-[4px]">
        {DOW_LABELS.map((label, dow) => {
          const window = byDow.get(dow) ?? null;
          return (
            <div key={dow} className="flex items-center gap-[8px] text-ui">
              <input
                type="checkbox"
                checked={!!window}
                aria-label={`${label} available`}
                onChange={(e) => toggleDay(dow, e.target.checked)}
                className="flex-none accent-accent w-[16px] h-[16px] m-[4px]"
              />
              <span className="w-[70px] flex-none text-ink-soft">{label}</span>
              {window ? (
                <>
                  <input
                    type="time"
                    value={minutesToTimeValue(window.startMin)}
                    aria-label={`${label} start time`}
                    onChange={(e) => updateStart(dow, window, e.target.value)}
                    className="rounded-[6px] border border-line-2 bg-transparent px-[6px] py-[2px] text-compact text-ink tabular-nums outline-none focus-visible:border-accent"
                  />
                  <span className="text-faint">–</span>
                  <input
                    type="time"
                    value={minutesToTimeValue(window.endMin)}
                    aria-label={`${label} end time`}
                    onChange={(e) => updateEnd(dow, window, e.target.value)}
                    className="rounded-[6px] border border-line-2 bg-transparent px-[6px] py-[2px] text-compact text-ink tabular-nums outline-none focus-visible:border-accent"
                  />
                </>
              ) : (
                <span className="text-meta text-faint italic">off</span>
              )}
            </div>
          );
        })}
      </div>

      <label className="flex items-center gap-[6px] pt-[6px] mt-[2px] border-t border-line-soft text-ui text-ink-soft select-none cursor-pointer">
        <input
          type="checkbox"
          checked={allDayBlocks}
          onChange={(e) => actions.setAllDayBlocks(e.target.checked)}
          className="flex-none accent-accent w-[16px] h-[16px] m-[4px]"
        />
        All-day events consume the whole day
      </label>
    </div>
  );
}
