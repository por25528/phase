import { useEffect, useMemo, useState } from 'react';
import { AssistantSurface } from '../components/assistant/AssistantSurface';
import { assistantOverlayBridge } from '../lib/assistantBridge';
import type { AssistantAction, AssistantSnapshot } from '../lib/assistantProtocol';

/**
 * The floating window's whole application: subscribe, render, forward.
 *
 * Everything on screen arrives as an `AssistantSnapshot` over the validated
 * relay, and every click leaves as an `AssistantAction` the same way. There is
 * deliberately no store, no Dexie, no tab lock and no clock-driven state here
 * — the main renderer stays the one writer, and `entryBoundary.test.ts` proves
 * this graph cannot even reach those modules.
 */
export function AssistantOverlay() {
  const bridge = useMemo(() => assistantOverlayBridge(), []);
  const [snapshot, setSnapshot] = useState<AssistantSnapshot>({ status: 'loading' });

  useEffect(() => {
    const off = bridge.onSnapshot(setSnapshot);
    // `ready` returns the relay's cached snapshot so the window paints
    // instantly, and the relay separately asks the owner for a fresh one.
    void bridge.ready().then(setSnapshot);
    return off;
  }, [bridge]);

  function onAction(action: AssistantAction): void {
    if (action.type === 'close') {
      bridge.close();
      return;
    }
    bridge.act(action);
  }

  return (
    <div className="h-screen overflow-y-auto bg-bg text-ink">
      <AssistantSurface snapshot={snapshot} onAction={onAction} />
    </div>
  );
}
