import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { AssistantSurface } from './AssistantSurface';
import { assistantMainBridge } from '../../lib/assistantBridge';
import { executionAdvice } from '../../lib/executionAdvisor';
import { expectedTimeFor } from '../../lib/expectedTime';
import type {
  AssistantAction, AssistantFocusView, AssistantSnapshot,
} from '../../lib/assistantProtocol';
import { elapsedFocusMinutes } from '../../lib/focusSession';
import { weekOf } from '../../lib/plan';
import { todayStr } from '../../lib/dates';

/**
 * The sole adapter between `AssistantAction` and the store.
 *
 * Everything a snapshot contains is derived here from hydrated state and the
 * local clock, and every verb lands on an EXISTING store action — `startFocus`,
 * `pauseFocus`/`resumeFocus`, `completeFocus`/`confirmFocus` — never on a new
 * write path. The only state of its own is the ephemeral notice, which is
 * exactly the state that must NOT persist: the assistant keeps no history.
 *
 * Works with no Electron at all: in the browser this renders the surface as an
 * anchored in-app panel and the desktop relay simply never engages.
 */

interface Notice {
  tone: 'neutral' | 'warning';
  text: string;
}

function nowMinute(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function AssistantHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    goals, tasks, sessions, availability, allDayBlocks, activeFocusSession,
    assistantAccelerator, hydration, actions,
  } = useAppStore();
  const [notice, setNotice] = useState<Notice | null>(null);

  // Escape is CONSUMED, exactly as Popover consumes it: App listens on the
  // bubble phase, and letting the key through would close this panel and the
  // page behind it in one press.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const snapshot: AssistantSnapshot = useMemo(() => {
    if (hydration !== 'ready') return { status: 'loading' };
    const today = todayStr();
    const advice = executionAdvice({
      goals, tasks, sessions, availability, blocks: [], allDayBlocks,
      today, week: weekOf(today), now: { date: today, minute: nowMinute() },
    });
    const activeFocus: AssistantFocusView | null = activeFocusSession
      ? {
          ref: activeFocusSession.ref,
          title: activeFocusSession.title,
          ...(activeFocusSession.goalTitle === undefined ? {} : { goalTitle: activeFocusSession.goalTitle }),
          phase: activeFocusSession.phase,
          elapsedMin: elapsedFocusMinutes(activeFocusSession, Date.now()),
          expected: activeFocusSession.expected,
          ...(activeFocusSession.proposedMinutes === undefined ? {} : { proposedMinutes: activeFocusSession.proposedMinutes }),
        }
      : null;
    return {
      status: 'ready',
      advice,
      activeFocus,
      ...(notice ? { notice } : {}),
    };
  }, [hydration, goals, tasks, sessions, availability, allDayBlocks, activeFocusSession, notice]);

  function onAction(action: AssistantAction): void {
    switch (action.type) {
      case 'start-focus': {
        setNotice(null);
        const started = actions.startFocus(
          action.ref,
          expectedTimeFor(action.ref, { goals, tasks, sessions }),
        );
        if (!started) setNotice({ tone: 'warning', text: 'A session is already running.' });
        return;
      }
      case 'pause-focus': actions.pauseFocus(); return;
      case 'resume-focus': actions.resumeFocus(); return;
      case 'complete-focus': {
        if (actions.completeFocus() === 'refused') {
          setNotice({ tone: 'warning', text: "Couldn't log that session." });
        }
        return;
      }
      case 'confirm-focus': actions.confirmFocus(action.minutes); return;
      case 'switch-focus': {
        // Log the running session first; only a clean log releases the switch.
        // A stale one parks in `confirming` and the surface asks about it.
        const result = actions.completeFocus();
        if (result === 'refused') {
          setNotice({ tone: 'warning', text: "Couldn't log the current session." });
          return;
        }
        if (result === 'needs-confirmation') return;
        actions.startFocus(action.ref, expectedTimeFor(action.ref, { goals, tasks, sessions }));
        return;
      }
      case 'close':
        onClose();
    }
  }

  // ── Desktop relay ──
  // The host stays the ONLY action executor: the overlay's clicks arrive here
  // as validated actions and run through the same `onAction` the in-app panel
  // uses. Snapshots go out only after hydration is ready (a `ready` snapshot
  // is by construction post-hydration), and again whenever the overlay asks.
  const bridge = useMemo(() => assistantMainBridge(), []);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  useEffect(() => {
    if (snapshot.status !== 'ready') return;
    bridge.publish(snapshot);
  }, [bridge, snapshot]);

  useEffect(() => {
    const offRequest = bridge.onRequestSnapshot(() => bridge.publish(snapshotRef.current));
    const offAction = bridge.onAction((action) => onActionRef.current(action));
    return () => {
      offRequest();
      offAction();
    };
  }, [bridge]);

  // Electron cannot read Dexie, so the hydrated shortcut preference is pushed
  // from here — once at hydration and again whenever Settings changes it. The
  // status that comes back (registered, or a conflict) is what the Settings
  // section shows; a conflict is a state to display, never an exception.
  useEffect(() => {
    if (!bridge.available || hydration !== 'ready') return;
    let cancelled = false;
    void bridge.configureShortcut(assistantAccelerator).then((status) => {
      if (!cancelled && status) actions.setAssistantShortcutStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, hydration, assistantAccelerator, actions]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Assistant"
      className="fixed right-[16px] top-[64px] z-40 max-h-[70vh] w-[380px] overflow-y-auto rounded-card border border-line bg-panel"
    >
      <AssistantSurface snapshot={snapshot} onAction={onAction} />
    </div>
  );
}
