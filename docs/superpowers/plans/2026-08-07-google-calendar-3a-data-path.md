# Google Calendar — the renderer data path (3a of 3)

> **SHELVED 2026-08-07 — do not execute this plan.** The Google Calendar
> integration was stopped before this slice began: the setup burden (a Google
> Cloud project, a consent screen, pasted OAuth credentials) is too much to ask
> of a user for what it returns. Plans 1 and 2 are built and committed; the
> producer sits in `electron/` and nothing calls it. This document is kept
> because the analysis in it is still true — in particular that the renderer is
> almost entirely pre-wired, and that ten `blocks: []` literals are the whole
> data path. If the feature is ever revived, start here.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make real Google busy time flow from the Electron producer into the renderer's capacity arithmetic and week grid, so `⌘N` and auto-placement stop dropping work on top of meetings.

**Architecture:** A thin typed accessor for `window.phaseCalendar`, a pure provenance check that decides whether a cached range may be believed, four store fields hydrated at boot and replaced wholesale on a successful fetch, and the replacement of ten hardcoded `blocks: []` literals with that state. No new arithmetic: `capacity.ts`, `slot.ts` and `busyLayout.ts` already take `blocks` and are already tested against it.

**Tech Stack:** React 19, TypeScript, Vite, Dexie/IndexedDB, Vitest + Testing Library, `useSyncExternalStore` store.

## Global Constraints

- **Nothing in `electron/` changes.** Plan 2 is finished and verified. If a handler looks wrong, stop and report — do not edit across the seam.
- **`src/db/calendarCache.ts` is the only module that touches the `calendarCache` table.** Never call `db.calendarCache` directly.
- **Every calendar write goes through `ifOwner`.** A tab that does not hold the Web Lock never writes at all. Refreshing is gated on ownership too, not merely the write.
- **`calendarCache` stays outside `AppState` and outside `persist()`.** `persist` is a full clear + bulkPut of the four app-data tables; a block array in there would be rewritten on every checkbox tick.
- **No block is ever mutated.** `busyBlocks` is read-only derived state, replaced wholesale. No action edits a block.
- **Visual identity is locked.** This plan adds information, not styling. No new colours, no new components. `designScale.test.ts` fails the build on a literal hex and on an arbitrary `text-[Nrem]`.
- **`allDayBlocks` is NOT provenance.** All-day blocks are always cached; the preference is applied at read time. Toggling it must never trigger a refetch.
- **Half-open ranges throughout.** `rangeEnd` is EXCLUSIVE, matching `DateRange`, `CalendarCache` and `NormalizeOptions`.
- Run `npm test` and `npx tsc -b` before every commit.

## What plans 1 and 2 already provide

Do not rebuild any of this.

`src/lib/calendarRange.ts`:

```ts
export interface DateRange { rangeStart: string; rangeEnd: string }
export const BASE_BACK_DAYS = 7;
export const BASE_FORWARD_DAYS = 56;
export const MAX_FORWARD_DAYS = 182;
export function fetchRange(mondayOfCurrentWeek: string, visitedMonday: string, previousEnd?: string): DateRange
export function coversWeek(range: DateRange, monday: string): boolean
```

`src/db/calendarCache.ts`:

```ts
export async function loadCalendarCache(): Promise<CalendarCache | undefined>
export async function saveCalendarCache(cache: CalendarCache): Promise<void>
export async function clearCalendarCache(): Promise<void>
```

`src/db/types.ts` defines `BusyBlock` and `CalendarCache` (with `accountId`, `calendarIds`, `timeZone` as provenance). `src/lib/capacity.ts` exposes `weekCapacity(input: CapacityInput)` whose `CapacityInput` already carries `blocks: BusyBlock[]` and `hasData: boolean`. `src/lib/slot.ts` exposes `freeIntervals`, `resolveSlot`, `clampResize`, all taking `blocks`. `src/lib/busyLayout.ts` exposes `dayBusySpans` and is **already wired into `DayBlocks.tsx`** — the two historical defects there are fixed. `src/views/plan/capacityLabel.ts` exposes `isOverCommitted`.

The preload exposes exactly seven methods on `window.phaseCalendar`: `status`, `configure`, `connect`, `disconnect`, `listCalendars`, `reset`, `fetch`.

## What this plan deliberately does NOT do

Named so a reviewer does not read them as omissions. All of these are **plan 3b**:

- **No settings UI.** No credentials field, no Connect button, no calendar picker, no Refresh button, no `fetched at` label, and the `allDayBlocks` checkbox stays out of `AvailabilitySettings.tsx`. Until 3b lands, the only way to connect is the devtools console, exactly as in plan 2.
- **No calendar picker.** This plan introduces the `calendarIds` setting with a default of `['primary']` so the fetch path is runnable and testable; 3b builds the UI that edits it.
- **No staleness label and no `capacityNote` copy.** The state this plan stores (`calendarFetchedAt`, `hasData`) is what 3b renders.
- **No all-day lane.** An all-day event still renders as a full-height span; the lane is the grid remaster's business.

## The one decision this plan makes

**A provenance mismatch discards the blocks from memory but leaves the row on disk.**

The alternative — calling `clearCalendarCache()` the moment provenance disagrees — loses good data to a transient failure. `status()` crosses an IPC boundary and can fail for reasons that have nothing to do with the account: the keychain being locked, the handler throwing, the app mid-quit. If a failed `status()` were allowed to delete the cache, a user who opened Phase while the OS keychain was still unlocking would silently lose a fetched fortnight and see every day render as fully free.

So: `usableCache` returns `null` and the renderer shows the window-derived figure with `hasData: false`. The row stays. The next boot re-evaluates it, and if provenance agrees again, it is believed again. A stale row that is never displayed is inert, exactly as an orphaned asset blob is inert.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/calendarBridge.ts` + `.test.ts` | typed, total accessor for `window.phaseCalendar` | 1 |
| `src/lib/calendarCacheState.ts` + `.test.ts` | pure provenance check; decides whether a cache may be believed | 2 |
| `src/db/db.ts` | `loadCalendarIds` / `saveCalendarIds` over the `settings` table | 3 |
| `src/state/store.ts` | four new UI fields, hydration, `refreshCalendar`, the eight slot call sites | 3–5 |
| `src/views/plan/useCalendarRefresh.ts` + `.test.ts` | the four fetch triggers | 6 |
| `src/views/Plan.tsx` | real `blocks` and `hasData` into `weekCapacity` and `DayBlocks` | 7 |

---

### Task 1: The calendar bridge

**Files:**
- Create: `src/lib/calendarBridge.ts`
- Test: `src/lib/calendarBridge.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `calendarBridge(): CalendarBridge | null`, plus the types `CalendarStatus`, `CalendarFetchResult`, `CalendarFetchFailure`, `CalendarSummary`, `CalendarBridge`.

Phase runs in two places: Electron, where the preload ran, and a plain browser under `npm run dev`, where it did not. Every caller must handle absence, and the cheapest way to guarantee that is to make absence a `null` return rather than a property access that throws at the first `await`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/calendarBridge.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { calendarBridge } from './calendarBridge';

function fakeBridge() {
  return {
    status: async () => ({
      configured: true, connected: true, available: true, corrupt: false,
      accountId: 'a@example.com', timeZone: 'America/New_York',
    }),
    configure: async () => {},
    connect: async () => ({ ok: true as const }),
    disconnect: async () => {},
    listCalendars: async () => [],
    reset: async () => {},
    fetch: async () => ({ ok: false as const, reason: 'not-connected' as const }),
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).phaseCalendar;
});

describe('calendarBridge', () => {
  it('is null in a browser, where the preload never ran', () => {
    expect(calendarBridge()).toBeNull();
  });

  it('returns the bridge the preload exposed', () => {
    const fake = fakeBridge();
    (globalThis as Record<string, unknown>).phaseCalendar = fake;
    expect(calendarBridge()).toBe(fake);
  });

  // The discriminating test. A half-built bridge must be rejected HERE, not at
  // the first `await bridge.fetch(...)` deep inside a refresh, where the
  // failure would surface as an unhandled rejection with no useful message.
  it('rejects a partial bridge rather than failing at the first call', () => {
    (globalThis as Record<string, unknown>).phaseCalendar = { status: async () => ({}) };
    expect(calendarBridge()).toBeNull();
  });

  it('rejects a non-object', () => {
    (globalThis as Record<string, unknown>).phaseCalendar = 'nope';
    expect(calendarBridge()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/calendarBridge.test.ts
```

Expected: FAIL — `Failed to resolve import "./calendarBridge"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/calendarBridge.ts`:

```ts
import type { BusyBlock } from '../db/types';

/**
 * The renderer's view of the producer. These types MUST stay identical to
 * `electron/calendarIpc.d.cts`; the two sides cannot import from each other —
 * main is CJS under Node, the renderer is ESM under Vite — so the duplication
 * is deliberate. Change one, change the other.
 */
export interface CalendarStatus {
  configured: boolean;
  connected: boolean;
  /** False when the OS keychain is unavailable; secret writes will fail. */
  available: boolean;
  /** The store exists but cannot be decrypted; 3b offers a reset. */
  corrupt: boolean;
  /** Provenance only — the Google account's primary calendar id. Never a credential. */
  accountId: string | null;
  timeZone: string;
}

export interface CalendarSummary {
  id: string;
  summary: string;
  primary: boolean;
}

export type CalendarConnectResult =
  | { ok: true }
  | { ok: false; reason: 'not-configured' | 'reauth-required' | 'request-failed' | 'cancelled' };

export type CalendarFetchFailure =
  | 'not-configured'
  | 'not-connected'
  | 'reauth-required'
  | 'invalid-range'
  | 'no-calendars'
  | 'corrupt'
  | 'invalid-time-zone'
  | 'malformed-data'
  | 'request-failed';

export type CalendarFetchResult =
  | { ok: true; blocks: BusyBlock[]; fetchedAt: string; accountId: string | null; timeZone: string }
  | { ok: false; reason: CalendarFetchFailure };

export interface CalendarBridge {
  status(): Promise<CalendarStatus>;
  configure(input: { clientId: string; clientSecret: string }): Promise<void>;
  connect(): Promise<CalendarConnectResult>;
  disconnect(): Promise<void>;
  listCalendars(): Promise<CalendarSummary[]>;
  reset(): Promise<void>;
  fetch(input: { rangeStart: string; rangeEnd: string; calendarIds: string[] }): Promise<CalendarFetchResult>;
}

const METHODS = [
  'status', 'configure', 'connect', 'disconnect', 'listCalendars', 'reset', 'fetch',
] as const;

/**
 * The bridge, or `null` in a plain browser where the preload never ran.
 *
 * Absence is a `null` return rather than a throwing property access so every
 * caller is forced by the type to handle the browser case. The completeness
 * check is not paranoia: a partial bridge would otherwise fail at the first
 * `await` inside a refresh, as an unhandled rejection with no useful message.
 */
export function calendarBridge(): CalendarBridge | null {
  const raw = (globalThis as { phaseCalendar?: unknown }).phaseCalendar;
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  return METHODS.every((m) => typeof obj[m] === 'function') ? (raw as CalendarBridge) : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/calendarBridge.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the completeness test discriminates**

Temporarily change the last line of `calendarBridge` to `return raw as CalendarBridge;`. Re-run.

Expected: "rejects a partial bridge" and "rejects a non-object" both FAIL. Revert.

- [ ] **Step 6: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
git add src/lib/calendarBridge.ts src/lib/calendarBridge.test.ts
git commit -m "feat(calendar): a typed door from the renderer to the producer"
```

---

### Task 2: Provenance — when a cache may be believed

**Files:**
- Create: `src/lib/calendarCacheState.ts`
- Test: `src/lib/calendarCacheState.test.ts`

**Interfaces:**
- Consumes: `CalendarCache`, `BusyBlock` from `src/db/types`.
- Produces: `interface CalendarProvenance { accountId: string; calendarIds: string[]; timeZone: string }` and `usableCache(cache: CalendarCache | undefined, current: CalendarProvenance | null): CalendarCache | null`.

Without this, an account switch, a changed calendar selection or a machine timezone change leaves stale blocks rendering as current fact — the one failure this feature must never produce, because a block that is not really there reads as free time that is not really free.

- [ ] **Step 1: Write the failing test**

Create `src/lib/calendarCacheState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { CalendarCache } from '../db/types';
import { usableCache, type CalendarProvenance } from './calendarCacheState';

const CACHE: CalendarCache = {
  rangeStart: '2026-07-27',
  rangeEnd: '2026-09-28',
  blocks: [{ date: '2026-08-03', startMin: 540, endMin: 600, title: 'standup', allDay: false }],
  fetchedAt: '2026-08-03T13:00:00.000Z',
  accountId: 'me@example.com',
  calendarIds: ['primary', 'work@example.com'],
  timeZone: 'America/New_York',
};

const NOW: CalendarProvenance = {
  accountId: 'me@example.com',
  calendarIds: ['primary', 'work@example.com'],
  timeZone: 'America/New_York',
};

describe('usableCache', () => {
  it('believes a cache whose provenance matches', () => {
    expect(usableCache(CACHE, NOW)).toBe(CACHE);
  });

  it('discards a cache from a different account', () => {
    expect(usableCache(CACHE, { ...NOW, accountId: 'other@example.com' })).toBeNull();
  });

  it('discards a cache flattened against a different timezone', () => {
    expect(usableCache(CACHE, { ...NOW, timeZone: 'Europe/London' })).toBeNull();
  });

  it('discards a cache when a calendar was added to the selection', () => {
    expect(usableCache(CACHE, { ...NOW, calendarIds: ['primary', 'work@example.com', 'gym'] })).toBeNull();
  });

  it('discards a cache when a calendar was removed from the selection', () => {
    expect(usableCache(CACHE, { ...NOW, calendarIds: ['primary'] })).toBeNull();
  });

  // Order is presentation, not identity. Re-ordering the picker must not throw
  // away a good fortnight of data and trigger a refetch for nothing.
  it('ignores the order of the calendar ids', () => {
    expect(usableCache(CACHE, { ...NOW, calendarIds: ['work@example.com', 'primary'] })).toBe(CACHE);
  });

  it('discards everything when disconnected', () => {
    expect(usableCache(CACHE, null)).toBeNull();
  });

  it('has nothing to believe when no cache was ever written', () => {
    expect(usableCache(undefined, NOW)).toBeNull();
  });

  // A duplicate must not make two different selections compare equal.
  it('does not confuse a duplicated id with a distinct one', () => {
    const dup = { ...CACHE, calendarIds: ['primary', 'primary'] };
    expect(usableCache(dup, { ...NOW, calendarIds: ['primary', 'work@example.com'] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/calendarCacheState.test.ts
```

Expected: FAIL — `Failed to resolve import "./calendarCacheState"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/calendarCacheState.ts`:

```ts
import type { CalendarCache } from '../db/types';

/** Current reality, to be compared against what the cache recorded. */
export interface CalendarProvenance {
  accountId: string;
  calendarIds: string[];
  timeZone: string;
}

/**
 * Compare as multisets: order is presentation, but a duplicate is a real
 * difference. Sorting copies rather than the arguments — `calendarIds` on a
 * live cache row must not be reordered underneath its owner.
 */
function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((id, i) => id === y[i]);
}

/**
 * The cache if it may be believed, otherwise `null`.
 *
 * `current` is `null` when nothing is connected, which discards everything.
 *
 * A mismatch does NOT delete the row — see the plan's "one decision". `status()`
 * crosses an IPC boundary and can fail for reasons unrelated to the account, and
 * deleting on a transient failure would silently lose a fetched fortnight.
 * An undisplayed row is inert.
 *
 * `allDayBlocks` is deliberately absent: all-day blocks are always cached and
 * the preference is applied at read time, so toggling it never refetches.
 */
export function usableCache(
  cache: CalendarCache | undefined,
  current: CalendarProvenance | null,
): CalendarCache | null {
  if (!cache || !current) return null;
  if (cache.accountId !== current.accountId) return null;
  if (cache.timeZone !== current.timeZone) return null;
  if (!sameIds(cache.calendarIds, current.calendarIds)) return null;
  return cache;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/calendarCacheState.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the multiset test discriminates**

Temporarily replace `sameIds`' body with `return new Set(a).size === new Set(b).size && [...new Set(a)].every((id) => b.includes(id));`. Re-run.

Expected: "does not confuse a duplicated id with a distinct one" FAILS. Revert.

- [ ] **Step 6: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
git add src/lib/calendarCacheState.ts src/lib/calendarCacheState.test.ts
git commit -m "feat(calendar): decide when a cached range may still be believed"
```

---

### Task 3: Store state and boot hydration

**Files:**
- Modify: `src/db/db.ts` (add `loadCalendarIds` / `saveCalendarIds` beside `loadAllDayBlocks` / `saveAllDayBlocks`, around line 141-148)
- Modify: `src/state/store.ts` (`UIState` around line 99; initial `state` around line 130; `initStore` around line 448-503)
- Modify: `src/state/store.test.ts` (extend `dbMocks`, add a `calendarCache` mock and a bridge helper)

**Interfaces:**
- Consumes: `calendarBridge()` (Task 1), `usableCache` (Task 2), `loadCalendarCache` from `src/db/calendarCache`.
- Produces: store fields `busyBlocks: BusyBlock[]`, `calendarRange: DateRange | null`, `calendarFetchedAt: string | null`, `calendarStatus: CalendarStatus | null`, `calendarIds: string[]`; db functions `loadCalendarIds(): Promise<string[]>` and `saveCalendarIds(ids: string[]): Promise<void>`.

`calendarIds` defaults to `['primary']` so the fetch path in Task 5 is runnable before 3b builds the picker.

- [ ] **Step 1: Write the failing test**

`src/state/store.test.ts` mocks `../db/db` wholesale with `vi.hoisted`, so a new export must be added to `dbMocks` or every import breaks. Add to the `dbMocks` object (beside `loadAllDayBlocks`):

```ts
  loadCalendarIds: vi.fn(async () => ['primary']),
  saveCalendarIds: vi.fn(async () => {}),
```

Add a new mock module beside the existing `vi.mock('../db/db', ...)`:

```ts
const calendarCacheMocks = vi.hoisted(() => ({
  loadCalendarCache: vi.fn(async () => undefined as CalendarCache | undefined),
  saveCalendarCache: vi.fn(async () => {}),
  clearCalendarCache: vi.fn(async () => {}),
}));

vi.mock('../db/calendarCache', () => calendarCacheMocks);
```

Add `CalendarCache` and `BusyBlock` to the existing `import type { ... } from '../db/types'` line.

Add this helper near the top of the file, after the mocks:

```ts
const TZ = 'America/New_York';

function installBridge(over: Record<string, unknown> = {}) {
  const bridge = {
    status: vi.fn(async () => ({
      configured: true, connected: true, available: true, corrupt: false,
      accountId: 'me@example.com', timeZone: TZ,
    })),
    configure: vi.fn(async () => {}),
    connect: vi.fn(async () => ({ ok: true })),
    disconnect: vi.fn(async () => {}),
    listCalendars: vi.fn(async () => []),
    reset: vi.fn(async () => {}),
    fetch: vi.fn(async () => ({ ok: false, reason: 'not-connected' })),
    ...over,
  };
  (globalThis as Record<string, unknown>).phaseCalendar = bridge;
  return bridge;
}
```

Make sure the file's existing `afterEach` also runs `delete (globalThis as Record<string, unknown>).phaseCalendar;`.

Now add this describe block:

```ts
describe('calendar hydration', () => {
  const CACHE: CalendarCache = {
    rangeStart: '2026-07-27',
    rangeEnd: '2026-09-28',
    blocks: [{ date: '2026-08-03', startMin: 540, endMin: 600, title: 'standup', allDay: false }],
    fetchedAt: '2026-08-03T13:00:00.000Z',
    accountId: 'me@example.com',
    calendarIds: ['primary'],
    timeZone: TZ,
  };

  it('believes a cache whose provenance matches the connected account', async () => {
    installBridge();
    calendarCacheMocks.loadCalendarCache.mockResolvedValueOnce(CACHE);
    const store = await freshStore();
    await store.initStore();

    const s = store.getState();
    expect(s.busyBlocks).toHaveLength(1);
    expect(s.calendarRange).toEqual({ rangeStart: '2026-07-27', rangeEnd: '2026-09-28' });
    expect(s.calendarFetchedAt).toBe('2026-08-03T13:00:00.000Z');
    expect(s.calendarStatus?.connected).toBe(true);
  });

  it('discards a cache from another account without deleting the row', async () => {
    installBridge({
      status: vi.fn(async () => ({
        configured: true, connected: true, available: true, corrupt: false,
        accountId: 'someone-else@example.com', timeZone: TZ,
      })),
    });
    calendarCacheMocks.loadCalendarCache.mockResolvedValueOnce(CACHE);
    const store = await freshStore();
    await store.initStore();

    expect(store.getState().busyBlocks).toEqual([]);
    expect(store.getState().calendarRange).toBeNull();
    expect(calendarCacheMocks.clearCalendarCache).not.toHaveBeenCalled();
  });

  // The discriminating test for the "don't delete on failure" decision.
  it('survives a producer that throws, with no blocks and no deletion', async () => {
    installBridge({ status: vi.fn(async () => { throw new Error('keychain locked'); }) });
    calendarCacheMocks.loadCalendarCache.mockResolvedValueOnce(CACHE);
    const store = await freshStore();
    await store.initStore();

    expect(store.getState().hydration).toBe('ready');
    expect(store.getState().busyBlocks).toEqual([]);
    expect(calendarCacheMocks.clearCalendarCache).not.toHaveBeenCalled();
  });

  it('hydrates cleanly in a browser, where there is no bridge at all', async () => {
    calendarCacheMocks.loadCalendarCache.mockResolvedValueOnce(CACHE);
    const store = await freshStore();
    await store.initStore();

    expect(store.getState().hydration).toBe('ready');
    expect(store.getState().calendarStatus).toBeNull();
    expect(store.getState().busyBlocks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/state/store.test.ts -t "calendar hydration"
```

Expected: FAIL — `busyBlocks` is not a property of the state.

- [ ] **Step 3: Add the settings accessors**

In `src/db/db.ts`, immediately after `saveAllDayBlocks` (around line 148):

```ts
const CALENDAR_IDS_KEY = 'calendarPrefs';

/** Which calendars a fetch queries. `['primary']` until 3b builds the picker. */
export async function loadCalendarIds(): Promise<string[]> {
  const row = await db.settings.get(CALENDAR_IDS_KEY);
  if (!row) return ['primary'];
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return ['primary'];
    const ids = parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
    return ids.length > 0 ? ids : ['primary'];
  } catch {
    return ['primary'];
  }
}

export async function saveCalendarIds(ids: string[]): Promise<void> {
  await db.settings.put({ key: CALENDAR_IDS_KEY, value: JSON.stringify(ids) });
}
```

- [ ] **Step 4: Add the store fields**

In `src/state/store.ts`, add to `UIState` after `activeHorizon` (line 99):

```ts
  // Calendar — read-only derived state. Hydrated from the device-local cache at
  // boot, replaced wholesale on a successful fetch. No action mutates a block.
  busyBlocks: BusyBlock[];
  calendarRange: DateRange | null;   // what the cached blocks actually cover
  calendarFetchedAt: string | null;  // ISO instant; drives the 15-minute refresh
  calendarStatus: CalendarStatus | null; // null in a browser, or when status() failed
  calendarIds: string[];             // which calendars a fetch queries
```

Add to the initial `state` literal after `activeHorizon: 0` (line 130):

```ts
  busyBlocks: [],
  calendarRange: null,
  calendarFetchedAt: null,
  calendarStatus: null,
  calendarIds: ['primary'],
```

Add the imports at the top of the file:

```ts
import type { BusyBlock, CalendarCache } from '../db/types';
import type { DateRange } from '../lib/calendarRange';
import { calendarBridge, type CalendarStatus } from '../lib/calendarBridge';
import { usableCache } from '../lib/calendarCacheState';
import { loadCalendarCache, saveCalendarCache } from '../db/calendarCache';
import { loadCalendarIds, saveCalendarIds } from '../db/db';
```

Fold `BusyBlock` / `CalendarCache` into the existing `import type ... from '../db/types'` line and `loadCalendarIds` / `saveCalendarIds` into the existing `from '../db/db'` import rather than adding duplicate statements.

- [ ] **Step 5: Hydrate at boot**

In `initStore`, add `loadCalendarIds()` and `loadCalendarCache()` to the existing `Promise.all` (line 448):

```ts
    const [
      appState, pxPerDay, planReview, availability, allDayBlocks, sidebarPanels,
      calendarIds, cachedCalendar,
    ] = await Promise.all([
      /* ...existing calls, unchanged... */
      loadCalendarIds(),
      loadCalendarCache(),
    ]);
```

Add this helper above `initStore`:

```ts
/**
 * The producer's current status, or `null` if there is no producer or it could
 * not answer. Never throws: a calendar that cannot be reached must not fail
 * hydration, because every other thing Phase does still works without it.
 */
async function readCalendarStatus(): Promise<CalendarStatus | null> {
  const bridge = calendarBridge();
  if (!bridge) return null;
  try {
    return await bridge.status();
  } catch {
    return null;
  }
}

/** The provenance to compare a cache against, or `null` when nothing is connected. */
function currentProvenance(
  status: CalendarStatus | null,
  calendarIds: string[],
): { accountId: string; calendarIds: string[]; timeZone: string } | null {
  if (!status || !status.connected || !status.accountId) return null;
  return { accountId: status.accountId, calendarIds, timeZone: status.timeZone };
}

/** The four calendar fields implied by a cache row and the live status. */
function calendarFields(
  cache: CalendarCache | undefined,
  status: CalendarStatus | null,
  calendarIds: string[],
): Pick<UIState, 'busyBlocks' | 'calendarRange' | 'calendarFetchedAt' | 'calendarStatus'> {
  const usable = usableCache(cache, currentProvenance(status, calendarIds));
  return {
    busyBlocks: usable ? usable.blocks : [],
    calendarRange: usable ? { rangeStart: usable.rangeStart, rangeEnd: usable.rangeEnd } : null,
    calendarFetchedAt: usable ? usable.fetchedAt : null,
    calendarStatus: status,
  };
}
```

Then, just before the `set({ ... hydration: 'ready' })` call (line 503), read the status, and include the fields in that same `set`:

```ts
    const calendarStatus = await readCalendarStatus();
```

and inside the `set({ ... })` literal, alongside `allDayBlocks,`:

```ts
      calendarIds,
      ...calendarFields(cachedCalendar, calendarStatus, calendarIds),
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx vitest run src/state/store.test.ts -t "calendar hydration"
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Prove the failure-tolerance test discriminates**

Temporarily remove the `try/catch` in `readCalendarStatus`, returning `await bridge.status()` directly. Re-run.

Expected: "survives a producer that throws" FAILS — `initStore` sets `hydration: 'error'`. Revert.

- [ ] **Step 8: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
git add src/db/db.ts src/state/store.ts src/state/store.test.ts
git commit -m "feat(calendar): hydrate the device-local cache at boot"
```

---

### Task 4: Let the blocks reach slot placement

**Files:**
- Modify: `src/state/store.ts` — eight literals: lines 700, 1724, 1732, 1760, 1766, 1807, 1883, 1906
- Modify: `src/state/store.test.ts`

**Interfaces:**
- Consumes: `state.busyBlocks` (Task 3).
- Produces: nothing new. This is the task that makes the feature *do* something.

All eight are `clampResize` / `resolveSlot` / `freeIntervals` calls. Two of them — 1732 and 1766 — are the `freeIntervals` calls behind slot resolution, so once blocks flow, `⌘N` and auto-placement stop dropping work on top of meetings. Note that 1732 and 1766 pass `blocks` **positionally** (third argument), not as a named property.

- [ ] **Step 1: Write the failing test**

Add to `src/state/store.test.ts`. Use whatever helper the file already uses to seed a goal with a leaf; the assertion is what matters.

This mirrors the existing `describe('scheduleNode / unscheduleNode', ...)` block at `src/state/store.test.ts:931`, which is the pattern to copy: `freshStore()`, `addGoal`, `addRootNode`, `setNodeEstimate`, then `scheduleNode(gid, nid, day, aimMin)` — which returns a boolean.

`'2026-08-05'` is a Wednesday, so the module default availability (Mon–Fri 09:00–18:00) covers it, and the system time is set to that morning so `now` never clamps the window.

```ts
describe('slot placement respects calendar busy time', () => {
  function cacheWith(blocks: BusyBlock[]): CalendarCache {
    return {
      rangeStart: '2026-08-03',
      rangeEnd: '2026-08-10',
      blocks,
      fetchedAt: '2026-08-03T13:00:00.000Z',
      accountId: 'me@example.com',
      calendarIds: ['primary'],
      timeZone: TZ,
    };
  }

  it('does not place a step on top of a meeting', async () => {
    vi.setSystemTime(new Date(2026, 7, 5, 8));
    installBridge();
    // 09:00-13:00 is booked solid.
    calendarCacheMocks.loadCalendarCache.mockResolvedValueOnce(
      cacheWith([{ date: '2026-08-05', startMin: 540, endMin: 780, title: 'offsite', allDay: false }]),
    );
    const store = await freshStore();
    await store.initStore();
    expect(store.getState().busyBlocks).toHaveLength(1);

    store.actions.addGoal('G');
    const gid = store.getState().goals[0].id;
    store.actions.addRootNode(gid, 'leaf');
    const nid = store.getState().goals[0].nodes[0].id;
    store.actions.setNodeEstimate(nid, 60);

    // Aim at 09:00 — squarely inside the meeting.
    expect(store.actions.scheduleNode(gid, nid, '2026-08-05', 540)).toBe(true);

    // The earliest gap that fits now starts when the offsite ends.
    expect(store.getState().goals[0].nodes[0].plannedStartMin).toBeGreaterThanOrEqual(780);
  });

  it('refuses the day when the calendar leaves no room at all', async () => {
    vi.setSystemTime(new Date(2026, 7, 5, 8));
    installBridge();
    calendarCacheMocks.loadCalendarCache.mockResolvedValueOnce(
      cacheWith([{ date: '2026-08-05', startMin: 0, endMin: 1440, title: 'conference', allDay: false }]),
    );
    const store = await freshStore();
    await store.initStore();

    store.actions.addGoal('G');
    const gid = store.getState().goals[0].id;
    store.actions.addRootNode(gid, 'leaf');
    const nid = store.getState().goals[0].nodes[0].id;
    store.actions.setNodeEstimate(nid, 60);

    expect(store.actions.scheduleNode(gid, nid, '2026-08-05', 540)).toBe(false);
    expect(store.getState().goals[0].nodes[0].plannedDay).toBeUndefined();
    // The refusal must describe the REAL longest stretch, which is now zero —
    // this is what Step 5 below proves depends on line 1732.
    expect(store.getState().toast).toMatch(/^No 1h gap left that day/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/state/store.test.ts -t "respects calendar busy time"
```

Expected: FAIL — the step lands at the start of the availability window, because `blocks: []` is still hardcoded.

- [ ] **Step 3: Replace all eight literals**

At lines 700, 1724, 1760, 1807, 1883 and 1906, replace the property:

```ts
      blocks: [],
```

with:

```ts
      blocks: state.busyBlocks,
```

At line 1724 also delete the now-false comment `// slice 2 supplies real busy blocks`.

At lines 1732 and 1766 the argument is **positional**. Replace:

```ts
      const gaps = freeIntervals(day, state.availability, [], placed, now, state.allDayBlocks);
```

with:

```ts
      const gaps = freeIntervals(day, state.availability, state.busyBlocks, placed, now, state.allDayBlocks);
```

and the same for the `date` variant at 1766. These two matter: the refusal message must describe the gaps the search was actually allowed to use, or the toast will offer a slot the placement just rejected.

Verify none remain:

```bash
grep -n "blocks: \[\]" src/state/store.ts
grep -n "state.availability, \[\]" src/state/store.ts
```

Both must be empty.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/state/store.test.ts
```

Expected: PASS. If a pre-existing placement test now fails, read it — it may have been asserting against an implicitly empty calendar, in which case the fixture needs a `busyBlocks` of `[]`, which is already the default. A genuine failure here means a call site got the wrong variable.

- [ ] **Step 5: Prove the refusal-message site matters**

Temporarily revert only line 1732 back to `[]`. Re-run the "refuses the day" test.

Expected: it still refuses, but the toast now describes a gap inside the conference. Confirm by reading the toast text, then revert.

- [ ] **Step 6: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(calendar): stop dropping work on top of meetings"
```

---

### Task 5: The refresh action

**Files:**
- Modify: `src/state/store.ts` (`actions` object, around line 758)
- Modify: `src/state/store.test.ts`

**Interfaces:**
- Consumes: `fetchRange` from `src/lib/calendarRange`, `weekOf` from `src/lib/plan`, `todayStr` from `src/lib/dates`, `saveCalendarCache`, `calendarBridge`, `calendarFields` (Task 3).
- Produces: `actions.refreshCalendar(visitedWeek?: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('refreshCalendar', () => {
  const OK = {
    ok: true as const,
    blocks: [{ date: '2026-08-05', startMin: 540, endMin: 600, title: 'standup', allDay: false }],
    fetchedAt: '2026-08-05T12:00:00.000Z',
    accountId: 'me@example.com',
    timeZone: TZ,
  };

  it('fetches the anchored range and stores the blocks with their provenance', async () => {
    const bridge = installBridge({ fetch: vi.fn(async () => OK) });
    const store = await freshStore();
    await store.initStore();

    await store.actions.refreshCalendar();

    expect(bridge.fetch).toHaveBeenCalledTimes(1);
    const input = bridge.fetch.mock.calls[0][0];
    expect(input.calendarIds).toEqual(['primary']);
    expect(input.rangeStart < input.rangeEnd).toBe(true);

    expect(store.getState().busyBlocks).toHaveLength(1);
    expect(store.getState().calendarFetchedAt).toBe('2026-08-05T12:00:00.000Z');
    expect(calendarCacheMocks.saveCalendarCache).toHaveBeenCalledTimes(1);
    const saved = calendarCacheMocks.saveCalendarCache.mock.calls[0][0];
    expect(saved.accountId).toBe('me@example.com');
    expect(saved.timeZone).toBe(TZ);
    expect(saved.calendarIds).toEqual(['primary']);
    expect(saved.rangeStart).toBe(input.rangeStart);
    expect(saved.rangeEnd).toBe(input.rangeEnd);
  });

  it('does nothing at all in a browser', async () => {
    const store = await freshStore();
    await store.initStore();

    await store.actions.refreshCalendar();

    expect(calendarCacheMocks.saveCalendarCache).not.toHaveBeenCalled();
  });

  it('does not fetch when nothing is connected', async () => {
    const bridge = installBridge({
      status: vi.fn(async () => ({
        configured: true, connected: false, available: true, corrupt: false,
        accountId: null, timeZone: TZ,
      })),
    });
    const store = await freshStore();
    await store.initStore();

    await store.actions.refreshCalendar();

    expect(bridge.fetch).not.toHaveBeenCalled();
    expect(store.getState().busyBlocks).toEqual([]);
  });

  // The discriminating test. A failed refresh must not present a booked week as free.
  it('keeps the blocks it already had when a refresh fails', async () => {
    const bridge = installBridge({ fetch: vi.fn(async () => OK) });
    const store = await freshStore();
    await store.initStore();
    await store.actions.refreshCalendar();
    expect(store.getState().busyBlocks).toHaveLength(1);

    bridge.fetch.mockResolvedValueOnce({ ok: false, reason: 'request-failed' });
    await store.actions.refreshCalendar();

    expect(store.getState().busyBlocks).toHaveLength(1);
    expect(calendarCacheMocks.saveCalendarCache).toHaveBeenCalledTimes(1);
  });

  it('drops the blocks when the account went away', async () => {
    const bridge = installBridge({ fetch: vi.fn(async () => OK) });
    const store = await freshStore();
    await store.initStore();
    await store.actions.refreshCalendar();

    bridge.fetch.mockResolvedValueOnce({ ok: false, reason: 'not-connected' });
    await store.actions.refreshCalendar();

    expect(store.getState().busyBlocks).toEqual([]);
  });

  it('extends the range forward for a week beyond the base window', async () => {
    const bridge = installBridge({ fetch: vi.fn(async () => OK) });
    const store = await freshStore();
    await store.initStore();

    await store.actions.refreshCalendar();
    const base = bridge.fetch.mock.calls[0][0].rangeEnd;

    const { weekOf } = await import('../lib/plan');
    const { todayStr, addDays } = await import('../lib/dates');
    await store.actions.refreshCalendar(weekOf(addDays(todayStr(), 120)));
    const extended = bridge.fetch.mock.calls[1][0].rangeEnd;

    expect(extended > base).toBe(true);
  });

  // Ownership is checked BEFORE the fetch, not merely before the write: a second
  // tab must not spend a Google quota or race the owner's cache row.
  it('a tab that does not own the lock never fetches', async () => {
    const bridge = installBridge({ fetch: vi.fn(async () => OK) });
    tabLockMocks.acquireTabLock.mockResolvedValueOnce(false);
    const store = await freshStore();
    await store.initStore();
    expect(store.getState().secondTab).toBe(true);

    await store.actions.refreshCalendar();

    expect(bridge.fetch).not.toHaveBeenCalled();
    expect(calendarCacheMocks.saveCalendarCache).not.toHaveBeenCalled();
  });
});
```

The dynamic `await import(...)` inside the last-but-one test matches how `freshStoreWithLegacyData` reaches for helpers after `vi.resetModules()`; a top-level import would bind to a stale module instance.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/state/store.test.ts -t "refreshCalendar"
```

Expected: FAIL — `actions.refreshCalendar is not a function`.

- [ ] **Step 3: Write the implementation**

Add to the `actions` object in `src/state/store.ts`:

```ts
  /**
   * Fetch the range that covers this week's planning horizon, plus `visitedWeek`
   * if the user has navigated past it.
   *
   * Gated on `ownsTabLock` like every other write — refreshing is gated on
   * ownership, not merely the write, so a second tab never spends a Google
   * quota or races the owner's cache row.
   *
   * A failed fetch keeps whatever blocks were already believed. Presenting a
   * booked week as free because the network hiccuped is the one outcome worth
   * more than freshness. The exceptions are the two reasons that mean the data
   * is genuinely gone rather than momentarily unreachable.
   */
  async refreshCalendar(visitedWeek?: string): Promise<void> {
    if (!ownsTabLock) return;
    const bridge = calendarBridge();
    if (!bridge) return;

    let status: CalendarStatus | null;
    try {
      status = await bridge.status();
    } catch {
      return;
    }
    set({ calendarStatus: status });
    if (!status.connected || !status.accountId) {
      set({ busyBlocks: [], calendarRange: null, calendarFetchedAt: null });
      return;
    }

    const currentMonday = weekOf(todayStr());
    const range = fetchRange(
      currentMonday,
      visitedWeek ?? currentMonday,
      state.calendarRange?.rangeEnd,
    );
    const calendarIds = state.calendarIds;

    let result: CalendarFetchResult;
    try {
      result = await bridge.fetch({ ...range, calendarIds });
    } catch {
      return;
    }

    if (!result.ok) {
      if (result.reason === 'not-connected' || result.reason === 'reauth-required') {
        set({ busyBlocks: [], calendarRange: null, calendarFetchedAt: null });
      }
      return;
    }

    const cache: CalendarCache = {
      rangeStart: range.rangeStart,
      rangeEnd: range.rangeEnd,
      blocks: result.blocks,
      fetchedAt: result.fetchedAt,
      // Stamped from the RESULT, not from `status`: the handler reports what the
      // blocks were actually flattened against, and a zone that changed mid-fetch
      // must invalidate rather than be papered over.
      accountId: result.accountId ?? status.accountId,
      calendarIds: [...calendarIds].sort(),
      timeZone: result.timeZone,
    };

    set({
      busyBlocks: cache.blocks,
      calendarRange: { rangeStart: cache.rangeStart, rangeEnd: cache.rangeEnd },
      calendarFetchedAt: cache.fetchedAt,
    });
    ifOwner(() => saveCalendarCache(cache));
  },
```

Add `CalendarFetchResult` to the `calendarBridge` type import, `fetchRange` to a `../lib/calendarRange` import, and `weekOf` to the existing `../lib/plan` import.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/state/store.test.ts -t "refreshCalendar"
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Prove the failure-tolerance test discriminates**

Temporarily change the `if (!result.ok)` branch to always `set({ busyBlocks: [], calendarRange: null, calendarFetchedAt: null });`. Re-run.

Expected: "keeps the blocks it already had when a refresh fails" FAILS. Revert.

- [ ] **Step 6: Prove the ownership gate discriminates**

Temporarily delete the `if (!ownsTabLock) return;` line at the top of `refreshCalendar`. Re-run.

Expected: "a tab that does not own the lock never fetches" FAILS — `bridge.fetch` was called. Revert.

This is worth proving separately from the write gate: `ifOwner` would still stop the *write*, so the test that catches a missing early return is the one asserting `fetch` was never called at all.

- [ ] **Step 7: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(calendar): fetch a range and cache it with its provenance"
```

---

### Task 6: The fetch triggers

**Files:**
- Create: `src/views/plan/useCalendarRefresh.ts`
- Test: `src/views/plan/useCalendarRefresh.test.tsx`

**Interfaces:**
- Consumes: `actions.refreshCalendar` (Task 5), `coversWeek` from `src/lib/calendarRange`.
- Produces: `useCalendarRefresh(weekStart: string, range: DateRange | null, fetchedAt: string | null): void` and `export const CALENDAR_STALE_MS = 15 * 60 * 1000`.

Four triggers, per spec §7.3: planner open, navigation to a week the cache does not cover, explicit Refresh (3b's button, calling the action directly), and window focus when the cache is older than 15 minutes. **This is not a background poll** — nothing runs while the app is unfocused or idle.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/useCalendarRefresh.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useCalendarRefresh, CALENDAR_STALE_MS } from './useCalendarRefresh';
import type { DateRange } from '../../lib/calendarRange';

const refreshCalendar = vi.fn(async () => {});
vi.mock('../../state/store', () => ({ actions: { refreshCalendar } }));

function Harness({ weekStart, range, fetchedAt }: {
  weekStart: string; range: DateRange | null; fetchedAt: string | null;
}) {
  useCalendarRefresh(weekStart, range, fetchedAt);
  return null;
}

const COVERING: DateRange = { rangeStart: '2026-07-27', rangeEnd: '2026-09-28' };

beforeEach(() => {
  refreshCalendar.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('useCalendarRefresh', () => {
  it('refreshes once when the planner opens', () => {
    render(<Harness weekStart="2026-08-03" range={null} fetchedAt={null} />);
    expect(refreshCalendar).toHaveBeenCalledTimes(1);
    expect(refreshCalendar).toHaveBeenCalledWith('2026-08-03');
  });

  it('refreshes when the user navigates past the cached range', () => {
    const { rerender } = render(
      <Harness weekStart="2026-08-03" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />,
    );
    refreshCalendar.mockClear();

    rerender(<Harness weekStart="2026-11-30" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />);

    expect(refreshCalendar).toHaveBeenCalledWith('2026-11-30');
  });

  // The discriminating test. Paging back and forth inside the cached window is
  // the single most common thing a user does on this screen; refetching on each
  // step would spend a Google quota to learn nothing.
  it('does not refresh when navigating inside the cached range', () => {
    const { rerender } = render(
      <Harness weekStart="2026-08-03" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />,
    );
    refreshCalendar.mockClear();

    rerender(<Harness weekStart="2026-08-10" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />);

    expect(refreshCalendar).not.toHaveBeenCalled();
  });

  it('refreshes on focus once the cache is older than fifteen minutes', () => {
    render(<Harness weekStart="2026-08-03" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />);
    refreshCalendar.mockClear();

    vi.setSystemTime(new Date(Date.now() + CALENDAR_STALE_MS + 1000));
    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(refreshCalendar).toHaveBeenCalledTimes(1);
  });

  it('ignores a focus while the cache is still fresh', () => {
    render(<Harness weekStart="2026-08-03" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />);
    refreshCalendar.mockClear();

    vi.setSystemTime(new Date(Date.now() + 60_000));
    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(refreshCalendar).not.toHaveBeenCalled();
  });

  it('stops listening once the planner unmounts', () => {
    const { unmount } = render(
      <Harness weekStart="2026-08-03" range={COVERING} fetchedAt="2026-08-05T12:00:00.000Z" />,
    );
    unmount();
    refreshCalendar.mockClear();

    vi.setSystemTime(new Date(Date.now() + CALENDAR_STALE_MS + 1000));
    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(refreshCalendar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/views/plan/useCalendarRefresh.test.tsx
```

Expected: FAIL — `Failed to resolve import "./useCalendarRefresh"`.

- [ ] **Step 3: Write the implementation**

Create `src/views/plan/useCalendarRefresh.ts`:

```ts
import { useEffect, useRef } from 'react';
import { actions } from '../../state/store';
import { coversWeek, type DateRange } from '../../lib/calendarRange';

/** Spec §7.3. Not a poll — nothing runs while the app is unfocused or idle. */
export const CALENDAR_STALE_MS = 15 * 60 * 1000;

/**
 * The three automatic fetch triggers. The fourth — an explicit Refresh — calls
 * `actions.refreshCalendar()` directly from 3b's button.
 *
 * A week INSIDE the cached range never triggers a fetch: paging back and forth
 * within the window is the commonest action on this screen, and refetching each
 * step would spend a Google quota to learn nothing. The range only ever grows
 * forward, so a covered week stays covered.
 */
export function useCalendarRefresh(
  weekStart: string,
  range: DateRange | null,
  fetchedAt: string | null,
): void {
  // Read through a ref so the focus listener is registered once and still sees
  // current values. Re-registering on every render would drop the listener
  // between the removeEventListener and the next paint.
  const latest = useRef({ weekStart, range, fetchedAt });
  latest.current = { weekStart, range, fetchedAt };

  // Planner open, and any navigation to a week the cache does not cover.
  useEffect(() => {
    if (range && coversWeek(range, weekStart)) return;
    void actions.refreshCalendar(weekStart);
    // `range` is deliberately absent: a refresh REPLACES it, and depending on it
    // would re-run this effect with the new range and risk a fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  // Window focus, when what we hold has gone stale.
  useEffect(() => {
    function onFocus() {
      const { fetchedAt: at, weekStart: week } = latest.current;
      if (!at) return;
      const age = Date.now() - new Date(at).getTime();
      if (!Number.isFinite(age) || age < CALENDAR_STALE_MS) return;
      void actions.refreshCalendar(week);
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/views/plan/useCalendarRefresh.test.tsx
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the coverage check discriminates**

Temporarily change the first effect's guard to `if (range) return;`. Re-run.

Expected: "refreshes when the user navigates past the cached range" FAILS. Revert.

Then change it to `if (false) return;`. Re-run.

Expected: "does not refresh when navigating inside the cached range" FAILS. Revert.

- [ ] **Step 6: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
git add src/views/plan/useCalendarRefresh.ts src/views/plan/useCalendarRefresh.test.tsx
git commit -m "feat(calendar): refresh on open, on navigation, and on a stale focus"
```

---

### Task 7: Wire the Plan view

**Files:**
- Modify: `src/views/Plan.tsx` — line 145 (`blocks: []`), line 151 (`hasData: false`), line 523 (`blocks={[]}`)

**Interfaces:**
- Consumes: store fields from Task 3, `useCalendarRefresh` from Task 6, `coversWeek`.
- Produces: nothing. This is the last wire.

**Why this task has no new unit test, deliberately.**

Nothing in the repo renders `Plan.tsx`. There is no Plan render harness and no `DayBlocks` test, because both sit under a `DndContext` and a live store; the two tests in `src/views/plan/` (`WeekGrid.centring.test.tsx`, `UnestimatedPanel.test.tsx`) render single components directly. Building a full-Plan harness is a real piece of work and it is not this task — it would be a larger change than the three lines it exists to cover.

What is left here is three lines of glue between seams that are *already* covered: `weekCapacity` is tested against `blocks` in `capacity.test.ts`, `dayBusySpans` in `busyLayout.test.ts`, `coversWeek` in `calendarRange.test.ts`, and Task 4 proves the store's blocks reach slot resolution. The glue is held by the typechecker and by Step 4's grep; its behaviour is confirmed by the manual checks in Task 8, which is where a rendering change of this kind is genuinely observable.

If a Plan render harness exists by the time you read this, write the test instead of taking this exemption.

- [ ] **Step 1: Wire the store fields in**

In `src/views/Plan.tsx`, add the four fields to the existing store subscription alongside `availability` and `allDayBlocks` (follow the file's existing pattern for reading state — around lines 88-104):

```ts
  const { busyBlocks, calendarRange, calendarFetchedAt } = useStore();
```

Then the capacity call at line 142:

```ts
  const capacity = weekCapacity({
    week: weekStart,
    windows: availability,
    blocks: busyBlocks,
    leaves: weekLeaves,
    tasks: weekTasks,
    now,
    allDayBlocks,
    hasData: calendarRange !== null && coversWeek(calendarRange, weekStart),
  });
```

And the grid at line 523:

```tsx
                blocks={busyBlocks}
```

Import `coversWeek` from `../lib/calendarRange`.

- [ ] **Step 2: Add the triggers**

Near the other hooks in `Plan.tsx`, after `weekStart` is defined:

```ts
  useCalendarRefresh(weekStart, calendarRange, calendarFetchedAt);
```

Import it from `./plan/useCalendarRefresh`.

- [ ] **Step 3: Confirm nothing regressed**

```bash
npx tsc -b && npx vitest run src/views/plan src/lib/capacity.test.ts src/lib/busyLayout.test.ts
```

Expected: typecheck exit 0, all passing. The typechecker is doing real work here — `busyBlocks` is `BusyBlock[]` and `blocks` expects `BusyBlock[]`, so a wrong variable name or a mis-shaped field fails the build rather than silently rendering nothing.

- [ ] **Step 4: Confirm no empty-block literal survives in the renderer**

```bash
grep -rn "blocks: \[\]\|blocks={\[\]}" src/ --include="*.ts" --include="*.tsx" | grep -v "\.test\."
```

Expected: no output.

- [ ] **Step 5: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
git add src/views/Plan.tsx
git commit -m "feat(calendar): draw real busy time on the week grid"
```

---

### Task 8: Verification sweep

**Files:** none created or modified unless a check fails.

- [ ] **Step 1: Full suite from clean**

```bash
npm test
```

Expected: 82+ files, all passing. The baseline entering this plan is **1670 tests / 82 files**; report the delta. If `src/views/goals/BoardCard.keyboard.test.tsx` fails, re-run it alone — it is a known pre-existing flake. Any other failure is real.

- [ ] **Step 2: Typecheck and production build**

```bash
npx tsc -b && npm run build
```

Both exit 0.

- [ ] **Step 3: Confirm the cache never enters `persist()`**

```bash
grep -n "calendarCache\|busyBlocks" src/state/store.ts | grep -i "persist\|bulkPut"
grep -rn "db.calendarCache" src/ --include="*.ts" --include="*.tsx" | grep -v "src/db/calendarCache.ts"
```

Both must be empty. A block array inside `persist` would be rewritten on every checkbox tick, and any module but `calendarCache.ts` touching the table breaks the single-writer rule.

- [ ] **Step 4: Confirm every calendar write is ownership-gated**

```bash
grep -n "saveCalendarCache\|clearCalendarCache\|saveCalendarIds" src/state/store.ts
```

Every call must sit inside an `ifOwner(...)` callback. Read each one and confirm by eye. `refreshCalendar` must additionally return early on `!ownsTabLock` — a non-owner must not even spend the Google quota.

- [ ] **Step 5: Confirm the backup boundary still holds**

```bash
grep -rn "calendarCache\|busyBlocks" src/db/db.ts
```

Expected: no match in the export/import paths. The calendar cache is device-local and deliberately outside a backup — an import is a generation boundary for app data, and re-importing someone's meetings onto another machine would be wrong even if it worked.

- [ ] **Step 6: Confirm no block is ever mutated**

```bash
grep -rn "busyBlocks\." src/ --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -vE "busyBlocks\.(length|filter|map|some|every|find|slice)"
```

Expected: no output. `busyBlocks` is replaced wholesale, never edited in place.

- [ ] **Step 7: Manual checks**

The producer must be connected first — work through `docs/google-calendar-verification.md` if it has not been done, since 3b's settings UI does not exist yet and the console is still the only way in.

```bash
npm run dev &
npm run app:dev
```

1. **Blocks reach the grid.** With a connected account, open Plan on a week that has real meetings. Each meeting draws in its day column at the right time. Cross-check one against your real calendar.
2. **The header agrees with the column.** A day with several meetings lists all of them in `blocked by:`, and every one of them is drawn. The two must never disagree.
3. **Free time shrank.** The day's free figure is the availability window minus the meetings, not the whole window.
4. **`⌘N` avoids a meeting.** On a day whose morning is fully booked, create a step with an estimate. It must land after the meeting, not on top of it.
5. **A full day refuses.** On a day covered end-to-end by events, `⌘N` refuses and the toast describes the real gaps — not gaps inside a meeting.
6. **Navigation inside the window is quiet.** Page forward a few weeks inside the cached range with devtools' Network tab open. No fetch fires.
7. **Navigation past the window fetches once.** Page to a week beyond eight weeks out. Exactly one fetch, and the blocks appear.
8. **Focus refresh.** Leave the app unfocused for over fifteen minutes, then click back in. One fetch fires. Click away and back again immediately — no second fetch.
9. **Restart.** Quit and relaunch. The blocks are there before any fetch completes, from the cache.
10. **Account switch invalidates.** `await window.phaseCalendar.disconnect()`, then reconnect with a different Google account. The old account's blocks must not appear even for a frame.
11. **Browser is unaffected.** `npm run dev` alone in a browser: Plan renders, no blocks, no errors in the console, and the capacity figures are the window-derived ones.

- [ ] **Step 8: Report**

Test count delta, every grep result, the outcome of each manual check with what you actually observed, every deliberate-failure check from Tasks 1–7 with the failure observed, and anything left open for 3b.
