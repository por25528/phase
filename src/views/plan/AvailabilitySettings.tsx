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
  const { availability, actions } = useAppStore();
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
            /*
              The rail is 249px wide at every viewport from 768px up, and a row
              of checkbox + 70px label + two 80px time inputs + the dash is
              ~290px. It overflowed by 41px, measured in Chromium — the end time
              was clipped mid-digit ("18:0") on a default desktop window, and
              the sidebar's `overflow-y-auto` turns that into a horizontal
              scrollbar rather than a visible failure.

              `flex-wrap` plus a shrinkable label is the whole fix: the times
              drop to a second line when they cannot fit, and stay inline when
              they can. `min-w-0` on the label is what lets it give way first —
              a flex item will not shrink below its content without it.
            */
            <div key={dow} className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ui">
              <input
                type="checkbox"
                checked={!!window}
                aria-label={`${label} available`}
                onChange={(e) => toggleDay(dow, e.target.checked)}
                className="flex-none accent-accent w-[16px] h-[16px] m-[4px]"
              />
              <span className="w-[70px] min-w-0 flex-1 truncate text-ink-soft">{label}</span>
              {window ? (
                <>
                  <input
                    type="time"
                    value={minutesToTimeValue(window.startMin)}
                    aria-label={`${label} start time`}
                    onChange={(e) => updateStart(dow, window, e.target.value)}
                    className="min-w-0 rounded-[6px] border border-line-2 bg-transparent px-[6px] py-[2px] text-compact text-ink tabular-nums outline-none focus-visible:border-accent"
                  />
                  <span className="text-muted">–</span>
                  <input
                    type="time"
                    value={minutesToTimeValue(window.endMin)}
                    aria-label={`${label} end time`}
                    onChange={(e) => updateEnd(dow, window, e.target.value)}
                    className="min-w-0 rounded-[6px] border border-line-2 bg-transparent px-[6px] py-[2px] text-compact text-ink tabular-nums outline-none focus-visible:border-accent"
                  />
                </>
              ) : (
                <span className="text-meta text-muted italic">off</span>
              )}
            </div>
          );
        })}
      </div>

      {/*
        The "All-day events consume the whole day" checkbox lived here and has
        been removed until there is a calendar to consume events from.

        `allDayBlocks` only ever reaches `freeMinutes`/`freeIntervals`/`blockedBy`
        alongside a `blocks` array that every call site hardcodes to `[]` — there
        is no producer of `BusyBlock` anywhere in `src/`. So toggling it could
        not change a single minute or pixel: a live control for a feature that
        cannot fire, which is worse than no control, because it reads as an
        explanation for whatever the grid is doing.

        The preference itself is untouched — still stored, still loaded, still
        exported, still threaded through the capacity math — so restoring the
        control when the calendar feed lands is putting this label back, nothing
        more.
      */}
    </div>
  );
}
