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
 * The row is still one button with the whole row as its hit area. `-mx-1`
 * against the row's own `px-1` keeps the hover surface aligned to the band's
 * text rather than to its padding box.
 */
const altRow =
  'flex w-full items-baseline gap-3 rounded-[6px] px-1 py-[5px] text-left '
  + 'hover:bg-hover disabled:opacity-40 disabled:pointer-events-none';

function AlternativesBand({ label, items, disabled, onPick, shelf }: {
  label: string;
  items: RecommendedWork[];
  disabled: boolean;
  onPick: (ref: RecommendedWork['ref']) => void;
  shelf: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className={`border-t border-line ${shelf ? 'px-4 pt-2 pb-2.5' : 'px-3 py-2'}`}>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-[2px] flex flex-col">
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            disabled={disabled}
            className={`${altRow} -mx-1 ${i ? 'border-t border-line-soft' : ''}`}
            onClick={() => onPick(item.ref)}
          >
            <span className="min-w-0 flex-1 truncate text-body text-ink-soft">{item.title}</span>
            <span className="shrink-0 text-meta text-muted">
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
 * Band 1: the work. One row — gutter, ring slot, the text column, the actions.
 *
 * Both panels render through this, which is the only reason the running state
 * and the idle state agree about where the title starts. `min-w-0` on the text
 * column is what lets `workTitle`'s `truncate` engage inside a flex row;
 * without it the column takes its content's width and the row overflows.
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
    <div className={`${bandCls(shelf)} flex items-center gap-3`}>
      <div data-gutter className={GUTTER}>{checkbox}</div>
      {ring}
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <SectionLabel>{eyebrow}</SectionLabel>
        {title}
        {subtitle}
        {extra}
      </div>
      <div className="flex shrink-0 gap-2">{actions}</div>
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
 * The three shapes are band 1 (the work), band 2 (the alternatives) and band 3
 * (the dials), in that order and at those heights, so the card does not reflow
 * into a different layout when the snapshot lands.
 */
function Skeleton() {
  return (
    <div role="status" aria-label="Preparing your next step" className="flex flex-col">
      <div className="px-4 pt-3.5 pb-3">
        <div data-testid="skeleton-row" className="h-[46px] rounded-field bg-hover" />
      </div>
      <div className="border-t border-line px-4 pt-2 pb-2.5">
        <div data-testid="skeleton-row" className="h-[42px] rounded-field bg-hover" />
      </div>
      <div className="border-t border-line bg-bg px-4 py-[7px]">
        <div data-testid="skeleton-row" className="h-[26px] rounded-[6px] bg-hover" />
      </div>
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
  const actions = focus.phase === 'confirming' ? (
    <div className="flex gap-2">
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
    </div>
  ) : focus.phase === 'active' ? (
    <div className="flex gap-2">
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
    </div>
  ) : (
    <div className="flex gap-2">
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
    </div>
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
        items={alternatives.slice(0, 2)}
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

  if (advice.kind === 'needs-hours') {
    return (
      <p className="text-body text-ink">
        Phase doesn&apos;t know your working hours yet. Set them in Settings and it can say what fits.
      </p>
    );
  }
  if (advice.kind === 'clear') {
    return <p className="text-body text-ink">Nothing needs you right now.</p>;
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

  if (snapshot.status === 'loading') return <Skeleton />;

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
