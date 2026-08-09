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
 * A property that is a yes/no rather than a choice — Milestone, today.
 *
 * A popover holding two options would be a menu asking a question its own
 * trigger already answers, so this commits on click and styles the `on` state
 * in the accent rather than opening anything.
 */
export function PropertyToggle({
  label,
  icon,
  on,
  onToggle,
  disabled,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`w-full flex items-center gap-[8px] px-[6px] py-[5px] rounded-[6px] text-ui text-left hover:bg-hover disabled:opacity-40 disabled:pointer-events-none ${
        on ? 'text-accent-deep' : 'text-muted'
      }`}
    >
      <span className={`flex-none inline-flex ${on ? 'text-accent' : 'text-faint'}`}>{icon}</span>
      <span className="flex-1 min-w-0 truncate">{children}</span>
    </button>
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
