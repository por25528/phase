import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AssistantAction, AssistantFocusView, AssistantSnapshot,
} from '../../lib/assistantProtocol';
import { expectedTimeLabel } from '../../lib/assistantProtocol';
import type { AssistantProposal } from '../../lib/assistantCommands';
import { ASSISTANT_EXAMPLES } from '../../lib/assistantCommands';
import type { AdviceReason, RecommendedWork } from '../../lib/executionAdvisor';
import { fmtMinutes } from '../../lib/effort';
import { fmtD } from '../../lib/dates';
import { useReducedMotion } from '../useReducedMotion';
import { useAssistantSendoff } from './useAssistantSendoff';

/**
 * The one assistant surface, rendered in two places: inside the app by
 * `AssistantHost`, and inside the floating Electron overlay. It is fully
 * controlled — everything it knows arrives in `snapshot`, everything it wants
 * leaves through `onAction` — which is what lets the overlay copy render with
 * no store, no database and no clock of its own.
 *
 * The layout is one column with one focal point: the running session if there
 * is one, otherwise the single primary recommendation. Everything else — the
 * alternatives behind Other options, the preview awaiting confirmation, the
 * notice — is deliberately smaller and greyer than that one thing.
 */

interface Props {
  snapshot: AssistantSnapshot;
  onAction: (action: AssistantAction) => void;
  /** `shelf` is the two-column primary/action top shelf; `embedded` stays compact vertical. */
  presentation?: 'embedded' | 'shelf';
  /** Increment to reset the send-off state machine (the overlay replays on every focus). */
  resetKey?: number;
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

function SectionLabel({ children }: { children: string }) {
  return <p className="text-meta font-semibold text-muted">{children}</p>;
}

function quietButton(extra = ''): string {
  return `rounded-field border border-line bg-panel px-3 py-1.5 text-ui text-ink hover:bg-hover ${extra}`;
}

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
    <div role="status" aria-label="Preparing your next step" className="flex flex-col gap-3 p-4">
      <div data-testid="skeleton-row" className="h-8 rounded-field bg-fill" />
      <div data-testid="skeleton-row" className="h-16 rounded-card bg-fill" />
      <div data-testid="skeleton-row" className="h-8 rounded-field bg-fill" />
    </div>
  );
}

function ProposalPanel({ proposal, onAction }: {
  proposal: AssistantProposal;
  onAction: Props['onAction'];
}) {
  if (proposal.kind === 'choose-subject') {
    if (proposal.choices.length === 0) {
      return (
        <div className="rounded-card border border-line p-3">
          <p className="text-body text-ink">Nothing open matches that.</p>
        </div>
      );
    }
    return (
      <div className="rounded-card border border-line p-3">
        <SectionLabel>Which one?</SectionLabel>
        <div className="mt-2 flex flex-col gap-1.5">
          {proposal.choices.map((choice) => (
            <button
              key={choice.ref.id}
              type="button"
              className={quietButton('text-left')}
              onClick={() => onAction({
                type: 'choose-subject', proposalId: proposal.id, subjectId: choice.ref.id,
              })}
            >
              <span className="text-ink">{choice.title}</span>
              {choice.goalTitle && <span className="ml-2 text-meta text-muted">{choice.goalTitle}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const line = proposal.kind === 'capture'
    ? [
        `Add "${proposal.title}"`,
        proposal.date ? `on ${fmtD(proposal.date)}` : null,
        proposal.estimateMin !== undefined ? `~${proposal.estimateMin}m` : null,
      ].filter(Boolean).join(' ')
    : proposal.kind === 'complete'
      ? `Mark "${proposal.subject.title}" done`
      : `Schedule "${proposal.subject.title}" on ${fmtD(proposal.date)}`;

  return (
    <div className="rounded-card border border-line p-3">
      <p className="text-body text-ink">{line}</p>
      {proposal.kind !== 'capture' && proposal.subject.goalTitle && (
        <p className="mt-0.5 truncate text-meta text-muted">{proposal.subject.goalTitle}</p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className={quietButton('border-line-2 font-medium')}
          onClick={() => onAction({ type: 'confirm-proposal', id: proposal.id })}
        >
          Confirm
        </button>
        <button
          type="button"
          className={quietButton('text-muted')}
          onClick={() => onAction({ type: 'cancel-proposal' })}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function FocusPanel({ focus, alternatives, onAction, shelf }: {
  focus: AssistantFocusView;
  alternatives: RecommendedWork[];
  onAction: Props['onAction'];
  shelf: boolean;
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
          {fmtMinutes(focus.elapsedMin)} worked
          {focus.phase === 'break' ? ' · on a break' : ''}
          {' · '}
          {expectedTimeLabel(focus.expected)}
        </p>
      )}
    </div>
  );
  const actions = focus.phase === 'confirming' ? (
    <div className="flex gap-2">
      <button
        type="button"
        className={quietButton('border-line-2 font-medium')}
        onClick={() => onAction({ type: 'confirm-focus', minutes: focus.proposedMinutes ?? focus.elapsedMin })}
      >
        Log {fmtMinutes(focus.proposedMinutes ?? focus.elapsedMin)}
      </button>
      <button
        type="button"
        className={quietButton('text-muted')}
        onClick={() => onAction({ type: 'confirm-focus', minutes: null })}
      >
        Didn&apos;t happen
      </button>
    </div>
  ) : (
    <div className="flex gap-2">
      <button
        type="button"
        className={quietButton('border-line-2 font-medium')}
        onClick={() => onAction({ type: 'complete-focus' })}
      >
        Complete session
      </button>
      {focus.phase === 'active' ? (
        <button type="button" className={quietButton()} onClick={() => onAction({ type: 'pause-focus' })}>
          Take break
        </button>
      ) : (
        <button type="button" className={quietButton()} onClick={() => onAction({ type: 'resume-focus' })}>
          Continue
        </button>
      )}
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
              className={quietButton('text-left')}
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

function AdvicePanel({ snapshot, onAction, shelf, pending, onStart }: {
  snapshot: Extract<AssistantSnapshot, { status: 'ready' }>;
  onAction: Props['onAction'];
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
    return (
      <div className="flex flex-col gap-2">
        <p className="text-body text-ink">Nothing needs you right now.</p>
        <SectionLabel>Try</SectionLabel>
        <ul className="flex flex-col gap-1">
          {ASSISTANT_EXAMPLES.map((example) => (
            <li key={example} className="text-ui text-muted">{example}</li>
          ))}
        </ul>
      </div>
    );
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
      <div className={bodyClass(shelf)}>
        {primaryColumn}
        <button
          type="button"
          disabled={pending}
          className={quietButton('border-line-2 font-medium disabled:cursor-default disabled:opacity-60')}
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
              className={quietButton('text-left')}
              onClick={() => onAction({ type: 'start-focus', ref: alt.ref })}
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
}: Props) {
  const [text, setText] = useState('');
  const reducedMotion = useReducedMotion();
  const sendoff = useAssistantSendoff({
    snapshot,
    reducedMotion,
    resetKey,
    onStart: (ref) => onAction({ type: 'start-focus', ref }),
    onClose: () => onAction({ type: 'close' }),
  });
  const shelf = presentation === 'shelf';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onAction({ type: 'close' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAction]);

  if (snapshot.status === 'loading') return <Skeleton />;

  if (sendoff.stage === 'message' || sendoff.stage === 'leaving' || sendoff.stage === 'hidden') {
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
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4">
      <input
        autoFocus
        aria-label="Ask Phase"
        className="w-full rounded-field border border-line bg-field px-3 py-2 text-ui text-ink placeholder:text-faint focus:border-line-2 focus:outline-none"
        placeholder="Ask Phase or add something…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          const line = text.trim();
          if (!line) return;
          onAction({ type: 'submit-input', text: line });
          setText('');
        }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {snapshot.notice?.tone === 'warning' && (
          <p className="mb-2 text-meta text-warn">{snapshot.notice.text}</p>
        )}
        {snapshot.proposal ? (
          <ProposalPanel proposal={snapshot.proposal} onAction={onAction} />
        ) : snapshot.notice?.tone === 'neutral' ? (
          <p className="text-body text-ink">{snapshot.notice.text}</p>
        ) : snapshot.activeFocus ? (
          <FocusPanel
            focus={snapshot.activeFocus}
            alternatives={snapshot.advice.kind === 'work' ? snapshot.advice.alternatives : []}
            onAction={onAction}
            shelf={shelf}
          />
        ) : (
          <AdvicePanel
            snapshot={snapshot}
            onAction={onAction}
            shelf={shelf}
            pending={sendoff.pending}
            onStart={sendoff.start}
          />
        )}
      </div>
    </div>
  );
}
