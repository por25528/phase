import '@fontsource-variable/public-sans/index.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { AssistantSurface } from '../components/assistant/AssistantSurface';
import { assistantOverlayBridge } from '../lib/assistantBridge';
import type { AssistantSnapshot } from '../lib/assistantProtocol';

/**
 * The embedded presentation, at its real width, for `scripts/shot-shelf.cjs`.
 *
 * One component renders in two places, and only one of them had a page: the
 * overlay's `assistant.html` mounts `AssistantOverlay`, which hard-codes
 * `presentation="shelf"`. So every capture and every measurement ever taken of
 * this surface was of the 620px arrangement, and the 380px one inside
 * `AssistantHost` was checked by nobody — which is how its title came to
 * measure 28px and render as `D…` without anyone seeing it. jsdom has no
 * layout, so the component tests could not have seen it either.
 *
 * It is a HARNESS and not a second host: it renders the real component, with
 * the real stylesheet, inside a copy of `AssistantHost`'s own box, and it
 * stubs nothing. The snapshot arrives through `assistantOverlayBridge` —
 * `scripts/measure-shelf-preload.cjs` answers `ready()` from an environment
 * variable — so the harness needs no data of its own, and in a plain browser
 * the bridge stays inert and the surface shows its loading state rather than
 * inventing facts.
 *
 * Deliberately NOT booted from `src/assistant/main.tsx`: that entry's module
 * graph is proven store-free by `entryBoundary.test.ts`, and a harness has no
 * business widening the graph that proof walks.
 */

/**
 * `AssistantHost`'s box, minus its placement. `fixed right-[16px] top-[64px]
 * z-40` only says where on the app page the panel hangs; everything that
 * decides what the surface has to fit into — the 380px width, the scroll cap,
 * the card's border and its panel background — is here. Kept as one string
 * beside a pointer to the original, because two copies of a width that must
 * agree is exactly the drift a harness is supposed to catch.
 */
const HOST_BOX = 'max-h-[70vh] w-[380px] overflow-y-auto rounded-card '
  + 'border border-line bg-panel text-ink';

function EmbeddedHarness() {
  const bridge = useMemo(() => assistantOverlayBridge(), []);
  const [snapshot, setSnapshot] = useState<AssistantSnapshot>({ status: 'loading' });

  useEffect(() => {
    void bridge.ready().then(setSnapshot);
  }, [bridge]);

  return (
    <div role="dialog" aria-label="Assistant" data-shelf className={HOST_BOX}>
      <AssistantSurface snapshot={snapshot} onAction={() => {}} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<EmbeddedHarness />);
