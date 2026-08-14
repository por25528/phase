import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssistantSurface } from '../components/assistant/AssistantSurface';
import { assistantOverlayBridge } from '../lib/assistantBridge';
import { shelfSizing } from '../lib/assistantShell';
import type { AssistantAction, AssistantSnapshot } from '../lib/assistantProtocol';
import { useReducedMotion } from '../components/useReducedMotion';

/**
 * The floating window's whole application: subscribe, render, forward.
 *
 * Everything on screen arrives as an `AssistantSnapshot` over the validated
 * relay, and every click leaves as an `AssistantAction` the same way. There is
 * deliberately no store, no Dexie, no tab lock and no clock-driven state here
 * — the main renderer stays the one writer, and `entryBoundary.test.ts` proves
 * this graph cannot even reach those modules.
 *
 * Each window focus replays the entry animation by bumping `openCycle`, which
 * also keys the container and resets the send-off state machine via
 * `resetKey`, so a returned-to shelf can never still be inside a farewell.
 */
export function AssistantOverlay() {
  const bridge = useMemo(() => assistantOverlayBridge(), []);
  const [snapshot, setSnapshot] = useState<AssistantSnapshot>({ status: 'loading' });
  const [openCycle, setOpenCycle] = useState(0);
  const [opening, setOpening] = useState(false);
  const reducedMotion = useReducedMotion();
  const sizing = shelfSizing(navigator.userAgent);
  const card = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState<{ height: number; cycle: number } | null>(null);

  // `index.css` gives every page a `bg-bg` body, and a card that filled the
  // window hid it completely. A hugging one does not: without this the
  // remainder under the card is an opaque page-coloured band — the exact "white
  // band" hugging exists to remove — rather than the transparent window behind
  // it. Set here and not in `index.css` because only this page has a remainder,
  // and gated on the same predicate that decides whether there is one.
  useEffect(() => {
    if (sizing !== 'hug') return;
    const previous = document.body.style.backgroundColor;
    document.body.style.backgroundColor = 'transparent';
    return () => { document.body.style.backgroundColor = previous; };
  }, [sizing]);

  useEffect(() => {
    const off = bridge.onSnapshot(setSnapshot);
    // `ready` returns the relay's cached snapshot so the window paints
    // instantly, and the relay separately asks the owner for a fresh one.
    void bridge.ready().then(setSnapshot);
    return off;
  }, [bridge]);

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

  /**
   * The farewell is the same size as the thing it says goodbye to.
   *
   * The card hugs its content and the farewell's content is two words, so
   * without this the shelf drops from a full panel to a ~31px sliver and only
   * then fades — a collapse the eye reads as the window closing twice. Holding
   * the footprint for the 660ms the send-off is on screen makes the fade the
   * only thing that happens.
   *
   * MEASURED at the transition, never a constant: "a typical shelf" is not a
   * height anyone has, and it would drift the first time a state grew — the
   * same reason `HEIGHT` in `assistantWindow.cjs` is measured. This is the one
   * moment the number exists, which is why the callback is synchronous.
   *
   * Stamped with `openCycle` rather than cleared in an effect, so a re-summoned
   * window drops the pin in the very render its card remounts in. An effect
   * would land one frame later — and one frame of a stale height is precisely
   * the flicker being fixed.
   */
  const onSendoffChange = useCallback((leaving: boolean) => {
    const measured = card.current;
    setPinned(leaving && measured ? { height: measured.offsetHeight, cycle: openCycle } : null);
  }, [openCycle]);

  function onAction(action: AssistantAction): void {
    if (action.type === 'close') {
      bridge.close();
      return;
    }
    bridge.act(action);
  }

  return (
    <div
      className="h-screen"
      // The window is fixed at its tallest state; on macOS everything the card
      // does not cover is transparent, so a press there is a press on the
      // desktop as far as the user is concerned. Closing is the honest answer.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) bridge.close();
      }}
    >
      <div
        key={openCycle}
        ref={card}
        data-shelf
        className={[
          // A single stretched cell, so the surface fills whatever the card is:
          // a child's percentage height cannot see a parent held open by
          // `min-height`, but a grid row grows into it, which is what keeps the
          // farewell centred in the footprint it just inherited. `grid-cols-1`
          // rather than an implicit track, because `minmax(0, 1fr)` is what
          // lets the titles inside go on truncating.
          'grid grid-cols-1',
          sizing === 'fill' ? 'h-full' : '',
          'overflow-hidden rounded-card border border-line bg-panel text-ink shadow-card',
          opening ? 'assistant-shelf-enter' : '',
        ].join(' ')}
        style={pinned?.cycle === openCycle ? { minHeight: pinned.height } : undefined}
      >
        <AssistantSurface
          snapshot={snapshot}
          onAction={onAction}
          presentation="shelf"
          resetKey={openCycle}
          onSendoffChange={onSendoffChange}
        />
      </div>
    </div>
  );
}
