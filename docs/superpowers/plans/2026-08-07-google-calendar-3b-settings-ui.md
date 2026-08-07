# Google Calendar — the settings UI and the honest caveat (3b of 3)

> **SHELVED 2026-08-07 — do not execute this plan.** See the same notice on
> plan 3a. One piece of this document outlives the calendar feature and is worth
> salvaging independently: Task 1 replaces `capacityNote`'s hardcoded
> `'calendar not connected'` with a health enum. That string is currently
> *correct* — no calendar is connected and none can be — so there is no bug
> today, but the comment in `capacityLabel.ts` predicting its obsolescence
> should be read alongside this notice rather than acted on.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the calendar a way in that is not the devtools console — credentials, connect, a calendar picker, a Refresh — and replace the week header's permanently-false "calendar not connected" caveat with one that says what is actually wrong.

**Architecture:** One new sidebar section beside Working hours, one new pure module that turns store state into a health verdict, and one new store field recording why the last fetch failed. Everything the UI drives already exists as a bridge method from plan 2 and a store action from plan 3a.

**Tech Stack:** React 19, TypeScript, Tailwind (theme tokens only), Vitest + Testing Library.

## Prerequisite

**Plan 3a must be complete and committed.** This plan consumes `actions.refreshCalendar`, the `busyBlocks` / `calendarRange` / `calendarFetchedAt` / `calendarStatus` / `calendarIds` store fields, and `calendarBridge()`. If those do not exist, stop — you are on the wrong plan.

## Global Constraints

- **Visual identity is locked.** No new colours, no new components, no restyling. `designScale.test.ts` fails the build on a literal hex, on an arbitrary `text-[Nrem]`, and on a `fontSize` key that collides with a `colors` key. Use the tokens the neighbouring components already use: `text-ui`, `text-compact`, `text-meta`, `text-tiny`, `text-eyebrow`, `text-ink`, `text-ink-soft`, `text-muted`, `text-warn`, `border-line-2`, `accent-accent`, `focus-visible:border-accent`, `bg-hover`.
- **The rail is 249px wide at every viewport ≥768px.** Not the viewport — the rail. Any row wider than that produces a horizontal scrollbar inside `overflow-y-auto` rather than a visible failure. `AvailabilitySettings.tsx:53-65` documents exactly this bug and its fix. Stack fields full-width; do not put two text inputs on one line.
- **No secret ever leaves the main process.** The producer never returns `clientSecret`, `accessToken` or `refreshToken` — `configure` only accepts them. The UI must never try to read a secret back to prepopulate a field.
- **Every settings write goes through `ifOwner`.** A tab that does not hold the Web Lock never writes.
- **Hover-revealed row controls use `.quiet-control`**, never a hand-rolled `opacity-0 group-hover:opacity-100`. It needs a literal `group` ancestor — `group/name` does not match.
- **`SIDEBAR_PANELS` is append-only.** `db.ts:155` says so: "append new members rather than inserting them", because the stored order is the written order.
- Run `npm test` and `npx tsc -b` before every commit.

## What 3a left for this plan

`WeekHeader` already takes a `calendarAvailable` prop (`WeekHeader.tsx:25`) which **nobody has ever passed**, so it defaults to `false` and the caveat has never rendered. `capacityNote` (`capacityLabel.ts:91`) returns the flat string `'calendar not connected'`, and its own doc comment says:

> Slice 2 breaks that coincidence: per the design spec §5.6, a provenance mismatch (account/calendar/timezone changed, or range not covered) and an expired/revoked refresh token both produce `hasData: false` while a calendar IS connected. At that point this string becomes a false statement. Slice 2 must derive this note from a richer state (e.g. an enum of "not connected" / "stale" / "provenance mismatch" / "reconnect needed") rather than the current boolean.

That is Task 1. The same comment flags a second trap to check while you are there:

> the note was only shown when `blockedBy.length === 0`, which makes the caveat conditional on having no blocks. In slice 2 a partially-populated, stale, or provenance-mismatched cache can have `blockedBy` entries AND `hasData: false` simultaneously — exactly the state this caveat exists to surface — so that conditional would hide the note precisely when it matters most.

Read `WeekHeader.tsx:34` and confirm the note is **not** gated on `blockedBy` before you finish Task 6. As of writing it is not, and it must stay that way.

## The decision this plan makes

**The caveat names the fix, not the diagnosis.**

"Provenance mismatch" is true and useless. Every state below maps to a sentence that tells the user what to do, and the health enum exists so that mapping is a pure function with a test rather than a chain of ternaries in JSX.

| Health | Caveat shown |
|---|---|
| `no-integration` | *(none — a browser has no calendar, and a permanent notice about an unavailable feature is noise)* |
| `not-configured` | `calendar not set up` |
| `not-connected` | `calendar not connected` |
| `reauth-required` | `calendar needs reconnecting` |
| `out-of-range` | `no calendar data for this week` |
| `stale` | *(none — the figures are real, and `fetched at` in the rail already says how old)* |
| `ok` | *(none)* |

`stale` earns no caveat because staleness is not wrongness: the blocks shown were true fifteen minutes ago and are almost certainly still true. The rail's `fetched at` line is where age belongs, beside the Refresh button that acts on it.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/calendarHealth.ts` + `.test.ts` | store state → health verdict → caveat string | 1 |
| `src/state/store.ts` | `calendarError`, and the five connection actions | 2 |
| `src/views/plan/CalendarSettings.tsx` + `.test.tsx` | the rail section: credentials, connect, picker, refresh | 3–4 |
| `src/db/db.ts` | `'calendar'` appended to `SidebarPanel` | 5 |
| `src/views/Plan.tsx` | the new `SidebarSection`; `calendarAvailable` into `WeekHeader` | 5–6 |
| `src/views/plan/AvailabilitySettings.tsx` | the all-day checkbox comes back | 5 |
| `src/views/plan/capacityLabel.ts` | `capacityNote` re-pointed at the health enum | 1, 6 |

---

### Task 1: The health verdict

**Files:**
- Create: `src/lib/calendarHealth.ts`
- Test: `src/lib/calendarHealth.test.ts`
- Modify: `src/views/plan/capacityLabel.ts` (`capacityNote`, line 91)

**Interfaces:**
- Consumes: `CalendarStatus`, `CalendarFetchFailure` from `src/lib/calendarBridge` (plan 3a, Task 1).
- Produces:

```ts
export type CalendarHealth =
  | 'no-integration' | 'not-configured' | 'not-connected'
  | 'reauth-required' | 'out-of-range' | 'stale' | 'ok';
export interface CalendarHealthInput {
  status: CalendarStatus | null;
  lastError: CalendarFetchFailure | null;
  coversWeek: boolean;
  fetchedAt: string | null;
  nowMs: number;
}
export function calendarHealth(input: CalendarHealthInput): CalendarHealth
export function calendarCaveat(health: CalendarHealth): string | null
export const CALENDAR_STALE_MS: number  // re-exported from useCalendarRefresh's constant
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/calendarHealth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calendarHealth, calendarCaveat, type CalendarHealthInput } from './calendarHealth';
import { CALENDAR_STALE_MS } from '../views/plan/useCalendarRefresh';

const NOW = Date.parse('2026-08-05T12:00:00.000Z');
const FRESH = '2026-08-05T11:55:00.000Z';

function input(over: Partial<CalendarHealthInput> = {}): CalendarHealthInput {
  return {
    status: {
      configured: true, connected: true, available: true, corrupt: false,
      accountId: 'me@example.com', timeZone: 'America/New_York',
    },
    lastError: null,
    coversWeek: true,
    fetchedAt: FRESH,
    nowMs: NOW,
    ...over,
  };
}

describe('calendarHealth', () => {
  it('is ok when connected, covering the week, and recently fetched', () => {
    expect(calendarHealth(input())).toBe('ok');
  });

  it('has no integration at all in a browser', () => {
    expect(calendarHealth(input({ status: null }))).toBe('no-integration');
  });

  it('is not configured before any credentials are saved', () => {
    expect(calendarHealth(input({
      status: { configured: false, connected: false, available: true, corrupt: false, accountId: null, timeZone: 'UTC' },
    }))).toBe('not-configured');
  });

  it('is not connected once configured but before consent', () => {
    expect(calendarHealth(input({
      status: { configured: true, connected: false, available: true, corrupt: false, accountId: null, timeZone: 'UTC' },
    }))).toBe('not-connected');
  });

  it('needs reconnecting when the last fetch said so', () => {
    expect(calendarHealth(input({ lastError: 'reauth-required' }))).toBe('reauth-required');
  });

  // The discriminating test for the trap in capacityLabel.ts's comment. A
  // connected, freshly-fetched calendar that simply does not reach this week is
  // NOT "not connected" — telling the user to connect would send them to fix
  // something that is not broken.
  it('reports out-of-range rather than not-connected for an uncovered week', () => {
    expect(calendarHealth(input({ coversWeek: false }))).toBe('out-of-range');
  });

  it('is stale once the fetch is older than the refresh interval', () => {
    expect(calendarHealth(input({
      fetchedAt: new Date(NOW - CALENDAR_STALE_MS - 1000).toISOString(),
    }))).toBe('stale');
  });

  it('treats a never-fetched but connected calendar as out of range', () => {
    expect(calendarHealth(input({ fetchedAt: null, coversWeek: false }))).toBe('out-of-range');
  });

  // Reauth outranks coverage: if the token is gone, "no data for this week" is
  // a symptom and reconnecting is the cure.
  it('prefers reauth-required over out-of-range', () => {
    expect(calendarHealth(input({ lastError: 'reauth-required', coversWeek: false }))).toBe('reauth-required');
  });
});

describe('calendarCaveat', () => {
  it('names the fix rather than the diagnosis', () => {
    expect(calendarCaveat('not-configured')).toBe('calendar not set up');
    expect(calendarCaveat('not-connected')).toBe('calendar not connected');
    expect(calendarCaveat('reauth-required')).toBe('calendar needs reconnecting');
    expect(calendarCaveat('out-of-range')).toBe('no calendar data for this week');
  });

  it('says nothing when there is nothing to fix', () => {
    expect(calendarCaveat('ok')).toBeNull();
    expect(calendarCaveat('no-integration')).toBeNull();
  });

  // Staleness is not wrongness — the blocks were true minutes ago, and the
  // rail's `fetched at` line already carries the age beside the Refresh button.
  it('does not nag about a merely stale cache', () => {
    expect(calendarCaveat('stale')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/calendarHealth.test.ts
```

Expected: FAIL — `Failed to resolve import "./calendarHealth"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/calendarHealth.ts`:

```ts
import type { CalendarStatus, CalendarFetchFailure } from './calendarBridge';
import { CALENDAR_STALE_MS } from '../views/plan/useCalendarRefresh';

/**
 * Why the week header's free figure may not be the whole truth.
 *
 * Ordered by what the user would have to DO about it, which is also the order
 * the checks run in: you cannot connect before configuring, and you cannot
 * cover a week with a token that has expired.
 */
export type CalendarHealth =
  | 'no-integration'  // a browser — there is no producer to ask
  | 'not-configured'  // no client credentials saved yet
  | 'not-connected'   // configured, but no account has consented
  | 'reauth-required' // the refresh token was revoked or expired
  | 'out-of-range'    // connected and healthy, but this week is not in the cache
  | 'stale'           // covered, but the fetch is older than the refresh interval
  | 'ok';

export interface CalendarHealthInput {
  status: CalendarStatus | null;
  /** The reason the last fetch failed, if it did. */
  lastError: CalendarFetchFailure | null;
  /** Whether the cached range covers the week being rendered. */
  coversWeek: boolean;
  fetchedAt: string | null;
  nowMs: number;
}

export function calendarHealth(input: CalendarHealthInput): CalendarHealth {
  const { status, lastError, coversWeek, fetchedAt, nowMs } = input;
  if (!status) return 'no-integration';
  if (!status.configured) return 'not-configured';
  if (lastError === 'reauth-required') return 'reauth-required';
  if (!status.connected) return 'not-connected';
  if (!coversWeek) return 'out-of-range';
  if (!fetchedAt) return 'out-of-range';
  const age = nowMs - Date.parse(fetchedAt);
  if (!Number.isFinite(age) || age >= CALENDAR_STALE_MS) return 'stale';
  return 'ok';
}

/**
 * The caveat shown beside the week's free figure, or `null` for the states
 * where the figure needs no qualification.
 *
 * Each string names the FIX, not the diagnosis. "Provenance mismatch" is true
 * and useless; "calendar needs reconnecting" is what the user can act on.
 */
export function calendarCaveat(health: CalendarHealth): string | null {
  switch (health) {
    case 'not-configured': return 'calendar not set up';
    case 'not-connected': return 'calendar not connected';
    case 'reauth-required': return 'calendar needs reconnecting';
    case 'out-of-range': return 'no calendar data for this week';
    // 'stale' is deliberately silent: the blocks shown were true minutes ago.
    // Age belongs beside the Refresh button in the rail, not in the header.
    case 'stale':
    case 'no-integration':
    case 'ok':
      return null;
  }
}
```

- [ ] **Step 4: Retire the old note**

In `src/views/plan/capacityLabel.ts`, delete `capacityNote` (line 91 and its doc comment, lines 63-93) entirely and remove `hasData` from `CapacityFigures` **only if nothing else reads it** — check first:

```bash
grep -rn "capacityNote\|hasData" src/ --include="*.ts" --include="*.tsx"
```

`hasData` is part of `DayCapacity` / `WeekCapacity` in `capacity.ts` and is read there, so **keep it**. Delete only `capacityNote` and its comment. Its replacement is `calendarCaveat`, and Task 6 re-points `WeekHeader` at it.

Leave a one-line marker where the comment was so the history is not lost:

```ts
// `capacityNote` lived here. It hardcoded 'calendar not connected', which
// became a false statement the moment a calendar could be connected AND
// short of data. See `src/lib/calendarHealth.ts`.
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/lib/calendarHealth.test.ts src/views/plan/capacityLabel.test.ts
```

Expected: `calendarHealth` PASSES, 12 tests. `capacityLabel.test.ts` will FAIL on any test covering `capacityNote` — delete those tests; the behaviour moved and is covered by `calendarHealth.test.ts`. Do not delete tests for `formatMinutes`, `capacityParts`, `loadParts`, `unestimatedLabel`, `dayLoadLabel`, `dayLoadHint` or `isOverCommitted`.

- [ ] **Step 6: Prove the out-of-range test discriminates**

Temporarily move the `if (!status.connected) return 'not-connected';` line to *after* the `coversWeek` check. Re-run.

Expected: no failure — which is the point. Now instead change the `coversWeek` check to `return 'not-connected'`. Re-run.

Expected: "reports out-of-range rather than not-connected for an uncovered week" FAILS. Revert both.

- [ ] **Step 7: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
git add src/lib/calendarHealth.ts src/lib/calendarHealth.test.ts src/views/plan/capacityLabel.ts src/views/plan/capacityLabel.test.ts
git commit -m "feat(calendar): a caveat that names the fix instead of guessing"
```

---

### Task 2: The connection actions

**Files:**
- Modify: `src/state/store.ts` (`UIState`, initial state, `actions`)
- Modify: `src/state/store.test.ts`

**Interfaces:**
- Consumes: `calendarBridge()`, `actions.refreshCalendar` (plan 3a).
- Produces: store field `calendarError: CalendarFetchFailure | null`, and actions:

```ts
configureCalendar(clientId: string, clientSecret: string): Promise<boolean>
connectCalendar(): Promise<boolean>
disconnectCalendar(): Promise<void>
resetCalendar(): Promise<void>
setCalendarIds(ids: string[]): void
```

Each returns whether it succeeded so the component can report a refusal rather than claim success — the same rule the bulk-edit actions follow.

- [ ] **Step 1: Write the failing test**

Add to `src/state/store.test.ts`, reusing the `installBridge` helper and `freshStore()` pattern that plan 3a Task 3 introduced:

```ts
describe('calendar connection actions', () => {
  it('configures, then reports the producer now has credentials', async () => {
    const bridge = installBridge();
    const store = await freshStore();
    await store.initStore();

    const ok = await store.actions.configureCalendar('id-123', 'secret-456');

    expect(ok).toBe(true);
    expect(bridge.configure).toHaveBeenCalledWith({ clientId: 'id-123', clientSecret: 'secret-456' });
  });

  it('reports a refusal rather than claiming success', async () => {
    installBridge({ configure: vi.fn(async () => { throw new Error('keychain unavailable'); }) });
    const store = await freshStore();
    await store.initStore();

    expect(await store.actions.configureCalendar('id', 'secret')).toBe(false);
  });

  it('refreshes immediately after a successful connect', async () => {
    const bridge = installBridge({
      connect: vi.fn(async () => ({ ok: true })),
      fetch: vi.fn(async () => ({
        ok: true, blocks: [], fetchedAt: '2026-08-05T12:00:00.000Z',
        accountId: 'me@example.com', timeZone: TZ,
      })),
    });
    const store = await freshStore();
    await store.initStore();

    expect(await store.actions.connectCalendar()).toBe(true);
    // Connecting and then showing an empty grid until something else triggers a
    // fetch reads as a failed connection.
    expect(bridge.fetch).toHaveBeenCalled();
  });

  it('does not refresh after a connect the user cancelled', async () => {
    const bridge = installBridge({ connect: vi.fn(async () => ({ ok: false, reason: 'cancelled' })) });
    const store = await freshStore();
    await store.initStore();

    expect(await store.actions.connectCalendar()).toBe(false);
    expect(bridge.fetch).not.toHaveBeenCalled();
  });

  it('drops every block on disconnect', async () => {
    const bridge = installBridge({
      fetch: vi.fn(async () => ({
        ok: true,
        blocks: [{ date: '2026-08-05', startMin: 540, endMin: 600, title: 'standup', allDay: false }],
        fetchedAt: '2026-08-05T12:00:00.000Z', accountId: 'me@example.com', timeZone: TZ,
      })),
    });
    const store = await freshStore();
    await store.initStore();
    await store.actions.refreshCalendar();
    expect(store.getState().busyBlocks).toHaveLength(1);

    await store.actions.disconnectCalendar();

    expect(bridge.disconnect).toHaveBeenCalled();
    expect(store.getState().busyBlocks).toEqual([]);
    expect(store.getState().calendarRange).toBeNull();
    // The row must go too — this is a user asking to be forgotten, not a
    // transient failure, so the "leave the row" rule from 3a does not apply.
    expect(calendarCacheMocks.clearCalendarCache).toHaveBeenCalled();
  });

  it('changing the calendar selection persists it and refetches', async () => {
    const bridge = installBridge({
      fetch: vi.fn(async () => ({
        ok: true, blocks: [], fetchedAt: '2026-08-05T12:00:00.000Z',
        accountId: 'me@example.com', timeZone: TZ,
      })),
    });
    const store = await freshStore();
    await store.initStore();

    store.actions.setCalendarIds(['primary', 'work@example.com']);

    expect(store.getState().calendarIds).toEqual(['primary', 'work@example.com']);
    const { saveCalendarIds } = await import('../db/db');
    expect(saveCalendarIds).toHaveBeenCalledWith(['primary', 'work@example.com']);
    // The old cache was fetched for a different selection, so it is no longer
    // believable — provenance would reject it on the next boot anyway.
    await vi.waitFor(() => expect(bridge.fetch).toHaveBeenCalled());
  });

  it('records why the last fetch failed', async () => {
    const bridge = installBridge({ fetch: vi.fn(async () => ({ ok: false, reason: 'reauth-required' })) });
    const store = await freshStore();
    await store.initStore();

    await store.actions.refreshCalendar();

    expect(store.getState().calendarError).toBe('reauth-required');
    expect(bridge.fetch).toHaveBeenCalled();
  });

  it('clears the recorded error once a fetch succeeds', async () => {
    const bridge = installBridge({ fetch: vi.fn(async () => ({ ok: false, reason: 'request-failed' })) });
    const store = await freshStore();
    await store.initStore();
    await store.actions.refreshCalendar();
    expect(store.getState().calendarError).toBe('request-failed');

    bridge.fetch.mockResolvedValueOnce({
      ok: true, blocks: [], fetchedAt: '2026-08-05T12:00:00.000Z',
      accountId: 'me@example.com', timeZone: TZ,
    });
    await store.actions.refreshCalendar();

    expect(store.getState().calendarError).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/state/store.test.ts -t "calendar connection actions"
```

Expected: FAIL — `store.actions.configureCalendar is not a function`.

- [ ] **Step 3: Add the error field**

In `src/state/store.ts`, add to `UIState` beside the other calendar fields:

```ts
  calendarError: CalendarFetchFailure | null; // why the last fetch failed
```

and to the initial state literal:

```ts
  calendarError: null,
```

Add `CalendarFetchFailure` to the existing `../lib/calendarBridge` type import.

- [ ] **Step 4: Record the error in `refreshCalendar`**

In the `refreshCalendar` action written in plan 3a Task 5, set the field on both paths. Replace the `if (!result.ok)` block:

```ts
    if (!result.ok) {
      set({ calendarError: result.reason });
      if (result.reason === 'not-connected' || result.reason === 'reauth-required') {
        set({ busyBlocks: [], calendarRange: null, calendarFetchedAt: null });
      }
      return;
    }
```

and add `calendarError: null` to the success `set({ ... })` that follows it.

- [ ] **Step 5: Write the actions**

Add to the `actions` object in `src/state/store.ts`:

```ts
  /**
   * Hand the OAuth client credentials to the producer.
   *
   * Returns whether it landed. The secret never comes back — `status()` reports
   * only `configured`, so there is nothing to read back into the field, and the
   * UI must not pretend otherwise.
   */
  async configureCalendar(clientId: string, clientSecret: string): Promise<boolean> {
    if (!ownsTabLock) return false;
    const bridge = calendarBridge();
    if (!bridge) return false;
    try {
      await bridge.configure({ clientId, clientSecret });
    } catch {
      return false;
    }
    set({ calendarStatus: await readCalendarStatus() });
    return true;
  },

  /**
   * Open Google's consent flow, then fetch immediately.
   *
   * The fetch is not optional: connecting and then showing an empty grid until
   * some other trigger fires reads as a failed connection.
   */
  async connectCalendar(): Promise<boolean> {
    if (!ownsTabLock) return false;
    const bridge = calendarBridge();
    if (!bridge) return false;
    let result: Awaited<ReturnType<typeof bridge.connect>>;
    try {
      result = await bridge.connect();
    } catch {
      return false;
    }
    set({ calendarStatus: await readCalendarStatus() });
    if (!result.ok) return false;
    set({ calendarError: null });
    await actions.refreshCalendar();
    return true;
  },

  /**
   * Revoke the grant and forget everything derived from it.
   *
   * The cache row IS deleted here, unlike a provenance mismatch: this is a user
   * asking to be forgotten, not a transient failure, so keeping the blocks
   * around to re-evaluate later would be exactly wrong.
   */
  async disconnectCalendar(): Promise<void> {
    if (!ownsTabLock) return;
    const bridge = calendarBridge();
    if (!bridge) return;
    try {
      await bridge.disconnect();
    } catch {
      // Fall through: local state must be cleared even if the revoke failed,
      // or the UI keeps showing an account the user has asked to remove.
    }
    set({
      busyBlocks: [], calendarRange: null, calendarFetchedAt: null,
      calendarError: null, calendarStatus: await readCalendarStatus(),
    });
    ifOwner(() => clearCalendarCache());
  },

  /** Wipe a secret store that cannot be decrypted, so setup can start over. */
  async resetCalendar(): Promise<void> {
    if (!ownsTabLock) return;
    const bridge = calendarBridge();
    if (!bridge) return;
    try {
      await bridge.reset();
    } catch {
      return;
    }
    set({
      busyBlocks: [], calendarRange: null, calendarFetchedAt: null,
      calendarError: null, calendarStatus: await readCalendarStatus(),
    });
    ifOwner(() => clearCalendarCache());
  },

  /**
   * Change which calendars a fetch queries, and refetch.
   *
   * The refetch is not a nicety: the cached blocks came from a different
   * selection, so `usableCache` would reject them on the next boot anyway.
   * Refetching now means the grid agrees with the picker immediately.
   */
  setCalendarIds(ids: string[]): void {
    const clean = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
    if (clean.length === 0) return; // an empty selection is a no-op, not a wipe
    set({ calendarIds: clean });
    ifOwner(() => saveCalendarIds(clean));
    void actions.refreshCalendar();
  },
```

Add `clearCalendarCache` to the existing `../db/calendarCache` import.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run src/state/store.test.ts -t "calendar connection actions"
```

Expected: PASS, 8 tests.

- [ ] **Step 7: Prove the disconnect-deletes rule discriminates**

Temporarily remove the `ifOwner(() => clearCalendarCache());` line from `disconnectCalendar`. Re-run.

Expected: "drops every block on disconnect" FAILS on the `clearCalendarCache` assertion. Revert.

- [ ] **Step 8: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(calendar): configure, connect, disconnect, and pick calendars"
```

---

### Task 3: The settings section

**Files:**
- Create: `src/views/plan/CalendarSettings.tsx`
- Test: `src/views/plan/CalendarSettings.test.tsx`

**Interfaces:**
- Consumes: `useAppStore()`, the Task 2 actions, `calendarBridge()` for `listCalendars`.
- Produces: `export function CalendarSettings()`.

Match `AvailabilitySettings.tsx` exactly: `useAppStore()` for state and actions, a `flex flex-col gap-[8px]` root, and the input class `min-w-0 rounded-[6px] border border-line-2 bg-transparent px-[6px] py-[2px] text-compact text-ink outline-none focus-visible:border-accent`. **Stack the credential fields full width** — the rail is 249px and two inputs on a line will overflow it.

- [ ] **Step 1: Write the failing test**

**Two things about this repo's test conventions, both verified — do not deviate:**

1. **There is no `@testing-library/jest-dom`.** No test in `src/` uses `toBeInTheDocument`. Assert with `toBeTruthy()`, `toBeNull()`, and direct property/attribute reads. `@testing-library/user-event` **is** available (`package.json:54`).
2. **Component tests drive the REAL store**, not a mocked one — see `src/views/plan/UnestimatedPanel.test.tsx`. They `vi.mock` the db layer, `vi.resetModules()`, `await store.initStore()`, then dynamically import the component. Mocking `../../state/store` would be a new pattern; do not introduce one.

`vitest.config.ts` sets `environment: 'node'` globally, so the `// @vitest-environment jsdom` pragma on line 1 is required.

Create `src/views/plan/CalendarSettings.test.tsx`:

```tsx
// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async () => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async () => []),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  loadCalendarIds: vi.fn(async () => ['primary']),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  saveSidebarPanels: vi.fn(async () => {}),
  saveCalendarIds: vi.fn(async () => {}),
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
  isSlotMigrationDone: vi.fn(async () => true),
  saveSlotMigrationSnapshot: vi.fn(async () => {}),
  loadSlotMigrationSnapshot: vi.fn(async () => null),
  markSlotMigrationDone: vi.fn(async () => {}),
  isCheckpointMigrationDone: vi.fn(async () => true),
  saveCheckpointMigrationSnapshot: vi.fn(async () => {}),
  loadCheckpointMigrationSnapshot: vi.fn(async () => null),
  markCheckpointMigrationDone: vi.fn(async () => {}),
}));
vi.mock('../../db/db', () => dbMocks);

const calendarCacheMocks = vi.hoisted(() => ({
  loadCalendarCache: vi.fn(async () => undefined),
  saveCalendarCache: vi.fn(async () => {}),
  clearCalendarCache: vi.fn(async () => {}),
}));
vi.mock('../../db/calendarCache', () => calendarCacheMocks);
vi.mock('../../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

const CALENDARS = [
  { id: 'primary', summary: 'Me', primary: true },
  { id: 'work@example.com', summary: 'Work', primary: false },
];

const CONNECTED = {
  configured: true, connected: true, available: true, corrupt: false,
  accountId: 'me@example.com', timeZone: 'America/New_York',
};
const UNCONFIGURED = {
  configured: false, connected: false, available: true, corrupt: false,
  accountId: null, timeZone: 'UTC',
};

function installBridge(over: Record<string, unknown> = {}) {
  const bridge = {
    status: vi.fn(async () => CONNECTED),
    configure: vi.fn(async () => {}),
    connect: vi.fn(async () => ({ ok: true })),
    disconnect: vi.fn(async () => {}),
    listCalendars: vi.fn(async () => CALENDARS),
    reset: vi.fn(async () => {}),
    fetch: vi.fn(async () => ({
      ok: true, blocks: [], fetchedAt: '2026-08-05T12:00:00.000Z',
      accountId: 'me@example.com', timeZone: 'America/New_York',
    })),
    ...over,
  };
  (globalThis as Record<string, unknown>).phaseCalendar = bridge;
  return bridge;
}

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

async function mount(over: Record<string, unknown> = {}) {
  vi.resetModules();
  const bridge = installBridge(over);
  const store = await import('../../state/store');
  await store.initStore();
  const { CalendarSettings } = await import('./CalendarSettings');
  render(createElement(CalendarSettings));
  return { store, bridge, user: userEvent.setup() };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  delete (globalThis as Record<string, unknown>).phaseCalendar;
});

/** jsdom returns Element; the checked/type reads need the input type. */
function input(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe('CalendarSettings', () => {
  it('asks for credentials before anything is configured', async () => {
    await mount({ status: vi.fn(async () => UNCONFIGURED) });

    expect(screen.getByLabelText('Client ID')).toBeTruthy();
    expect(screen.getByLabelText('Client secret')).toBeTruthy();
  });

  // The secret is a password field. A desktop OAuth secret is not truly
  // confidential — the setup guide says so — but it is still a credential
  // sitting on screen over someone's shoulder.
  it('masks the secret and offers to reveal it', async () => {
    const { user } = await mount({ status: vi.fn(async () => UNCONFIGURED) });

    expect(input('Client secret').getAttribute('type')).toBe('password');
    await user.click(screen.getByRole('button', { name: /show secret/i }));
    expect(input('Client secret').getAttribute('type')).toBe('text');
  });

  it('saves both credentials together', async () => {
    const { user, bridge } = await mount({ status: vi.fn(async () => UNCONFIGURED) });

    await user.type(screen.getByLabelText('Client ID'), 'id-123');
    await user.type(screen.getByLabelText('Client secret'), 'secret-456');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(bridge.configure).toHaveBeenCalledWith({ clientId: 'id-123', clientSecret: 'secret-456' });
  });

  it('will not save a half-filled pair', async () => {
    const { user, bridge } = await mount({ status: vi.fn(async () => UNCONFIGURED) });

    await user.type(screen.getByLabelText('Client ID'), 'id-123');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(bridge.configure).not.toHaveBeenCalled();
  });

  it('shows the connected account and offers to disconnect', async () => {
    await mount();

    expect(screen.getByText('me@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('lists the calendars with the selected ones checked', async () => {
    await mount();

    await screen.findByLabelText('Work');
    expect(input('Me').checked).toBe(true);
    expect(input('Work').checked).toBe(false);
  });

  it('adds a calendar to the selection', async () => {
    const { user, store } = await mount();

    await user.click(await screen.findByLabelText('Work'));

    expect(store.getState().calendarIds).toEqual(['primary', 'work@example.com']);
  });

  // The discriminating test. Unchecking the last calendar would fetch nothing
  // and render a fully-booked week as a free one.
  it('refuses to uncheck the last remaining calendar', async () => {
    const { user, store } = await mount();

    await user.click(await screen.findByLabelText('Me'));

    expect(store.getState().calendarIds).toEqual(['primary']);
  });

  it('refreshes on demand and says how old the data is', async () => {
    const { user, bridge } = await mount();
    await screen.findByLabelText('Work'); // let the picker settle first
    bridge.fetch.mockClear();

    expect(screen.getByText(/fetched|never fetched/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(bridge.fetch).toHaveBeenCalled();
  });

  it('offers a reset when the secret store cannot be decrypted', async () => {
    const { user, bridge } = await mount({
      status: vi.fn(async () => ({ ...UNCONFIGURED, corrupt: true })),
    });

    await user.click(screen.getByRole('button', { name: /reset/i }));

    expect(bridge.reset).toHaveBeenCalled();
  });

  it('says plainly that a browser cannot do this', async () => {
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).phaseCalendar;
    const store = await import('../../state/store');
    await store.initStore();
    const { CalendarSettings } = await import('./CalendarSettings');
    render(createElement(CalendarSettings));

    expect(screen.getByText(/only.*desktop app/i)).toBeTruthy();
    expect(screen.queryByLabelText('Client ID')).toBeNull();
  });

  it('warns when the OS keychain is unavailable', async () => {
    await mount({ status: vi.fn(async () => ({ ...UNCONFIGURED, available: false })) });

    expect(screen.getByText(/keychain/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/views/plan/CalendarSettings.test.tsx
```

Expected: FAIL — `Failed to resolve import "./CalendarSettings"`.

- [ ] **Step 3: Write the component**

Create `src/views/plan/CalendarSettings.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useAppStore } from '../../state/store';
import { calendarBridge, type CalendarSummary } from '../../lib/calendarBridge';

// Lifted from AvailabilitySettings (the section directly above this one in the
// rail) and WeekHeader, so the two read as one surface. NOTE: SubtaskAiModal.tsx
// defines its own `field`/`label`/`primary`/`ghost` constants — do NOT reuse
// those here. They are modal scale (`text-body`, `py-[7px]`) and will overflow a
// 249px rail.
const INPUT =
  'w-full min-w-0 rounded-[6px] border border-line-2 bg-transparent px-[6px] py-[2px] '
  + 'text-compact text-ink outline-none focus-visible:border-accent';
const BUTTON =
  'text-meta text-muted hover:text-ink min-h-[24px] px-[6px] rounded-[6px] hover:bg-hover';

/** "3 minutes ago" is prettier; an absolute local time is unambiguous. */
function fetchedLabel(iso: string | null): string {
  if (!iso) return 'never fetched';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'never fetched';
  return `fetched ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * Google Calendar connection, credentials, and calendar picker.
 *
 * Sits beside Working hours in the rail, which is 249px wide at every viewport
 * from 768px up — so every field is full width and stacked. Two inputs on one
 * line overflow it, and the rail's `overflow-y-auto` turns that into a
 * horizontal scrollbar rather than a visible failure.
 *
 * The client secret is never read back: the producer only accepts it, and
 * `status()` reports `configured` and nothing more. Once saved, this shows that
 * it is set rather than pretending to show the value.
 */
export function CalendarSettings() {
  const { calendarStatus, calendarIds, calendarFetchedAt, actions } = useAppStore();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [revealSecret, setRevealSecret] = useState(false);
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const connected = !!calendarStatus?.connected;

  useEffect(() => {
    if (!connected) { setCalendars([]); return; }
    const bridge = calendarBridge();
    if (!bridge) return;
    let live = true;
    void bridge.listCalendars()
      .then((list) => { if (live) setCalendars(list); })
      .catch(() => { if (live) setCalendars([]); });
    return () => { live = false; };
  }, [connected]);

  if (!calendarStatus) {
    return (
      <p className="text-meta text-muted">
        Google Calendar is only available in the desktop app.
      </p>
    );
  }

  async function save() {
    // Both or neither: a half-filled pair cannot authenticate, and sending it
    // would overwrite a working configuration with a broken one.
    if (!clientId.trim() || !clientSecret.trim()) return;
    setBusy(true);
    const ok = await actions.configureCalendar(clientId.trim(), clientSecret.trim());
    setBusy(false);
    if (ok) { setClientId(''); setClientSecret(''); setRevealSecret(false); }
  }

  function toggleCalendar(id: string, on: boolean) {
    const next = on ? [...calendarIds, id] : calendarIds.filter((c) => c !== id);
    // Fetching zero calendars returns zero blocks, which renders a booked week
    // as a free one. Refuse rather than accept an empty selection.
    if (next.length === 0) return;
    actions.setCalendarIds(next);
  }

  return (
    <div className="flex flex-col gap-[8px]">
      {!calendarStatus.available && (
        <p className="text-meta text-warn">
          The system keychain is unavailable, so credentials cannot be saved.
        </p>
      )}

      {calendarStatus.corrupt && (
        <div className="flex flex-col gap-[4px]">
          <p className="text-meta text-warn">Saved credentials could not be read.</p>
          <button type="button" className={BUTTON} onClick={() => void actions.resetCalendar()}>
            Reset calendar setup
          </button>
        </div>
      )}

      {!calendarStatus.configured ? (
        <div className="flex flex-col gap-[4px]">
          <label className="text-meta text-ink-soft" htmlFor="cal-client-id">Client ID</label>
          <input
            id="cal-client-id"
            className={INPUT}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
          <div className="flex items-center justify-between gap-[6px]">
            <label className="text-meta text-ink-soft" htmlFor="cal-client-secret">Client secret</label>
            <button
              type="button"
              className={BUTTON}
              aria-label={revealSecret ? 'Hide secret' : 'Show secret'}
              onClick={() => setRevealSecret((was) => !was)}
            >
              {revealSecret ? 'hide' : 'show'}
            </button>
          </div>
          <input
            id="cal-client-secret"
            className={INPUT}
            type={revealSecret ? 'text' : 'password'}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
          <button type="button" className={BUTTON} disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </div>
      ) : !connected ? (
        <button type="button" className={BUTTON} disabled={busy} onClick={async () => {
          setBusy(true);
          await actions.connectCalendar();
          setBusy(false);
        }}>
          Connect Google Calendar
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between gap-[6px]">
            <span className="text-meta text-ink-soft truncate min-w-0">{calendarStatus.accountId}</span>
            <button type="button" className={BUTTON} onClick={() => void actions.disconnectCalendar()}>
              Disconnect
            </button>
          </div>

          <div className="flex flex-col gap-[2px]">
            {calendars.map((cal) => (
              <label key={cal.id} className="flex items-center gap-[6px] text-ui min-w-0">
                <input
                  type="checkbox"
                  className="flex-none accent-accent w-[16px] h-[16px] m-[4px]"
                  checked={calendarIds.includes(cal.id)}
                  onChange={(e) => toggleCalendar(cal.id, e.target.checked)}
                />
                <span className="truncate min-w-0 text-ink-soft">{cal.summary}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between gap-[6px]">
            <span className="text-meta text-muted truncate min-w-0">{fetchedLabel(calendarFetchedAt)}</span>
            <button type="button" className={BUTTON} onClick={() => void actions.refreshCalendar()}>
              Refresh
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

Note the picker labels rely on the `<label>` wrapping its `<input>`, which is what makes `getByLabelText('Work')` find the checkbox.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/views/plan/CalendarSettings.test.tsx
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Prove the last-calendar guard discriminates**

Temporarily delete the `if (next.length === 0) return;` line in `toggleCalendar`. Re-run.

Expected: "refuses to uncheck the last remaining calendar" FAILS. Revert.

- [ ] **Step 6: Prove the half-filled guard discriminates**

Temporarily delete the `if (!clientId.trim() || !clientSecret.trim()) return;` line in `save`. Re-run.

Expected: "will not save a half-filled pair" FAILS. Revert.

- [ ] **Step 7: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
git add src/views/plan/CalendarSettings.tsx src/views/plan/CalendarSettings.test.tsx
git commit -m "feat(calendar): a way in that is not the devtools console"
```

---

### Task 4: Confirm the rail does not overflow

**Files:** none modified unless the check fails.

`AvailabilitySettings.tsx:53-65` records a real bug of exactly this kind: a row measured ~290px in a 249px rail, and the end time was clipped mid-digit on a default desktop window. The failure is silent because `overflow-y-auto` converts it into a horizontal scrollbar. A new section of form controls is the most likely thing to reintroduce it.

- [ ] **Step 1: Check every fixed width in the new component**

```bash
grep -n "w-\[\|min-w-\[\|px-\[\|gap-\[" src/views/plan/CalendarSettings.tsx
```

Every element must be `w-full`, `min-w-0`, `flex-none` on a 16px checkbox, or `truncate`. There must be **no** fixed pixel width above 16px on any element that shares a row with another. Read the output and confirm by eye.

- [ ] **Step 2: Confirm the long-value cases truncate**

The two values that can be arbitrarily long are the Google account address and a calendar's summary. Both must carry `truncate min-w-0`:

```bash
grep -n "calendarStatus.accountId\|cal.summary" src/views/plan/CalendarSettings.tsx
```

Both lines must have `truncate` and `min-w-0` on the element or its parent.

- [ ] **Step 3: Verify in the running app**

This is the only reliable check — the rest is reading class names.

```bash
npm run dev
```

Open Plan at a default desktop window width, expand the Calendar section, and confirm: no horizontal scrollbar appears in the rail, and a long account address and a long calendar name are both clipped with an ellipsis rather than pushing the row wide.

If a horizontal scrollbar appears, fix it here rather than deferring — the whole point of this task is that the bug is silent.

- [ ] **Step 4: Commit only if something changed**

```bash
npm test && npx tsc -b
git add src/views/plan/CalendarSettings.tsx
git commit -m "fix(calendar): keep the settings section inside the 249px rail"
```

---

### Task 5: Put it in the rail, and bring the checkbox back

**Files:**
- Modify: `src/db/db.ts` (`SidebarPanel`, line 151; `SIDEBAR_PANELS`, line 155)
- Modify: `src/views/Plan.tsx` (the sidebar block, around line 429-441)
- Modify: `src/views/plan/AvailabilitySettings.tsx` (the removal comment, lines 101-116)

**Interfaces:**
- Consumes: `CalendarSettings` (Task 3).
- Produces: the `'calendar'` sidebar panel.

- [ ] **Step 1: Append the panel**

In `src/db/db.ts`:

```ts
/** Which sidebar panels are expanded. The backlog is pinned and never listed. */
export type SidebarPanel = 'habits' | 'stats' | 'availability' | 'calendar';

// Stored order — `saveSidebarPanels` writes panels in this order, so append
// new members rather than inserting them.
const SIDEBAR_PANELS: readonly SidebarPanel[] = ['habits', 'stats', 'availability', 'calendar'];
```

Appending is required, not stylistic: `parseSidebarPanels` filters `SIDEBAR_PANELS` by membership, so inserting in the middle would rewrite every existing user's stored order.

- [ ] **Step 2: Render the section**

In `src/views/Plan.tsx`, directly after the Working hours section:

```tsx
          <SidebarSection panel="availability" title="Working hours">
            <AvailabilitySettings />
          </SidebarSection>
          <SidebarSection panel="calendar" title="Calendar">
            <CalendarSettings />
          </SidebarSection>
```

Import it: `import { CalendarSettings } from './plan/CalendarSettings';`

- [ ] **Step 3: Restore the all-day checkbox**

In `src/views/plan/AvailabilitySettings.tsx`, replace the removal comment (lines 101-116) with the control it describes. The comment ends "restoring the control when the calendar feed lands is putting this label back, nothing more" — this is that moment.

```tsx
      <label className="flex items-center gap-[6px] text-ui min-w-0">
        <input
          type="checkbox"
          className="flex-none accent-accent w-[16px] h-[16px] m-[4px]"
          checked={allDayBlocks}
          onChange={(e) => actions.setAllDayBlocks(e.target.checked)}
        />
        <span className="truncate min-w-0 text-ink-soft">All-day events consume the whole day</span>
      </label>
```

Add `allDayBlocks` to the destructured `useAppStore()` call at line 22:

```ts
  const { availability, allDayBlocks, actions } = useAppStore();
```

- [ ] **Step 4: Write the test for the restored control**

Create `src/views/plan/AvailabilitySettings.test.tsx`. Copy the `dbMocks` / `vi.mock` / `beforeAll(matchMedia)` preamble from `CalendarSettings.test.tsx` verbatim — the real-store harness, not a mocked store — then:

```tsx
async function mount() {
  vi.resetModules();
  dbMocks.loadAllDayBlocks.mockResolvedValueOnce(true);
  dbMocks.loadAvailability.mockResolvedValueOnce([{ dow: 0, startMin: 540, endMin: 1080 }]);
  const store = await import('../../state/store');
  await store.initStore();
  const { AvailabilitySettings } = await import('./AvailabilitySettings');
  render(createElement(AvailabilitySettings));
  return { store, user: userEvent.setup() };
}

describe('AvailabilitySettings', () => {
  it('toggles whether all-day events consume the day', async () => {
    const { store, user } = await mount();
    expect(store.getState().allDayBlocks).toBe(true);

    await user.click(screen.getByLabelText(/All-day events/i));

    expect(store.getState().allDayBlocks).toBe(false);
  });

  // The control is only worth restoring because it is free — toggling it
  // re-filters cached blocks and must never cost a round trip to Google.
  it('does not refetch when the preference changes', async () => {
    const bridge = installBridge();
    const { user } = await mount();
    bridge.fetch.mockClear();

    await user.click(screen.getByLabelText(/All-day events/i));

    expect(bridge.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/views/plan
```

Expected: PASS.

- [ ] **Step 6: Confirm the panel persists**

```bash
npm run dev
```

Expand the Calendar section, reload the page, and confirm it is still expanded. Collapse it, reload, confirm it is still collapsed. This exercises `parseSidebarPanels`' append-only contract against a real stored value.

- [ ] **Step 7: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
git add src/db/db.ts src/views/Plan.tsx src/views/plan/AvailabilitySettings.tsx src/views/plan/AvailabilitySettings.test.tsx
git commit -m "feat(calendar): a Calendar section in the rail, and the all-day control returns"
```

---

### Task 6: The week header tells the truth

**Files:**
- Modify: `src/views/plan/WeekHeader.tsx` (props, line 12-32; the note, line 34)
- Modify: `src/views/Plan.tsx` (the `WeekHeader` call, around line 444)
- Test: `src/views/plan/WeekHeader.test.tsx` (create)

**Interfaces:**
- Consumes: `calendarHealth`, `calendarCaveat` (Task 1).
- Produces: `WeekHeader` takes `caveat?: string | null` in place of `calendarAvailable`.

`WeekHeader` computing its own note from a boolean was the original mistake. Passing the finished string in makes the header a renderer and puts the decision in a tested pure function.

- [ ] **Step 1: Write the failing test**

Create `src/views/plan/WeekHeader.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WeekHeader } from './WeekHeader';
import type { WeekCapacity } from '../../lib/capacity';

afterEach(cleanup);

const CAPACITY: WeekCapacity = {
  days: [], freeMin: 360, plannedMin: 120, backlogMin: 0, unestimated: 0, hasData: false,
};

function renderHeader(over: Partial<Parameters<typeof WeekHeader>[0]> = {}) {
  return render(
    <WeekHeader
      weekStart="2026-08-03"
      isPast={false}
      capacity={CAPACITY}
      onPrev={vi.fn()}
      onNext={vi.fn()}
      onToday={vi.fn()}
      {...over}
    />,
  );
}

describe('WeekHeader', () => {
  it('shows the caveat it is given', () => {
    renderHeader({ caveat: 'calendar needs reconnecting' });
    expect(screen.getByText('calendar needs reconnecting')).toBeTruthy();
  });

  it('shows nothing when there is no caveat', () => {
    renderHeader({ caveat: null });
    expect(screen.queryByText(/calendar/i)).toBeNull();
  });

  // The trap named in capacityLabel.ts's old comment: the caveat must NOT be
  // conditional on having no blocks. A stale or partial cache produces
  // blockedBy entries AND a caveat at the same time — exactly when it matters.
  it('still shows the caveat on a week that has busy blocks', () => {
    renderHeader({
      caveat: 'no calendar data for this week',
      capacity: { ...CAPACITY, days: [{
        date: '2026-08-05', freeMin: 300, plannedMin: 0, backlogMin: 0,
        unestimated: 0, blockedBy: ['standup'], hasData: false,
      }] },
    });
    expect(screen.getByText('no calendar data for this week')).toBeTruthy();
  });

  it('still reports the free figure alongside the caveat', () => {
    renderHeader({ caveat: 'calendar not connected' });
    expect(screen.getByText(/6h free/)).toBeTruthy();
  });
});
```

This repo has no `jest-dom`, so `toBeTruthy()` is the matcher — `getByText` already throws when nothing matches, which is what makes the assertion meaningful.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/views/plan/WeekHeader.test.tsx
```

Expected: FAIL — `caveat` is not a prop; nothing renders.

- [ ] **Step 3: Change the prop**

In `src/views/plan/WeekHeader.tsx`, replace `calendarAvailable = false` in the destructure with `caveat = null`, replace the prop type block:

```ts
  /**
   * The calendar caveat to show beside the figures, or `null`. Computed by
   * `calendarCaveat` in `src/lib/calendarHealth.ts` — this component renders
   * it and does not decide it.
   *
   * Deliberately NOT conditional on `blockedBy`: a stale or partially-covered
   * cache produces blocks AND a caveat simultaneously, which is exactly when
   * the caveat matters most.
   */
  caveat?: string | null;
```

and replace line 34 entirely:

```ts
  const note = caveat;
```

Remove the now-unused `capacityNote` from the import on line 3.

- [ ] **Step 4: Pass it from Plan**

In `src/views/Plan.tsx`, compute the health beside the existing `capacity` memo and pass the caveat:

```ts
  const caveat = useMemo(() => calendarCaveat(calendarHealth({
    status: calendarStatus,
    lastError: calendarError,
    coversWeek: calendarRange !== null && coversWeek(calendarRange, weekStart),
    fetchedAt: calendarFetchedAt,
    nowMs: Date.now(),
  })), [calendarStatus, calendarError, calendarRange, calendarFetchedAt, weekStart]);
```

and in the `WeekHeader` element:

```tsx
            caveat={caveat}
```

Add `calendarError` to the destructured store read, and import `calendarHealth` / `calendarCaveat` from `../lib/calendarHealth`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/views/plan/WeekHeader.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Prove the blockedBy trap stays closed**

Temporarily change the note render in `WeekHeader.tsx` to be conditional on there being no blocked days:

```tsx
      {note && capacity.days.every((d) => d.blockedBy.length === 0) && (
```

Re-run.

Expected: "still shows the caveat on a week that has busy blocks" FAILS. Revert. This is the exact regression `capacityLabel.ts`'s comment warned about, so it is worth having a test that catches it.

- [ ] **Step 7: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
git add src/views/plan/WeekHeader.tsx src/views/plan/WeekHeader.test.tsx src/views/Plan.tsx
git commit -m "feat(calendar): say what is actually wrong, not what was wrong in slice 1"
```

---

### Task 7: Verification sweep

**Files:** none created or modified unless a check fails.

- [ ] **Step 1: Full suite from clean**

```bash
npm test
```

Expected: all passing. Report the delta from the count 3a finished at. If `src/views/goals/BoardCard.keyboard.test.tsx` fails, re-run it alone — known pre-existing flake.

- [ ] **Step 2: Typecheck and production build**

```bash
npx tsc -b && npm run build
```

Both exit 0.

- [ ] **Step 3: Confirm no secret is ever read back**

```bash
grep -n "clientSecret\|accessToken\|refreshToken" src/ -r --include="*.ts" --include="*.tsx"
```

Expected: matches only in `CalendarSettings.tsx`'s local `clientSecret` state and the `configureCalendar` signature — both write-only paths into the producer. There must be no read of a secret from `status()` or any other result.

- [ ] **Step 4: Confirm the design scale still holds**

```bash
npx vitest run src/lib/designScale.test.ts
```

Expected: PASS. This is the guard against a literal hex or an arbitrary `text-[Nrem]` sneaking into the new component.

- [ ] **Step 5: Confirm the dead caveat is gone**

```bash
grep -rn "capacityNote\|calendarAvailable" src/
```

Expected: no output. Both were replaced — `capacityNote` by `calendarCaveat`, `calendarAvailable` by `caveat`. A leftover means one of the two paths is still live and they will disagree.

- [ ] **Step 6: Manual checks**

```bash
npm run dev &
npm run app:dev
```

1. **Cold start.** With no credentials saved, the Calendar section shows Client ID and Client secret fields, and the week header reads `calendar not set up`.
2. **The secret is masked.** It renders as dots; `show` reveals it; `hide` masks it again.
3. **Half a pair is refused.** Fill only the Client ID and press Save — nothing happens, and no error is thrown to the console.
4. **Save, then connect.** Paste both, Save. The fields are replaced by a Connect button and the header now reads `calendar not connected`. Click Connect; consent in the browser. On return the account address shows, the picker lists your calendars, and **the grid already has your meetings on it** without any further action.
5. **The caveat is gone.** With data covering the week, the header shows no calendar caveat at all.
6. **Navigate out of range.** Page to a week beyond six months. The header reads `no calendar data for this week` and the free figure is still shown.
7. **Picker.** Tick a second calendar. Its events appear on the grid within a moment. Untick it; they go. Try to untick the last remaining one — it must refuse.
8. **Refresh and the age label.** The `fetched …` line shows a plausible local time. Click Refresh; it updates.
9. **The rail does not overflow.** At a default desktop window, no horizontal scrollbar in the sidebar. A long account address and a long calendar name both ellipsis.
10. **All-day control.** Toggle "All-day events consume the whole day" in Working hours. A day carrying an all-day event flips between full and free **with no refetch** — watch the Network tab and confirm nothing fires.
11. **Panel persistence.** Expand Calendar, reload, still expanded. Collapse, reload, still collapsed.
12. **Disconnect.** Click Disconnect. Blocks vanish, the header reads `calendar not connected`, and the grant is gone from https://myaccount.google.com/permissions.
13. **Reconnect is not re-setup.** After disconnecting, the section shows Connect — not the credentials fields. The client credentials survive a disconnect; only the account grant does not.
14. **Browser.** `npm run dev` alone: the Calendar section reads "Google Calendar is only available in the desktop app", and the week header shows no calendar caveat.

- [ ] **Step 7: Report**

Test count delta, every grep result, the outcome of each manual check with what you actually observed, every deliberate-failure check from Tasks 1–6 with the failure observed, and anything left open.

---

## Notes for whoever executes this

**`src/views/plan/AvailabilityModal.tsx` is dead code.** It wraps `AvailabilitySettings` in a `Modal` titled "Working hours", and nothing imports it — `Plan.tsx:440` renders `AvailabilitySettings` directly inside a `SidebarSection`. It is not this plan's job to delete it, but do not use it as a precedent for where calendar settings should live, and mention it when you report.

**The `stale` health state has no UI beyond the `fetched …` label.** That is deliberate, not an omission — see "The decision this plan makes". If it turns out users want a louder staleness signal, the enum is already there to hang it on.
