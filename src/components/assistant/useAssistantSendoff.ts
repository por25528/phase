import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantSnapshot } from '../../lib/assistantProtocol';
import type { WorkRef } from '../../lib/expectedTime';

export type AssistantSendoffStage = 'idle' | 'pending' | 'message' | 'leaving' | 'hidden';

interface Options {
  snapshot: AssistantSnapshot;
  reducedMotion: boolean;
  resetKey: number;
  onStart(ref: WorkRef): void;
  onClose(): void;
}

const MESSAGE_AND_HOLD_MS = 660;
const FALLBACK_CLOSE_MS = 1000;
const REDUCED_CLOSE_MS = 350;

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
}: Options) {
  const [stage, setStageState] = useState<AssistantSendoffStage>('idle');
  const stageRef = useRef<AssistantSendoffStage>('idle');
  const requestedRef = useRef<WorkRef | null>(null);
  const startSnapshot = useRef<AssistantSnapshot | null>(null);
  const previousResetKey = useRef(resetKey);
  const onStartRef = useRef(onStart);
  const onCloseRef = useRef(onClose);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const closed = useRef(false);
  onStartRef.current = onStart;
  onCloseRef.current = onClose;

  const setStage = useCallback((next: AssistantSendoffStage) => {
    stageRef.current = next;
    setStageState(next);
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
