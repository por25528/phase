import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { EstimateField } from './EstimateField';
import { formatEstimateValue } from '../lib/estimateInput';
import { normalizeEstimate } from '../lib/capacity';

/**
 * Preset durations, in minutes.
 *
 * Six is deliberate: enough to cover the shapes a step actually takes (a
 * quarter-hour of admin through a half-day of implementation) without becoming
 * a menu you have to read. Anything else is typed — `EstimateField` parses
 * `45`, `90m`, `1h30` and `1.5h`, so the presets are a shortcut, never the only
 * route.
 */
export const ESTIMATE_PRESETS = [15, 30, 45, 60, 120, 240] as const;

/**
 * The one estimate control in the app.
 *
 * It exists because `EstimateField` — the input — was only ever half the
 * interaction. The other half (the badge that shows the current value and swaps
 * itself for the field) lived inline in the backlog row, which made the rail
 * the ONLY surface that could set an estimate. Every other place that wanted
 * one would have had to re-implement the swap, the blur handling and the
 * dnd-kit event guards, so nowhere else got one and `estimateMin` — the input
 * the whole capacity engine runs on — was unreachable for any step outside a
 * Now/Next project's unplaced work.
 *
 * Hosts pass only data and a setter. Everything about how an estimate is
 * entered lives here, so the drawer's step tree and the rail behave identically.
 *
 * ## Focus
 *
 * The editor closes on focusout, but ONLY when focus has actually left the
 * control — `relatedTarget` is checked against the container, so Tab can reach
 * the preset buttons from the input without the panel closing under the
 * keyboard. A plain `onBlur` here (the rail's previous behaviour) would have
 * made every preset unreachable by keyboard and by mouse alike, since a click
 * blurs the input before it lands.
 *
 * ## Pointer events
 *
 * Both the badge and the presets stop `pointerdown`. The backlog row spreads
 * dnd-kit `listeners` on the row root, so an un-stopped press arms the drag
 * sensor and a 5px twitch turns the click into a drag. The drawer's tree keeps
 * `listeners` on a dedicated handle, so it does not need this — but the control
 * must behave the same in both, and stopping an event no one is listening for
 * is free.
 */
export function EstimateControl({
  minutes,
  label,
  onChange,
  className = '',
  openRequest = 0,
  alwaysShow = false,
}: {
  minutes: number | undefined;
  /** The item's title, for the accessible name. */
  label: string;
  /** `null` clears the estimate; a number sets it. */
  onChange: (minutes: number | null) => void;
  className?: string;
  /**
   * Bump to open the editor from outside — the row's `E` shortcut and its `⋯`
   * menu both land here.
   *
   * A COUNTER rather than a boolean, matching `taskCapture`'s focusRequest: the
   * host is asking for an event, not describing a state, and a boolean would
   * need resetting to false afterwards or the second `E` would do nothing.
   */
  openRequest?: number;
  /**
   * Keep the unset badge legible at rest.
   *
   * On a dense tree row `+ est` is pure affordance and hides until hover, which
   * is right there. In the INSPECTOR the property row IS the affordance — a
   * `.quiet-control` there rendered as a bare icon beside an empty space, which
   * reads as a broken row rather than as an empty property.
   */
  alwaysShow?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const seenOpenRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest === seenOpenRequest.current) return;
    seenOpenRequest.current = openRequest;
    setEditing(true);
  }, [openRequest]);
  /*
   * Committing collapses the panel, which unmounts the control the user was
   * standing on — so focus fell to `<body>` after every preset click and every
   * Enter. From there Tab restarts at the top of the document, which on a
   * twelve-step project means estimating the second step is a hunt. Returning
   * focus to the badge keeps the keyboard where it was; the badge is the same
   * place the interaction began.
   *
   * Only when the collapse was a COMMIT. Clicking away already moved focus
   * somewhere the user chose, and yanking it back would fight them.
   */
  const returnFocus = useRef(false);
  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    badgeRef.current?.focus();
  }, [editing]);

  function close(commit: boolean) {
    returnFocus.current = commit;
    setEditing(false);
  }

  /*
   * Closes on focusout, but must NOT decide whether this was a commit.
   *
   * `EstimateField` blurs itself immediately after committing on Enter, so this
   * handler runs for a keyboard commit too. Resetting the flag here clobbered
   * the one `onChange` had just set a tick earlier, and Enter lost focus to
   * `<body>` while a preset click kept it — the same interaction behaving two
   * different ways. The flag is owned by whoever knows a write happened; this
   * only leaves it alone. It is cleared by the effect above once consumed, so a
   * plain click-away can never inherit a stale `true`.
   */
  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setEditing(false);
  }

  if (!editing) {
    /*
     * Display follows `normalizeEstimate`, not the raw field.
     *
     * An imported `estimateMin: 0` is not an estimate anywhere else in the app
     * — capacity counts it as unestimated and the roll-up ignores it — but
     * `minutes !== undefined` called it set, and `formatEstimateValue(0)`
     * returns an empty string. The result was a blank badge that had lost its
     * `quiet-control` class, so it occupied space at rest and announced itself
     * as `Estimate for "X": . Change it`.
     */
    const shown = normalizeEstimate(minutes);
    const set = shown !== undefined;
    return (
      <button
        ref={badgeRef}
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        aria-label={
          set
            ? `Estimate for "${label}": ${formatEstimateValue(shown)}. Change it`
            : `Set estimate for "${label}"`
        }
        // A set estimate stays legible at rest — it is information. An unset one
        // only advertises itself on hover/focus, which is this app's rule for
        // anything that is purely an affordance. `.quiet-control` carries the
        // `@media (hover: hover)` gate and the 24px target floor; a hand-rolled
        // `opacity-0 group-hover:` would drop both.
        // `alwaysShow` is the INSPECTOR presentation: the row is a labelled
        // property in a column of them, so it takes the column's UI face rather
        // than the mono badge that suits a dense tree row.
        className={`flex-none tabular-nums min-w-[24px] min-h-[24px] inline-flex items-center rounded-[4px] text-muted hover:text-ink-soft hover:bg-hover ${
          alwaysShow ? 'text-ui' : 'font-mono text-eyebrow justify-center'
        } ${set || alwaysShow ? '' : 'quiet-control'} ${className}`}
      >
        {set ? formatEstimateValue(shown) : alwaysShow ? 'No estimate' : '+ est'}
      </button>
    );
  }

  return (
    <div
      className="flex-none flex flex-wrap items-center gap-[3px]"
      onBlur={handleBlur}
      // Rendered in flow rather than in an absolutely-positioned popover on
      // purpose: the backlog rail is a scroll container, so an absolute panel
      // would be clipped by it. Wrapping costs the row a second line while it
      // is being edited and nothing at rest.
      onClick={(e) => e.stopPropagation()}
    >
      <EstimateField
        minutes={minutes}
        label={label}
        onChange={(next) => {
          onChange(next);
          // The field blurs itself after committing, so `handleBlur` runs on
          // the next tick and would otherwise close this as a non-commit.
          returnFocus.current = true;
        }}
      />
      {ESTIMATE_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          // preventDefault, not just stopPropagation. `EstimateField` commits
          // on blur, and pressing this button blurs the input BEFORE its own
          // click fires — so a typed draft committed first and then unmounted
          // these buttons, swallowing the click. On the estimate that wrote
          // twice and armed two undo entries; on the append-only time ledger it
          // logged the typed value INSTEAD of the preset the user pressed.
          // Preventing the default on pointerdown suppresses the focus change,
          // so the input never blurs and only the click writes.
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onChange(preset);
            close(true);
          }}
          aria-label={`Set estimate for "${label}" to ${formatEstimateValue(preset)}`}
          className="font-mono text-eyebrow tabular-nums min-h-[24px] px-[4px] inline-flex items-center rounded-[4px] border border-line-2 text-muted hover:text-ink hover:bg-hover"
        >
          {formatEstimateValue(preset)}
        </button>
      ))}
      {normalizeEstimate(minutes) !== undefined && (
        <button
          type="button"
          // preventDefault, not just stopPropagation. `EstimateField` commits
          // on blur, and pressing this button blurs the input BEFORE its own
          // click fires — so a typed draft committed first and then unmounted
          // these buttons, swallowing the click. On the estimate that wrote
          // twice and armed two undo entries; on the append-only time ledger it
          // logged the typed value INSTEAD of the preset the user pressed.
          // Preventing the default on pointerdown suppresses the focus change,
          // so the input never blurs and only the click writes.
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onChange(null);
            close(true);
          }}
          aria-label={`Clear estimate for "${label}"`}
          className="font-mono text-eyebrow min-h-[24px] px-[4px] inline-flex items-center rounded-[4px] border border-line-2 text-muted hover:text-warn hover:bg-warn-tint"
        >
          clear
        </button>
      )}
    </div>
  );
}
