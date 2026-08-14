import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantSnapshot } from '../../lib/assistantProtocol';
import type { WorkRef } from '../../lib/expectedTime';

export type AssistantSendoffStage = 'idle' | 'pending' | 'message' | 'leaving' | 'hidden';

/**
 * The stages that show the farewell instead of the shelf. The surface branches
 * on this and the notification below fires on it, so the two cannot drift into
 * disagreeing about when the shelf's content is gone.
 */
export function isLeavingStage(stage: AssistantSendoffStage): boolean {
  return stage === 'message' || stage === 'leaving' || stage === 'hidden';
}

interface Options {
  snapshot: AssistantSnapshot;
  reducedMotion: boolean;
  resetKey: number;
  onStart(ref: WorkRef): void;
  onClose(): void;
  /**
   * The send-off began, or was abandoned — fired SYNCHRONOUSLY at the
   * transition rather than from an effect after it, which is the whole point.
   * The overlay measures its card in here, and a measurement is only worth
   * anything while the DOM still holds the body the farewell is about to
   * replace. An effect would run after that body is gone.
   *
   * Optional, and only the floating window passes it: the embedded surface
   * sits in a panel that was never sized to its content.
   */
  onSendoffChange?(leaving: boolean): void;
}

const MESSAGE_AND_HOLD_MS = 660;
const FALLBACK_CLOSE_MS = 1000;
const REDUCED_CLOSE_MS = 350;
const PENDING_TIMEOUT_MS = 5000;

function sameRef(left: WorkRef, right: WorkRef): boolean {
  return left.kind === right.kind
    && left.id === right.id
    && left.goalId === right.goalId;
}

export function useAssistantSendoff({
  snapshot,
  reducedMotion,
  resetKey,
  onStart,
  onClose,
  onSendoffChange,
}: Options) {
  const [stage, setStageState] = useState<AssistantSendoffStage>('idle');
  const stageRef = useRef<AssistantSendoffStage>('idle');
  const requestedRef = useRef<WorkRef | null>(null);
  const startSnapshot = useRef<AssistantSnapshot | null>(null);
  const previousResetKey = useRef(resetKey);
  const onStartRef = useRef(onStart);
  const onCloseRef = useRef(onClose);
  const onSendoffChangeRef = useRef(onSendoffChange);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const closed = useRef(false);
  onStartRef.current = onStart;
  onCloseRef.current = onClose;
  onSendoffChangeRef.current = onSendoffChange;

  const setStage = useCallback((next: AssistantSendoffStage) => {
    const was = isLeavingStage(stageRef.current);
    stageRef.current = next;
    setStageState(next);
    // Before the re-render, not after it: the caller is here to look at a DOM
    // that still holds the shelf. Only the crossing is reported — `message` to
    // `leaving` to `hidden` is one farewell, not three.
    const now = isLeavingStage(next);
    if (now !== was) onSendoffChangeRef.current?.(now);
  }, []);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  const closeOnce = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    clearTimers();
    setStage('hidden');
    onCloseRef.current();
  }, [clearTimers, setStage]);

  const start = useCallback((ref: WorkRef) => {
    if (stageRef.current !== 'idle') return;
    closed.current = false;
    requestedRef.current = ref;
    startSnapshot.current = snapshot;
    setStage('pending');
    onStartRef.current(ref);
    timers.current.push(
      setTimeout(() => {
        if (stageRef.current === 'pending' && requestedRef.current === ref) {
          requestedRef.current = null;
          startSnapshot.current = null;
          setStage('idle');
        }
      }, PENDING_TIMEOUT_MS),
    );
  }, [setStage, snapshot]);

  const finishExit = useCallback(() => {
    if (stageRef.current === 'leaving') closeOnce();
  }, [closeOnce]);

  useEffect(() => {
    if (previousResetKey.current === resetKey) return;
    previousResetKey.current = resetKey;
    clearTimers();
    requestedRef.current = null;
    startSnapshot.current = null;
    closed.current = false;
    setStage('idle');
  }, [clearTimers, resetKey, setStage]);

  useEffect(() => {
    if (stageRef.current !== 'pending') return;
    if (snapshot === startSnapshot.current) return;
    const requested = requestedRef.current;
    if (
      snapshot.status === 'ready'
      && requested
      && snapshot.activeFocus
      && sameRef(snapshot.activeFocus.ref, requested)
    ) {
      clearTimers();
      setStage('message');
      if (reducedMotion) {
        timers.current.push(setTimeout(closeOnce, REDUCED_CLOSE_MS));
      } else {
        timers.current.push(setTimeout(() => setStage('leaving'), MESSAGE_AND_HOLD_MS));
        timers.current.push(setTimeout(closeOnce, FALLBACK_CLOSE_MS));
      }
      return;
    }
    if (snapshot.status === 'ready' && snapshot.notice?.tone === 'warning') {
      clearTimers();
      requestedRef.current = null;
      startSnapshot.current = null;
      setStage('idle');
    }
  }, [clearTimers, closeOnce, reducedMotion, setStage, snapshot]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return {
    stage,
    pending: stage === 'pending',
    start,
    finishExit,
  };
}
