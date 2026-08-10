import { Popover } from './Popover';

/**
 * One line of the compact inspector: a mark, a value, and a popover behind it.
 *
 * The panel this replaces spent a labelled `<section>` on every property — an
 * eyebrow, then a control, then 22px of margin. Four properties came to roughly
 * 240 vertical pixels to state four short facts, so the task's own children
 * were below the fold on the surface whose job is showing them.
 *
 * A property row states the fact and hides the editor. The value IS the label:
 * "45m" needs no eyebrow reading "Estimate", and when there is no value the
 * placeholder says which property is empty ("No estimate") — which is also the
 * affordance for setting one. What it never does is print a zero. `0m` is a
 * measurement nobody took, and rendering it as though someone had is how the
 * old header made an empty goal look estimated.
 */
export function PropertyRow({
  label,
  icon,
  value,
  placeholder,
  tone = 'normal',
  panelWidth = 232,
  align = 'start',
  panelRole = 'menu',
  disabled,
  children,
}: {
  /** The property's name, for assistive tech and the popover's own label. */
  label: string;
  icon: React.ReactNode;
  /** The current value. `null` renders `placeholder` in the muted tone. */
  value: string | null;
  placeholder: string;
  /** `warn` for a value that is itself the problem — an overdue date. */
  tone?: 'normal' | 'warn';
  panelWidth?: number;
  align?: 'start' | 'end';
  /**
   * `menu` for a list of choices (status), `dialog` when the panel holds a
   * textbox (estimate, date). A `menu` may not contain a text input — the
   * roles its children are allowed to take do not include one.
   */
  panelRole?: 'menu' | 'dialog';
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const filled = value !== null;
  return (
    <Popover
      label={`${label}: ${value ?? placeholder}`}
      align={align}
      disabled={disabled}
      role={panelRole}
      panelWidth={panelWidth}
      panelClassName="px-[5px]"
      triggerClassName={`w-full flex items-center gap-[8px] px-[6px] py-[5px] rounded-[6px] text-ui text-left hover:bg-hover disabled:opacity-40 disabled:pointer-events-none ${
        tone === 'warn' && filled ? 'text-warn' : filled ? 'text-ink-soft' : 'text-muted'
      }`}
      trigger={
        <>
          <span className="flex-none inline-flex text-faint">{icon}</span>
          <span className="flex-1 min-w-0 truncate">{value ?? placeholder}</span>
        </>
      }
    >
      {children}
    </Popover>
  );
}

/**
 * A property with nothing behind it — a container's derived status, which is
 * computed from its descendants and cannot be set here.
 *
 * It matches the interactive rows' metrics exactly so a column of properties
 * stays a column, and carries no hover state, because there is nothing to
 * press. A disabled `PropertyRow` would have been the lazy version of this and
 * would have implied the editor exists but is unavailable.
 */
export function PropertyStatic({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full flex items-center gap-[8px] px-[6px] py-[5px] text-ui text-ink-soft">
      <span className="flex-none inline-flex text-faint">{icon}</span>
      <span className="flex-1 min-w-0 truncate">{children}</span>
    </div>
  );
}

/**
 * A choice inside a property popover — one status, one estimate preset.
 *
 * `menuitemradio` rather than `option`: `option` is only legal inside a
 * `listbox`, and these sit in the `menu` a `PropertyRow` opens. The role also
 * carries the "one of these is current" semantic that `menuitem` lacks, so a
 * screen reader states the selected status without the label repeating it.
 *
 * `current` draws the accent rather than a filled background: the panel is
 * small, and a solid row in it reads as a hover state the pointer has left
 * behind.
 */
export function PropertyOption({
  onSelect,
  close,
  current,
  children,
}: {
  onSelect: () => void;
  close: () => void;
  current?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={!!current}
      onClick={() => {
        close();
        onSelect();
      }}
      className={`w-full text-left px-[9px] py-[5px] rounded-[6px] text-ui flex items-center gap-[8px] hover:bg-hover ${
        current ? 'text-accent-deep font-semibold' : 'text-ink-soft'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The same property, laid out inline instead of stacked.
 *
 * A task's page states its facts in a row under the title, where the inspector
 * states them in a column. Only the metrics differ: the trigger opens the SAME
 * `Popover` with the SAME children, which is what stops the page and the panel
 * drifting about what scheduling or status offers.
 *
 * `rounded-field`, not a pill. The chip is one of this app's controls wearing
 * this app's control shape; a borrowed pill would be a second visual language
 * for a job the existing one already does.
 */
const CHIP_CLASS =
  'inline-flex items-center gap-[6px] min-h-[28px] px-[9px] py-[3px] rounded-field border border-line text-ui';

export function PropertyChip({
  label,
  icon,
  value,
  placeholder,
  panelWidth = 232,
  panelRole = 'menu',
  children,
}: {
  label: string;
  icon: React.ReactNode;
  value: string | null;
  placeholder: string;
  panelWidth?: number;
  /** `dialog` whenever the panel holds a textbox — a `menu` may not contain one. */
  panelRole?: 'menu' | 'dialog';
  children: (close: () => void) => React.ReactNode;
}) {
  const filled = value !== null;
  return (
    <Popover
      label={`${label}: ${value ?? placeholder}`}
      align="start"
      role={panelRole}
      panelWidth={panelWidth}
      panelClassName="px-[5px]"
      triggerClassName={`${CHIP_CLASS} hover:bg-hover ${
        filled ? 'text-ink-soft' : 'text-muted'
      }`}
      trigger={
        <>
          <span className="flex-none inline-flex text-faint">{icon}</span>
          <span className="truncate max-w-[220px]">{value ?? placeholder}</span>
        </>
      }
    >
      {children}
    </Popover>
  );
}

/** A chip that is a yes/no rather than a choice — Milestone. */
export function PropertyChipToggle({
  label,
  icon,
  on,
  onToggle,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`${CHIP_CLASS} hover:bg-hover ${
        on ? 'text-accent-deep border-accent' : 'text-muted'
      }`}
    >
      <span className={`flex-none inline-flex ${on ? 'text-accent' : 'text-faint'}`}>{icon}</span>
      <span className="truncate max-w-[220px]">{children}</span>
    </button>
  );
}

/**
 * A chip wrapping a control that already owns its own badge→field swap —
 * `EstimateControl`, `LogTimeControl`. They borrow the metrics and keep their
 * behaviour: putting either behind a popover would nest a disclosure inside a
 * disclosure.
 */
export function PropertyChipInline({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className={`${CHIP_CLASS} text-ink-soft`}>
      <span className="flex-none inline-flex text-faint">{icon}</span>
      {children}
    </span>
  );
}
