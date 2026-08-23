import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type {
  AssistantAction, AssistantFocusView, AssistantSnapshot,
} from '../../lib/assistantProtocol';
import { elapsedAgainstExpected, expectedTimeLabel } from '../../lib/assistantProtocol';
import { switchCandidates } from '../../lib/pickWork';
import type { AdviceReason, RecommendedWork } from '../../lib/executionAdvisor';
import { TIME_LEVELS, TIME_WORD, type TimeLevel } from '../../lib/timeLens';
import { FOCUS_LEVELS, FOCUS_WORD, type FocusLevel } from '../../lib/focusLens';
import { MAX_ALTERNATIVES } from '../../lib/executionAdvisor';
import { dropSharedPrefix, sharedProjectPrefix } from '../../lib/sharedPrefix';
import { ringState } from '../../lib/sessionRing';
import { fmtMinutes } from '../../lib/effort';
import { useReducedMotion } from '../useReducedMotion';
import { isLeavingStage, useAssistantSendoff } from './useAssistantSendoff';
import { SegmentedSwitch } from '../SegmentedControl';
import { ghostBtn, primaryBtn, secondaryBtn } from '../dialogStyles';
import { captionLabel, ruleTag, sectionLabel } from '../sectionLabel';
import { SessionRing } from './SessionRing';
import { TodayCheckbox } from '../TodayCheckbox';

/**
 * The one assistant surface, rendered in two places: inside the app by
 * `AssistantHost`, and inside the floating Electron overlay. It is fully
 * controlled — everything it knows arrives in `snapshot`, everything it wants
 * leaves through `onAction` — which is what lets the overlay copy render with
 * no store, no database and no clock of its own.
 *
 * The layout is one column with one focal point: the running session if there
 * is one, otherwise the single primary recommendation. Everything else — the
 * alternatives in their own band below the work, the notice — stays quieter
 * and unbordered rather than that one thing's filled card, never hidden
 * behind a disclosure. A notice is a LINE ABOVE the body and never a
 * replacement for it: there is no state of the shelf with nothing to press.
 */

interface Props {
  snapshot: AssistantSnapshot;
  onAction: (action: AssistantAction) => void;
  /** `shelf` is the two-column primary/action top shelf; `embedded` stays compact vertical. */
  presentation?: 'embedded' | 'shelf';
  /** Increment to reset the send-off state machine (the overlay replays on every focus). */
  resetKey?: number;
  /**
   * The farewell has taken over the surface, or has given it back. Fired at the
   * transition, while the shelf's own body is still on screen — the floating
   * window measures its card here so the send-off can keep that footprint.
   * Embedded callers pass nothing and behave exactly as they did.
   */
  onSendoffChange?: (leaving: boolean) => void;
}

const REASON_WORD: Record<AdviceReason, string> = {
  'scheduled-now': 'Happening now',
  'scheduled-next': 'Up next',
  due: 'Due today',
  'committed-today': 'Committed today',
  'committed-week': 'This week',
  'carried-over': 'Carried over',
  'free-time': 'Fits your free time',
};

/**
 * The number row, and it drives BOTH dials: `1`-`3` set the time, `4`-`6` the
 * focus.
 *
 * OVERTURNS "two dials would want six keys, and the shelf is not a keyboard
 * surface". What falsified it is the bar itself. That argument was written when
 * the time dial was the one that changed what you are offered and the focus
 * dial was the junior of the two; the dials then shipped side by side, same
 * size, same voice, captioned as parallel nouns — and at that point "only one
 * of them has keys" stopped reading as restraint and started reading as an
 * omission. Two controls presented as peers, one of them mouse-only, is a
 * worse answer than six keys on a surface summoned by a keyboard shortcut.
 *
 * The rest of the old comment survives intact and still matters: the shelf has
 * no text field, so there is nothing for the number row to steal them from.
 */
const KEY_TO_TIME_LEVEL: Record<string, TimeLevel | undefined> = {
  '1': 'low', '2': 'medium', '3': 'high',
};

const KEY_TO_FOCUS_LEVEL: Record<string, FocusLevel | undefined> = {
  '4': 'low', '5': 'medium', '6': 'high',
};

/**
 * The printed legend for the two maps above, derived from them rather than
 * written out — a hint that names a key nothing binds is worse than no hint.
 *
 * Shelf only. The BINDING is live in both presentations and always has been;
 * what the 380px embedded panel does not get is the engraving, because that
 * panel is one anchored surface among many in a window already full of
 * shortcuts, and its dials are stacked into a column with no room to spare.
 */
function keyFor(map: Record<string, string | undefined>, level: string): string | undefined {
  return Object.keys(map).find((key) => map[key] === level);
}

function SectionLabel({ children }: { children: string }) {
  return <p className={sectionLabel}>{children}</p>;
}

/**
 * The notice line, and the two advisory lines, sit ABOVE band 1.
 *
 * The shelf branch grew a bottom inset with the rule tags, and that is not a
 * change of mind. The old rule — "a line above the body is not a band and does
 * not get one's bottom padding" — worked because the band UNDER it opened with
 * `pt-3.5`, so the gap existed and belonged to the band. A rule tag opens with
 * a hairline at y=0 and has no top inset to lend, so without this the notice
 * would sit directly on the rule. Embedded has no rule tags and keeps the
 * original rule exactly.
 *
 * The card's padding used to live on the root as a single `p-3`, which is why
 * every band had to share one inset and no band could carry a full-width
 * hairline. Each band owns its own now, and the hairlines run edge to edge.
 *
 * This states its padding IN FULL rather than appending an override to the band
 * helper it sits above. `${bandCls(shelf)} pb-0` would leave which rule wins to
 * the order Tailwind happens to emit `pb-3` and `pb-0` in — `dialogStyles.ts`
 * says it outright: a class list is not a cascade, and that exact trap is why
 * `DateField`'s `size` prop exists.
 */
function aboveBandCls(shelf: boolean): string {
  return shelf ? 'px-4 pt-3 pb-2.5' : 'px-3';
}

/**
 * The primary title, in both panels, so the running state and the idle state
 * cannot disagree about how a name overflows.
 *
 * `line-clamp-2`, and this OVERTURNS `truncate`. The one-line rule had a real
 * argument behind it — a single line makes the card's height independent of its
 * content, which is what `HEIGHT` in `electron/assistantWindow.cjs` budgets
 * against, since that window CLIPS rather than scrolls. What falsified it is
 * not the reasoning but its premise: "at the band layout's 433px one line
 * carries the name" was measured against short test titles. Against real ones
 * — `Pull slides and labs 1–5, get past papers (scope check)` — the shelf's own
 * primary was cut at the one moment it has to be read, which is the single
 * defect this whole surface exists to avoid.
 *
 * The budget answer is to pay the budget, not to shorten the sentence, and the
 * invariant already says what to do when a state grows — measure it again. It
 * was: `HEIGHT` moved from 308 to 343, re-measured by
 * `scripts/measure-shelf.cjs` at 620px, tallest state `confirming`.
 *
 * The full string stays on `title` either way, because two lines is a bigger
 * window, not an unbounded one.
 */
const workTitle = 'line-clamp-2 text-h2 font-semibold text-ink leading-[1.25]';

/**
 * The instrument grammar: a full-bleed hairline with its label sitting IN it.
 *
 * A section label and its divider are two objects — a line, then a heading
 * under it — and the reader assembles them. This is one: a tinted cell at the
 * left end carrying the label, the hairline continuing from it, and an
 * optional figure in a rule-separated cell at the right end. The divider and
 * the heading stop being two things.
 *
 * `bg-chip` is the tint. The mockup calls it `panel-hi`; this codebase has had
 * that exact value under the name `chip` in both themes since the token set
 * was written (`#F1F0EC` light, `#262421` dark), and adding a second name for
 * one value is how a palette starts drifting.
 *
 * SHELF ONLY, and every caller gates on it. The 380px embedded panel keeps
 * `SectionLabel` above its bands: a rule tag spends horizontal room on a cell,
 * a hairline and a figure, and that panel has already had the 620px shape
 * imposed on it twice — once by the alternatives row and once by the dials —
 * with a measurement recorded each time saying what it cost.
 *
 * `top` draws the hairline on BOTH edges. The first rule on the card only has
 * to separate itself from what follows; the `Or` rule sits between two regions
 * and has to close the one above it as well.
 */
const ruleRow = 'flex items-stretch border-b border-line';
const ruleCell = `${ruleTag} shrink-0 border-r border-line bg-chip px-[10px] py-[4px]`;
const ruleFigure =
  'flex shrink-0 items-center border-l border-line px-3 '
  + 'font-mono text-micro tabular-nums text-muted';

function RuleTag({ tag, figure, top }: { tag: string; figure?: string; top?: boolean }) {
  return (
    <div className={`${ruleRow} ${top ? 'border-t border-line' : ''}`}>
      <span className={ruleCell}>{tag}</span>
      {/* The rule itself: the empty middle IS the line, which is why the tag
          cell and the figure cell are both `shrink-0` and this is not. */}
      <span className="min-w-0 flex-1" />
      {figure !== undefined && <span className={ruleFigure}>{figure}</span>}
    </div>
  );
}

/**
 * The shelf's two dials, and the only always-present controls on it.
 *
 * They are two axes and never one: the left says how long you have, which
 * decides what fits; the right says how much of you is available, which decides
 * what the work has to be light enough for. Ship them as one control and "half
 * an hour" and "keep it simple" have to share a number neither of them means.
 *
 * `SegmentedSwitch` rather than `SegmentedControl`: this is view state and not
 * form data, the same distinction Board/Timeline already makes. `sm` because
 * the shelf is a dense toolbar, and because 26px clears the 24px target floor.
 *
 * One component, two arrangements, the same idiom `bandCls(shelf)` already
 * uses below: side by side on the 620px shelf, stacked on the 380px embedded
 * host, which has nothing for a second label-plus-switch pair to live in on
 * one line. A width-based wrap would answer a question neither presentation
 * actually asks — both are known fixed widths — so the branch is explicit.
 */
function DialStrip({ timeLevel, focusLevel, onAction, shelf }: {
  timeLevel: TimeLevel;
  focusLevel: FocusLevel;
  onAction: Props['onAction'];
  shelf: boolean;
}) {
  return (
    <div className={dialStripClass(shelf)}>
      <div className={dialCellCls(shelf, true)}>
        <span className={captionLabel}>Time</span>
        <SegmentedSwitch
          label="How long you have"
          size="sm"
          value={timeLevel}
          options={TIME_LEVELS.map((value) => ({
            value,
            label: TIME_WORD[value],
            ...(shelf ? { hint: keyFor(KEY_TO_TIME_LEVEL, value) } : {}),
          }))}
          onChange={(next) => onAction({ type: 'set-time-level', level: next })}
        />
      </div>
      <div className={dialCellCls(shelf, false)}>
        <span className={captionLabel}>Focus</span>
        <SegmentedSwitch
          label="How much focus you have"
          size="sm"
          value={focusLevel}
          options={FOCUS_LEVELS.map((value) => ({
            value,
            label: FOCUS_WORD[value],
            ...(shelf ? { hint: keyFor(KEY_TO_FOCUS_LEVEL, value) } : {}),
          }))}
          onChange={(next) => onAction({ type: 'set-focus-level', level: next })}
        />
      </div>
    </div>
  );
}

/**
 * On the shelf this is band 3: a status bar under the content, on `bg-bg`,
 * with the hairline ABOVE it. Embedded it stays where it was, above the body
 * with the hairline below — `AssistantHost` renders inside a
 * `max-h-[70vh] overflow-y-auto` panel, so a bar at the bottom would scroll
 * out of view instead of pinning, which is the whole point of a status bar.
 *
 * The `flex-col` in the embedded branch and its absence in the shelf branch
 * are both load-bearing: the 380px host has nothing for a second
 * caption-plus-switch pair to live in on one line.
 *
 * On the shelf the bar is now two CELLS with a hairline between them, and the
 * inset moved from the bar onto each cell — the same move the rule tags make
 * one region up. Two axes crowded onto one row read as one wide control with
 * six segments; ruled apart they read as two instruments, which is what they
 * are and what `DialStrip`'s own doc has said all along.
 */
function dialStripClass(shelf: boolean): string {
  return shelf
    ? 'flex items-stretch border-t border-line bg-bg'
    : 'flex flex-col gap-1.5 border-b border-line px-3 pb-2 pt-3';
}

/**
 * One dial's cell. `first` is what decides the divider rather than a
 * `:first-child` selector, because the hairline belongs to the SECOND cell —
 * a leading border on cell one would draw a line down the card's own left edge.
 */
function dialCellCls(shelf: boolean, first: boolean): string {
  if (!shelf) return 'flex items-center gap-2.5';
  return `flex items-center gap-2.5 px-4 py-[7px] ${first ? '' : 'border-l border-line'}`;
}

/**
 * Band 2: what else you could be doing.
 *
 * The rows used to be `optionRow` — bordered boxes on `bg-panel` — while the
 * primary recommendation had no container at all, so the only things on the
 * card wearing a border were the ones you were being invited NOT to pick. They
 * are text rows on hairlines now, and the primary is the only emphasised thing
 * on the surface.
 *
 * One band, two labels: `Or` when nothing is running, `Switch to` when
 * something is. Two verbs, because starting work you have not begun and
 * displacing a running sitting are different acts — but one region, because a
 * reader must not have to look in two places for the same question.
 *
 * The row is still one button with the whole row as its hit area, and that box
 * is exactly the band's content box — no horizontal padding of its own, and no
 * negative margin to cancel one. It carried `px-1 -mx-1` to bleed the hover
 * surface past the text, which also dragged the `border-line-soft` divider
 * BETWEEN the rows 4px out on each side: an inner rule cannot start left of
 * the inset its band's own hairline is drawn to, or the subordinate line reads
 * as the wider of the two. The text now starts where the section label above
 * it starts, and the divider ends where the band does.
 */
const altRow =
  'w-full rounded-[6px] py-[5px] text-left '
  + 'hover:bg-hover disabled:opacity-40 disabled:pointer-events-none';

/**
 * The same row, full-bleed under a rule tag.
 *
 * No rounding and no band inset: the rows now run edge to edge like the rule
 * above them, so the hover surface is the whole width of the card and a 6px
 * radius inside it would be a corner belonging to nothing. The inset moved onto
 * the row, which is what keeps the title's left edge on the same axis as the
 * rule tag's label.
 */
const altRowShelf =
  'w-full px-4 py-[7px] text-left '
  + 'hover:bg-hover disabled:opacity-40 disabled:pointer-events-none';

/**
 * A row's own arrangement, and the second place the 620px shape had to stop
 * being imposed on the 380px one.
 *
 * The 380px half of the original argument STANDS and is unchanged:
 * `Comparative Literature · Usually 45–60m` claims about 227px there, leaving
 * the NAME OF THE WORK 114px — less than half the room its own quiet metadata
 * gets, which inverts the hierarchy this whole band exists to correct.
 * `Sidecar`, which this replaced, stacked them as two `block` spans for exactly
 * that reason; flattening it into one row was a regression, not a
 * simplification. So embedded still stacks, and both spans still truncate — a
 * long goal title must not widen the panel, it must be cut.
 *
 * What is CORRECTED is the other half: "that is right at 620px". It was not.
 * The metadata was `shrink-0`, so it claimed its full width first and the title
 * took the remainder — and with real course titles that remainder cut BOTH
 * alternative titles while the metadata beside them stated itself in full. The
 * arrangement was not right at 620 and wrong at 380; it was wrong at both, and
 * only visibly catastrophic at 380.
 *
 * The row now gives its width to the work. See `altTitleCls`/`altMetaCls`.
 */
function altRowCls(shelf: boolean): string {
  return shelf ? `${altRowShelf} flex items-baseline gap-3` : altRow;
}

/**
 * The two spans of a shelf row, and the one rule between them: **the work's
 * name is never the first thing to lose room.**
 *
 * `min-w-[50%]` on the title is what states that. A `flex-1` title against a
 * `shrink-0` meta reads as "the title takes the rest", and it is — but "the
 * rest" is whatever the metadata did not want, and metadata that names a
 * project and a duration wants about 40% of the row before anyone asks. The
 * floor inverts who yields: the title cannot be pushed below half the row, so
 * a greedy meta hits the floor and gives its own width back instead.
 *
 * It is a floor and not a width. While the metadata is short — which, in the
 * rule-tag treatment, is most of the time — nothing binds and the title takes
 * everything it can use, exactly as before. The floor is what happens on the
 * bad day.
 *
 * `truncate` on the meta is the other half: a span that yields has to CUT.
 * Without it the meta wraps, and a two-line meta under a one-line title is the
 * embedded stack drawn by accident at the wrong width.
 */
const altTitleCls = (shelf: boolean): string => shelf
  ? 'min-w-[50%] flex-1 truncate text-body text-ink-soft'
  : 'block truncate text-body text-ink-soft';

/**
 * The metadata's voice, and the shelf's is MONO.
 *
 * What sits here is a project identifier and a duration — the two things a
 * proportional face sets worst and a mono one sets for a living. `tabular-nums`
 * on top of it so a column of minutes lines up rather than shimmering, which is
 * the whole reason the figure on a rule tag is set the same way.
 *
 * Embedded is unchanged: that panel stacks the two spans and has no rule tags
 * to be consistent with, so switching its face would be a change for its own
 * sake on the presentation the spec pins as untouched.
 */
const altMetaCls = (shelf: boolean): string => shelf
  ? 'min-w-0 shrink truncate font-mono text-micro tabular-nums text-muted'
  : 'block truncate text-meta text-muted';

/**
 * The subtitle under the primary's title. Same reasoning as `altMetaCls`: on
 * the shelf it carries the project and nothing else — the duration moved to the
 * rule tag's figure cell — so it is an identifier, and identifiers are what the
 * mono face is for.
 */
const workSubtitleCls = (shelf: boolean): string => shelf
  ? 'truncate font-mono text-micro tabular-nums text-muted'
  : 'truncate text-meta text-muted';

/**
 * The alternatives band's own inset, shared with `Skeleton` so the loading
 * shape and the thing that replaces it cannot drift apart.
 */
function altBandCls(shelf: boolean): string {
  return `border-t border-line ${shelf ? 'px-4 pt-2 pb-2.5' : 'px-3 py-2'}`;
}

/**
 * What the `Or` rule's figure states, and why it is honest.
 *
 * `MAX_ALTERNATIVES` really does cap this band — `FocusPanel` and `AdvicePanel`
 * both slice to it — so a bare count would be describing a list the reader
 * cannot see the end of. `N more` describes the ROWS, which is the one number
 * that is true whether or not the cap bit, and it is stated on the rule rather
 * than under the last row because a count of things you are about to read
 * belongs at the top of them.
 */
function moreLabel(count: number): string {
  return `${count} more`;
}

function AlternativesBand({ label, items, disabled, onPick, shelf, sharedPrefix }: {
  label: string;
  items: RecommendedWork[];
  disabled: boolean;
  onPick: (ref: RecommendedWork['ref']) => void;
  shelf: boolean;
  /**
   * The project prefix the PRIMARY already stated in full. Shelf only: the
   * embedded panel gives the metadata its own line, so there is no row of
   * repeated words to collapse.
   */
  sharedPrefix: string;
}) {
  if (items.length === 0) return null;
  const meta = (item: RecommendedWork): string => {
    const goal = item.goalTitle === undefined
      ? undefined
      : shelf ? dropSharedPrefix(item.goalTitle, sharedPrefix) : item.goalTitle;
    // `expectedTimeLabel` in full, never a bare `45m`. The prefix is what that
    // function is FOR — it says where the number came from — and the history
    // case is a RANGE no single figure can state.
    return `${goal ? `${goal} · ` : ''}${expectedTimeLabel(item.expected)}`;
  };
  const rows = items.map((item, i) => (
    <button
      key={item.key}
      type="button"
      disabled={disabled}
      className={`${altRowCls(shelf)} ${i ? 'border-t border-line-soft' : ''}`}
      onClick={() => onPick(item.ref)}
    >
      <span className={altTitleCls(shelf)}>{item.title}</span>
      <span className={altMetaCls(shelf)}>{meta(item)}</span>
    </button>
  ));

  if (shelf) {
    return (
      <>
        <RuleTag top tag={label} figure={moreLabel(items.length)} />
        <div className="flex flex-col">{rows}</div>
      </>
    );
  }
  return (
    <div className={altBandCls(shelf)}>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-[2px] flex flex-col">{rows}</div>
    </div>
  );
}

/**
 * A content band's padding. The card's padding used to live on the root as a
 * single `p-3`, which is why every band had to share one inset and no band
 * could carry a full-width hairline. Each band owns its own now, and the
 * hairlines run edge to edge.
 *
 * Stated in full rather than composed with `aboveBandCls`: appending an
 * override like `${bandCls(shelf)} pb-0` would leave which rule wins to the
 * order Tailwind happens to emit them in. `dialogStyles.ts` says it outright —
 * a class list is not a cascade, and that exact trap is why `DateField`'s
 * `size` prop exists.
 */
function bandCls(shelf: boolean): string {
  return shelf ? 'px-4 pt-3.5 pb-3' : 'px-3 py-2';
}

/**
 * The leading gutter, and why it is reserved rather than conditional.
 *
 * `confirming` renders no checkbox and no ring — that is a deliberate pin, and
 * it stands: the state is already asking "was that real work?", and a tick
 * there would answer a different question. But withholding the CONTROLS used
 * to withhold their ROOM too, so the shelf's most important line jumped 34px
 * left the instant a session ended.
 *
 * The checkbox slot is occupied in every state. The ring slot is occupied
 * across all three session phases — `active`, `break` AND `confirming` — so
 * the indent holds for as long as a session lasts, which is the interval over
 * which anyone actually watches this line. Idle work indents by the checkbox
 * alone; that step happens only when the whole card's content changes anyway.
 */
const GUTTER = 'w-[22px] shrink-0';
const RING_SLOT = 'w-[34px] shrink-0';

/**
 * Band 1: the work. Gutter, ring slot, the text column, the actions.
 *
 * Both panels render through this, which is the only reason the running state
 * and the idle state agree about where the title starts. `min-w-0` on the text
 * column is what lets `workTitle`'s `truncate` engage inside a flex row;
 * without it the column takes its content's width and the row overflows.
 *
 * **The actions sit beside the work on the shelf and BELOW it embedded, and
 * that branch is not cosmetic.** The one-row arrangement is what the 620px
 * overlay was designed around: subtract the gutter, the ring slot, two gaps
 * and two buttons from 588px and the title still measures 260px. Do the same
 * subtraction inside `AssistantHost`'s 380px panel and there is nothing left —
 * 28.4px in `active` and `break`, which draws as `D…`, and 48.6px in
 * `confirming`, where the sentence asking whether the session was real work
 * wraps into 189px of vertical text. That is the state this component exists
 * to make legible, rendered illegibly.
 *
 * Stacking is what the embedded panel did before the bands landed
 * (`bodyClass(false)` was `flex min-h-0 flex-col gap-2`), and the spec that
 * introduced them says in three places that this presentation does not change.
 * It gives the title 274px of the same 356px box. The buttons go to the
 * reading edge, per `dialogFooter` — the filled one is still last, and still
 * the reason you opened the panel.
 *
 * The gutter and the ring keep their reserved slots in BOTH arrangements: the
 * title's left edge must not move when a session ends, and that is true at
 * either width.
 */
function WorkBand({ checkbox, ring, eyebrow, figure, title, subtitle, extra, actions, shelf }: {
  checkbox: ReactNode;
  ring: ReactNode;
  eyebrow: string;
  /**
   * The rule tag's right-hand cell — shelf only, and only for work that has not
   * STARTED. `expectedTimeLabel` states an expectation, and a rule that
   * introduces a region is where a fact stated once belongs. A running session
   * has no expectation left to state; it has PROGRESS, which is a readout that
   * changes and therefore belongs beside the work rather than on its label.
   * That split is `expectedTimeLabel` vs `elapsedAgainstExpected`, restated as
   * a position.
   */
  figure?: string;
  title: ReactNode;
  subtitle: ReactNode;
  extra?: ReactNode;
  actions: ReactNode;
  shelf: boolean;
}) {
  const band = (
    <div className={`${bandCls(shelf)} flex ${shelf ? 'items-center gap-3' : 'flex-col gap-2'}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div data-gutter className={GUTTER}>{checkbox}</div>
        {ring}
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          {/* The eyebrow moved OUT of this column on the shelf and became the
              rule above it, which is what buys the title its second line back
              — see `workTitle`. Embedded keeps it here: a rule tag is a
              full-bleed object and that panel is 380px of one. */}
          {!shelf && <SectionLabel>{eyebrow}</SectionLabel>}
          {title}
          {subtitle}
          {extra}
        </div>
      </div>
      <div className={`flex shrink-0 gap-2 ${shelf ? '' : 'justify-end'}`}>{actions}</div>
    </div>
  );
  if (!shelf) return band;
  return (
    <>
      <RuleTag tag={eyebrow} {...(figure === undefined ? {} : { figure })} />
      {band}
    </>
  );
}

/**
 * The loading state, shaped like the thing that replaces it.
 *
 * Rows are `bg-hover`, a SURFACE token. They were `bg-fill`, which is the ink
 * token — the same value `text-ink` resolves to — so the light theme's loading
 * state was three solid black bars.
 *
 * The three shapes are the work, the alternatives and the dials, in the order
 * and at the insets THAT presentation puts them in, so the card does not
 * reflow into a different layout when the snapshot lands. It takes the same
 * `shelf` prop the bands do and spends their own class helpers, because it was
 * hard-coded to the shelf — `px-4` where the embedded bands use `px-3`, the
 * dial strip's `bg-bg` bar inside a `bg-panel` card, and the dials last where
 * embedded they come first. A skeleton that promises the wrong layout is worse
 * than no skeleton: it reflows twice.
 */
function Skeleton({ shelf }: { shelf: boolean }) {
  // `w-full` and never `flex-1`: the dial strip's own class is a flex
  // container, so a plain block child collapses to zero WIDTH inside its shelf
  // row — and `flex-1` fixes that by setting `flex-basis: 0`, which collapses
  // the same child to zero HEIGHT inside its embedded column. A width states
  // the one thing that is in question in both.
  const row = (height: string) => (
    <div data-testid="skeleton-row" className={`${height} w-full rounded-field bg-hover`} />
  );
  // A rule tag is CHROME, not content, so the skeleton draws the real thing
  // rather than a grey bar standing in for it: the same borders, the same tint,
  // the same cell — with a non-breaking space giving the cell the exact line
  // height its label would. That makes the promised height right by
  // construction, which is the only way two hand-tuned numbers stay in step.
  const rule = (top: boolean) => (
    <div className={`${ruleRow} ${top ? 'border-t border-line' : ''}`}>
      <span className={`${ruleCell} w-[104px]`}>{'\u00A0'}</span>
    </div>
  );
  const work = <div className={bandCls(shelf)}>{row('h-[46px]')}</div>;
  const alternatives = shelf
    ? <div className="flex flex-col px-4 py-[7px]">{row('h-[42px]')}</div>
    : <div className={altBandCls(shelf)}>{row('h-[42px]')}</div>;
  // Two captioned switches stacked embedded, one row of them on the shelf. The
  // shelf's cells own the inset now, so the strip itself has none and the
  // placeholder has to carry it.
  const dials = (
    <div className={dialStripClass(shelf)}>
      {shelf
        ? <div className={`${dialCellCls(true, true)} w-full`}>{row('h-[26px]')}</div>
        : row('h-[58px]')}
    </div>
  );
  return (
    <div role="status" aria-label="Preparing your next step" className="flex flex-col">
      {shelf
        ? <>{rule(false)}{work}{rule(true)}{alternatives}{dials}</>
        : <>{dials}{work}{alternatives}</>}
    </div>
  );
}

function FocusPanel({ focus, alternatives, onAction, shelf, focusLevel }: {
  focus: AssistantFocusView;
  alternatives: RecommendedWork[];
  onAction: Props['onAction'];
  shelf: boolean;
  focusLevel: FocusLevel;
}) {
  // The ring and the tick share one condition: `confirming` carries neither.
  // The ring has no progress to draw against a figure still in question, and a
  // tick would answer a different question than the one on screen.
  const running = focus.phase !== 'confirming';
  // `running` is `focus.phase !== 'confirming'`. The ring SLOT is present in
  // all three session phases; the ring itself only when something is running.
  const ring = (
    <div data-ring-slot className={RING_SLOT}>
      {running && (
        <SessionRing
          state={ringState(focus.expected, focus.elapsedMin, focusLevel)}
          paused={focus.phase === 'break'}
        />
      )}
    </div>
  );
  const checkbox = running ? (
    <TodayCheckbox
      checked={false}
      ariaLabel={`Complete "${focus.title}"`}
      onToggle={() => onAction({ type: 'complete-work', ref: focus.ref })}
    />
  ) : null;
  const subtitle = focus.goalTitle
    ? <p className={workSubtitleCls(shelf)}>{focus.goalTitle}</p>
    : null;
  const extra = focus.phase === 'confirming' ? (
    <p className="text-body text-ink">
      This session shows {fmtMinutes(focus.proposedMinutes ?? focus.elapsedMin)} — was that real work?
    </p>
  ) : (
    <p className="text-meta tabular-nums text-muted">
      {elapsedAgainstExpected(focus.elapsedMin, focus.expected, focusLevel)}
      {focus.phase === 'break' ? ' · On a break' : ''}
    </p>
  );
  // The filled button is whatever moves the session forward from where you
  // are: on a break you came back to resume, mid-session you came to finish,
  // and `confirming` is a question whose expected answer is yes. It sits last,
  // under the reading edge, exactly as dialogFooter puts a commit button last.
  //
  // No autoFocus. A shelf that focuses the same button on every open gains
  // nothing from a mark saying which button is focused — the ring was on
  // 100% of the time and distinguished nothing, in the one hue the system
  // reserves for action. Tab and it appears, where it means something.
  //
  // The pairs are fragments and not rows: `WorkBand` already wraps whatever it
  // is handed in a `flex gap-2`, so a second one here was a wrapper whose only
  // effect was to hide the buttons from the arrangement outside it.
  const actions = focus.phase === 'confirming' ? (
    <>
      <button
        type="button"
        className={ghostBtn}
        onClick={() => onAction({ type: 'confirm-focus', minutes: null })}
      >
        Didn&apos;t happen
      </button>
      <button
        type="button"
        className={primaryBtn}
        onClick={() => onAction({ type: 'confirm-focus', minutes: focus.proposedMinutes ?? focus.elapsedMin })}
      >
        Log {fmtMinutes(focus.proposedMinutes ?? focus.elapsedMin)}
      </button>
    </>
  ) : focus.phase === 'active' ? (
    <>
      <button type="button" className={secondaryBtn} onClick={() => onAction({ type: 'pause-focus' })}>
        Take break
      </button>
      <button
        type="button"
        className={primaryBtn}
        onClick={() => onAction({ type: 'complete-focus' })}
      >
        Complete session
      </button>
    </>
  ) : (
    <>
      <button
        type="button"
        className={secondaryBtn}
        onClick={() => onAction({ type: 'complete-focus' })}
      >
        Complete session
      </button>
      <button type="button" className={primaryBtn} onClick={() => onAction({ type: 'resume-focus' })}>
        Continue
      </button>
    </>
  );
  return (
    <>
      <WorkBand
        shelf={shelf}
        checkbox={checkbox}
        ring={ring}
        eyebrow="Focus session"
        title={<h2 className={workTitle} title={focus.title}>{focus.title}</h2>}
        subtitle={subtitle}
        extra={extra}
        actions={actions}
      />
      <AlternativesBand
        label="Switch to"
        // The same cap the idle panel takes, from the same constant: both
        // labels are one region, and a hard-coded 2 here would make `Switch to`
        // and `Or` disagree the day `MAX_ALTERNATIVES` moves.
        items={alternatives.slice(0, MAX_ALTERNATIVES)}
        disabled={false}
        onPick={(ref) => onAction({ type: 'switch-focus', ref })}
        shelf={shelf}
        // The running session is what states the project in full here, so it
        // is the one the alternatives may stop repeating.
        sharedPrefix={sharedProjectPrefix([
          focus.goalTitle,
          ...alternatives.slice(0, MAX_ALTERNATIVES).map((item) => item.goalTitle),
        ])}
      />
    </>
  );
}

function AdvicePanel({ snapshot, shelf, pending, onAction, onStart }: {
  snapshot: Extract<AssistantSnapshot, { status: 'ready' }>;
  shelf: boolean;
  pending: boolean;
  onAction: Props['onAction'];
  onStart: (ref: RecommendedWork['ref']) => void;
}) {
  const { advice } = snapshot;

  // The two bodies that are a sentence rather than a band, and they take a
  // band's inset anyway. The card's padding used to live on the root as one
  // `p-3`; when it moved onto the bands these two returns were left with
  // nothing, so the text sat at x=0, flush against the card's own rounded
  // corner.
  //
  // A `needs-hours` state used to sit above `clear` — "every day is switched
  // off in Settings". Nothing asks when you work any more, so the state is
  // unreachable and the sentence would be a lie. `beyondFocus` below carries
  // what it was really for: a missing model and a zero are different
  // sentences, and the shelf still says which one it means.
  if (advice.kind === 'clear') {
    return <p className={`${bandCls(shelf)} text-body text-ink`}>Nothing needs you right now.</p>;
  }

  const { primary } = advice;
  const alternatives = advice.alternatives.slice(0, MAX_ALTERNATIVES);

  return (
    <>
      {advice.beyondWindow && (
        <p className={`${aboveBandCls(shelf)} text-meta text-muted`}>
          Nothing that short left — this is next when you&apos;re ready.
        </p>
      )}
      {advice.beyondFocus && (
        <p className={`${aboveBandCls(shelf)} text-meta text-muted`}>
          Nothing light left — this is next when you&apos;re ready.
        </p>
      )}
      <WorkBand
        shelf={shelf}
        checkbox={
          <TodayCheckbox
            checked={false}
            ariaLabel={`Complete "${primary.title}"`}
            onToggle={() => onAction({ type: 'complete-work', ref: primary.ref })}
          />
        }
        ring={null}
        eyebrow={REASON_WORD[primary.reason]}
        // On the shelf the expectation is stated ONCE, on the rule above the
        // work, at the reading edge where a figure belongs. Embedded has no
        // rule to put it on, so it stays in the subtitle exactly as it was —
        // and that is the whole difference between these two branches.
        {...(shelf ? { figure: expectedTimeLabel(primary.expected) } : {})}
        title={<h2 className={workTitle} title={primary.title}>{primary.title}</h2>}
        subtitle={shelf ? (
          primary.goalTitle
            ? <p className={workSubtitleCls(true)}>{primary.goalTitle}</p>
            : null
        ) : (
          <p className="flex min-w-0 items-baseline gap-1.5 text-meta text-muted">
            {primary.goalTitle && <span className="truncate">{primary.goalTitle}</span>}
            {primary.goalTitle && <span aria-hidden>·</span>}
            <span className="shrink-0">{expectedTimeLabel(primary.expected)}</span>
          </p>
        )}
        actions={
          <button type="button" disabled={pending} className={primaryBtn} onClick={() => onStart(primary.ref)}>
            Start session
          </button>
        }
      />
      <AlternativesBand
        label="Or"
        items={alternatives}
        disabled={pending}
        // A pick points the shelf at the row; `Start session` starts it. The
        // same verb `Switch to` spends, because both bands are one region.
        onPick={(ref) => onAction({ type: 'switch-focus', ref })}
        shelf={shelf}
        // The primary names its project in full one region up; the alternatives
        // only have to say what makes them different.
        sharedPrefix={sharedProjectPrefix([
          primary.goalTitle,
          ...alternatives.map((item) => item.goalTitle),
        ])}
      />
    </>
  );
}

export function AssistantSurface({
  snapshot,
  onAction,
  presentation = 'embedded',
  resetKey = 0,
  onSendoffChange,
}: Props) {
  const reducedMotion = useReducedMotion();
  const sendoff = useAssistantSendoff({
    snapshot,
    reducedMotion,
    resetKey,
    onStart: (ref) => onAction({ type: 'start-focus', ref }),
    onClose: () => onAction({ type: 'close' }),
    onSendoffChange,
  });
  const shelf = presentation === 'shelf';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onAction({ type: 'close' });
        return;
      }
      const time = KEY_TO_TIME_LEVEL[event.key];
      if (time) {
        onAction({ type: 'set-time-level', level: time });
        return;
      }
      const focus = KEY_TO_FOCUS_LEVEL[event.key];
      if (focus) onAction({ type: 'set-focus-level', level: focus });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAction]);

  if (snapshot.status === 'loading') return <Skeleton shelf={shelf} />;

  if (isLeavingStage(sendoff.stage)) {
    return (
      <div
        role="status"
        aria-live="polite"
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && sendoff.stage === 'leaving') {
            sendoff.finishExit();
          }
        }}
        className={[
          'grid h-full place-items-center px-[46px] text-center',
          sendoff.stage === 'message' ? 'assistant-sendoff-enter' : '',
          'transition-[opacity,transform] duration-[180ms] ease-out',
          sendoff.stage === 'leaving' || sendoff.stage === 'hidden'
            ? 'pointer-events-none -translate-y-[6px] opacity-0'
            : 'translate-y-0 opacity-100',
        ].join(' ')}
      >
        {sendoff.quote ? (
          <div className="flex flex-col gap-2">
            <p className="text-h2 font-semibold text-ink">&ldquo;{sendoff.quote.text}&rdquo;</p>
            <p className="text-meta text-muted">
              <span className="font-semibold text-ink-soft">{sendoff.quote.who}</span>
              {' · '}{sendoff.quote.source}
            </p>
          </div>
        ) : (
          <span className="text-h2 font-semibold text-ink">Good luck!</span>
        )}
      </div>
    );
  }

  const body = (
    <>
      {snapshot.notice && (
        <p className={[
          aboveBandCls(shelf),
          shelf ? 'truncate' : '',
          'text-meta',
          snapshot.notice.tone === 'warning' ? 'text-warn' : 'text-muted',
        ].join(' ')}>
          {snapshot.notice.text}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {snapshot.activeFocus ? (
          <FocusPanel
            focus={snapshot.activeFocus}
            // Primary included, running work excluded: `alternatives` alone
            // hid the advisor's head and could offer the task already on
            // the clock as something to switch to.
            alternatives={switchCandidates(snapshot.advice, snapshot.activeFocus.ref)}
            onAction={onAction}
            shelf={shelf}
            focusLevel={snapshot.focusLevel}
          />
        ) : (
          <AdvicePanel
            snapshot={snapshot}
            shelf={shelf}
            pending={sendoff.pending}
            onAction={onAction}
            onStart={sendoff.start}
          />
        )}
      </div>
    </>
  );

  // The dial bar is LAST on the shelf and FIRST embedded — see dialStripClass.
  // The root carries no padding of its own any more: each band owns its inset,
  // which is what lets the hairlines between them run edge to edge.
  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden ${shelf ? '' : 'gap-2 pb-3'}`}>
      {!shelf && <DialStrip timeLevel={snapshot.timeLevel} focusLevel={snapshot.focusLevel} onAction={onAction} shelf={false} />}
      {body}
      {shelf && <DialStrip timeLevel={snapshot.timeLevel} focusLevel={snapshot.focusLevel} onAction={onAction} shelf />}
    </div>
  );
}
