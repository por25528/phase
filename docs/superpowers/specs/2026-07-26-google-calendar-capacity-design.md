# Google Calendar capacity — design

Date: 2026-07-26
Status: approved design, revised after review

## 1. Problem

The week planner lets you commit any number of steps to a week with no notion of
whether the time exists. The only guard today is `SOFT_CAPACITY = 7` in
`PlanWeekOverlay.tsx` — a hardcoded guess at how many steps fit in a week,
identical for a free week and a week with four full days of meetings.

The result is the classic goal-app failure: a plan that was never physically
possible, followed by a recap full of carry-overs, followed by distrust of the
plan itself.

Google Calendar knows where the time actually went. This feature pulls that in
so the planner can show real capacity at the moment of commitment.

## 2. Scope

**Read-only, pull-only. Phase never writes to Google.**

Google is an input to planning, nothing else. Phase stays the sole writer of
Phase data. There is no sync engine, no conflict resolution, no tombstones, no
sync tokens, no background job.

Out of scope, explicitly:

- Writing planned steps into Google Calendar (push)
- Two-way sync
- Any calendar provider other than Google
- Meeting creation, editing, or RSVP
- **Planner week navigation.** The planner is fixed to `weekOf(today)`
  (`PlanWeekOverlay.tsx:90`). This feature does not add navigation, and does not
  depend on it.

### 2.1 The seam

Two rules, and they must not contradict each other:

> **1. All Google I/O and all timezone arithmetic live in the Electron main
> process.** Main fetches raw Google JSON, normalizes it, and sends only
> `BusyBlock[]` across IPC.
>
> **2. `src/` never sees Google JSON, a token, or a timezone.** It receives
> normalized blocks and computes capacity from them.

The normalizer is therefore a **main-process module** (`electron/busyBlocks.cjs`),
not a `src/lib` module. It is nonetheless pure — no I/O, no clock, no network —
so it is fully unit-testable offline. This is a deliberate, narrow exception to
the "pure logic lives in `src/lib`" convention, made because the code must run
where the timezone and the HTTP client are. `vitest.config.ts` gains
`electron/**/*.test.ts` to its `include` so these tests run in the normal suite.

Rationale: the part of this feature that can be *wrong* is arithmetic — window
math, overlap merging, midnight clipping, "time already gone". Every piece of it
is pure and fixture-tested on both sides of the seam. Nothing requires a network,
a token, or a mock server.

### 2.2 Platform

Electron is the product surface and gets real calendar data. The browser dev
server (`npm run dev`) gets a disconnected stub: the feature reports "not
connected" and all other Phase behavior is unchanged. No browser code path is
broken by this feature's absence.

## 3. Data model

### 3.1 Estimates

```ts
// On GoalNode — leaves only. Absent means unestimated.
estimateMin?: number;

// On Task — same meaning, same units.
estimateMin?: number;
```

Both optional, so every existing goal tree and task loads unchanged. No data
migration.

`estimateMin` is meaningful on **leaves only**. If a node gains children and
becomes a container, `estimateMin` is dropped alongside `done`/`doneAt`, per the
existing leaf-XOR-container invariant. Any `estimateMin` on a container is
ignored rather than rolled up.

`Task` carries an estimate because the planner grid already shows dated tasks
beside planned steps (`PlanWeekOverlay.tsx:213-220`). A workload figure that
counted only goal leaves would report spare capacity while tasks visibly occupied
the week — see §4.3.

### 3.2 Calendar types

```ts
export interface AvailabilityWindow {
  dow: number;      // 0 = Mon … 6 = Sun, matching weekDates() order
  startMin: number; // minutes from local midnight; 540 = 09:00
  endMin: number;   // exclusive
}

// A busy slice, ALREADY flattened onto one local day by the main process.
export interface BusyBlock {
  date: string;     // 'YYYY-MM-DD' local
  startMin: number; // clipped to that local day, 0..1440
  endMin: number;   // exclusive, > startMin
  title: string;
  allDay: boolean;
}

export interface CalendarCache {
  rangeStart: string;    // 'YYYY-MM-DD' inclusive
  rangeEnd: string;      // 'YYYY-MM-DD' exclusive
  blocks: BusyBlock[];
  fetchedAt: string;     // ISO instant, for the staleness label
  // --- provenance: any mismatch invalidates the cache (§5.5) ---
  accountId: string;     // Google account the blocks came from
  calendarIds: string[]; // sorted; which calendars were queried
  timeZone: string;      // IANA zone the blocks were flattened against
}
```

**Provenance is part of the cache, not metadata.** Without it, an account
switch, a changed calendar selection, or a machine timezone change leaves stale
blocks rendering as current fact. See §5.5.

Note `allDayBlocks` is **not** in the provenance list. All-day blocks are always
cached; the preference is applied at read time in `capacity.ts` (§4.2), so
toggling it never requires a refetch.

### 3.3 Persistence

Dexie `version(5)` adds a `calendarCache` table, single-row, following the
existing `planReview` pattern (`clear()` + `put()` in one transaction).

Availability windows and calendar preferences persist as JSON rows in the
existing `settings` table (keys `availability`, `calendarPrefs`).

**Backup exclusion:** `calendarCache` is not written by `exportState` and not
read by `importStateFromFile`. Calendar event titles must not land in a
`phase-goals-*.json` the user might share. On import the cache is left untouched
— it is device-local derived data, not user data.

## 4. Capacity computation (`src/lib/capacity.ts`, pure)

### 4.1 Remaining, not nominal

Capacity is measured **from now forward**, not across the whole week. A planner
opened Tuesday afternoon must not count Monday, nor Tuesday morning — that is
precisely the time that is already unrecoverable, and counting it reproduces the
over-commitment the feature exists to prevent.

`capacity.ts` therefore takes an explicit `now: { date: string; minute: number }`
argument (injected, never read from a clock — the module stays pure):

- a day **before** `now.date` → zero remaining capacity
- **`now.date` itself** → its availability window is clipped to start no earlier
  than `now.minute`
- days **after** → the full window

The distinction between *nominal* capacity (what the week held) and *remaining*
capacity (what you can still commit) is surfaced in the UI as well; the planner
shows remaining, because that is the number the decision depends on.

### 4.2 Free minutes

```
free(day) = Σ(window(day) clipped by now) − Σ(merged busy ∩ that clipped window)
```

Busy time outside the availability window is ignored — a 22:00 event does not
reduce a 09:00–18:00 window. Free minutes clamp at zero.

All-day blocks are consulted here, not at fetch time: when the `allDayBlocks`
preference is on, an all-day block zeroes its day's window; when off, all-day
blocks are skipped. Both directions are a pure filter over cached data.

### 4.3 Workload: unfinished commitments, both kinds

The week's workload is **unfinished** work of both kinds the planner displays:

- planned goal leaves where `!done` — note `plannedLeaves()` returns done leaves
  too (`plan.ts:65`), so this filter is mandatory
- dated tasks in the week where `!done`

This mirrors the existing `plannerOpenCount(placed, weekTasks)` in
`planner.ts`, which already defines "open work" across both kinds. Capacity must
not invent a narrower definition than the count sitting next to it.

### 4.4 The honesty rule

Three numbers, never fused into one:

- **free** minutes remaining (calendar fact)
- **planned** minutes (Σ `estimateMin` over unfinished commitments)
- **unestimated** count (unfinished commitments, either kind, with no estimate)

Unestimated work is never assigned a phantom duration. A single blended number
would look authoritative while being partly invented; three numbers stay honest,
and the dangling count is itself the nudge to estimate.

**"Anyday" steps** — `plannedWeek` set, no `plannedDay` — count toward the
**week** totals only. They are not charged to any day, because they are not on
one.

## 5. Google integration (main process)

### 5.1 Scopes

Two read-only scopes:

| Scope | Needed for |
| --- | --- |
| `calendar.events.readonly` | `events.list` — the busy data |
| `calendar.calendarlist.readonly` | `calendarList.list` — the calendar picker |

`events.readonly` alone does **not** authorize `calendarList.list`. Both are
requested, rather than the broader `calendar.readonly`, to keep the grant as
narrow as the feature actually requires.

### 5.2 OAuth loopback contract

Standard installed-app flow (PKCE), entirely in main:

1. Generate a PKCE verifier/challenge and a cryptographically random `state`
2. Start a one-shot HTTP listener on `127.0.0.1`, random free port
3. `shell.openExternal` to the Google consent URL
4. The listener accepts **only** the exact callback path; any other path 404s
5. The returned `state` is compared against the generated one; a mismatch aborts
   the flow and returns an error
6. Exchange code + verifier for tokens
7. Encrypt the refresh token with `safeStorage` (macOS Keychain), store under
   `app.getPath('userData')`

Hard requirements: the flow **times out** (user never completes consent), and
the listener is **shut down on every outcome** — success, error, state mismatch,
timeout, and window close. A leaked listening socket is a security defect, not
an untidiness.

**Disconnect** revokes the token with Google, deletes the stored credential, and
deletes the `calendarCache` row. Disconnect must not leave calendar-derived data
on disk.

### 5.3 Credentials: the user brings their own

Phase ships **no** client credentials. The user creates a Google Cloud project
and OAuth client and points Phase at it via local gitignored config.

This is the decisive factor: for **external** apps left in *Testing* publishing
status, Google expires Calendar-scope refresh tokens after **seven days**,
forcing a re-consent every week — which would quietly destroy the weekly
planning ritual this feature exists to support. A user-owned client can be set
to *Production* (accepting the one-time unverified-app warning) and its refresh
token persists.

It also sidesteps the credential problem honestly: desktop OAuth clients embed
their "secret" and it is not confidential. Shipping one would be security
theater. Not shipping one avoids the question.

Three deployment postures, documented in `docs/google-calendar-setup.md`:

| Posture | Refresh token | Notes |
| --- | --- | --- |
| Personal, own client, Production + unverified | Persists | **Recommended.** One-time warning screen. |
| Own client, Testing | **Expires in 7 days** | Development only. |
| Verified production app | Persists | Requires Google review; out of scope. |

Regardless of posture, refresh failure is handled gracefully (§5.6) rather than
assumed away.

### 5.4 Fetch: fan-out, pagination, all-or-nothing

A refresh is **selected calendars × pages**, not one call. `events.list`
addresses exactly one `calendarId`, and each may return several pages via
`nextPageToken`.

Per calendar, per page: `singleEvents=true` so Google expands recurrences
server-side — no RRULE, EXDATE, or VTIMEZONE parsing anywhere in this codebase.

**The cache is replaced only if every selected calendar and every page
succeeds.** A partial result is discarded entirely and the previous cache is
kept with its old `fetchedAt`. This is the critical rule: a half-fetched week
would render the missing calendar's meetings as *free time* — silently wrong in
the exact direction that causes over-commitment. Failing loudly to stale-but-
complete data is strictly safer than succeeding to incomplete data.

Range: `[Monday of the current week, +28d)`. Fetch triggers are planner open and
an explicit Refresh button. No background poll.

### 5.5 Cache invalidation

The cache is discarded, not displayed, when any provenance field disagrees with
current reality:

- `accountId` differs from the connected account (account switch)
- `calendarIds` differs from the current selection
- `timeZone` differs from the machine's current IANA zone
- the range does not cover the days being rendered
- the user disconnected

A day outside the cached range renders as **"no data"**, never as "free".

### 5.6 Degraded states

Every failure resolves to *last known complete data plus a label*, never an
error pane and never a silently wrong zero:

| State | Behavior |
| --- | --- |
| Not configured | Capacity UI absent; planner behaves exactly as today |
| Not connected | "Connect Google Calendar" affordance |
| Offline / any fetch failure | Cached blocks + "as of Tue 9:41am" staleness label |
| Refresh token expired/revoked | Cached blocks + re-connect prompt |
| Provenance mismatch | Cache discarded → "no data", plus a refresh prompt |
| Connected, empty range | "No events" — genuinely free |

The last two rows must render differently. An empty calendar and an unavailable
calendar looking identical is the failure mode that makes the whole feature
untrustworthy.

## 6. Modules

| Module | Responsibility | Pure |
| --- | --- | --- |
| `src/lib/availability.ts` | Window model, validation, defaults, per-day lookup | yes |
| `src/lib/capacity.ts` | windows + blocks + commitments + `now` → figures | yes |
| `src/lib/calendarBridge.ts` | Adapter over `window.phaseCalendar`; stub when absent | boundary |
| `electron/busyBlocks.cjs` | Google JSON → `BusyBlock[]`: filter, split, clip, merge | yes |
| `electron/googleClient.cjs` | Fan-out, pagination, token refresh — injected adapters | I/O |
| `electron/oauth.cjs` | PKCE loopback flow, `safeStorage`, revoke | I/O |
| `electron/preload.cjs` | **new** — `contextBridge` calendar API | main |

### 6.1 `busyBlocks.cjs` — normalization rules

Highest bug density in the feature, so the rules are exhaustive. Given raw
`events.list` items, a local date range, and an IANA timezone, it produces a
**disjoint, day-clipped, merged** `BusyBlock[]`.

Skip an event when any hold:

1. `status === 'cancelled'`
2. `transparency === 'transparent'` (marked Free in Google)
3. Declined by the user: some `attendees[]` entry with `self === true` and
   `responseStatus === 'declined'`

Note all-day events are **not** skipped here — they are always cached and
filtered at read time (§4.2).

Then:

4. **Split** at local midnight, so a multi-day or overnight event yields one
   block per local day
5. **Clip** to the requested range
6. **Merge** overlaps — two overlapping meetings contribute their union, never
   the sum of their durations. This is the single likeliest source of a wrong
   number and is tested directly.

Merged blocks join their constituent titles so the "blocked by" line stays
truthful after a merge.

### 6.2 Availability validation

A persisted window set is valid only if every entry has an **integer** `dow` in
`0..6`, `dow` values are **unique**, and `0 ≤ startMin < endMin ≤ 1440`. Any
violation falls back to the shipped default — Mon–Fri 09:00–18:00, Sat/Sun off
(`startMin: 540, endMin: 1080` for dow 0–4; no entry for 5–6) — rather than
throwing or rendering partial garbage.

## 7. Surfaces

### 7.1 Week planner (primary)

Each day column header gains:

```
Tue  ·  3h 15m free  ·  2h planned  ·  2 unestimated
     blocked by: standup, 1:1, dentist
```

"free" is *remaining* capacity (§4.1). The week total replaces the hardcoded
`SOFT_CAPACITY = 7`. Over-commitment is signalled with the existing visual
vocabulary — no new colors or components. Visual identity is locked; this feature
adds information, not styling.

Setting an estimate is reachable inline from the planner, so the "unestimated"
count is one keystroke from resolution — for both steps and tasks.

### 7.2 Timeline (secondary, minimal)

A light per-day load tint across the cached range only — heavier means more
booked. **No numbers**: at ~13px/day they would be unreadable, and past the cache
horizon there is no data. The band stops exactly where the cache stops, so it
visibly ends where the truth ends rather than fading into an implied "free".

### 7.3 Not included

The Today view is deliberately untouched. Capacity is a *commitment-time*
signal; Today is an execution surface, where a free-hours readout reads as
judgment rather than planning input. Revisit after living with the planner
numbers.

## 8. Testing

No test touches the network. Main-process modules take **injected** HTTP, token,
and storage adapters, so they are exercised fully offline.

**`electron/busyBlocks.test.ts`** — overlapping events (the merge case),
back-to-back events, overnight events, multi-day events, all-day events,
declined events, `transparent` events, cancelled events, events wholly outside
the range, and a DST transition day.

**`electron/googleClient.test.ts`** — multi-page pagination via `nextPageToken`;
multi-calendar fan-out; **partial failure discards the whole result and keeps
the prior cache**; refresh-token failure surfaces as a typed re-connect error.

**`electron/oauth.test.ts`** — `state` mismatch aborts; wrong callback path
404s; timeout path; listener shut down on every outcome including error and
timeout; disconnect revokes and deletes both credential and cache.

**`src/lib/capacity.test.ts`** — free/planned/unestimated arithmetic; the zero
clamp; **past days yield zero and today's window clips to `now.minute`**; anyday
steps counting to the week but no day; done leaves and done tasks excluded;
unfinished tasks without estimates landing in the unestimated bucket; a
fully-booked day; a day with no window; `allDayBlocks` on and off over identical
cached data.

**`src/lib/availability.test.ts`** — duplicate `dow`, non-integer `dow`,
out-of-range `dow`, `startMin >= endMin`, `endMin > 1440`, malformed JSON — each
falling back to the default.

**`src/state/store.test.ts`** additions — the calendar slice against a fake
bridge: connect, disconnect, fetch success, fetch failure preserving cached
data, each provenance mismatch discarding the cache.

**`src/db/db.test.ts`** additions — `version(5)` migration over a v4 database;
`calendarCache` absent from export and untouched by import.

## 9. Risks

**The numbers are only as good as the calendar.** Someone whose meetings live
outside Google, or who blocks focus time inconsistently, will see free hours
that overstate reality. Mitigation: the "blocked by" line makes the basis
visible and immediately falsifiable, and per-calendar selection tunes what
counts. Disclosed in the connect flow rather than discovered later.

**Estimates decay.** `estimateMin` is a guess and the sum inherits every error.
The three-number display keeps the guess visibly separate from the calendar fact
rather than blending them into false precision.

**Setup friction.** Bringing your own Google Cloud client is a real barrier
compared to a one-click connect. Accepted deliberately: the alternative is
either a weekly re-consent (Testing mode's 7-day refresh expiry) or shipping a
non-secret secret. The setup guide carries this cost.

## 10. Implementation phasing

Three slices, each independently valuable, each leaving the app shippable.

1. **Estimates, windows, and capacity — no network.** `estimateMin` on
   `GoalNode` and `Task`, `availability.ts`, `capacity.ts` (including `now`
   clipping), the settings UI, and the planner's three-number display against an
   empty block list. Real value with zero Google involvement, and it proves the
   arithmetic before any OAuth code exists.
2. **Connect and fetch.** `oauth.cjs`, `googleClient.cjs`, `busyBlocks.cjs`,
   `preload.cjs`, `calendarBridge.ts`, Dexie `version(5)`, provenance and
   invalidation, degraded states. Free hours become calendar-aware.
3. **Timeline band.** The per-day load tint over the cached range.

Slice 1 carries the design risk and has no external dependency — deliberately
sequenced first.

## 11. Invariants preserved

- `estimateMin` is scheduling metadata. Like `start`, `deadline`, `plannedWeek`,
  and `Milestone`, it **never** affects the pct roll-up in `src/lib/pct.ts`.
- The `goals` array stays column-major; this feature adds no goal reordering.
- Views never call `db` or the bridge directly — everything routes through
  `actions`.
- Visual identity is unchanged; no restyling.
- New pure renderer logic lives in `src/lib` with a sibling test. The one
  exception — the main-process normalizer — is justified in §2.1 and tested to
  the same standard.
