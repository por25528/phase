import '@fontsource-variable/inter/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { AssistantOverlay } from './AssistantOverlay';

// The overlay's boot is deliberately tiny: styles, the overlay component, and
// nothing else. No initStore, no persistence, no tab lock — this window is a
// viewer over IPC, and entryBoundary.test.ts holds that shape in place.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AssistantOverlay />
  </StrictMode>,
);
