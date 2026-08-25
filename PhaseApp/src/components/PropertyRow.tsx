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
 * The same property as a labelled LINE — the task page's form.
 *
 * What this replaced stated a leaf's properties as bordered chips, on the rule
 * that "the value IS the label": `45m` needs no eyebrow reading Estimate, and
 * an unset one names itself ("No estimate"). That rule holds for the docked
 * inspector above, where four short facts share one narrow column and a label
 * beside each would double its width for nothing.
 *
 * It does not hold on a page. Five chips in a row put five equal-weight
 * bordered objects between the title and the document, and on a task nobody
 * has filled in yet, FOUR of them read "No dates", "Not scheduled", "No
 * estimate", "Not a milestone" — a row of negations, louder than the note they
 * sit above. Splitting the label off lets the labels stay quiet and constant
 * while only the values carry ink, so an empty task reads as a page with a
 * blank margin rather than a page shouting about what it lacks.
 *
 * The popover behind every line is unchanged, and so is the accessible name
 * (`"Status: done"`), so a line and a chip are indistinguishable to a screen
 * reader and to the tests that drive them.
 */
/**
 * 140px of label, then the value. The list itself is capped by its caller
 * (`max-w-[520px]`) rather than running the document's full 720px measure: a
 * value cell that spans to the right margin turns every hover into a slab the
 * width of the page, which reads as a selected row rather than a pointer
 * passing over one.
 */
const LINE = 'grid grid-cols-[140px_minmax(0,1fr)] items-center gap-[4px] min-h-[30px]';
const LINE_LABEL =
  'inline-flex items-center gap-[7px] min-w-0 px-[6px] text-ui text-muted select-none';
const LINE_VALUE =
  'w-full flex items-center gap-[7px] px-[6px] py-[4px] rounded-[6px] text-ui text-left';

/**
 * `text-muted`, never `text-faint`, for an unset value.
 *
 * index.css reserves `faint` for "genuinely decorative marks, placeholders and
 * disabled states" and puts anything a user must READ in `muted`. An unset
 * property is read — it is also the only affordance for setting one — so it
 * takes the tone that clears AA. The hierarchy comes from `ink` vs `muted`
 * (15.8:1 against 4.8:1), which is plenty without dimming a control to 3:1.
 */
function valueTone(filled: boolean, tone: 'normal' | 'warn'): string {
  if (tone === 'warn' && filled) return 'text-warn';
  return filled ? 'text-ink' : 'text-muted';
}

/** A labelled line whose value opens a popover — Status, Dates, Schedule. */
export function PropertyLine({
  label,
  icon,
  value,
  placeholder,
  valueMark,
  tone = 'normal',
  panelWidth = 232,
  panelRole = 'menu',
  children,
}: {
  label: string;
  /** Sits with the LABEL, in the quiet column — this is what a property IS. */
  icon: React.ReactNode;
  value: string | null;
  placeholder: string;
  /** Sits with the VALUE, for a property whose mark is part of the reading — status. */
  valueMark?: React.ReactNode;
  tone?: 'normal' | 'warn';
  panelWidth?: number;
  /** `dialog` whenever the panel holds a textbox — a `menu` may not contain one. */
  panelRole?: 'menu' | 'dialog';
  children: (close: () => void) => React.ReactNode;
}) {
  const filled = value !== null;
  return (
    <div className={LINE}>
      <span className={LINE_LABEL} aria-hidden="true">
        <span className="flex-none inline-flex text-faint">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <Popover
        label={`${label}: ${value ?? placeholder}`}
        align="start"
        role={panelRole}
        panelWidth={panelWidth}
        panelClassName="px-[5px]"
        triggerClassName={`${LINE_VALUE} hover:bg-hover ${valueTone(filled, tone)}`}
        trigger={
          <>
            {valueMark && <span className="flex-none inline-flex">{valueMark}</span>}
            <span className="flex-1 min-w-0 truncate">{value ?? placeholder}</span>
          </>
        }
      >
        {children}
      </Popover>
    </div>
  );
}

/** A line that is a yes/no rather than a choice — Milestone. */
export function PropertyLineToggle({
  label,
  name,
  icon,
  on,
  onToggle,
  children,
}: {
  /** The accessible name — it states the ACTION, so it changes with the state. */
  label: string;
  /** The quiet, constant name of the property itself. */
  name: string;
  icon: React.ReactNode;
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={LINE}>
      <span className={LINE_LABEL} aria-hidden="true">
        <span className="flex-none inline-flex text-faint">{icon}</span>
        <span className="truncate">{name}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        className={`${LINE_VALUE} hover:bg-hover ${on ? 'text-ink' : 'text-muted'}`}
      >
        <span className="flex-1 min-w-0 truncate">{children}</span>
      </button>
    </div>
  );
}

/**
 * A line wrapping a control that already owns its own badge→field swap —
 * `EstimateControl`, `LogTimeControl`. They keep their behaviour: putting
 * either behind a popover would nest a disclosure inside a disclosure.
 */
export function PropertyLineInline({
  name,
  icon,
  children,
}: {
  name: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={LINE}>
      <span className={LINE_LABEL} aria-hidden="true">
        <span className="flex-none inline-flex text-faint">{icon}</span>
        <span className="truncate">{name}</span>
      </span>
      <span className={`${LINE_VALUE} text-ink`}>{children}</span>
    </div>
  );
}

/** A line whose value is free text the page must keep visible — Blocked on. */
export function PropertyLineField({
  name,
  icon,
  ...input
}: {
  name: string;
  icon: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={LINE}>
      <span className={LINE_LABEL} aria-hidden="true">
        <span className="flex-none inline-flex text-faint">{icon}</span>
        <span className="truncate">{name}</span>
      </span>
      {/* Borderless until focused, like every other value on the page: a boxed
          field here would be the only form control in a document. */}
      <input
        type="text"
        {...input}
        className={`${LINE_VALUE} text-ink bg-transparent outline-none hover:bg-hover focus:bg-hover placeholder:text-muted`}
      />
    </div>
  );
}
