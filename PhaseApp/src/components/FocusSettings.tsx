import { useAppStore } from '../state/store';
import { fieldCls, labelCls } from './dialogStyles';
import type { CycleConfig } from '../lib/focusCycle';

/**
 * The pomodoro dial — four numbers, and nothing else.
 *
 * There is no mode switch here, because the mode is not a preference: it is
 * chosen per session on the shelf, beside the work it applies to. What lives
 * in Settings is only the LENGTHS the next pomodoro will be started with, and
 * saying so out loud is what the copy below is for — a dial that silently
 * retimed a running interval would be the one thing this design refuses.
 *
 * Clamping is deliberately NOT here. `actions.setCycleConfig` owns the ranges,
 * so a row hand-edited on disk and a number typed into this box meet the same
 * rule, and these stay four plain fields. What the fields DO own is the
 * half-typed state: an emptied box dispatches nothing and waits, rather than
 * snapping the dial to its minimum between two keystrokes.
 */
const FIELDS: Array<{ key: keyof CycleConfig; label: string; unit: string }> = [
  { key: 'workMin', label: 'Work interval', unit: 'minutes' },
  { key: 'breakMin', label: 'Short break', unit: 'minutes' },
  { key: 'longBreakMin', label: 'Long break', unit: 'minutes' },
  { key: 'longEvery', label: 'Long break every', unit: 'intervals' },
];

export function FocusSettings() {
  const { cycleConfig, actions } = useAppStore();

  return (
    <div>
      <div className="grid grid-cols-2 gap-x-[12px] gap-y-[10px]">
        {FIELDS.map(({ key, label, unit }) => (
          <label key={key} className="block">
            <span className={`mb-[4px] block ${labelCls}`}>{label}</span>
            <span className="flex items-baseline gap-[6px]">
              <input
                type="number"
                inputMode="numeric"
                aria-label={label}
                value={String(cycleConfig[key])}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  // An empty box is a keystroke in progress, not a value.
                  if (event.target.value === '' || !Number.isFinite(next)) return;
                  actions.setCycleConfig({ ...cycleConfig, [key]: next });
                }}
                className={`${fieldCls} tabular-nums`}
              />
              <span className="shrink-0 text-meta text-muted">{unit}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="mt-[10px] text-meta text-muted leading-[1.5]">
        Applies to sessions you start as pomodoro. A running session keeps the
        lengths it started with.
      </p>
    </div>
  );
}
