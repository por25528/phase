import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AssistantAction, AssistantFocusView, AssistantSnapshot,
} from '../../lib/assistantProtocol';
import { elapsedAgainstExpected, expectedTimeLabel } from '../../lib/assistantProtocol';
import type { AdviceReason, RecommendedWork } from '../../lib/executionAdvisor';
import { TIME_LEVELS, TIME_WORD, type TimeLevel } from '../../lib/timeLens';
import { DETAIL_LEVELS, DETAIL_WORD, type DetailLevel } from '../../lib/shelfDetail';
import { fmtMinutes } from '../../lib/effort';
import { useReducedMotion } from '../useReducedMotion';
import { isLeavingStage, useAssistantSendoff } from './useAssistantSendoff';
import { SegmentedSwitch } from '../SegmentedControl';
import { ghostBtn, primaryBtn, secondaryBtn } from '../dialogStyles';
import { sectionLabel } from '../sectionLabel';

/**
 * The one assistant surface, rendered in two places: inside the app by
 * `AssistantHost`, and inside the floating Electron overlay. It is fully
 * controlled — everything it knows arrives in `snapshot`, everything it wants
 * leaves through `onAction` — which is what lets the overlay copy render with
 * no store, no database and no clock of its own.
 *
 * The layout is one column with one focal point: the running session if there
 * is one, otherwise the single primary recommendation. Everything else — the
 * alternatives behind Other options, the notice — is deliberately smaller and
 * greyer than that one thing. A notice is a LINE ABOVE the body and never a
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
 * The shelf's two dials, and the only always-present controls on it.
 *
 * They are two axes and never one: the left says how long you have, which
 * decides what fits; the right says how much to hand over, which decides how
 * much is drawn. Ship them as one control and "half an hour" and "keep it
 * simple" have to share a number neither of them means.
 *
 * `SegmentedSwitch` rather than `SegmentedControl`: this is view state and not
 * form data, the same distinction Board/Timeline already makes. `sm` because
 * the shelf is a dense toolbar, and because 26px clears the 24px target floor.
 *
 * One component, two arrangements, the same idiom `bodyClass(shelf)` already
 * uses below: side by side on the 620px shelf, stacked on the 380px embedded
 * host, which has nothing for a second label-plus-switch pair to live in on
 * one line. A width-based wrap would answer a question neither presentation
 * actually asks — both are known fixed widths — so the branch is explicit.
 */
function DialStrip({ timeLevel, detailLevel, onAction, shelf }: {
  timeLevel: TimeLevel;
  detailLevel: DetailLevel;
  onAction: Props['onAction'];
  shelf: boolean;
}) {
  return (
    <div className={dialStripClass(shelf)}>
      <div className="flex items-center gap-2.5">
        <span className="text-meta font-semibold text-muted">I&rsquo;ve got</span>
        <SegmentedSwitch
          label="How long you have"
          size="sm"
          value={timeLevel}
          options={TIME_LEVELS.map((value) => ({ value, label: TIME_WORD[value] }))}
          onChange={(next) => onAction({ type: 'set-time-level', level: next })}
        />
      </div>
      <div className="flex items-center gap-2.5">
        <span className="text-meta font-semibold text-muted">Focus</span>
        <SegmentedSwitch
          label="How much to show"
          size="sm"
          value={detailLevel}
          options={DETAIL_LEVELS.map((value) => ({ value, label: DETAIL_WORD[value] }))}
          onChange={(next) => onAction({ type: 'set-detail-level', level: next })}
        />
      </div>
    </div>
  );
}

function dialStripClass(shelf: boolean): string {
  return shelf
    ? 'flex items-center gap-2.5 border-b border-line pb-2'
    : 'flex flex-col gap-1.5 border-b border-line pb-2';
}

/**
 * A row in a list of choices — an alternative to start, or to switch to.
 * Deliberately NOT one of the three dialog variants: those three
 * answer "which of these commits", and a list of things to pick from is not a
 * commit at all. Left-aligned and full-width, because it is read as a row.
 */
const optionRow =
  'w-full rounded-field border border-line bg-panel px-3 py-1.5 text-left text-ui text-ink '
  + 'hover:bg-hover disabled:opacity-40 disabled:pointer-events-none';

/** The one primary/action arrangement: two columns on the shelf, one stack embedded. */
function bodyClass(shelf: boolean): string {
  return shelf
    ? 'grid min-h-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1'
    : 'flex min-h-0 flex-col gap-2';
}

/** A quiet text disclosure. Revealed content is capped at two rows, internally scrollable. */
function OtherOptions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className="text-ui font-medium text-ink-soft hover:text-ink"
        onClick={() => setOpen((was) => !was)}
      >
        Other options
      </button>
      {open && (
        <div className="mt-1 flex max-h-32 flex-col gap-1.5 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div role="status" aria-label="Preparing your next step" className="flex flex-col gap-2 p-3">
      <div data-testid="skeleton-row" className="h-8 rounded-field bg-fill" />
      <div data-testid="skeleton-row" className="h-16 rounded-card bg-fill" />
      <div data-testid="skeleton-row" className="h-8 rounded-field bg-fill" />
    </div>
  );
}

function FocusPanel({ focus, alternatives, onAction, shelf, detail }: {
  focus: AssistantFocusView;
  alternatives: RecommendedWork[];
  onAction: Props['onAction'];
  shelf: boolean;
  detail: DetailLevel;
}) {
  const info = (
    <div className="flex min-w-0 flex-col gap-1">
      <SectionLabel>Focus session</SectionLabel>
      <h2 className="line-clamp-2 text-h2 font-semibold text-ink">{focus.title}</h2>
      {focus.goalTitle && <p className="truncate text-meta text-muted">{focus.goalTitle}</p>}
      {focus.phase === 'confirming' ? (
        <p className="text-body text-ink">
          This session shows {fmtMinutes(focus.proposedMinutes ?? focus.elapsedMin)} — was that real work?
        </p>
      ) : (
        <p className="text-meta text-muted">
          {elapsedAgainstExpected(focus.elapsedMin, focus.expected, detail)}
          {focus.phase === 'break' ? ' · On a break' : ''}
        </p>
      )}
    </div>
  );
  // The filled button is whatever moves the session forward from where you
  // are: on a break you came back to resume, mid-session you came to finish,
  // and `confirming` is a question whose expected answer is yes. It sits last,
  // under the reading edge, exactly as dialogFooter puts a commit button last.
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
        autoFocus
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
        autoFocus
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
      <button type="button" autoFocus className={primaryBtn} onClick={() => onAction({ type: 'resume-focus' })}>
        Continue
      </button>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className={bodyClass(shelf)}>
        {info}
        {actions}
      </div>
      {alternatives.length > 0 && (
        <OtherOptions>
          {alternatives.slice(0, 2).map((alt) => (
            <button
              key={alt.key}
              type="button"
              className={optionRow}
              onClick={() => onAction({ type: 'switch-focus', ref: alt.ref })}
            >
              <span className="text-ink-soft">{alt.title}</span>
              {alt.goalTitle && <span className="ml-2 truncate text-meta text-muted">{alt.goalTitle}</span>}
            </button>
          ))}
        </OtherOptions>
      )}
    </div>
  );
}

function AdvicePanel({ snapshot, shelf, pending, onStart }: {
  snapshot: Extract<AssistantSnapshot, { status: 'ready' }>;
  shelf: boolean;
  pending: boolean;
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
  const alternatives = advice.alternatives.slice(0, 2);
  const primaryColumn = (
    <div className="flex min-w-0 flex-col gap-1">
      <SectionLabel>{REASON_WORD[primary.reason]}</SectionLabel>
      <h2 className="line-clamp-2 text-h2 font-semibold text-ink">{primary.title}</h2>
      <p className="flex min-w-0 items-baseline gap-1.5 text-meta text-muted">
        {primary.goalTitle && <span className="truncate">{primary.goalTitle}</span>}
        {primary.goalTitle && <span aria-hidden>·</span>}
        <span className="shrink-0">{expectedTimeLabel(primary.expected)}</span>
      </p>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {advice.beyondWindow && (
        <p className="text-meta text-muted">Nothing light left — this is next when you&apos;re ready.</p>
      )}
      <div className={bodyClass(shelf)}>
        {primaryColumn}
        <button
          type="button"
          autoFocus
          disabled={pending}
          className={primaryBtn}
          onClick={() => onStart(primary.ref)}
        >
          Start session
        </button>
      </div>
      {alternatives.length > 0 && (
        <OtherOptions>
          {alternatives.map((alt) => (
            <button
              key={alt.key}
              type="button"
              disabled={pending}
              className={optionRow}
              onClick={() => onStart(alt.ref)}
            >
              <span className="text-ink-soft">{alt.title}</span>
              {alt.goalTitle && <span className="ml-2 text-meta text-muted">{alt.goalTitle}</span>}
              <span className="ml-2 text-meta text-faint">{expectedTimeLabel(alt.expected)}</span>
            </button>
          ))}
        </OtherOptions>
      )}
    </div>
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
          'grid h-full place-items-center text-h2 font-semibold text-ink',
          sendoff.stage === 'message' ? 'assistant-sendoff-enter' : '',
          'transition-[opacity,transform] duration-[180ms] ease-out',
          sendoff.stage === 'leaving' || sendoff.stage === 'hidden'
            ? 'pointer-events-none -translate-y-[6px] opacity-0'
            : 'translate-y-0 opacity-100',
        ].join(' ')}
      >
        Good luck!
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-3">
      <DialStrip timeLevel={snapshot.timeLevel} detailLevel={snapshot.detailLevel} onAction={onAction} shelf={shelf} />
      {snapshot.notice && (
        <p className={`text-meta ${snapshot.notice.tone === 'warning' ? 'text-warn' : 'text-muted'}`}>
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
            detail={snapshot.detailLevel}
          />
        ) : (
          <AdvicePanel
            snapshot={snapshot}
            shelf={shelf}
            pending={sendoff.pending}
            onStart={sendoff.start}
          />
        )}
      </div>
    </div>
  );
}
