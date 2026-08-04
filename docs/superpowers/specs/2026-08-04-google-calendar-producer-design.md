# Google Calendar producer (slice 2) — design

Date: 2026-08-04
Status: approved design
Supersedes, in part: `2026-07-26-google-calendar-capacity-design.md` (the "old
spec" throughout). Where the two disagree, this document wins.

## 1. Problem

Phase's claim is commitment honesty. The week header says
`24h 6m free · 9h 35m planned · 2h to place`, and the whole capacity engine —
`capacity.ts`, `slot.ts`, `freeIntervals`, `resolveSlot` — computes against it.

But **"free" today means your declared working hours minus what you scheduled
in Phase.** Your 09:00 lecture, your 15:00 standup and your Thursday lab are
invisible. The number is confidently wrong in exactly the situation it exists
to catch, and `⌘N` will happily place a two-hour step on top of a meeting.

The old spec designed the fix and slice 1 built half of it: the consumer.
`BusyBlock` is defined, `freeIntervals`/`freeMinutes`/`blockedBy` all take a
`blocks` array, `DayBlocks` renders calendar events, and `capacityNote` exists
to caveat a day the cache does not cover. Every call site passes `[]`.
`AvailabilitySettings.tsx:101` documents a checkbox that was *removed* because
"there is no producer of `BusyBlock` anywhere in `src/`."

**This spec builds the producer.** One end of a wire exists; this is the other.

## 2. Scope

In scope: pulling Google Calendar events into Phase, so events render on the
week grid and every capacity figure accounts for them.

Out of scope, each a separate future spec:

- **Writing to Google.** Deferred deliberately, not refused. The old spec's
  §2 refusal ("Phase stays the sole writer of Phase data. There is no sync
  engine, no conflict resolution, no tombstones, no sync tokens, no background
  job") remains correct *for two-way sync*. The intended follow-on is narrower
  and does not need any of that machinery: a **one-way projection into a
  dedicated "Phase" calendar** that Phase owns exclusively. Two disjoint sets —
  Phase authoritative for its own calendar, Google authoritative for everything
  else — so there is no conflict to reconcile. Nothing in this spec may
  foreclose it.
- **A month view.** Independent of Google entirely; `src/lib/calendar.ts`
  already exports `monthGrid(ym)` as the primitive.
- Any provider other than Google. See §3.1 on why the seam keeps this cheap.

## 3. Corrections to the old spec

The old spec was written on 2026-07-26 against an app that has since changed.
Five of its statements are now false and implementing it literally would
produce defects.

| Old spec says | Reality on 2026-08-04 |
|---|---|
| "Dexie `version(5)` adds a `calendarCache` table" | **v5 is `assets`** (`db.ts:48`). `calendarCache` is **`version(6)`**. |
| `SOFT_CAPACITY = 7` in `PlanWeekOverlay.tsx` | Both deleted in `b3e2c6e`. Every §3.1/§7.1 reference to them is dead. |
| "The planner is fixed to `weekOf(today)` … this feature does not add navigation, and does not depend on it" | **`Plan.tsx` navigates weeks freely** — `onPrev`/`onNext`/`onToday` at `Plan.tsx:449-451`, plus `[`/`]` at `Plan.tsx:272`. This invalidates the fixed fetch range. See §7. |
| §7.3 "The Today view is deliberately untouched" | The Today view was deleted and merged into Plan. The exclusion is moot. |
| §6 lists `electron/preload.cjs` as the only "new" module | `electron/main.cjs` is 64 lines with **no preload and no `ipcMain` at all**. Every main-process module in this spec is new. |

One thing the old spec got right and that this one inherits unchanged:
`main.cjs:22-25` already sets `contextIsolation: true, nodeIntegration: false`,
so a preload can be added without fixing a security posture first.

### 3.1 The seam is the reason this stays cheap

Old spec §2.1, retained verbatim as the governing rule:

> **1. All Google I/O and all timezone arithmetic live in the Electron main
> process.** Main fetches raw Google JSON, normalizes it, and sends only
> `BusyBlock[]` across IPC.
>
> **2. `src/` never sees Google JSON, a token, or a timezone.** It receives
> normalized blocks and computes capacity from them.

The consequence is that **the producer is swappable**. `calendarBridge.ts`,
`capacity.ts`, `slot.ts`, `DayBlocks` and every surface are identical whether
the blocks come from the Google API, macOS EventKit, or an ICS feed. Google was
chosen (see §5) but nothing downstream depends on that choice.

## 4. Modules

| Module | Responsibility | Pure? |
|---|---|---|
| `electron/busyBlocks.cjs` | Google JSON → `BusyBlock[]`: skip, split at local midnight, clip, merge | **yes** |
| `electron/googleClient.cjs` | calendar fan-out, pagination, token refresh | I/O, injected adapters |
| `electron/oauth.cjs` | PKCE loopback, `safeStorage`, revoke | I/O, injected adapters |
| `electron/credentials.cjs` | store/read the user's OAuth client id + secret | I/O |
| `electron/calendarIpc.cjs` | register handlers; wire the four above | thin |
| `electron/preload.cjs` | `contextBridge` → `window.phaseCalendar` | — |
| `src/lib/calendarBridge.ts` | adapter over `window.phaseCalendar`; stub when absent | boundary |
| `src/db/calendarCache.ts` | **the only module that touches the `calendarCache` table** | — |

The last row deliberately mirrors the existing rule for `src/db/assets.ts`.

The split exists so the code that can be *wrong* is pure. Every arithmetic
decision — merging overlaps, clipping at midnight, deciding a day is blocked —
lives in `busyBlocks.cjs` or in `src/lib`, both fixture-tested offline. The
modules that touch the network own no arithmetic.

## 5. Producer choice: the Google Calendar API

Three options were weighed.

**Chosen: the Google Calendar API.** `events.list` with `singleEvents=true`
makes Google expand recurrences server-side, so **no RRULE, EXDATE or
VTIMEZONE parsing ever enters this codebase**. That is a large and permanent
win: recurrence expansion is the bug swamp of every calendar integration, and
for a student most of the week *is* recurring. Both I/O modules take injected
adapters, so the whole producer is exercised offline.

Cost: it is the most code, and it requires a Google Cloud project you own
(§6.1). The API itself is free — no billing account, ~1,000,000 queries/day
quota against a workload of a handful of requests per planner open.

**Rejected: macOS EventKit via a Swift helper.** Would delete `oauth.cjs` and
`googleClient.cjs` outright and pick up iCloud, Exchange and subscribed course
feeds for free. Rejected because its failure surface is TCC permissions and
code signing, which no test can reach: `electron-builder` is configured with
`identity: null` (unsigned), and `npm run app:dev` runs stock Electron as the
host — whose `Info.plist` carries no `NSCalendarsFullAccessUsageDescription`.
It trades testable code for untestable environment behaviour, precisely where
development happens.

**Rejected: ICS secret-address feeds.** No OAuth and provider-agnostic, but it
inherits the RRULE/EXDATE/VTIMEZONE parsing the chosen option buys its way out
of, and Google caches secret-address feeds hard enough that an event added this
morning may not appear for hours. Stale inside the freshness window that
matters is a correctness bug for a planner, not an inconvenience.

## 6. Credentials and connect

### 6.1 The user brings their own OAuth client

Phase ships no client credentials. Rationale from the old spec §5.3 stands: a
desktop OAuth client's "secret" is not confidential, so shipping one would be
security theater, and — decisively — Google expires Calendar-scope refresh
tokens after **seven days** for external apps left in *Testing* publishing
status. A weekly forced re-consent would quietly destroy the weekly planning
ritual this feature exists to serve.

| Posture | Refresh token | Notes |
|---|---|---|
| Own client, **In production**, unverified | Persists | **Recommended.** One-time "Google hasn't verified this app" screen. |
| Own client, Testing | **Expires in 7 days** | Development only. |
| Verified production app | Persists | Requires Google review; out of scope. |

`docs/google-calendar-setup.md` is written as part of this work, and its most
important content is that table.

### 6.2 Change from the old spec: credentials are pasted, not a config file

Old §5.3 put the client id and secret in "local gitignored config." That works
only for someone running from source: it breaks at `npm run build:mac`, because
the file is not in the bundle and editing inside a `.app` is not a workflow.

Instead the client id and secret are **pasted into a field in Phase's Calendar
settings** and stored with `safeStorage` under `app.getPath('userData')`,
alongside the refresh token. Same location, same encryption, survives rebuilds,
identical for dev and packaged.

### 6.3 Scopes

| Scope | Needed for |
|---|---|
| `calendar.events.readonly` | `events.list` — the busy data |
| `calendar.calendarlist.readonly` | `calendarList.list` — the calendar picker |

`events.readonly` alone does not authorize `calendarList.list`. Both are
requested rather than the broader `calendar.readonly`, to keep the grant as
narrow as the feature requires.

### 6.4 OAuth loopback contract

Standard installed-app PKCE flow, entirely in main:

1. Generate a PKCE verifier/challenge and a cryptographically random `state`.
2. Start a one-shot HTTP listener on `127.0.0.1`, random free port. Google
   permits loopback redirects on any port for Desktop clients, so no per-port
   registration is needed.
3. `shell.openExternal` to the Google consent URL.
4. The listener accepts **only** the exact callback path; any other path 404s.
5. Compare the returned `state` against the generated one; a mismatch aborts.
6. Exchange code + verifier for tokens.
7. Encrypt the refresh token with `safeStorage`, store under `userData`.

Two hard requirements, both security properties rather than tidiness:

- **The flow times out** when the user never completes consent.
- **The listener is shut down on every outcome** — success, error, state
  mismatch, timeout, and window close. A leaked listening socket is a defect.

**Disconnect** revokes the token with Google, deletes the stored credential,
and deletes the `calendarCache` row. Disconnecting must not leave
calendar-derived data on disk.

## 7. Fetch range, cache, and triggers

### 7.1 The navigation problem

The old spec fixed the range at `[Monday of this week, +28d)` and justified it
with "the planner is fixed to `weekOf(today)`." That is no longer true. Left
alone, navigating six weeks out to place a deadline would show every day
reporting its nominal availability window as "free" — the exact
over-commitment this feature exists to prevent.

The cache must not become a union of disjoint ranges, because old §5.4's safety
rule depends on it being one atomic thing:

> The cache is replaced only if every selected calendar and every page
> succeeds. A partial result is discarded entirely and the previous cache is
> kept with its old `fetchedAt`.

A half-fetched week renders the missing calendar's meetings **as free time** —
silently wrong in the direction that causes over-commitment. Failing loudly to
stale-but-complete data is strictly safer than succeeding to incomplete data. A
patchwork cache would destroy that property.

### 7.2 One contiguous range that grows forward

Let `M` = Monday of the current week. All three bounds below are anchored to
`M`, not to the previously fetched range, so the arithmetic is stable across
refetches.

- **Base range:** `rangeStart = M − 7d`, `rangeEnd = M + 56d` (8 weeks). One
  week back so the `RecapPanel` week is covered — a past day reports what it
  *held*, and meetings held it. No further back; history is not planning input.
- **Navigating to a week whose Monday `W` satisfies `W + 7d > rangeEnd`
  extends `rangeEnd` to `W + 7d`** — enough to cover the visited week
  completely, not merely its first day — and refetches the whole range
  atomically. `rangeStart` never moves. The range only grows within a session,
  so bouncing between this week and week +10 does not thrash.
- **Capped at `M + 182d` (26 weeks).** If `W + 7d` would exceed the cap,
  `rangeEnd` is not extended and the visited week renders with the caveat
  (§10). Planning six months out at five-minute granularity is not a real
  activity, and an unbounded range is an unbounded payload.
- **Never extends backward.** A week before `M − 7d` renders with the caveat.
- **`M` is recomputed on each trigger**, so leaving the app open across a
  Sunday midnight rolls the window forward on the next fetch rather than
  stranding it on last week's anchor.

Anything outside the range renders **the window-derived free figure plus
`capacityNote`** — never suppressed, never presented as fact. This is slice 1's
amendment to old §5.5 and it already works; **slice 2 must not reintroduce
suppression of the free figure.**

### 7.3 Triggers

- Planner open.
- Navigation to a week the cache does not cover.
- Explicit Refresh.
- **On window focus, when the cache is older than 15 minutes.** New in this
  spec. Without it, a window left open overnight shows yesterday's calendar
  until the user notices. This is not a background poll — nothing runs while
  the app is unfocused or idle — but it means the numbers are right whenever
  someone is actually looking at them.

No background poll, and no timer while focused.

### 7.4 Fetch shape

A refresh is **selected calendars × pages**, not one call. `events.list`
addresses exactly one `calendarId`, and each may return several pages via
`nextPageToken`. Per calendar, per page: `singleEvents=true`.

### 7.5 Cache and provenance

```ts
export interface CalendarCache {
  rangeStart: string;    // 'YYYY-MM-DD' inclusive
  rangeEnd: string;      // 'YYYY-MM-DD' exclusive
  blocks: BusyBlock[];
  fetchedAt: string;     // ISO instant, for the staleness label
  // provenance: any mismatch invalidates the cache
  accountId: string;     // Google account the blocks came from
  calendarIds: string[]; // sorted; which calendars were queried
  timeZone: string;      // IANA zone the blocks were flattened against
}
```

Provenance is part of the cache, not metadata: without it, an account switch, a
changed calendar selection or a machine timezone change leaves stale blocks
rendering as current fact. The cache is **discarded, not displayed**, when
`accountId`, `calendarIds` or `timeZone` disagrees with current reality, or
when the user disconnects.

`allDayBlocks` is deliberately **not** in the provenance list. All-day blocks
are always cached; the preference is applied at read time in `capacity.ts`, so
toggling it never requires a refetch.

### 7.6 Where the cache lives — invariants

Dexie **`version(6)`** adds a single-row `calendarCache` table. Three rules,
each inherited from an existing invariant rather than invented here:

1. **Outside `AppState` and outside `persist()`**, exactly as `assets` is.
   `persist` is a full `clear()` + `bulkPut` of goals/habits/tasks/sessions
   (`db.ts:72-88`), so anything folded into it is rewritten on every checkbox
   tick. Calendar writes are surgical, through `src/db/calendarCache.ts`.
2. **Behind `ifOwner`.** A tab that does not hold the Web Lock never writes at
   all; the refresh itself is gated on ownership, not just the write.
3. **Excluded from backup export and import.** Calendar event titles must not
   land in a `phase-goals-*.json` a user might share. On import the cache is
   left untouched — device-local derived data, not user data.

In the renderer, the store gains `busyBlocks: BusyBlock[]` and a
`calendarStatus`. Both are read-only derived state: hydrated from the cache at
boot, replaced wholesale on a successful fetch. No action ever mutates a block.

## 8. IPC contract

Five `invoke`/`handle` channels and nothing else:

| Channel | Returns |
|---|---|
| `status()` | `{ configured, connected, accountId, timeZone }` |
| `connect()` | success, or a typed failure reason |
| `disconnect()` | — |
| `listCalendars()` | `{ id, summary, primary }[]` for the picker |
| `fetch({ rangeStart, rangeEnd, calendarIds })` | `{ ok: true, blocks, fetchedAt, accountId, timeZone }` or `{ ok: false, reason }` |

Three constraints:

- **No token, refresh token, or raw Google JSON ever crosses.** `status()`
  returns an account id for provenance, never a credential.
- **The renderer never supplies a URL.** `fetch` takes calendar ids and a date
  range; main builds the Google URL itself and validates every argument. This
  matters even though the renderer is first-party code: it means a
  renderer-side compromise cannot turn main into an arbitrary HTTP client.
- **Handlers register before the window loads**, so a fast first paint cannot
  call a channel that does not exist yet.

`calendarBridge.ts` checks for `window.phaseCalendar`. When it is absent —
which is `npm run dev` in a browser — it reports *not configured*, blocks stay
`[]`, and every other behaviour is byte-identical to today. **Exercising this
feature requires `npm run app:dev` or a packaged build.**

## 9. Renderer wiring

### 9.1 Threading

Ten hardcoded empty-block arrays exist in `src/`. Nine need real data:

`store.ts` lines 700, 1724, 1732, 1760, 1766, 1807, 1883, 1906, and
`Plan.tsx:145`. Line 1724 already carries `// slice 2 supplies real busy
blocks`.

The tenth, `migrateSlots.ts:74`, **stays empty, and that is correct** — it runs
at first hydration, before any calendar fetch, and its own comment says so.
Threading it would be a defect.

`store.ts:1732` and `1766` are the substantive ones: they are the
`freeIntervals` calls behind slot resolution, so once blocks flow, **`⌘N` and
auto-placement stop dropping work on top of meetings.** That is the feature
arriving, not merely a readout changing.

`Plan.tsx:145` also supplies `hasData` to `weekCapacity`, which is what drives
`capacityNote`.

### 9.2 Two defects in the currently-unexercised busy path

`DayBlocks.tsx:34` warns: *"currently unexercised. It still has to be correct
when it lights up."* It is not, in two places, and both must be fixed as part
of lighting it up:

1. **When `allDayBlocks` is on, timed events vanish from the grid.**
   `DayBlocks.tsx:85-87` builds `busy` as *either* the all-day block *or* the
   timed ones, never both. But `capacity.ts`'s `blockedBy` lists every event
   regardless of `allDay`. So a day header would read
   `blocked by: standup, 1:1, offsite` while the column showed one slab
   labelled "offsite". The grid and the header contradicting each other is the
   failure mode this product exists to avoid.
2. **Only the first all-day event survives.** `dayBlocks.find((b) => b.allDay)`
   at `DayBlocks.tsx:85` — a day with "Conference" *and* "Holiday" shows one
   and silently drops the other.

### 9.3 A dependency to name, not solve

An all-day event renders as a busy block spanning `DAY_START_MIN`→
`DAY_END_MIN`, which under the remastered grid is **1440px of solid column**
rather than the old 720px wash. The grid remaster's plan 3 proposes an all-day
lane, which is the correct home for these. This spec renders them as they are
and records the dependency; it does not pre-empt a plan that is not yet
written.

### 9.4 Surfaces

- **Day column headers** already render `free · planned · to place ·
  unestimated` and the `blocked by:` line via `capacityLabel.ts`. No change —
  they simply become true.
- **Calendar settings**, a section beside Working hours in the rail: connect /
  disconnect, connected account, calendar picker, `fetched at`, Refresh, and
  the client-credentials field from §6.2.
- **The `allDayBlocks` checkbox returns** to `AvailabilitySettings`. Its
  removal note (`AvailabilitySettings.tsx:101-116`) says restoring it is
  "putting this label back, nothing more."
- **Events stay inert.** `EventBlock.tsx:60` already sets `isBusy` and
  `EventBlock.tsx:72` disables the drag; busy blocks get no ×, ✓ or resize
  handle. Nothing to add — only not to undo.
- **Visual identity is locked.** This feature adds information, not styling.
  No new colours or components; `designScale.test.ts` governs as always.

## 10. Degraded states

Every failure resolves to *last known complete data plus a label* — never an
error pane, never a silently wrong zero.

| State | Behaviour |
|---|---|
| Not configured | Calendar UI offers setup; planner behaves exactly as today |
| Not connected | "Connect Google Calendar" affordance |
| Offline / any fetch failure | Cached blocks + "as of Tue 9:41am" staleness label |
| Refresh token expired or revoked | Cached blocks + re-connect prompt |
| Provenance mismatch | Cache discarded → free figure + `capacityNote`, plus a refresh prompt |
| Range not covered | Free figure + `capacityNote` ("does not yet account for meetings") |
| Connected, empty range | "No events" — genuinely free |

**"Connected, empty range" must render differently from "provenance mismatch"
and "range not covered".** An empty calendar means *you are genuinely free*; an
unavailable calendar means *Phase does not know*. Those two looking identical
is the single failure mode that would make the whole feature untrustworthy —
the first invites you to book the day, the second must not.

## 11. Testing

**No test touches the network.** `oauth.cjs` and `googleClient.cjs` take
injected HTTP, token and storage adapters, so both run fully offline.
`vitest.config.ts` gains `electron/**/*.test.ts` to its `include` (currently
`['src/**/*.test.ts', 'src/**/*.test.tsx']`).

**`electron/busyBlocks.test.ts`** — the highest bug density in the feature, so
the table is exhaustive: overlapping events (**the merge case: two overlapping
meetings contribute their union, never the sum of their durations**),
back-to-back events, overnight events, multi-day events, all-day events,
declined events (`attendees[].self && responseStatus === 'declined'`),
`transparency === 'transparent'`, `status === 'cancelled'`, events wholly
outside the range, and a DST transition day. Merged blocks join their
constituent titles so `blocked by:` stays truthful after a merge.

**`electron/googleClient.test.ts`** — multi-page pagination via `nextPageToken`,
token refresh on 401, and the critical one: **a partial failure discards the
whole result and leaves the previous cache and its `fetchedAt` intact.**

**New in this slice, beyond old §8:**

- Range extension: grows forward, never backward, caps at 26 weeks.
- Provenance invalidation on account, calendar-selection and timezone change.
- The two `DayBlocks` defects in §9.2, each pinned by a test that fails against
  today's code.
- The `calendarBridge` stub path, proving `npm run dev` in a browser is
  unchanged.
- `calendarCache` is absent from `exportState` output and untouched by
  `importStateFromFile`.

**Stated limit, so nobody fabricates coverage later:** the OAuth flow
end-to-end, the `safeStorage` round-trip, and the IPC boundary itself are **not
unit-testable**. They require the packaged app or `npm run app:dev`. They get a
written manual checklist, the same way the grid remaster's drag arithmetic did
— and for the same reason: a test that cannot distinguish correct from broken
is worse than an honest gap, because it reads as coverage.

## 12. Follow-ons

In the order they make sense, each its own spec:

1. **The projection** — one-way push of Phase's planned blocks into a dedicated
   "Phase" Google calendar. Needs a write scope and delete handling; needs no
   sync engine, because the two calendars are disjoint sets.
2. **Month view** — over Phase's own data plus this spec's events.
   `monthGrid(ym)` in `src/lib/calendar.ts` already exists.
3. **All-day lane** — grid remaster plan 3, which subsumes §9.3.
