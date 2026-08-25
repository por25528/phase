import { useEffect, useState } from 'react';
import { createLocalBridge } from './bridge/localBridge';
import { createPhoneStore, type PhoneStore } from './state/phoneStore';
import { Today } from './views/Today';

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
 * The bridge is chosen HERE and nowhere else — `localBridge` today, the iCloud
 * plugin once the native shell exists — because every screen below takes the
 * store, not the bridge, and none of them can tell the difference.
 */
export function App({ store: injected }: { store?: PhoneStore } = {}) {
  const [store] = useState(() => injected ?? createPhoneStore(createLocalBridge()));
  const [tab, setTab] = useState<Tab>('today');

  useEffect(() => {
    void store.refresh();
  }, [store]);

  return (
    <div className="min-h-full flex flex-col">
      <main className="flex-1 min-h-0 overflow-y-auto pb-[12px]">
        {tab === 'today' && <Today store={store} />}
        {tab !== 'today' && (
          <p className="px-[18px] py-[22px] text-body text-muted">Coming next.</p>
        )}
      </main>

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
