import { CONTROL_H, CONTROL_LINE } from './dialogStyles';

/**
 * One shape for "pick exactly one of these few".
 *
 * The app had grown four of these, and no two agreed on what "selected" looks
 * like:
 *
 *   New goal › Type       chip track, raised pill, 33px
 *   Goals › Board/Timeline  hover track, panel pill, 11px radius
 *   Plan › Week/Month     joined bordered pair, SOLID INVERTED segment, 24px
 *   Timeline › Fit/W/M/Q  joined bordered row, ACCENT TINT segment, 26px
 *
 * Three different meanings for the same state — a pill that rises, a block that
 * inverts, and a wash of the colour index.css reserves for ACTION (zoom level
 * is state; you are not doing anything by being at it). Board/Timeline and
 * Week/Month are two clicks apart and looked nothing like each other.
 *
 * `bg-raised` over `bg-chip` is the one answer now, and it carries the dark-mode
 * fix with it: Board/Timeline's pill was `bg-panel`, which is BRIGHTER than its
 * `bg-hover` track in light (255 over 243) and DARKER in dark (13 under 22), so
 * the selected segment rose on one theme and sank on the other. `raised` is a
 * step up in whichever direction the theme calls up.
 *
 * Two components because the semantics genuinely differ, not the looks:
 * `SegmentedControl` is radios — a value in a form, submitted with it.
 * `SegmentedSwitch` is `aria-pressed` buttons — a view state, which is not form
 * data and must not be announced as though a screen reader could submit it.
 */

const SIZES = {
  /** Forms and dialogs. 2 + 4 + 21 + 4 + 2 = 33, the dialog control height. */
  md: {
    track: `${CONTROL_H} p-[2px] rounded-field`,
    segment: `px-[8px] py-[4px] text-ui ${CONTROL_LINE} rounded-[6px]`,
  },
  /**
   * Dense toolbars — a plan header, a timeline ruler. 2 + 2 + 18 + 2 + 2 = 26,
   * which is the height of the `Today` button and the scope `<select>` it sits
   * between, and clears the 24px target floor those rows were sitting exactly
   * on.
   *
   * Still `text-ui`. Dropping to `text-meta` to save the height made the zoom
   * labels visibly smaller than the `Completed` checkbox and the select on
   * either side of them — a control does not get quieter type for being short.
   */
  sm: {
    track: 'min-h-[26px] p-[2px] rounded-[6px]',
    segment: 'px-[9px] py-[2px] text-ui leading-[18px] rounded-[4px]',
  },
} as const;

const TRACK = 'inline-flex gap-[2px] bg-chip';
const SEGMENT =
  'flex-1 flex items-center justify-center whitespace-nowrap cursor-pointer select-none font-medium text-muted transition-colors duration-100';
/**
 * Every segment is `font-medium` and only its colour and surface change.
 * Bolding the selected one would resize its text and shove its neighbours
 * sideways on every pick.
 */
const SEGMENT_ON = 'bg-raised text-ink shadow-card';
const SEGMENT_OFF = 'hover:text-ink';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** Tooltip, for a segment whose label cannot carry the whole explanation. */
  title?: string;
  disabled?: boolean;
};

type Size = keyof typeof SIZES;

/**
 * Radios under an `sr-only` layer, so arrow keys, the single roving tab stop
 * and the accessibility tree are the platform's rather than ours. Use this when
 * the choice is a VALUE — the type of a new goal, submitted with the form.
 *
 * `GoalTree` and `Timeline`'s scope keep their `<select>`s on purpose: those
 * choose among many, and a segmented control of many is a toolbar.
 */
export function SegmentedControl<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
  size = 'md',
}: {
  /** Radio group name — must be unique on the page. */
  name: string;
  /** Accessible name for the group; pair it with a visible `labelCls` span. */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (next: T) => void;
  size?: Size;
}) {
  const s = SIZES[size];
  return (
    <div role="radiogroup" aria-label={label} className={`${TRACK} ${s.track}`}>
      {options.map((o) => (
        <label key={o.value} className="flex-1 flex" title={o.title}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
            className="peer sr-only"
          />
          {/* `rounded-[6px]` inside the track's `rounded-field` (9px) is
              concentric: nested radii step DOWN, they do not mix. */}
          <span
            className={`${SEGMENT} ${s.segment} ${SEGMENT_OFF} peer-checked:bg-raised peer-checked:text-ink peer-checked:shadow-card peer-disabled:opacity-40 peer-disabled:cursor-default peer-focus-visible:ring-2 peer-focus-visible:ring-accent`}
          >
            {o.label}
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * The same shape for a VIEW STATE — Board or Timeline, week or month, which
 * zoom the ruler is at. `aria-pressed` buttons rather than radios: nothing here
 * is form data, and `value` may be `null` when the view sits between presets
 * (the timeline at a free zoom), which a radio group cannot express.
 */
export function SegmentedSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
}: {
  label: string;
  value: T | null;
  options: readonly SegmentedOption<T>[];
  onChange: (next: T) => void;
  size?: Size;
}) {
  const s = SIZES[size];
  return (
    <div role="group" aria-label={label} className={`${TRACK} ${s.track}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          disabled={o.disabled}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`${SEGMENT} ${s.segment} disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            value === o.value ? SEGMENT_ON : SEGMENT_OFF
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
