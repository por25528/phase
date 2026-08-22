import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type {
  AssistantAction, AssistantFocusView, AssistantSnapshot,
} from '../../lib/assistantProtocol';
import { elapsedAgainstExpected, expectedTimeLabel } from '../../lib/assistantProtocol';
import type { AdviceReason, RecommendedWork } from '../../lib/executionAdvisor';
import { TIME_LEVELS, TIME_WORD, type TimeLevel } from '../../lib/timeLens';
import { FOCUS_LEVELS, FOCUS_WORD, type FocusLevel } from '../../lib/focusLens';
import { MAX_ALTERNATIVES } from '../../lib/executionAdvisor';
import { ringState } from '../../lib/sessionRing';
import { fmtMinutes } from '../../lib/effort';
import { useReducedMotion } from '../useReducedMotion';
import { isLeavingStage, useAssistantSendoff } from './useAssistantSendoff';
import { SegmentedSwitch } from '../SegmentedControl';
import { ghostBtn, primaryBtn, secondaryBtn } from '../dialogStyles';
import { captionLabel, sectionLabel } from '../sectionLabel';
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
 * The dial on the home row of the number keys, and it drives the TIME one —
 * that is the dial which changes what you are offered. Two dials would want
 * six keys, and the shelf is not a keyboard surface. There is no text field to
 * steal them.
 */
const KEY_TO_TIME_LEVEL: Record<string, TimeLevel | undefined> = {
  '1': 'low', '2': 'medium', '3': 'high',
};

function SectionLabel({ children }: { children: string }) {
  return <p className={sectionLabel}>{children}</p>;
}

/**
 * The notice line, and the two advisory lines, sit ABOVE band 1 with no bottom
 * inset — a line above the body is not a band and does not get one's bottom
 * padding.
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
  return shelf ? 'px-4 pt-3' : 'px-3';
}

/**
 * The primary title, in both panels, so the running state and the idle state
 * cannot disagree about how a name overflows.
 *
 * `truncate`, not `line-clamp-2`. The clamp was correct at 165px; at the band
 * layout's 433px one line carries the name, and a single line makes the card's
 * height independent of its content — which is what `HEIGHT` in
 * `electron/assistantWindow.cjs` is budgeting against, since that window clips
 * rather than scrolls. The full string stays on `title`.
 */
const workTitle = 'truncate text-h2 font-semibold text-ink leading-[1.25]';

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
      <div className="flex items-center gap-2.5">
        <span className={captionLabel}>Time</span>
        <SegmentedSwitch
          label="How long you have"
          size="sm"
          value={timeLevel}
          options={TIME_LEVELS.map((value) => ({ value, label: TIME_WORD[value] }))}
          onChange={(next) => onAction({ type: 'set-time-level', level: next })}
        />
      </div>
      <div className="flex items-center gap-2.5">
        <span className={captionLabel}>Focus</span>
        <SegmentedSwitch
          label="How much focus you have"
          size="sm"
          value={focusLevel}
          options={FOCUS_LEVELS.map((value) => ({ value, label: FOCUS_WORD[value] }))}
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
 */
function dialStripClass(shelf: boolean): string {
  return shelf
    ? 'flex items-center gap-4 border-t border-line bg-bg px-4 py-[7px]'
    : 'flex flex-col gap-1.5 border-b border-line px-3 pb-2 pt-3';
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
 * A row's own arrangement, and the second place the 620px shape had to stop
 * being imposed on the 380px one.
 *
 * On the shelf the title and its metadata sit on one line, the metadata
 * `shrink-0` so it states itself in full and the title takes the rest. That is
 * right at 620px and wrong at 380: `Comparative Literature · Usually 45–60m`
 * claims about 227px there, leaving the NAME OF THE WORK 114px — less than half
 * the room its own quiet metadata gets, which inverts the hierarchy this whole
 * band exists to correct. `Sidecar`, which this replaced, stacked them as two
 * `block` spans for exactly that reason; flattening it into one row was a
 * regression, not a simplification.
 *
 * So embedded stacks: the title takes its own line at full width, the metadata
 * sits beneath it. Both still truncate — a long goal title must not widen the
 * panel, it must be cut.
 */
function altRowCls(shelf: boolean): string {
  return shelf ? `${altRow} flex items-baseline gap-3` : altRow;
}

/**
 * The alternatives band's own inset, shared with `Skeleton` so the loading
 * shape and the thing that replaces it cannot drift apart.
 */
function altBandCls(shelf: boolean): string {
  return `border-t border-line ${shelf ? 'px-4 pt-2 pb-2.5' : 'px-3 py-2'}`;
}

function AlternativesBand({ label, items, disabled, onPick, shelf }: {
  label: string;
  items: RecommendedWork[];
  disabled: boolean;
  onPick: (ref: RecommendedWork['ref']) => void;
  shelf: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className={altBandCls(shelf)}>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-[2px] flex flex-col">
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            disabled={disabled}
            className={`${altRowCls(shelf)} ${i ? 'border-t border-line-soft' : ''}`}
            onClick={() => onPick(item.ref)}
          >
            <span
              className={shelf
                ? 'min-w-0 flex-1 truncate text-body text-ink-soft'
                : 'block truncate text-body text-ink-soft'}
            >
              {item.title}
            </span>
            <span
              className={shelf
                ? 'shrink-0 text-meta text-muted'
                : 'block truncate text-meta text-muted'}
            >
              {item.goalTitle ? `${item.goalTitle} · ` : ''}{expectedTimeLabel(item.expected)}
            </span>
          </button>
        ))}
      </div>
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
function WorkBand({ checkbox, ring, eyebrow, title, subtitle, extra, actions, shelf }: {
  checkbox: ReactNode;
  ring: ReactNode;
  eyebrow: string;
  title: ReactNode;
  subtitle: ReactNode;
  extra?: ReactNode;
  actions: ReactNode;
  shelf: boolean;
}) {
  return (
    <div className={`${bandCls(shelf)} flex ${shelf ? 'items-center gap-3' : 'flex-col gap-2'}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div data-gutter className={GUTTER}>{checkbox}</div>
        {ring}
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <SectionLabel>{eyebrow}</SectionLabel>
          {title}
          {subtitle}
          {extra}
        </div>
      </div>
      <div className={`flex shrink-0 gap-2 ${shelf ? '' : 'justify-end'}`}>{actions}</div>
    </div>
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
  const work = <div className={bandCls(shelf)}>{row('h-[46px]')}</div>;
  const alternatives = <div className={altBandCls(shelf)}>{row('h-[42px]')}</div>;
  // Two captioned switches stacked embedded, one row of them on the shelf.
  const dials = <div className={dialStripClass(shelf)}>{row(shelf ? 'h-[26px]' : 'h-[58px]')}</div>;
  return (
    <div role="status" aria-label="Preparing your next step" className="flex flex-col">
      {shelf ? <>{work}{alternatives}{dials}</> : <>{dials}{work}{alternatives}</>}
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
    ? <p className="truncate text-meta text-muted">{focus.goalTitle}</p>
    : null;
  const extra = focus.phase === 'confirming' ? (
    <p className="text-body text-ink">
      This session shows {fmtMinutes(focus.proposedMinutes ?? focus.elapsedMin)} — was that real work?
    </p>
  ) : (
    <p className="text-meta text-muted">
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
  // `needs-hours` is no longer what a new install shows on its first summon —
  // every install now starts on DEFAULT_AVAILABILITY — but it is still
  // reachable by switching every day off in Settings, and it is still a
  // different sentence from "nothing needs you". See PlanNotice.tsx.
  if (advice.kind === 'needs-hours') {
    return (
      <p className={`${bandCls(shelf)} text-body text-ink`}>
        Every day is switched off in Settings, so Phase can&apos;t say what fits. Give it some hours back.
      </p>
    );
  }
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
        title={<h2 className={workTitle} title={primary.title}>{primary.title}</h2>}
        subtitle={
          <p className="flex min-w-0 items-baseline gap-1.5 text-meta text-muted">
            {primary.goalTitle && <span className="truncate">{primary.goalTitle}</span>}
            {primary.goalTitle && <span aria-hidden>·</span>}
            <span className="shrink-0">{expectedTimeLabel(primary.expected)}</span>
          </p>
        }
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
        onPick={onStart}
        shelf={shelf}
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
      const level = KEY_TO_TIME_LEVEL[event.key];
      if (level) onAction({ type: 'set-time-level', level });
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
            alternatives={snapshot.advice.kind === 'work' ? snapshot.advice.alternatives : []}
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
