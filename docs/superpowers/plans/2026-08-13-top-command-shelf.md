# Phase Top Command Shelf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Command–Space into a pre-warmed, top-center Phase shelf that starts the student's next session, confirms the write, says “Good luck!”, and disappears without raising the Phase Hub.

**Architecture:** Keep the Hub renderer alive as Phase's sole store owner and keep the shelf renderer read-only. Put macOS panel behavior, placement, readiness, and renderer recovery behind one Electron shelf-window module; put menu-bar and login-item access behind a separate validated shell bridge. The shared React assistant surface gains a small start-confirmation state machine, while an active-focus WorkRef remains the only acknowledgment that a requested session really started.

**Tech Stack:** Electron 43 BrowserWindow panel, React 19, TypeScript 6, Vite 8 multi-page build, Vitest 3, Testing Library, Tailwind CSS 3, existing Phase assistant protocol and Dexie-backed store.

---

## Product contract

This plan implements the approved design in docs/superpowers/specs/2026-08-13-top-command-shelf-design.md.

- Command–Space toggles a 620 × 200 DIP shelf at the top center of the display nearest the pointer.
- Summoning the shelf neither opens nor raises the Phase Hub.
- The command field is focused first and says “Ask Phase or add something…”.
- One recommendation is visually primary. At most two alternatives stay behind “Other options”.
- Start session disables immediately and cannot dispatch twice.
- Only a new snapshot whose activeFocus.ref equals the requested WorkRef can trigger “Good luck!”.
- A warning snapshot restores the normal shelf and leaves it open.
- Normal motion is 160 ms in, 500 ms hold, and 180 ms out. Reduced motion shows the message for 350 ms with no translation.
- Escape, blur, and the second shortcut hide without a send-off.
- Closing the Hub hides it; Command–Q or Quit Phase exits it.
- A menu-bar item exposes Open Phase, Open assistant, Settings, and Quit Phase.
- Launch Phase at login is off by default and launches both renderers hidden when enabled.
- The browser build retains the in-app AssistantHost fallback.
- No store, database, note, asset, URL, calendar title, or generic IPC access is added to the shelf renderer.

## Scope boundary

Ship in this plan:

1. Focus-reference acknowledgment and send-off behavior.
2. The fixed top-shelf visual treatment.
3. Pointer-display placement and macOS panel behavior.
4. Background Hub lifecycle and renderer recovery.
5. Desktop routing, menu-bar controls, and launch-at-login settings.
6. Automated gates and the macOS acceptance pass.

Defer:

- Swift or AppKit until the Electron acceptance gate demonstrates a concrete limitation.
- A headless database owner.
- Voice, transcription, arbitrary automation, or chat history.
- A new todo or homework model.
- A persistent timer, floating bubble, or Dock-visibility preference.

## Final file map

Create:

- electron/assistantWindowController.cjs — owns the shelf BrowserWindow, readiness, placement, show/hide, and crash recreation.
- electron/assistantWindowController.d.cts — declares the controller's narrow interface for TypeScript tests.
- electron/assistantWindowController.test.ts — tests geometry ordering, visibility, focus, and recovery through the public interface.
- electron/shellIpc.cjs — validates main-renderer access to desktop shell actions and login settings.
- electron/shellIpc.d.cts — declares the shell IPC module.
- electron/shellIpc.test.ts — pins sender validation and channel disposal.
- electron/menuBar.cjs — owns the Tray and its four user actions.
- electron/menuBar.d.cts — declares the menu-bar module.
- electron/menuBar.test.ts — tests menu construction, action routing, failure isolation, and disposal.
- electron/appLifecycle.cjs — owns quitting state, close-to-hide behavior, activation, and hidden login launch policy.
- electron/appLifecycle.d.cts — declares the lifecycle module.
- electron/appLifecycle.test.ts — tests hide, reopen, hidden login launch, and explicit quit.
- electron/assets/phaseTemplate.png — 18 px monochrome menu-bar template image.
- electron/assets/phaseTemplate@2x.png — 36 px retina template image.
- build/phase-tray.svg — vector source for the two menu-bar assets.
- scripts/make-tray-icon.sh — reproducibly rasterizes the vector source with macOS-native tools.
- src/components/assistant/useAssistantSendoff.ts — contains the pending, acknowledged, leaving, and hidden start-session states.
- src/components/assistant/useAssistantSendoff.test.tsx — pins acknowledgment and both timing paths.
- src/lib/shellBridge.ts — gives React a typed browser-safe wrapper around phaseShell.
- src/lib/shellBridge.test.ts — tests the real preload wrapper and inert browser adapter.
- src/components/assistant/LaunchAtLoginSettings.tsx — owns the one desktop-only settings row.
- src/components/assistant/LaunchAtLoginSettings.test.tsx — tests load, toggle, and refusal behavior.

Modify:

- src/lib/assistantProtocol.ts — add WorkRef to AssistantFocusView.
- src/components/assistant/AssistantHost.tsx — publish the active focus reference and clear stale notices before start.
- src/components/assistant/AssistantHost.test.tsx — prove the published active focus identifies the started work.
- electron/assistantIpc.cjs — validate activeFocus.ref.
- electron/assistantIpc.test.ts — accept valid refs and reject missing or malformed refs.
- electron/assistantWindow.cjs — replace the tall overlay options with fixed shelf options and pure placement.
- electron/assistantWindow.d.cts — declare the new option and bounds shapes.
- src/components/assistant/AssistantSurface.tsx — render the shelf layout, disclosure, pending state, and send-off.
- src/components/assistant/AssistantSurface.test.tsx — pin the approved visual hierarchy and interaction states.
- src/assistant/AssistantOverlay.tsx — replay the opening animation on every focus and reset hidden send-off state.
- src/index.css — add restrained shelf entry/exit keyframes and disable them under Reduce Motion.
- src/lib/designScale.test.ts — keep the new animation durations in the approved 100–200 ms band.
- electron/preload.cjs — expose only the four phaseShell verbs to the main renderer.
- src/App.tsx — route Open assistant through the desktop shell when available and subscribe to Open Settings.
- src/App.test.ts — prove browser fallback behavior.
- src/components/SettingsModal.tsx — add the launch-at-login row without adding a new settings card.
- electron/main.cjs — compose the shelf, shell, menu-bar, and lifecycle modules.
- package.json — add the tray asset generation script.
- docs/assistant-verification.md — record the new automated and manual evidence.
- docs/superpowers/specs/2026-08-13-top-command-shelf-design.md — mark the written specification approved.

Do not modify:

- src/state/store.ts or the Dexie schema.
- src/assistant/entryBoundary.test.ts except to strengthen an existing import-boundary assertion if a new runtime edge requires it.
- The assistant command vocabulary or recommendation ranking.

## Deep-module seams

The Electron composition root may know about BrowserWindow, screen, Tray, Menu, nativeImage, app, and ipcMain. No React or domain module may know about those objects.

The shelf window module presents this interface:

~~~ts
interface AssistantWindowController {
  create(): void;
  position(): void;
  showAndFocus(): void;
  hide(): void;
  isShowing(): boolean;
  current(): RelayWindow | null;
  dispose(): void;
}
~~~

Here AssistantWindowController is the public TypeScript face of the CommonJS module; RelayWindow is the existing minimal main-process window shape and gains only the methods the controller needs.

The shell bridge presents this renderer interface:

~~~ts
interface PhaseShellBridge {
  available: boolean;
  openAssistant(): Promise<boolean>;
  onOpenSettings(fn: () => void): () => void;
  getLaunchAtLogin(): Promise<boolean | null>;
  setLaunchAtLogin(enabled: boolean): Promise<boolean | null>;
}
~~~

These are real seams: the shelf has a production Electron adapter and injected fakes in tests; the shell bridge has a preload adapter and an inert browser adapter. Do not add pass-through modules around either interface.

### Task 1: Carry the active work reference through the acknowledgment snapshot

**Files:**

- Modify: src/lib/assistantProtocol.ts:18-28
- Modify: src/components/assistant/AssistantHost.tsx:71-95,127-136
- Modify: src/components/assistant/AssistantHost.test.tsx
- Modify: electron/assistantIpc.cjs:82-92
- Modify: electron/assistantIpc.test.ts

- [ ] **Step 1: Write the failing host and relay tests**

Add a Host test that reads the exact published projection, not only the store:

~~~ts
it('publishes the reference of the work that actually started', async () => {
  const publish = vi.fn();
  (window as unknown as Record<string, unknown>).phaseAssistant = {
    publish,
    onRequestSnapshot: vi.fn(() => () => {}),
    onAction: vi.fn(() => () => {}),
    configureShortcut: vi.fn(async () => ({
      requested: 'Command+Space',
      active: 'Command+Space',
      registered: true,
      conflict: false,
    })),
  };

  try {
    const store = await mountHost({
      tasks: [{
        id: 't1',
        title: 'Draft essay',
        done: false,
        goalId: null,
        date: TODAY,
      }],
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    });

    expect(store.getState().activeFocusSession?.ref).toEqual({
      kind: 'task',
      id: 't1',
      goalId: null,
    });
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      activeFocus: expect.objectContaining({
        ref: { kind: 'task', id: 't1', goalId: null },
      }),
    }));
  } finally {
    delete (window as unknown as Record<string, unknown>).phaseAssistant;
  }
});
~~~

Extend the relay snapshot fixture with a valid focus:

~~~ts
const FOCUSED_SNAPSHOT = {
  ...SNAPSHOT,
  activeFocus: {
    ref: { kind: 'step', id: 'n1', goalId: 'g1' },
    title: 'Problem set 4',
    goalTitle: 'Algorithms',
    phase: 'active',
    elapsedMin: 0,
    expected: { kind: 'estimate', minutes: 45 },
  },
};
~~~

Add this relay test:

~~~ts
it('requires a valid work reference on an active focus projection', () => {
  const { ipcMain, ipc } = relay();

  ipcMain.emit('phase-assistant:publish', MAIN_ID, FOCUSED_SNAPSHOT);
  expect(ipc.latest()).toEqual(FOCUSED_SNAPSHOT);

  const missing = {
    ...FOCUSED_SNAPSHOT,
    activeFocus: { ...FOCUSED_SNAPSHOT.activeFocus, ref: undefined },
  };
  ipcMain.emit('phase-assistant:publish', MAIN_ID, missing);
  expect(ipc.latest()).toEqual(FOCUSED_SNAPSHOT);

  const malformed = {
    ...FOCUSED_SNAPSHOT,
    activeFocus: {
      ...FOCUSED_SNAPSHOT.activeFocus,
      ref: { kind: 'step', id: 'n1' },
    },
  };
  ipcMain.emit('phase-assistant:publish', MAIN_ID, malformed);
  expect(ipc.latest()).toEqual(FOCUSED_SNAPSHOT);
});
~~~

Add the same fixture ref to every activeFocus object in AssistantSurface.test.tsx:

~~~ts
ref: { kind: 'step', id: 'n1', goalId: 'g1' },
~~~

This makes TypeScript describe the new contract honestly in the active, break, confirming, and accessibility cases.

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run:

~~~bash
npx vitest run --config vitest.config.ts electron/assistantIpc.test.ts src/components/assistant/AssistantHost.test.tsx src/components/assistant/AssistantSurface.test.tsx
~~~

Expected: FAIL because AssistantFocusView has no ref and validFocus does not require one.

- [ ] **Step 3: Add the minimum projection and validator change**

Change AssistantFocusView to:

~~~ts
export interface AssistantFocusView {
  ref: WorkRef;
  title: string;
  goalTitle?: string;
  phase: 'active' | 'break' | 'confirming';
  elapsedMin: number;
  expected: ExpectedTime;
  proposedMinutes?: number;
}
~~~

Add the ref when AssistantHost builds the projection:

~~~ts
const activeFocus: AssistantFocusView | null = activeFocusSession
  ? {
      ref: activeFocusSession.ref,
      title: activeFocusSession.title,
      ...(activeFocusSession.goalTitle === undefined
        ? {}
        : { goalTitle: activeFocusSession.goalTitle }),
      phase: activeFocusSession.phase,
      elapsedMin: elapsedFocusMinutes(activeFocusSession, Date.now()),
      expected: activeFocusSession.expected,
      ...(activeFocusSession.proposedMinutes === undefined
        ? {}
        : { proposedMinutes: activeFocusSession.proposedMinutes }),
    }
  : null;
~~~

Require that field at the relay:

~~~js
function validFocus(focus) {
  if (focus === null) return true;
  return !!focus
    && typeof focus === 'object'
    && validRef(focus.ref)
    && shortString(focus.title)
    && optionalShortString(focus.goalTitle)
    && (focus.phase === 'active' || focus.phase === 'break' || focus.phase === 'confirming')
    && boundedMinutes(focus.elapsedMin)
    && validExpected(focus.expected)
    && (focus.proposedMinutes === undefined || boundedMinutes(focus.proposedMinutes));
}
~~~

Clear an old neutral or warning message before attempting a start so a new refusal is distinguishable:

~~~ts
case 'start-focus': {
  setNotice(null);
  const started = actions.startFocus(
    action.ref,
    expectedTimeFor(action.ref, { goals, tasks, sessions }),
  );
  if (!started) setNotice({ tone: 'warning', text: 'A session is already running.' });
  return;
}
~~~

- [ ] **Step 4: Re-run the focused tests**

Run:

~~~bash
npx vitest run --config vitest.config.ts electron/assistantIpc.test.ts src/components/assistant/AssistantHost.test.tsx src/components/assistant/AssistantSurface.test.tsx
~~~

Expected: PASS.

- [ ] **Step 5: Commit the protocol acknowledgment**

~~~bash
git add src/lib/assistantProtocol.ts src/components/assistant/AssistantHost.tsx src/components/assistant/AssistantHost.test.tsx src/components/assistant/AssistantSurface.test.tsx electron/assistantIpc.cjs electron/assistantIpc.test.ts
git commit -m "feat(assistant): acknowledge the started work"
~~~

### Task 2: Add the deterministic send-off state machine

**Files:**

- Create: src/components/assistant/useAssistantSendoff.ts
- Create: src/components/assistant/useAssistantSendoff.test.tsx
- Read/reuse: src/components/useReducedMotion.ts

- [ ] **Step 1: Write failing hook tests for confirmation, refusal, and timing**

Use renderHook with fake timers:

~~~ts
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantSnapshot } from '../../lib/assistantProtocol';
import { useAssistantSendoff } from './useAssistantSendoff';

const REF = { kind: 'step', id: 'n1', goalId: 'g1' } as const;

function ready(over: Partial<Extract<AssistantSnapshot, { status: 'ready' }>> = {}): AssistantSnapshot {
  return {
    status: 'ready',
    advice: { kind: 'clear' },
    activeFocus: null,
    proposal: null,
    ...over,
  };
}

describe('useAssistantSendoff', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits for the matching focus reference and ignores duplicate starts', () => {
    const onStart = vi.fn();
    const onClose = vi.fn();
    const initial = ready();
    const { result, rerender } = renderHook(
      ({ snapshot }) => useAssistantSendoff({
        snapshot,
        reducedMotion: false,
        resetKey: 0,
        onStart,
        onClose,
      }),
      { initialProps: { snapshot: initial } },
    );

    act(() => {
      result.current.start(REF);
      result.current.start(REF);
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(result.current.stage).toBe('pending');

    rerender({
      snapshot: ready({
        activeFocus: {
          ref: { kind: 'task', id: 't1', goalId: null },
          title: 'Other work',
          phase: 'active',
          elapsedMin: 0,
          expected: { kind: 'starter', minutes: 30 },
        },
      }),
    });
    expect(result.current.stage).toBe('pending');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('holds the message, leaves, then closes on the transition end', () => {
    const onClose = vi.fn();
    const initial = ready();
    const { result, rerender } = renderHook(
      ({ snapshot }) => useAssistantSendoff({
        snapshot,
        reducedMotion: false,
        resetKey: 0,
        onStart: vi.fn(),
        onClose,
      }),
      { initialProps: { snapshot: initial } },
    );

    act(() => result.current.start(REF));
    rerender({
      snapshot: ready({
        activeFocus: {
          ref: REF,
          title: 'Problem set 4',
          phase: 'active',
          elapsedMin: 0,
          expected: { kind: 'estimate', minutes: 45 },
        },
      }),
    });

    expect(result.current.stage).toBe('message');
    act(() => vi.advanceTimersByTime(659));
    expect(result.current.stage).toBe('message');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.stage).toBe('leaving');
    act(() => result.current.finishExit());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.stage).toBe('hidden');
  });

  it('uses a one-second fallback and a 350ms reduced-motion path', () => {
    const normalClose = vi.fn();
    const initial = ready();
    const normal = renderHook(
      ({ snapshot }) => useAssistantSendoff({
        snapshot,
        reducedMotion: false,
        resetKey: 0,
        onStart: vi.fn(),
        onClose: normalClose,
      }),
      { initialProps: { snapshot: initial } },
    );
    act(() => normal.result.current.start(REF));
    normal.rerender({
      snapshot: ready({
        activeFocus: {
          ref: REF,
          title: 'Problem set 4',
          phase: 'active',
          elapsedMin: 0,
          expected: { kind: 'starter', minutes: 30 },
        },
      }),
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(normalClose).toHaveBeenCalledTimes(1);

    const reducedClose = vi.fn();
    const reduced = renderHook(
      ({ snapshot }) => useAssistantSendoff({
        snapshot,
        reducedMotion: true,
        resetKey: 0,
        onStart: vi.fn(),
        onClose: reducedClose,
      }),
      { initialProps: { snapshot: initial } },
    );
    act(() => reduced.result.current.start(REF));
    reduced.rerender({
      snapshot: ready({
        activeFocus: {
          ref: REF,
          title: 'Problem set 4',
          phase: 'active',
          elapsedMin: 0,
          expected: { kind: 'starter', minutes: 30 },
        },
      }),
    });
    act(() => vi.advanceTimersByTime(349));
    expect(reducedClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(reducedClose).toHaveBeenCalledTimes(1);
    normal.unmount();
    reduced.unmount();
  });

  it('restores idle on a new warning snapshot', () => {
    const initial = ready();
    const { result, rerender } = renderHook(
      ({ snapshot }) => useAssistantSendoff({
        snapshot,
        reducedMotion: false,
        resetKey: 0,
        onStart: vi.fn(),
        onClose: vi.fn(),
      }),
      { initialProps: { snapshot: initial } },
    );
    act(() => result.current.start(REF));
    rerender({
      snapshot: ready({
        notice: { tone: 'warning', text: 'A session is already running.' },
      }),
    });
    expect(result.current.stage).toBe('idle');
  });
});
~~~

- [ ] **Step 2: Run the new test and confirm it cannot import the hook**

Run:

~~~bash
npx vitest run --config vitest.config.ts src/components/assistant/useAssistantSendoff.test.tsx
~~~

Expected: FAIL because useAssistantSendoff.ts does not exist.

- [ ] **Step 3: Implement the hook with one close path**

Use these public types and constants:

~~~ts
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

const MESSAGE_AND_HOLD_MS = 160 + 500;
const FALLBACK_CLOSE_MS = 1000;
const REDUCED_CLOSE_MS = 350;

function sameRef(left: WorkRef, right: WorkRef): boolean {
  return left.kind === right.kind
    && left.id === right.id
    && left.goalId === right.goalId;
}
~~~

Implement the hook with refs for immediate duplicate protection and current callbacks:

~~~ts
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
~~~

The implementation above must preserve these invariants:

- keep stage and requested ref in refs as well as React state so two clicks in one tick cannot dispatch twice;
- remember the exact snapshot object present at start time and ignore that object;
- treat only a matching activeFocus.ref as success;
- treat a new warning snapshot as refusal;
- schedule leaving at 660 ms and fallback close at 1000 ms for normal motion;
- close at 350 ms for reduced motion;
- make finishExit idempotent;
- clear every timer on refusal, resetKey change, and unmount;
- reset to idle when resetKey changes so a hidden pre-warmed renderer is ready for the next summon.

Use this return shape:

~~~ts
return {
  stage,
  pending: stage === 'pending',
  start,
  finishExit,
};
~~~

- [ ] **Step 4: Run the hook tests**

Run:

~~~bash
npx vitest run --config vitest.config.ts src/components/assistant/useAssistantSendoff.test.tsx
~~~

Expected: PASS with no pending fake timers after cleanup.

- [ ] **Step 5: Commit the state machine**

~~~bash
git add src/components/assistant/useAssistantSendoff.ts src/components/assistant/useAssistantSendoff.test.tsx
git commit -m "feat(assistant): confirm focus before the send-off"
~~~

### Task 3: Reshape the shared assistant into the minimal shelf

**Files:**

- Modify: src/components/assistant/AssistantSurface.tsx
- Modify: src/components/assistant/AssistantSurface.test.tsx
- Modify: src/assistant/AssistantOverlay.tsx
- Modify: src/index.css
- Modify: src/lib/designScale.test.ts

- [ ] **Step 1: Write failing surface tests for the approved hierarchy**

Add these cases:

~~~ts
it('focuses the Phase command field with the approved prompt', () => {
  render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
  const input = screen.getByRole('textbox', { name: 'Ask Phase' });
  expect(input.getAttribute('placeholder')).toBe('Ask Phase or add something…');
  expect(input.hasAttribute('autofocus')).toBe(true);
});

it('keeps alternatives behind Other options and reveals at most two', () => {
  const alternatives = [
    work({ key: 'step:n2', title: 'Read chapter 5' }),
    work({ key: 'step:n3', title: 'Pitch deck' }),
    work({ key: 'step:n4', title: 'Email advisor' }),
  ];
  render(
    <AssistantSurface
      snapshot={ready({ advice: { kind: 'work', primary: work(), alternatives } })}
      onAction={() => {}}
    />,
  );

  expect(screen.queryByText('Read chapter 5')).toBeNull();
  const disclosure = screen.getByRole('button', { name: 'Other options' });
  expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(disclosure);
  expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Read chapter 5')).toBeTruthy();
  expect(screen.getByText('Pitch deck')).toBeTruthy();
  expect(screen.queryByText('Email advisor')).toBeNull();
});

it('disables Start session while the owner has not acknowledged it', () => {
  const onAction = vi.fn();
  render(<AssistantSurface snapshot={ready()} onAction={onAction} />);
  const start = screen.getByRole('button', { name: 'Start session' });
  fireEvent.click(start);
  fireEvent.click(start);
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(start.hasAttribute('disabled')).toBe(true);
});

it('shows only Good luck during the confirmed send-off', () => {
  vi.useFakeTimers();
  const onAction = vi.fn();
  const { rerender } = render(<AssistantSurface snapshot={ready()} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  rerender(
    <AssistantSurface
      snapshot={ready({
        activeFocus: {
          ref: work().ref,
          title: work().title,
          goalTitle: work().goalTitle,
          phase: 'active',
          elapsedMin: 0,
          expected: work().expected,
        },
      })}
      onAction={onAction}
    />,
  );
  expect(screen.getByRole('status').textContent).toBe('Good luck!');
  expect(screen.queryByRole('textbox')).toBeNull();
  vi.useRealTimers();
});
~~~

Update the old alternative test to assert disclosure behavior rather than immediate visibility. Keep the existing verb, truncation, loading, proposal, and active-session tests.

Because AssistantSurface now reads Reduce Motion, install a stable matchMedia fake in this test file:

~~~ts
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
~~~

Update the existing AssistantHost switch test to click Other options before it clicks Revise notes. This preserves task switching without making it compete with the running session.

- [ ] **Step 2: Run the surface tests and confirm the red state**

Run:

~~~bash
npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx
~~~

Expected: FAIL on the prompt, disclosure, disabled state, and send-off.

- [ ] **Step 3: Wire the state machine into AssistantSurface**

Extend the props without exposing Electron:

~~~ts
interface Props {
  snapshot: AssistantSnapshot;
  onAction: (action: AssistantAction) => void;
  presentation?: 'embedded' | 'shelf';
  resetKey?: number;
}
~~~

Inside AssistantSurface:

~~~ts
export function AssistantSurface({
  snapshot,
  onAction,
  presentation = 'embedded',
  resetKey = 0,
}: Props) {
const reducedMotion = useReducedMotion();
const sendoff = useAssistantSendoff({
  snapshot,
  reducedMotion,
  resetKey,
  onStart: (ref) => onAction({ type: 'start-focus', ref }),
  onClose: () => onAction({ type: 'close' }),
});
// Continue with the render branches below.
}
~~~

When stage is message, leaving, or hidden, render only:

~~~tsx
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
~~~

Route every Start session button through sendoff.start and disable it while pending. Do not route Switch task through the send-off; it preserves the running-session surface.

- [ ] **Step 4: Implement the restrained shelf layout**

Use presentation to choose layout density:

~~~ts
const shelf = presentation === 'shelf';
const bodyClass = shelf
  ? 'grid min-h-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1'
  : 'flex min-h-0 flex-col gap-2';
~~~

Apply these structural rules:

~~~tsx
<div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4">
  <input
    autoFocus
    aria-label="Ask Phase"
    placeholder="Ask Phase or add something…"
    className="w-full rounded-field border border-line bg-field px-3 py-2 text-ui text-ink placeholder:text-faint focus:border-line-2 focus:outline-none"
  />
  <div className="min-h-0 flex-1 overflow-y-auto">
    {/* Exactly one of notice/proposal, active focus, or advice occupies this region. */}
  </div>
</div>
~~~

In AdvicePanel:

- put reason, title, and metadata in the first column;
- put one Start session button in the action column;
- add a text button named Other options with aria-expanded;
- reveal alternatives.slice(0, 2) below the primary without making them headings;
- preserve line-clamp-2 on the title and truncate on goal metadata.

In FocusPanel:

- keep Focus session as the quiet label;
- keep Complete session primary;
- keep Take break or Continue secondary;
- place elapsed and expected-time copy below the title;
- put switch candidates behind the same Other options disclosure and keep the revealed rows internally scrollable.

Render one mutually exclusive content branch:

~~~tsx
{snapshot.proposal ? (
  <ProposalPanel proposal={snapshot.proposal} onAction={onAction} />
) : snapshot.notice?.tone === 'neutral' ? (
  <p className="text-body text-ink">{snapshot.notice.text}</p>
) : snapshot.activeFocus ? (
  <FocusPanel
    focus={snapshot.activeFocus}
    alternatives={snapshot.advice.kind === 'work' ? snapshot.advice.alternatives : []}
    onAction={onAction}
  />
) : (
  <AdvicePanel snapshot={snapshot} onAction={onAction} />
)}
~~~

A warning stays as one quiet line above this mutually exclusive region because it explains why an attempted action was refused. A proposal or neutral answer replaces the recommendation instead of stacking a second card over it.

The loading state must retain three horizontal skeleton rows and the fixed window must never grow with proposal choices.

- [ ] **Step 5: Replay the opening animation on every shelf focus**

In AssistantOverlay, use useReducedMotion and track an open cycle plus a brief opening flag:

~~~ts
const [openCycle, setOpenCycle] = useState(0);
const [opening, setOpening] = useState(false);
const reducedMotion = useReducedMotion();

useEffect(() => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onFocus = () => {
    setOpenCycle((cycle) => cycle + 1);
    setOpening(!reducedMotion);
    if (!reducedMotion) timer = setTimeout(() => setOpening(false), 160);
  };
  window.addEventListener('focus', onFocus);
  return () => {
    window.removeEventListener('focus', onFocus);
    if (timer) clearTimeout(timer);
  };
}, [reducedMotion]);
~~~

Render:

~~~tsx
<div
  key={openCycle}
  className={[
    'h-screen overflow-hidden rounded-card border border-line bg-panel text-ink shadow-card',
    opening ? 'assistant-shelf-enter' : '',
  ].join(' ')}
>
  <AssistantSurface
    snapshot={snapshot}
    onAction={onAction}
    presentation="shelf"
    resetKey={openCycle}
  />
</div>
~~~

Add these styles:

~~~css
@keyframes assistant-shelf-enter {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.assistant-shelf-enter {
  animation: assistant-shelf-enter 160ms ease-out both;
}

@keyframes assistant-sendoff-enter {
  from { opacity: 0; }
  to { opacity: 1; }
}

.assistant-sendoff-enter {
  animation: assistant-sendoff-enter 160ms ease-out both;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
  }
}
~~~

Keep the duration guard at 100–200 ms. Its existing animation-declaration scan must see and accept 160 ms.

- [ ] **Step 6: Run the UI and design gates**

Run:

~~~bash
npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx src/components/assistant/useAssistantSendoff.test.tsx src/assistant/entryBoundary.test.ts src/lib/designScale.test.ts
~~~

Expected: PASS. The boundary test still proves the shelf graph cannot reach src/state or src/db.

- [ ] **Step 7: Commit the shelf interaction**

~~~bash
git add src/components/assistant/AssistantSurface.tsx src/components/assistant/AssistantSurface.test.tsx src/components/assistant/useAssistantSendoff.ts src/components/assistant/useAssistantSendoff.test.tsx src/assistant/AssistantOverlay.tsx src/index.css src/lib/designScale.test.ts
git commit -m "feat(assistant): shape the calm top shelf"
~~~

### Task 4: Build the shelf-window deep module

**Files:**

- Modify: electron/assistantWindow.cjs
- Modify: electron/assistantWindow.d.cts
- Create: electron/assistantWindowController.cjs
- Create: electron/assistantWindowController.d.cts
- Create: electron/assistantWindowController.test.ts
- Modify: electron/assistantIpc.test.ts

- [ ] **Step 1: Write failing pure option and geometry tests**

Move window lifecycle expectations out of source-regex tests and into the new interface. Add:

~~~ts
it('uses a fixed macOS panel with the dedicated preload', () => {
  const options = assistantWindowOptions('/x/assistantPreload.cjs', 'darwin', false);
  expect(options).toMatchObject({
    type: 'panel',
    width: 620,
    height: 200,
    minWidth: 620,
    maxWidth: 620,
    minHeight: 200,
    maxHeight: 200,
    useContentSize: true,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
  });
  expect(options.webPreferences).toEqual({
    contextIsolation: true,
    nodeIntegration: false,
    preload: '/x/assistantPreload.cjs',
  });
});

it('omits the macOS-only type on fallback platforms', () => {
  expect(assistantWindowOptions('/x/preload.cjs', 'linux').type).toBeUndefined();
});

it('uses transparent macOS corners and a theme-matched fallback first frame', () => {
  expect(assistantWindowOptions('/x/preload.cjs', 'darwin', false)).toMatchObject({
    transparent: true,
    backgroundColor: '#00000000',
  });
  expect(assistantWindowOptions('/x/preload.cjs', 'linux', true)).toMatchObject({
    transparent: false,
    backgroundColor: '#000000',
  });
});

it('centres inside a positive-origin work area', () => {
  expect(assistantShelfBounds({
    x: 0,
    y: 25,
    width: 1512,
    height: 957,
  })).toEqual({ x: 446, y: 43, width: 620, height: 200 });
});

it('centres inside a negative-origin secondary display', () => {
  expect(assistantShelfBounds({
    x: -1440,
    y: 0,
    width: 1440,
    height: 900,
  })).toEqual({ x: -1030, y: 18, width: 620, height: 200 });
});
~~~

- [ ] **Step 2: Run the tests and confirm the old 400 × 480 window fails**

Run:

~~~bash
npx vitest run --config vitest.config.ts electron/assistantIpc.test.ts electron/assistantWindowController.test.ts
~~~

Expected: FAIL because the new controller test file and assistantShelfBounds do not exist.

- [ ] **Step 3: Implement fixed options and pure bounds**

Use these constants and functions in assistantWindow.cjs:

~~~js
const WIDTH = 620;
const HEIGHT = 200;
const TOP_GAP = 18;

function assistantShelfBounds(workArea) {
  return {
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: workArea.y + TOP_GAP,
    width: WIDTH,
    height: HEIGHT,
  };
}

function assistantWindowOptions(preloadPath, platform = process.platform, darkMode = false) {
  const transparent = platform === 'darwin';
  return {
    ...(platform === 'darwin' ? { type: 'panel' } : {}),
    width: WIDTH,
    height: HEIGHT,
    minWidth: WIDTH,
    maxWidth: WIDTH,
    minHeight: HEIGHT,
    maxHeight: HEIGHT,
    useContentSize: true,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    hasShadow: true,
    transparent,
    backgroundColor: transparent ? '#00000000' : darkMode ? '#000000' : '#FAF9F7',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  };
}
~~~

Keep assistantEntry unchanged and export assistantShelfBounds.

- [ ] **Step 4: Write controller tests through its public interface**

Create fakes that record calls and event listeners. Pin:

~~~ts
it('positions on the pointer display before showing and focuses the renderer', () => {
  const calls: string[] = [];
  const win = fakeWindow(calls);
  const controller = createAssistantWindowController({
    createWindow: () => win,
    preloadPath: '/x/preload.cjs',
    entry: { kind: 'file', target: '/x/assistant.html' },
    getCursorScreenPoint: () => ({ x: -100, y: 200 }),
    getDisplayNearestPoint: () => ({
      workArea: { x: -1440, y: 0, width: 1440, height: 900 },
    }),
    beforeShow: () => calls.push('snapshot'),
  });

  controller.create();
  win.emit('ready-to-show');
  controller.showAndFocus();

  expect(win.setBounds).toHaveBeenCalledWith(
    { x: -1030, y: 18, width: 620, height: 200 },
    false,
  );
  expect(calls).toEqual(['bounds', 'snapshot', 'show', 'focus', 'web-focus']);
});

it('hides on blur and a second invocation can be represented by isShowing', () => {
  const win = fakeWindow([]);
  const controller = controllerWith(win);
  controller.create();
  win.emit('ready-to-show');
  controller.showAndFocus();
  expect(controller.isShowing()).toBe(true);
  win.emit('blur');
  expect(win.hide).toHaveBeenCalledTimes(1);
  expect(controller.isShowing()).toBe(false);
});

it('recreates only when invoked after the renderer exits', () => {
  const first = fakeWindow([]);
  const second = fakeWindow([]);
  const createWindow = vi.fn()
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(second);
  const controller = controllerWith(first, { createWindow });
  controller.create();
  first.webContents.emit('render-process-gone');
  expect(first.destroy).toHaveBeenCalledTimes(1);
  expect(controller.current()).toBeNull();
  controller.showAndFocus();
  expect(createWindow).toHaveBeenCalledTimes(2);
});

it('cancels a pending show and destroys exactly once on dispose', () => {
  const win = fakeWindow([]);
  const controller = controllerWith(win);
  controller.showAndFocus();
  controller.hide();
  win.emit('ready-to-show');
  expect(win.show).not.toHaveBeenCalled();
  controller.dispose();
  controller.dispose();
  expect(win.destroy).toHaveBeenCalledTimes(1);
});
~~~

- [ ] **Step 5: Implement readiness, show ordering, and recovery**

The controller implementation must:

- create lazily and allow create at startup for pre-warming;
- call setAlwaysOnTop(true, 'floating');
- call setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
- deny every window.open from the shelf webContents;
- load only assistantEntry;
- remember a pending show until ready-to-show;
- calculate bounds immediately before every visible show;
- request the fresh snapshot after positioning and before show;
- call show, focus, and webContents.focus in that order;
- hide on blur;
- clear its handle on closed; on render-process-gone destroy and discard the unusable window before clearing the handle;
- recreate only on the next create or showAndFocus call;
- make hide and dispose idempotent.

Use one live-window helper:

~~~js
function live(win) {
  return win && !win.isDestroyed() ? win : null;
}
~~~

Implement the controller body behind the public interface:

~~~js
const {
  assistantShelfBounds,
  assistantWindowOptions,
} = require('./assistantWindow.cjs');

function createAssistantWindowController(deps) {
  const {
    createWindow,
    preloadPath,
    entry,
    getCursorScreenPoint,
    getDisplayNearestPoint,
    beforeShow,
    platform = process.platform,
    shouldUseDarkColors = () => false,
    logError = () => {},
  } = deps;

  let assistantWindow = null;
  let ready = false;
  let pendingShow = false;
  let disposed = false;

  function positionWindow(win) {
    const pointer = getCursorScreenPoint();
    const display = getDisplayNearestPoint(pointer);
    win.setBounds(assistantShelfBounds(display.workArea), false);
  }

  function reveal(win) {
    if (assistantWindow !== win || !ready || !pendingShow || !live(win)) return;
    pendingShow = false;
    positionWindow(win);
    beforeShow();
    win.show();
    win.focus();
    win.webContents.focus();
  }

  function clearWindow(win) {
    if (assistantWindow !== win) return;
    assistantWindow = null;
    ready = false;
    pendingShow = false;
  }

  function buildWindow() {
    if (disposed) return null;
    const current = live(assistantWindow);
    if (current) return current;
    if (assistantWindow) clearWindow(assistantWindow);

    try {
      const win = createWindow(assistantWindowOptions(
        preloadPath,
        platform,
        shouldUseDarkColors(),
      ));
      assistantWindow = win;
      ready = false;

      win.setAlwaysOnTop(true, 'floating');
      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

      win.once('ready-to-show', () => {
        if (assistantWindow !== win) return;
        ready = true;
        reveal(win);
      });
      win.on('blur', () => {
        if (assistantWindow === win) {
          pendingShow = false;
          if (live(win)) win.hide();
        }
      });
      win.on('closed', () => clearWindow(win));
      win.webContents.on('render-process-gone', () => {
        if (assistantWindow !== win) return;
        clearWindow(win);
        if (!win.isDestroyed()) win.destroy();
      });

      if (entry.kind === 'url') win.loadURL(entry.target);
      else win.loadFile(entry.target);
      return win;
    } catch (error) {
      assistantWindow = null;
      ready = false;
      pendingShow = false;
      logError('[phase-assistant] shelf window unavailable', error);
      return null;
    }
  }

  return {
    create() {
      buildWindow();
    },
    position() {
      const win = buildWindow();
      if (win) positionWindow(win);
    },
    showAndFocus() {
      const win = buildWindow();
      if (!win) return;
      pendingShow = true;
      reveal(win);
    },
    hide() {
      pendingShow = false;
      const win = live(assistantWindow);
      if (win) win.hide();
    },
    isShowing() {
      return live(assistantWindow)?.isVisible() === true;
    },
    current() {
      return live(assistantWindow);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pendingShow = false;
      const win = live(assistantWindow);
      assistantWindow = null;
      ready = false;
      if (win) win.destroy();
    },
  };
}

module.exports = { createAssistantWindowController };
~~~

The .d.cts file must declare the AssistantWindowController interface in this plan's Deep-module seams section plus only the injected capabilities used above. Do not expose BrowserWindow options, screen, or event listeners to main.cjs beyond that dependency object.

- [ ] **Step 6: Run controller and relay tests**

Run:

~~~bash
npx vitest run --config vitest.config.ts electron/assistantWindowController.test.ts electron/assistantIpc.test.ts
~~~

Expected: PASS, including options, geometry, show ordering, blur, recovery, and disposal.

- [ ] **Step 7: Commit the window module**

~~~bash
git add electron/assistantWindow.cjs electron/assistantWindow.d.cts electron/assistantWindowController.cjs electron/assistantWindowController.d.cts electron/assistantWindowController.test.ts electron/assistantIpc.test.ts
git commit -m "feat(assistant): control the top shelf window"
~~~

### Task 5: Add the validated desktop shell bridge

**Files:**

- Create: electron/shellIpc.cjs
- Create: electron/shellIpc.d.cts
- Create: electron/shellIpc.test.ts
- Modify: electron/preload.cjs
- Create: src/lib/shellBridge.ts
- Create: src/lib/shellBridge.test.ts

- [ ] **Step 1: Write failing main-process sender tests**

Use the same fake ipcMain shape as assistantIpc.test.ts. Pin:

~~~ts
it('lets only the Hub open the assistant shelf', async () => {
  const { ipcMain, openAssistant } = shell();
  expect(await ipcMain.invoke('phase-shell:open-assistant', MAIN_ID)).toBe(true);
  expect(await ipcMain.invoke('phase-shell:open-assistant', STRANGER_ID)).toBe(false);
  expect(openAssistant).toHaveBeenCalledTimes(1);
});

it('lets only the Hub read and change the login item', async () => {
  const { ipcMain, getLaunchAtLogin, setLaunchAtLogin } = shell();
  expect(await ipcMain.invoke('phase-shell:get-launch-at-login', MAIN_ID)).toBe(false);
  expect(await ipcMain.invoke('phase-shell:set-launch-at-login', MAIN_ID, true)).toBe(true);
  expect(await ipcMain.invoke('phase-shell:set-launch-at-login', MAIN_ID, 'yes')).toBeNull();
  expect(await ipcMain.invoke('phase-shell:set-launch-at-login', STRANGER_ID, false)).toBeNull();
  expect(getLaunchAtLogin).toHaveBeenCalled();
  expect(setLaunchAtLogin).toHaveBeenCalledTimes(1);
});

it('shows the Hub before asking it to open Settings', () => {
  const { main, showMainWindow, ipc } = shell();
  ipc.openSettings();
  expect(showMainWindow).toHaveBeenCalledTimes(1);
  expect(main.webContents.send).toHaveBeenCalledWith('phase-shell:open-settings');
});

it('waits for a login-launched Hub to finish loading before opening Settings', () => {
  const { main, ipc } = shell({ loading: true });
  ipc.openSettings();
  expect(main.webContents.send).not.toHaveBeenCalled();
  main.webContents.emit('did-finish-load');
  expect(main.webContents.send).toHaveBeenCalledTimes(1);
  expect(main.webContents.send).toHaveBeenCalledWith('phase-shell:open-settings');
});

it('removes every channel on dispose', () => {
  const { ipcMain, ipc } = shell();
  ipc.dispose(ipcMain);
  expect(ipcMain.removeHandler).toHaveBeenCalledWith('phase-shell:open-assistant');
  expect(ipcMain.removeHandler).toHaveBeenCalledWith('phase-shell:get-launch-at-login');
  expect(ipcMain.removeHandler).toHaveBeenCalledWith('phase-shell:set-launch-at-login');
});
~~~

- [ ] **Step 2: Run the shell tests and confirm the missing module**

Run:

~~~bash
npx vitest run --config vitest.config.ts electron/shellIpc.test.ts
~~~

Expected: FAIL because shellIpc.cjs does not exist.

- [ ] **Step 3: Implement the main-process shell module**

Use phase-shell as the fixed channel prefix. The module must:

~~~js
function createShellIpc(deps) {
  const {
    getMainWindow,
    openAssistant,
    showMainWindow,
    getLaunchAtLogin,
    setLaunchAtLogin,
  } = deps;

  function liveMain() {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? win : null;
  }

  function isMainSender(event) {
    const win = liveMain();
    return !!win && event.sender.id === win.webContents.id;
  }

  function onOpenAssistant(event) {
    if (!isMainSender(event)) return false;
    openAssistant();
    return true;
  }

  function onGetLaunchAtLogin(event) {
    if (!isMainSender(event)) return null;
    return getLaunchAtLogin();
  }

  function onSetLaunchAtLogin(event, enabled) {
    if (!isMainSender(event) || typeof enabled !== 'boolean') return null;
    return setLaunchAtLogin(enabled);
  }

  return {
    register(ipcMain) {
      ipcMain.handle('phase-shell:open-assistant', onOpenAssistant);
      ipcMain.handle('phase-shell:get-launch-at-login', onGetLaunchAtLogin);
      ipcMain.handle('phase-shell:set-launch-at-login', onSetLaunchAtLogin);
    },
    openSettings() {
      showMainWindow();
      const win = liveMain();
      if (!win) return;
      const send = () => win.webContents.send('phase-shell:open-settings');
      if (win.webContents.isLoadingMainFrame()) {
        win.webContents.once('did-finish-load', send);
      } else {
        send();
      }
    },
    dispose(ipcMain) {
      ipcMain.removeHandler('phase-shell:open-assistant');
      ipcMain.removeHandler('phase-shell:get-launch-at-login');
      ipcMain.removeHandler('phase-shell:set-launch-at-login');
    },
  };
}
~~~

Catch operating-system login-item exceptions inside the dependency functions in main.cjs, log them, and return null. On success, setLaunchAtLogin must read app.getLoginItemSettings().openAtLogin after the write and return that observed boolean rather than the requested boolean. Do not let an IPC exception close Settings.

- [ ] **Step 4: Expose the narrow preload and write renderer tests**

Add only:

~~~js
contextBridge.exposeInMainWorld('phaseShell', {
  openAssistant: () => ipcRenderer.invoke('phase-shell:open-assistant'),
  onOpenSettings: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('phase-shell:open-settings', listener);
    return () => ipcRenderer.removeListener('phase-shell:open-settings', listener);
  },
  getLaunchAtLogin: () => ipcRenderer.invoke('phase-shell:get-launch-at-login'),
  setLaunchAtLogin: (enabled) =>
    ipcRenderer.invoke('phase-shell:set-launch-at-login', enabled),
});
~~~

Write shellBridge tests that prove:

- no preload returns available false, false for openAssistant, null for login reads/writes, and a safe unsubscribe;
- a real preload receives all four calls and returns its unsubscribe;
- neither bridge accepts a channel name from React.

- [ ] **Step 5: Implement the browser-safe renderer adapter**

Implement the exact PhaseShellBridge interface from the file map. Follow assistantBridge.ts's preloadOf and noop pattern. openAssistant returns false in the browser; login methods return null.

- [ ] **Step 6: Run all bridge and preload security tests**

Run:

~~~bash
npx vitest run --config vitest.config.ts electron/shellIpc.test.ts electron/assistantIpc.test.ts src/lib/shellBridge.test.ts src/lib/assistantBridge.test.ts
~~~

Expected: PASS. The preload escape-hatch test must inspect phaseShell calls as well as phaseAssistant calls.

- [ ] **Step 7: Commit the shell bridge**

~~~bash
git add electron/shellIpc.cjs electron/shellIpc.d.cts electron/shellIpc.test.ts electron/preload.cjs src/lib/shellBridge.ts src/lib/shellBridge.test.ts electron/assistantIpc.test.ts
git commit -m "feat(shell): expose narrow desktop actions"
~~~

### Task 6: Add the resilient menu-bar controller and template icon

**Files:**

- Create: build/phase-tray.svg
- Create: scripts/make-tray-icon.sh
- Create: electron/assets/phaseTemplate.png
- Create: electron/assets/phaseTemplate@2x.png
- Create: electron/menuBar.cjs
- Create: electron/menuBar.d.cts
- Create: electron/menuBar.test.ts
- Modify: package.json

- [ ] **Step 1: Write failing menu construction tests**

Pin the exact, consistent verbs:

~~~ts
it('builds one neutral menu in the approved order', () => {
  const { controller, buildFromTemplate } = menuBar();
  controller.create();
  const template = buildFromTemplate.mock.calls[0][0];
  expect(template.map((item: { label?: string; type?: string }) =>
    item.type === 'separator' ? 'separator' : item.label,
  )).toEqual([
    'Open Phase',
    'Open assistant',
    'Settings',
    'separator',
    'Quit Phase',
  ]);
});

it('routes each item once and disposes the native tray', () => {
  const fixture = menuBar();
  fixture.controller.create();
  const template = fixture.buildFromTemplate.mock.calls[0][0];
  template[0].click();
  template[1].click();
  template[2].click();
  template[4].click();
  expect(fixture.onOpenPhase).toHaveBeenCalledTimes(1);
  expect(fixture.onOpenAssistant).toHaveBeenCalledTimes(1);
  expect(fixture.onOpenSettings).toHaveBeenCalledTimes(1);
  expect(fixture.onQuit).toHaveBeenCalledTimes(1);
  fixture.controller.dispose();
  fixture.controller.dispose();
  expect(fixture.tray.destroy).toHaveBeenCalledTimes(1);
});

it('logs a tray creation failure and leaves the app usable', () => {
  const fixture = menuBar({ createTray: () => { throw new Error('no status item'); } });
  expect(() => fixture.controller.create()).not.toThrow();
  expect(fixture.logError).toHaveBeenCalledWith(
    '[phase-shell] menu bar unavailable',
    expect.any(Error),
  );
});
~~~

- [ ] **Step 2: Run the test and confirm the module is absent**

Run:

~~~bash
npx vitest run --config vitest.config.ts electron/menuBar.test.ts
~~~

Expected: FAIL because menuBar.cjs does not exist.

- [ ] **Step 3: Add the monochrome vector source and generator**

Use only the existing Phase lightning silhouette in solid black:

~~~svg
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 48 48">
  <path fill="#000000" d="M25.842 44.938c-.664.844-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.183c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.498 0-3.579-1.842-3.579H1.133c-.92 0-1.456-1.04-.92-1.787L9.91.473c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.578 1.842 3.578h11.377c.943 0 1.473 1.088.89 1.832L25.843 44.94z"/>
</svg>
~~~

The shell script must:

~~~bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE="$PROJECT_DIR/build/phase-tray.svg"
ASSET_DIR="$PROJECT_DIR/electron/assets"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$ASSET_DIR"
qlmanage -t -s 36 -o "$WORK_DIR" "$SOURCE" >/dev/null 2>&1
RAW="$WORK_DIR/$(basename "$SOURCE").png"
test -f "$RAW"
sips -z 18 18 "$RAW" --out "$ASSET_DIR/phaseTemplate.png" >/dev/null
sips -z 36 36 "$RAW" --out "$ASSET_DIR/phaseTemplate@2x.png" >/dev/null
~~~

Add package script:

~~~json
"tray-icon": "bash scripts/make-tray-icon.sh"
~~~

Run:

~~~bash
npm run tray-icon
file electron/assets/phaseTemplate.png electron/assets/phaseTemplate@2x.png
~~~

Expected: both files report PNG image data at 18 × 18 and 36 × 36.

- [ ] **Step 4: Implement the menu-bar deep module**

Expose create and dispose only. Dependencies provide createTray, buildMenu, loadImage, iconPath, the four callbacks, and logError. On create:

1. load the PNG;
2. throw inside the module if the image is empty;
3. call setTemplateImage(true);
4. create Tray;
5. set tooltip to Phase;
6. build and attach the approved menu.

Catch the whole sequence, destroy a partially created Tray, set the internal handle to null, and log exactly:

~~~js
logError('[phase-shell] menu bar unavailable', error);
~~~

Quit Phase must call the injected explicit quit callback; do not use role: 'quit', because the lifecycle module must observe one deliberate route.

- [ ] **Step 5: Run menu tests and regenerate assets once**

Run:

~~~bash
npx vitest run --config vitest.config.ts electron/menuBar.test.ts
npm run tray-icon
git diff --check
~~~

Expected: PASS and clean whitespace.

- [ ] **Step 6: Commit the menu bar**

~~~bash
git add build/phase-tray.svg scripts/make-tray-icon.sh electron/assets/phaseTemplate.png electron/assets/phaseTemplate@2x.png electron/menuBar.cjs electron/menuBar.d.cts electron/menuBar.test.ts package.json
git commit -m "feat(shell): add the Phase menu bar"
~~~

### Task 7: Make the Hub a hidden background state owner

**Files:**

- Create: electron/appLifecycle.cjs
- Create: electron/appLifecycle.d.cts
- Create: electron/appLifecycle.test.ts

- [ ] **Step 1: Write failing lifecycle tests**

Pin close-to-hide and explicit quit:

~~~ts
it('prevents an ordinary Hub close and hides it', () => {
  const fixture = lifecycle();
  fixture.controller.register();
  fixture.controller.protectMainWindow(fixture.main);
  const event = { preventDefault: vi.fn() };
  fixture.main.emit('close', event);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(fixture.main.hide).toHaveBeenCalledTimes(1);
});

it('allows close after before-quit and releases resources on will-quit', () => {
  const fixture = lifecycle();
  fixture.controller.register();
  fixture.controller.protectMainWindow(fixture.main);
  fixture.app.emit('before-quit');
  const event = { preventDefault: vi.fn() };
  fixture.main.emit('close', event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  fixture.app.emit('will-quit');
  expect(fixture.onWillQuit).toHaveBeenCalledTimes(1);
});

it('reopens Phase on Dock activation', () => {
  const fixture = lifecycle();
  fixture.controller.register();
  fixture.app.emit('activate');
  expect(fixture.onActivate).toHaveBeenCalledTimes(1);
});

it('keeps a login launch hidden', () => {
  expect(shouldShowMainAtLaunch({ wasOpenedAtLogin: true })).toBe(false);
  expect(shouldShowMainAtLaunch({ wasOpenedAtLogin: false })).toBe(true);
});
~~~

- [ ] **Step 2: Run the lifecycle test and confirm the red state**

Run:

~~~bash
npx vitest run --config vitest.config.ts electron/appLifecycle.test.ts
~~~

Expected: FAIL because appLifecycle.cjs does not exist.

- [ ] **Step 3: Implement lifecycle ownership**

Use:

~~~js
function shouldShowMainAtLaunch(settings) {
  return settings.wasOpenedAtLogin !== true;
}

function createAppLifecycle({ app, onActivate, onWillQuit }) {
  let quitting = false;
  let registered = false;

  const beforeQuit = () => { quitting = true; };
  const activate = () => onActivate();
  const willQuit = () => onWillQuit();

  return {
    register() {
      if (registered) return;
      registered = true;
      app.on('before-quit', beforeQuit);
      app.on('activate', activate);
      app.on('will-quit', willQuit);
    },
    protectMainWindow(win) {
      win.on('close', (event) => {
        if (quitting) return;
        event.preventDefault();
        win.hide();
      });
    },
    isQuitting() {
      return quitting;
    },
    dispose() {
      if (!registered) return;
      registered = false;
      app.removeListener('before-quit', beforeQuit);
      app.removeListener('activate', activate);
      app.removeListener('will-quit', willQuit);
    },
  };
}
~~~

Do not call app.quit from window-all-closed. The explicit Quit Phase callback and Command–Q call app.quit, which emits before-quit and permits the protected window to close.

- [ ] **Step 4: Run the lifecycle tests**

Run:

~~~bash
npx vitest run --config vitest.config.ts electron/appLifecycle.test.ts
~~~

Expected: PASS.

- [ ] **Step 5: Commit lifecycle behavior**

~~~bash
git add electron/appLifecycle.cjs electron/appLifecycle.d.cts electron/appLifecycle.test.ts
git commit -m "feat(shell): keep Phase ready in the background"
~~~

### Task 8: Route desktop entry points and expose launch-at-login in Settings

**Files:**

- Create: src/components/assistant/LaunchAtLoginSettings.tsx
- Create: src/components/assistant/LaunchAtLoginSettings.test.tsx
- Modify: src/components/SettingsModal.tsx
- Modify: src/App.tsx
- Modify: src/App.test.ts
- Modify: src/lib/shellBridge.test.ts

- [ ] **Step 1: Write failing launch-at-login component tests**

Mock shellBridge and pin:

~~~ts
it('loads the current desktop value and toggles it once', async () => {
  const setLaunchAtLogin = vi.fn(async () => true);
  bridgeMock.mockReturnValue({
    available: true,
    openAssistant: vi.fn(),
    onOpenSettings: vi.fn(() => () => {}),
    getLaunchAtLogin: vi.fn(async () => false),
    setLaunchAtLogin,
  });
  render(<LaunchAtLoginSettings />);
  const toggle = await screen.findByRole('switch', { name: 'Launch Phase at login' });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  expect(setLaunchAtLogin).toHaveBeenCalledWith(true);
});

it('restores the truthful value and shows a warning when the OS refuses', async () => {
  bridgeMock.mockReturnValue({
    available: true,
    openAssistant: vi.fn(),
    onOpenSettings: vi.fn(() => () => {}),
    getLaunchAtLogin: vi.fn(async () => false),
    setLaunchAtLogin: vi.fn(async () => null),
  });
  render(<LaunchAtLoginSettings />);
  const toggle = await screen.findByRole('switch', { name: 'Launch Phase at login' });
  fireEvent.click(toggle);
  expect(await screen.findByText("Phase couldn't change this setting.")).toBeTruthy();
  expect(toggle.getAttribute('aria-checked')).toBe('false');
});

it('renders nothing in the plain browser', () => {
  bridgeMock.mockReturnValue({
    available: false,
    openAssistant: vi.fn(),
    onOpenSettings: vi.fn(() => () => {}),
    getLaunchAtLogin: vi.fn(async () => null),
    setLaunchAtLogin: vi.fn(async () => null),
  });
  const { container } = render(<LaunchAtLoginSettings />);
  expect(container.innerHTML).toBe('');
});
~~~

- [ ] **Step 2: Write failing desktop-routing tests**

Extract one tiny resolver from App.tsx into the same file or export it for App.test.ts:

~~~ts
export function openAssistantForEnvironment(
  bridge: PhaseShellBridge,
  openEmbedded: () => void,
): void {
  if (bridge.available) {
    void bridge.openAssistant();
    return;
  }
  openEmbedded();
}
~~~

Test:

~~~ts
it('opens the native shelf on desktop and the embedded host in a browser', () => {
  const openEmbedded = vi.fn();
  const desktop = shellFixture(true);
  openAssistantForEnvironment(desktop, openEmbedded);
  expect(desktop.openAssistant).toHaveBeenCalledTimes(1);
  expect(openEmbedded).not.toHaveBeenCalled();

  const browser = shellFixture(false);
  openAssistantForEnvironment(browser, openEmbedded);
  expect(browser.openAssistant).not.toHaveBeenCalled();
  expect(openEmbedded).toHaveBeenCalledTimes(1);
});
~~~

- [ ] **Step 3: Run the component and App tests**

Run:

~~~bash
npx vitest run --config vitest.config.ts src/components/assistant/LaunchAtLoginSettings.test.tsx src/App.test.ts
~~~

Expected: FAIL because the component and resolver do not exist.

- [ ] **Step 4: Implement the settings row**

LaunchAtLoginSettings owns four local states: enabled, loading, saving, and error. On mount:

- return null immediately when bridge.available is false;
- read getLaunchAtLogin;
- render a quiet skeleton line until the read resolves;
- render one role=switch button afterward;
- disable it while saving;
- optimistically keep the old value until setLaunchAtLogin returns;
- use the returned boolean as authoritative;
- preserve the old value and show the exact warning if the result is null.

The switch is not a live status announcer. Keep the warning in role=alert, and use role=status only for the Good luck send-off and existing application notices.

Use neutral styling:

~~~tsx
<button
  type="button"
  role="switch"
  aria-checked={enabled}
  aria-label="Launch Phase at login"
  disabled={saving}
  className="flex w-full items-center justify-between rounded-field px-2 py-2 text-left text-ui hover:bg-hover disabled:opacity-50"
>
  <span>
    <span className="block text-ink">Launch Phase at login</span>
    <span className="block text-meta text-muted">Keep the assistant ready after you sign in.</span>
  </span>
  <span
    aria-hidden="true"
    className={"h-[18px] w-[32px] rounded-field border p-[2px] "
      + (enabled ? 'border-ink bg-ink' : 'border-check bg-panel')}
  >
    <span
      className={"block h-[12px] w-[12px] rounded-field bg-panel transition-transform duration-150 "
        + (enabled ? 'translate-x-[12px]' : 'translate-x-0')}
    />
  </span>
</button>
~~~

Add the row directly below Assistant shortcut in SettingsModal with no surrounding card and no additional heading competing with the current sections.

- [ ] **Step 5: Route App entry points through phaseShell**

Create the bridge once:

~~~ts
const shell = useMemo(() => shellBridge(), []);
~~~

Use openAssistantForEnvironment in the assistant command-palette case. Keep AssistantHost mounted as the state owner and relay even when open is false; only its visible in-app dialog remains browser fallback.

Add useMemo to App.tsx's React import.

Subscribe to menu Settings:

~~~ts
useEffect(
  () => shell.onOpenSettings(() => setSettingsOpen(true)),
  [shell],
);
~~~

Desktop Open assistant must close the command palette through the palette's existing completion flow, then invoke the shelf. Do not set assistantOpen true on desktop.

- [ ] **Step 6: Run React, bridge, and boundary tests**

Run:

~~~bash
npx vitest run --config vitest.config.ts src/components/assistant/LaunchAtLoginSettings.test.tsx src/App.test.ts src/lib/shellBridge.test.ts src/components/assistant/AssistantHost.test.tsx src/assistant/entryBoundary.test.ts
~~~

Expected: PASS.

- [ ] **Step 7: Commit desktop routing and Settings**

~~~bash
git add src/components/assistant/LaunchAtLoginSettings.tsx src/components/assistant/LaunchAtLoginSettings.test.tsx src/components/SettingsModal.tsx src/App.tsx src/App.test.ts src/lib/shellBridge.test.ts
git commit -m "feat(shell): route Phase through the desktop shelf"
~~~

### Task 9: Compose the shelf, lifecycle, shell, and menu bar in Electron

**Files:**

- Modify: electron/main.cjs
- Modify: electron/assistantIpc.test.ts
- Modify: electron/appLifecycle.test.ts
- Modify: electron/menuBar.test.ts
- Modify: electron/shellIpc.test.ts

- [ ] **Step 1: Add a composition-level source contract before editing main**

Replace the old source assertions that require window-all-closed to quit. Pin the new composition:

~~~ts
it('composes the background Hub and shelf modules', () => {
  expect(main).toContain('createAssistantWindowController');
  expect(main).toContain('createAppLifecycle');
  expect(main).toContain('createShellIpc');
  expect(main).toContain('createMenuBar');
  expect(main).not.toMatch(/window-all-closed[\s\S]{0,100}app\.quit/);
});

it('prewarms the shelf without showing the Hub on a login launch', () => {
  expect(main).toMatch(/shouldShowMainAtLaunch\(app\.getLoginItemSettings\(\)\)/);
  expect(main).toMatch(/assistantController\.create\(\)/);
});

it('releases every global resource on explicit quit', () => {
  expect(main).toContain('assistantShortcut.dispose()');
  expect(main).toContain('globalShortcut.unregisterAll()');
  expect(main).toContain('assistantController?.dispose()');
  expect(main).toContain('menuBar.dispose()');
  expect(main).toContain('assistantIpc.dispose(ipcMain)');
  expect(main).toContain('shellIpc.dispose(ipcMain)');
});
~~~

- [ ] **Step 2: Run the Electron tests and confirm the old lifecycle fails**

Run:

~~~bash
npx vitest run --config vitest.config.ts electron/assistantIpc.test.ts electron/assistantWindowController.test.ts electron/appLifecycle.test.ts electron/menuBar.test.ts electron/shellIpc.test.ts
~~~

Expected: FAIL because main.cjs still owns a tall BrowserWindow, destroys it with the Hub, and quits from window-all-closed.

- [ ] **Step 3: Replace direct shelf ownership with the controller**

Import screen, Tray, Menu, and nativeImage from Electron. Replace assistantWindow with:

~~~js
let assistantController = null;
~~~

Create two explicit entry functions:

~~~js
function openAssistant() {
  assistantController?.showAndFocus();
}

function toggleAssistant() {
  if (!assistantController) return;
  if (assistantController.isShowing()) assistantController.hide();
  else assistantController.showAndFocus();
}
~~~

Point the shortcut at toggleAssistant. Point menu and shell actions at openAssistant. Give assistantIpc:

~~~js
getAssistantWindow: () => assistantController?.current() ?? null,
hideAssistant: () => assistantController?.hide(),
~~~

The controller's beforeShow dependency calls assistantIpc.requestSnapshot. Delete createAssistantWindow and every direct assistantWindow event listener from main.cjs.

- [ ] **Step 4: Protect and reopen the Hub**

Change createWindow to accept showOnReady:

~~~js
function createWindow(showOnReady = true) {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const win = new BrowserWindow(mainWindowOptions);
  mainWindow = win;
  lifecycle.protectMainWindow(win);
  win.once('ready-to-show', () => {
    if (showOnReady && mainWindow === win) win.show();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}
~~~

Keep the existing secure options, external-link handling, and dev/production entry. Add:

~~~js
function openPhase() {
  const win = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
~~~

The lifecycle activate callback calls openPhase. Remove the window-all-closed quit listener.

- [ ] **Step 5: Register shell IPC and login settings**

Compose createShellIpc with:

~~~js
getLaunchAtLogin: () => {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (error) {
    console.error('[phase-shell] login item unavailable', error);
    return null;
  }
},
setLaunchAtLogin: (enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return app.getLoginItemSettings().openAtLogin;
  } catch (error) {
    console.error('[phase-shell] login item unavailable', error);
    return null;
  }
},
showMainWindow: openPhase,
openAssistant,
~~~

Register it after app readiness and before the Hub page can invoke it.

- [ ] **Step 6: Prewarm hidden surfaces and build the menu bar**

Inside app.whenReady:

1. register calendar, assistant, and shell IPC;
2. register lifecycle listeners;
3. calculate showMain with shouldShowMainAtLaunch(app.getLoginItemSettings());
4. call createWindow(showMain);
5. construct assistantController with BrowserWindow, screen, assistant options, and assistant entry;
6. call assistantController.create while it remains show:false. macOS uses a transparent native background so the rounded CSS surface paints without square corners or a light flash; fallback platforms pass nativeTheme.shouldUseDarkColors into the fixed window options;
7. create menuBar with the generated template icon;
8. leave both windows hidden when showMain is false.

Use:

~~~js
menuBar = createMenuBar({
  createTray: (image) => new Tray(image),
  buildMenu: (template) => Menu.buildFromTemplate(template),
  loadImage: (assetPath) => nativeImage.createFromPath(assetPath),
  iconPath: path.join(__dirname, 'assets', 'phaseTemplate.png'),
  onOpenPhase: openPhase,
  onOpenAssistant: openAssistant,
  onOpenSettings: () => shellIpc.openSettings(),
  onQuit: () => app.quit(),
  logError: (...args) => console.error(...args),
});
menuBar.create();
~~~

- [ ] **Step 7: Centralize quit cleanup**

The lifecycle onWillQuit callback must run exactly once:

~~~js
assistantShortcut.dispose();
globalShortcut.unregisterAll();
assistantController?.dispose();
menuBar.dispose();
assistantIpc.dispose(ipcMain);
shellIpc.dispose(ipcMain);
~~~

Then clear controller handles. Do not destroy the shelf when the Hub merely hides.

- [ ] **Step 8: Run the Electron unit and composition tests**

Run:

~~~bash
npx vitest run --config vitest.config.ts electron/assistantIpc.test.ts electron/assistantShortcut.test.ts electron/assistantWindowController.test.ts electron/appLifecycle.test.ts electron/menuBar.test.ts electron/shellIpc.test.ts
~~~

Expected: PASS.

- [ ] **Step 9: Commit Electron composition**

~~~bash
git add electron/main.cjs electron/assistantIpc.test.ts electron/appLifecycle.test.ts electron/menuBar.test.ts electron/shellIpc.test.ts
git commit -m "feat(shell): compose the background command shelf"
~~~

### Task 10: Verify, build, launch, and record the macOS acceptance gate

**Files:**

- Modify: docs/assistant-verification.md
- Modify: docs/superpowers/specs/2026-08-13-top-command-shelf-design.md

- [ ] **Step 1: Run focused shelf gates**

Run:

~~~bash
npx vitest run --config vitest.config.ts src/components/assistant/useAssistantSendoff.test.tsx src/components/assistant/AssistantSurface.test.tsx src/components/assistant/AssistantHost.test.tsx src/lib/assistantBridge.test.ts src/lib/shellBridge.test.ts src/assistant/entryBoundary.test.ts src/lib/designScale.test.ts electron/assistantIpc.test.ts electron/assistantShortcut.test.ts electron/assistantWindowController.test.ts electron/appLifecycle.test.ts electron/menuBar.test.ts electron/shellIpc.test.ts
~~~

Expected: all listed files PASS.

- [ ] **Step 2: Run the complete automated gate**

Run:

~~~bash
npm test
npx tsc -b
npm run build
npm run build:mac
git diff --check
~~~

Expected:

- the complete Vitest suite passes;
- TypeScript exits 0;
- Vite emits dist/index.html and dist/assistant.html;
- electron-builder emits release/mac-arm64/Phase.app and a DMG;
- git diff --check prints nothing.

- [ ] **Step 3: Scan the implementation for scope and security regressions**

Run:

~~~bash
rg -n "TO""DO|FIX""ME|T""BD|coming soon|chat history|homework table|NSPanel|screen-saver|generic.*ipc|ipcRenderer\.(send|invoke)\([^'\"]" src electron assistant.html
rg -n "from ['\"].*(state|db)|initStore|persist|Dexie|tabLock" src/assistant src/components/assistant/AssistantSurface.tsx src/components/assistant/useAssistantSendoff.ts
~~~

Expected:

- the first command has no implementation placeholders, native fallback, elevated window level, or parameterized IPC;
- the second command has no hits in the shelf renderer graph. AssistantHost is intentionally excluded because it is the Hub's store adapter.

- [ ] **Step 4: Launch the built app for the macOS acceptance pass**

Quit any older development instance, then run:

~~~bash
open release/mac-arm64/Phase.app
~~~

Use the computer-use skill for visible UI checks, then verify these physical behaviors at the real keyboard:

1. From Finder or another normal app, press Command–Space. The Hub stays behind and the shelf input has focus.
2. Press Command–Space again. The shelf hides once and focus returns to the underlying app.
3. Reopen and press Escape. It hides without “Good luck!”.
4. Reopen, click away, and confirm blur hides it.
5. Start the recommended session. The button disables, “Good luck!” appears only after the task becomes the active session, and the shelf disappears without a white flash.
6. Reopen. The shelf shows Focus session with the same task, elapsed work, expected-time text, Complete session, and Take break.
7. Enable Reduce Motion in macOS, repeat a start with another test item, and confirm there is no translation and the message remains about 350 ms.
8. Close the Hub. The menu bar and Command–Space still work.
9. Use menu-bar Open Phase, Open assistant, and Settings. Each opens the named surface exactly once.
10. Toggle Launch Phase at login off and on, confirm the switch reflects the OS result, then leave it in the user's chosen state.
11. Test a second display, a fullscreen app, another Space, Stage Manager, sleep/wake, and monitor reconnect. The shelf uses the pointer display and never remains offscreen.
12. Use Command–Q and Quit Phase separately. Both fully exit and release Command–Space.

If only the Electron panel fails focus, fullscreen Space, or Stage Manager checks after documented Electron options are verified, stop this plan and write a separate AppKit adapter plan. Do not add a Swift helper inside this task.

- [ ] **Step 5: Record exact evidence**

Update docs/assistant-verification.md with:

- test file and test counts from npm test;
- TypeScript, Vite, and electron-builder outcomes;
- each acceptance item marked automated, observed, or still manual;
- the macOS version, Electron version, display arrangement, Reduce Motion result, and whether Command–Space conflicted;
- any failure copied verbatim, without describing an unobserved behavior as passing.

Change the spec status line to:

~~~markdown
**Status:** Approved on 2026-08-13; implementation governed by the macOS acceptance gate
~~~

- [ ] **Step 6: Commit verification documentation**

~~~bash
git add docs/assistant-verification.md docs/superpowers/specs/2026-08-13-top-command-shelf-design.md
git commit -m "docs(assistant): verify the top command shelf"
~~~

## Final review checklist

Before calling this plan complete, verify:

- Every start-session path is acknowledged by matching WorkRef, never by time elapsed or optimistic local state.
- Every assistant mutation still executes in AssistantHost through existing store actions.
- The shelf entry graph remains store-free and database-free.
- The window is positioned before show on every summon.
- The window remains fixed at 620 × 200 and scrolls internally.
- The Hub close button hides; explicit quit exits.
- Menu-bar failure is logged but cannot prevent the Hub or shortcut from working.
- A shortcut conflict stays visible and does not create a silent fallback.
- No alternative becomes a second heading or default action.
- No bright gradient, glow, emoji, saturated chrome, new font size, hard-coded UI color, or mixed radius is introduced.
- No AppKit or new task/homework model appears in the diff.
