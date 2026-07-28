# Google Calendar capacity — design

Date: 2026-07-26
Status: approved design, not yet planned

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

### 2.1 The load-bearing architectural rule

> **No network code lands in `src/`.**

The Electron main process owns OAuth and all HTTP. It hands the renderer an
already-normalized `BusyBlock[]`. Everything in `src/lib/` stays pure and
side-effect-free, matching the existing convention.

This is not incidental. The part of this feature that can be *wrong* is the
capacity arithmetic — window math, overlap merging, midnight clipping. Keeping
it pure means all of it is unit-testable with fixtures, with no network, no
token, and no mock server.

### 2.2 Platform

Electron (`npm run app:dev`, `npm run build:mac`) is the product surface and
gets real calendar data. The browser dev server (`npm run dev`) gets a
disconnected stub: the feature reports "not connected" and every other part of
Phase behaves exactly as it does today. No browser code path is broken by this
feature's absence.

## 3. Data model

### 3.1 Additions to `src/db/types.ts`

```ts
// On GoalNode — leaves only. Absent means unestimated.
estimateMin?: number;
```

Optional, so every existing goal tree loads unchanged. No data migration.

`estimateMin` is meaningful on **leaves only**. If a node gains children and
becomes a container, `estimateMin` is dropped alongside `done`/`doneAt`, per the
existing leaf-XOR-container invariant. Any `estimateMin` found on a container is
ignored by `capacity.ts` rather than rolled up — containers are not planned, only
leaves are.

```ts
// One row per weekday. Absent dow, or startMin >= endMin, means "day off".
export interface AvailabilityWindow {
  dow: number;      // 0 = Mon … 6 = Sun, matching weekDates() order
  startMin: number; // minutes from local midnight; 540 = 09:00
  endMin: number;   // exclusive
}

// A busy slice, ALREADY flattened onto one local day.
export interface BusyBlock {
  date: string;     // 'YYYY-MM-DD' local
  startMin: number; // clipped to that local day, 0..1440
  endMin: number;   // exclusive, > startMin
  title: string;    // for the "blocked by" line
  allDay: boolean;
}

export interface CalendarCache {
  rangeStart: string;  // 'YYYY-MM-DD' inclusive
  rangeEnd: string;    // 'YYYY-MM-DD' exclusive
  blocks: BusyBlock[];
  fetchedAt: string;   // ISO instant, for the staleness label
}
```

`BusyBlock` is flattened onto local days **in the bridge, before `src/` sees
it**. Multi-day and cross-midnight events are split there. Consequently no
module in `src/lib/` ever performs timezone arithmetic.

### 3.2 Persistence

Dexie `version(5)` adds a `calendarCache` table, single-row, following the
existing `planReview` pattern (`clear()` + `put()` inside one transaction).

Availability windows persist as one JSON row in the existing `settings` table,
key `availability`. The shipped default is Mon–Fri 09:00–18:00 and Sat/Sun off
(`startMin: 540, endMin: 1080` for dow 0–4; no entry for dow 5–6). A malformed
or missing row falls back to this default rather than throwing.

**Backup exclusion:** `calendarCache` is *not* written by `exportState` and not
read by `importStateFromFile`. Calendar event titles must not land in a
`phase-goals-*.json` file the user might share, sync, or attach to an issue. On
import, the cache is left untouched — it is device-local derived data, not user
data.

## 4. Modules

| Module | Responsibility | Pure |
| --- | --- | --- |
| `src/lib/availability.ts` | Window model, validation, defaults, per-day window lookup | yes |
| `src/lib/busyBlocks.ts` | Google event JSON → `BusyBlock[]`: filter, clip, split, merge | yes |
| `src/lib/capacity.ts` | windows + blocks + planned leaves → per-day and per-week figures | yes |
| `src/lib/calendarBridge.ts` | Adapter over `window.phaseCalendar`; stub when absent | boundary |
| `electron/calendar.cjs` | OAuth PKCE loopback, Keychain token, `events.list` fetch | main |
| `electron/preload.cjs` | **new file** — `contextBridge` exposure of the calendar API | main |

Each pure module ships a sibling `*.test.ts`, per the repo convention.

### 4.1 `busyBlocks.ts` — normalization rules

This module holds the highest bug density in the feature, so its rules are
specified exhaustively. Given raw Google `events.list` items and a local date
range, it produces a **disjoint, day-clipped, merged** `BusyBlock[]`.

Events are **skipped** when any of these hold:

1. `status === 'cancelled'`
2. `transparency === 'transparent'` — the user marked it Free in Google
3. The user declined it: some `attendees[]` entry has `self === true` and
   `responseStatus === 'declined'`
4. It is all-day and the `allDayBlocks` setting is off (see §4.2)

Surviving events are then:

5. **Split** at local midnight, so an event spanning two days yields two blocks
6. **Clipped** to the requested date range
7. **Merged** where they overlap — two overlapping meetings must contribute
   their union, never the sum of their durations. This is the single most
   likely source of a wrong number and is tested directly.

Merged blocks keep the titles of their constituents (joined) so the "blocked
by" line stays truthful after a merge.

### 4.2 All-day events

An all-day event (`start.date` present, `start.dateTime` absent) that survives
the skip rules blocks the **entire availability window** for each day it
covers. A day-long "Conference" should zero out that day.

This is behind a setting, `allDayBlocks`, defaulting **on**. The escape hatch
matters because a calendar carrying all-day noise (a shared holiday feed, an
"on call" banner) would otherwise silently zero whole weeks. The user also
chooses which calendars are queried (§5.2), which is the primary defense.

### 4.3 `capacity.ts` — the honesty rule

For each day:

```
freeMin = Σ(window minutes) − Σ(merged busy ∩ window)
```

Busy time falling outside the availability window is ignored — a 22:00 event
does not reduce a 09:00–18:00 window. Free minutes are clamped at zero.

Against that, the planner reports **three separate numbers that are never
fused into one**:

- free minutes (from the calendar)
- planned minutes (sum of `estimateMin` over planned leaves)
- count of planned leaves with no `estimateMin`

Unestimated steps are **never** assigned a phantom duration. A single blended
number would look authoritative while being partly invented; three numbers stay
honest and the dangling count is itself the nudge to estimate.

**"Anyday" steps** — planned to the week via the planner's `anyday` drop zone,
with `plannedWeek` but no `plannedDay` — count toward the **week** totals only.
They are not charged to any day, because they are not on one.

## 5. Auth and fetch

### 5.1 OAuth

Standard OAuth 2.0 installed-app flow, entirely inside the main process:

1. Main starts a one-shot HTTP listener on `127.0.0.1` at a random free port
2. `shell.openExternal` opens the Google consent screen (PKCE challenge, the
   loopback as `redirect_uri`)
3. The listener catches the authorization code and shuts down immediately
4. Main exchanges code + PKCE verifier for tokens
5. The refresh token is encrypted with Electron `safeStorage` (macOS Keychain)
   and written to `app.getPath('userData')`

Scope: `https://www.googleapis.com/auth/calendar.events.readonly` — read-only,
and the narrowest scope that still exposes event titles and the all-day flag.

**The renderer never sees a token.** It calls `connect`, `disconnect`,
`getStatus`, and `fetchRange` over IPC and receives normalized data or a status.

Client credentials are read from environment/gitignored local config, never
committed. When unconfigured, the feature reports "not configured" and is
simply absent from the UI — never a broken pane. Setup is documented in
`docs/google-calendar-setup.md`, written as part of implementation.

### 5.2 Calendar selection

On connect, main lists the user's calendars and the user picks which count as
"busy" (default: primary only). Stored in `settings`. This is the main defense
against noisy shared calendars.

### 5.3 Refresh policy

One `events.list` call covering `[today, today + 28d)`, with `singleEvents=true`
so Google expands recurring events server-side — no RRULE, EXDATE, or VTIMEZONE
parsing anywhere in this codebase. Paginated via `nextPageToken`.

Fetch triggers:

- planner open
- explicit Refresh button
- planner navigation to a week outside the cached range

The cache holds exactly **one contiguous range**. Navigating outside it replaces
the cache with a fresh 28-day range anchored at the Monday of the week being
viewed — it does not accumulate disjoint ranges. A day with no cached coverage
renders as "no data", never as "free".

There is no background poll. The planner is opened a few times a week; a timer
would burn quota and introduce numbers that change mid-edit.

### 5.4 Degraded states

Every failure mode resolves to *last known data plus a label*, never an error
pane and never a silently wrong zero:

| State | Behavior |
| --- | --- |
| Not configured | Capacity UI absent; planner behaves exactly as today |
| Not connected | Capacity UI shows a "Connect Google Calendar" affordance |
| Offline / fetch failed | Cached blocks + "as of Tue 9:41am" staleness label |
| Token expired, refresh failed | Cached blocks + a re-connect prompt |
| Connected, empty range | "No events" — genuinely free, distinct from no data |

The distinction in the last row matters: an empty calendar and an unavailable
calendar must never render identically.

## 6. Surfaces

### 6.1 Week planner (primary)

Each day column header gains:

```
Tue  ·  3h 15m free  ·  2h planned  ·  2 unestimated
     blocked by: standup, 1:1, dentist
```

The week total replaces the hardcoded `SOFT_CAPACITY = 7` with a real figure.
Over-commitment (planned > free) is signalled using the existing visual
vocabulary — no new colors or components. Visual identity is locked; this
feature adds information, not styling.

Setting an estimate on a step is reachable inline from the planner so the
"unestimated" count is one keystroke from resolution.

### 6.2 Timeline (secondary, deliberately minimal)

A light per-day load tint across the ~28 cached days only — heavier tint means
more booked. **No numbers.** At the timeline's normal scale (~13px/day) figures
would be unreadable, and past the cache horizon there is no data.

The band stops exactly where the cached range stops. It reads as texture
showing where the crunch is, and it visibly stops where the truth stops rather
than fading into an implied "free."

### 6.3 Not included

The Today view is intentionally left alone in this iteration. Capacity is a
*commitment-time* signal; Today is an execution surface, and a free-hours
readout there risks reading as judgment rather than planning input. Revisit
after living with the planner numbers.

## 7. Testing

No test in this feature touches the network.

- `busyBlocks.test.ts` — fixtures for: overlapping events (the merge case),
  back-to-back events, cross-midnight events, multi-day events, all-day events
  with the setting on and off, declined events, `transparent` events, cancelled
  events, events wholly outside the availability window, and a DST transition
  day.
- `availability.test.ts` — window validation, day-off handling, malformed
  persisted JSON falling back to defaults.
- `capacity.test.ts` — free/planned/unestimated arithmetic, the zero clamp,
  anyday steps counting to the week but no day, a fully-booked day, and a day
  with no window.
- `store.test.ts` additions — the calendar slice driven by a fake bridge:
  connect, disconnect, fetch success, fetch failure preserving cached data.
- `db.test.ts` additions — `version(5)` migration over a v4 database;
  `calendarCache` absent from export and untouched by import.

## 8. Risks

**The numbers are only as good as the calendar.** Someone whose meetings live
outside Google, or who blocks focus time inconsistently, will see free hours
that overstate reality. Mitigations: the "blocked by" line makes the basis
visible and immediately falsifiable, and per-calendar selection lets the user
tune what counts. This is disclosed in the connect flow rather than discovered.

**Estimates decay.** `estimateMin` is a guess, and the sum inherits every
error. The three-number display keeps the guess visibly separate from the
calendar fact rather than blending them into false precision.

**Google verification.** `calendar.events.readonly` is a sensitive scope. An
unverified app stays in testing mode, capped at 100 users — sufficient for
personal and small-scale use, and documented in the setup guide so it is not a
surprise later.

## 9. Suggested implementation phasing

The feature is deliverable in three slices, each independently valuable and
independently testable. Every slice leaves the app shippable.

1. **Estimates and windows, no network.** Add `estimateMin`, the availability
   model, the settings UI, and `capacity.ts`. The planner shows planned hours
   and the unestimated count against the configured window — real value with
   zero Google involvement, and it proves the arithmetic before any OAuth code
   exists.
2. **Connect and fetch.** `electron/calendar.cjs`, `preload.cjs`, the bridge,
   `busyBlocks.ts`, the Dexie `version(5)` cache, and the degraded states. Free
   hours become calendar-aware.
3. **Timeline band.** The per-day load tint over the cached range.

Slice 1 is where the design risk lives, and it is the slice with no external
dependency — deliberately sequenced first.

## 10. Invariants preserved

- `estimateMin` is scheduling metadata. Like `start`, `deadline`, `plannedWeek`,
  and `Milestone`, it **never** affects the pct roll-up in `src/lib/pct.ts`.
- The `goals` array stays column-major; this feature adds no goal reordering.
- Views never call `db` or the bridge directly — everything routes through
  `actions` in the store.
- New pure logic lives in `src/lib` with a sibling test file.
- Visual identity is unchanged; no restyling.
