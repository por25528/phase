import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { createLocalBridge } from './bridge/localBridge';
import { createICloudBridge } from './bridge/icloudBridge';
import { createPhoneStore, type PhoneStore } from './state/phoneStore';
import { SyncBar } from './views/SyncBar';
import { Today } from './views/Today';
import { Capture } from './views/Capture';
import { Week } from './views/Week';

type Tab = 'today' | 'capture' | 'week';

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'capture', label: 'Capture' },
  { id: 'week', label: 'Week' },
];

/**
 * The shell: three screens, one bottom bar, Today first.
 *
 * Today is the default because it is the only screen that answers the question
 * you unlock the phone already asking. Capture and Week are destinations you
 * go to on purpose.
 *
 * The bridge is chosen HERE and nowhere else — the iCloud plugin on device,
 * `localBridge` in a browser — because every screen below takes the store,
 * not the bridge, and none of them can tell the difference.
 */
export function App({ store: injected }: { store?: PhoneStore } = {}) {
  const [store] = useState(
    () => injected ?? createPhoneStore(Capacitor.isNativePlatform() ? createICloudBridge() : createLocalBridge()),
  );
  const [tab, setTab] = useState<Tab>('today');

  useEffect(() => {
    void store.refresh();
  }, [store]);

  return (
    <div className="min-h-full flex flex-col">
      <main className="flex-1 min-h-0 overflow-y-auto pb-[12px]">
        {tab === 'today' && <Today store={store} />}
        {tab === 'capture' && <Capture store={store} />}
        {tab === 'week' && <Week store={store} />}
      </main>

      {/* Above the nav and below the scroller, so it is the last thing before
          your thumb and it never scrolls out of reach of the screen it is
          reporting on. It draws nothing when the sync is healthy. */}
      <SyncBar store={store} />

      {/* The bar is a rule with cells on it, the same object every other
          heading in this product is — not a floating pill. */}
      <nav className="flex-none flex border-t border-line bg-panel" aria-label="Screens">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            className={`flex-1 h-[52px] text-ui ${
              tab === id ? 'text-ink font-semibold' : 'text-muted'
            }`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
