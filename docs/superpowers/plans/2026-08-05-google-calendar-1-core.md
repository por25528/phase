# Google Calendar producer — the pure core (1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every pure piece of the Google Calendar producer — the event normalizer, the fetch-range arithmetic, the cache table — and fix the two defects already sitting in the unexercised busy-block path.

**Architecture:** Nothing in this plan touches the network, Electron, or OAuth. `electron/busyBlocks.cjs` is a pure main-process module (it lives there because slice 2's I/O modules will `require` it, and because `src/` must never see Google JSON) that takes raw `events.list` items plus a date range and an IANA timezone and returns disjoint, day-clipped, merged `BusyBlock[]`. `src/lib/calendarRange.ts` and `src/lib/busyLayout.ts` are ordinary pure `src/lib` modules with sibling tests. `src/db/calendarCache.ts` is the only module that may touch the new `calendarCache` table, mirroring the existing rule for `src/db/assets.ts`.

**Tech Stack:** TypeScript, Vitest, Dexie, `Intl.DateTimeFormat` for timezone arithmetic (no date library is added).

## Global Constraints

Every task's requirements implicitly include this section.

- **Spec:** `docs/superpowers/specs/2026-08-04-google-calendar-producer-design.md`. Where this plan and the spec disagree, stop and ask.
- **Both `npm test` and `npx tsc -b` must be green before every commit.** No commit may leave the build broken, even transiently.
- **Baseline: 1436 tests across 73 files** on a clean, idle run. `src/views/goals/BoardCard.keyboard.test.tsx` is a **known pre-existing flake** under parallel load — if it fails, re-run that file alone before investigating. It is not caused by this plan.
- **No test in this plan may touch the network, the filesystem, or a clock.** Every function here takes its inputs explicitly.
- **No Electron API** — no `require('electron')`, no `app`, `safeStorage`, `shell`, `ipcMain` — appears anywhere in this plan. Those arrive in plan 2. Everything here must run under Vitest's default `node` environment.
- `electron/*.cjs` files are **CommonJS**: `module.exports = { ... }`, `require(...)`. `main.cjs` loads them with `require`.
- **Visual identity is locked.** No new colours, no literal hex, no arbitrary `text-[Nrem]` — `src/lib/designScale.test.ts` fails the build on these.
- **`BusyBlock` is declared twice on purpose** — once in `src/db/types.ts` and once in `electron/busyBlocks.d.cts` — because the two sides of the process seam cannot import from each other. Any change to one must change the other, and both carry a comment saying so.
- Commit messages: imperative mood, no trailing period on the subject, and end with the `Co-Authored-By: Claude <noreply@anthropic.com>` trailer.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `vitest.config.ts` | **Modify** — add `electron/**/*.test.ts` to `include` | 1 |
| `tsconfig.node.json` | **Modify** — add `electron` to `include` so main-process tests are typechecked | 1 |
| `electron/busyBlocks.d.cts` | **Create** — the hand-written contract for the CJS normalizer | 1, 2, 3 |
| `electron/busyBlocks.cjs` | **Create** — skip rules, local-day expansion, clip, merge | 1, 2, 3 |
| `electron/busyBlocks.test.ts` | **Create** — the exhaustive normalizer table | 1, 2, 3 |
| `src/lib/calendarRange.ts` | **Create** — base range, forward-only extension, 26-week cap | 4 |
| `src/lib/calendarRange.test.ts` | **Create** | 4 |
| `src/db/types.ts` | **Modify** — add `CalendarCache` | 5 |
| `src/db/db.ts` | **Modify** — Dexie `version(6)`, `calendarCache` table declaration | 5 |
| `src/db/calendarCache.ts` | **Create** — the only module that touches the table | 5 |
| `src/db/calendarCache.test.ts` | **Create** | 5 |
| `src/db/db.test.ts` | **Modify** — clear the new table in `beforeEach`; assert import leaves it alone | 5 |
| `src/lib/busyLayout.ts` | **Create** — day → busy spans, with both defects fixed | 6 |
| `src/lib/busyLayout.test.ts` | **Create** | 6 |
| `src/views/plan/DayBlocks.tsx` | **Modify** — delegate to `busyLayout`, delete the inline logic | 6 |
| `docs/superpowers/specs/2026-08-04-google-calendar-producer-design.md` | **Modify** — record the all-day collapse decision | 6 |

---

### Task 1: Vitest and tsc reach the main process

Nothing under `electron/` is compiled or tested today. This task establishes that seam and proves it end-to-end with the smallest real piece of logic — the skip rules — so that no later task discovers the toolchain does not work after writing three hundred lines on top of it.

**Files:**
- Modify: `vitest.config.ts`
- Modify: `tsconfig.node.json`
- Create: `electron/busyBlocks.cjs`
- Create: `electron/busyBlocks.d.cts`
- Test: `electron/busyBlocks.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `shouldSkipEvent(event: GoogleEvent): boolean`, plus the `GoogleEvent`, `GoogleAttendee`, `GoogleDateTime` and `BusyBlock` types in `electron/busyBlocks.d.cts`.

- [ ] **Step 1: Let Vitest see `electron/`**

Modify `vitest.config.ts` — change only the `include` line:

```ts
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'electron/**/*.test.ts'],
```

- [ ] **Step 2: Let `tsc -b` see `electron/`**

Modify `tsconfig.node.json` — change only the `include` line:

```json
  "include": ["vite.config.ts", "electron"]
```

`allowJs` is deliberately NOT enabled. TypeScript therefore ignores `electron/main.cjs` and `electron/busyBlocks.cjs` entirely and typechecks only `.ts` and `.d.cts` files. The `.d.cts` is what gives the test its types.

- [ ] **Step 3: Write the contract file**

Create `electron/busyBlocks.d.cts`:

```ts
/**
 * The contract for `busyBlocks.cjs`.
 *
 * Hand-written because the module is CommonJS with no build step. It is also
 * the only place the main process states its output shape, so it doubles as
 * documentation of the process seam.
 *
 * `BusyBlock` below MUST stay identical to the one in `src/db/types.ts`. The
 * two sides of the IPC boundary cannot import from each other — main is CJS
 * under Node, the renderer is ESM under Vite — so the duplication is
 * deliberate. Change one, change the other.
 */

/** One end of a Google event. Exactly one of `date` / `dateTime` is present. */
export interface GoogleDateTime {
  /** 'YYYY-MM-DD' for an all-day event. On `end`, this is EXCLUSIVE. */
  date?: string;
  /** RFC3339 instant for a timed event, e.g. '2026-08-04T09:00:00-04:00'. */
  dateTime?: string;
}

export interface GoogleAttendee {
  /** True on the entry representing the authenticated user. */
  self?: boolean;
  responseStatus?: string;
}

/** Only the fields this module reads. `events.list` returns far more. */
export interface GoogleEvent {
  status?: string;
  transparency?: string;
  summary?: string;
  attendees?: GoogleAttendee[];
  start?: GoogleDateTime;
  end?: GoogleDateTime;
}

/** A busy slice, already flattened onto one local day. */
export interface BusyBlock {
  date: string;     // 'YYYY-MM-DD' local
  startMin: number; // clipped to that local day, 0..1440
  endMin: number;   // exclusive, > startMin
  title: string;
  allDay: boolean;
}

/**
 * True when an event must not consume any time.
 *
 * All-day events are deliberately NOT skipped here — they are always
 * normalized and cached, and the `allDayBlocks` preference is applied at read
 * time in `src/lib/capacity.ts`, so toggling it never requires a refetch.
 */
export declare function shouldSkipEvent(event: GoogleEvent): boolean;
```

- [ ] **Step 4: Write the failing test**

Create `electron/busyBlocks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldSkipEvent, type GoogleEvent } from './busyBlocks.cjs';

const TIMED: GoogleEvent = {
  status: 'confirmed',
  summary: 'standup',
  start: { dateTime: '2026-08-04T09:00:00-04:00' },
  end: { dateTime: '2026-08-04T09:15:00-04:00' },
};

describe('shouldSkipEvent', () => {
  it('keeps an ordinary confirmed event', () => {
    expect(shouldSkipEvent(TIMED)).toBe(false);
  });

  it('skips a cancelled event', () => {
    expect(shouldSkipEvent({ ...TIMED, status: 'cancelled' })).toBe(true);
  });

  it('skips an event marked Free in Google', () => {
    expect(shouldSkipEvent({ ...TIMED, transparency: 'transparent' })).toBe(true);
  });

  it('keeps an event explicitly marked Busy', () => {
    expect(shouldSkipEvent({ ...TIMED, transparency: 'opaque' })).toBe(false);
  });

  it('skips an event the user declined', () => {
    expect(shouldSkipEvent({
      ...TIMED,
      attendees: [{ self: true, responseStatus: 'declined' }],
    })).toBe(true);
  });

  // The `self` flag is what makes this specific to the user. Without it, one
  // colleague declining would delete the meeting from your own capacity.
  it('keeps an event someone ELSE declined', () => {
    expect(shouldSkipEvent({
      ...TIMED,
      attendees: [{ self: false, responseStatus: 'declined' }],
    })).toBe(false);
  });

  it('keeps an event the user accepted or has not answered', () => {
    for (const responseStatus of ['accepted', 'tentative', 'needsAction']) {
      expect(shouldSkipEvent({
        ...TIMED,
        attendees: [{ self: true, responseStatus }],
      }), responseStatus).toBe(false);
    }
  });

  // All-day events reach the cache regardless; the preference is read-time.
  it('keeps an all-day event', () => {
    expect(shouldSkipEvent({
      status: 'confirmed',
      summary: 'Conference',
      start: { date: '2026-08-04' },
      end: { date: '2026-08-05' },
    })).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
npx vitest run --config vitest.config.ts electron/busyBlocks.test.ts
```

Expected: FAIL — `Failed to resolve import "./busyBlocks.cjs"`. If instead you see "No test files found", the `vitest.config.ts` include from Step 1 is wrong; fix that before continuing.

- [ ] **Step 6: Write the implementation**

Create `electron/busyBlocks.cjs`:

```js
// Google events -> BusyBlock[]. Pure: no I/O, no clock, no network.
//
// This is a main-process module rather than a src/lib one because the seam
// says `src/` never sees Google JSON. It is nonetheless fully unit-tested
// offline; see busyBlocks.test.ts. Its contract lives in busyBlocks.d.cts.

/**
 * True when an event must not consume any time.
 *
 * All-day events are deliberately NOT skipped: they are always cached, and
 * the `allDayBlocks` preference is applied at read time in capacity.ts, so
 * toggling it never requires a refetch.
 */
function shouldSkipEvent(event) {
  if (event.status === 'cancelled') return true;
  if (event.transparency === 'transparent') return true;
  const attendees = event.attendees || [];
  // `self` matters: without it, a colleague declining would delete the
  // meeting from YOUR capacity.
  return attendees.some((a) => a.self === true && a.responseStatus === 'declined');
}

module.exports = { shouldSkipEvent };
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
npx vitest run --config vitest.config.ts electron/busyBlocks.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 8: Verify the typecheck reaches the new file**

```bash
npx tsc -b
```

Expected: exit 0, no output.

Then prove it is actually looking: temporarily add `const x: number = 'nope';` to the top of `electron/busyBlocks.test.ts`, re-run `npx tsc -b`, and confirm it FAILS with a type error. Remove the line and confirm it passes again. If it did not fail, `tsconfig.node.json` is not picking the file up and Step 2 must be fixed — otherwise every later task's test file is silently unchecked.

- [ ] **Step 9: Run the whole suite and commit**

```bash
npm test
```

Expected: 1444 tests / 74 files (baseline 1436 + 8).

```bash
git add vitest.config.ts tsconfig.node.json electron/busyBlocks.cjs electron/busyBlocks.d.cts electron/busyBlocks.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): test and typecheck the main process

Nothing under electron/ was compiled or tested. Adds it to both, and
proves the seam with the normalizer's skip rules: cancelled, marked
Free, and declined-by-you. An all-day event is deliberately kept — the
allDayBlocks preference is applied at read time in capacity.ts, so
filtering here would make toggling it require a refetch.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Expand an event onto local days

The single hardest piece of arithmetic in the feature. An event is an instant pair; a `BusyBlock` is minutes from local midnight on one named day. Getting this wrong shifts every meeting by hours without any test noticing, because the wrong answer is still a plausible number.

**Files:**
- Modify: `electron/busyBlocks.cjs`
- Modify: `electron/busyBlocks.d.cts`
- Test: `electron/busyBlocks.test.ts`

**Interfaces:**
- Consumes: `shouldSkipEvent`, `GoogleEvent` from Task 1.
- Produces: `expandToLocalDays(event: GoogleEvent, timeZone: string): BusyBlock[]` — one block per local day the event touches, with `title` and `allDay` already set. Not yet clipped to a range and not yet merged; Task 3 does both.

- [ ] **Step 1: Write the failing tests**

Append to `electron/busyBlocks.test.ts` (and add `expandToLocalDays` to the import at the top):

```ts
const NY = 'America/New_York';

function timed(summary: string, startIso: string, endIso: string): GoogleEvent {
  return { status: 'confirmed', summary, start: { dateTime: startIso }, end: { dateTime: endIso } };
}

describe('expandToLocalDays', () => {
  it('maps a timed event to minutes from local midnight', () => {
    expect(expandToLocalDays(timed('standup', '2026-08-04T09:00:00-04:00', '2026-08-04T09:15:00-04:00'), NY))
      .toEqual([{ date: '2026-08-04', startMin: 540, endMin: 555, title: 'standup', allDay: false }]);
  });

  // The instant is identical; only the zone differs. If this returns the same
  // block as the test above, the timezone argument is being ignored.
  it('reads the instant in the requested zone, not the machine zone', () => {
    expect(expandToLocalDays(timed('standup', '2026-08-04T13:00:00Z', '2026-08-04T13:15:00Z'), 'Europe/London'))
      .toEqual([{ date: '2026-08-04', startMin: 840, endMin: 855, title: 'standup', allDay: false }]);
  });

  it('puts a midnight start at minute 0, not minute 1440', () => {
    expect(expandToLocalDays(timed('batch', '2026-08-04T00:00:00-04:00', '2026-08-04T01:00:00-04:00'), NY))
      .toEqual([{ date: '2026-08-04', startMin: 0, endMin: 60, title: 'batch', allDay: false }]);
  });

  it('splits an overnight event at local midnight', () => {
    expect(expandToLocalDays(timed('flight', '2026-08-04T22:00:00-04:00', '2026-08-05T02:00:00-04:00'), NY))
      .toEqual([
        { date: '2026-08-04', startMin: 1320, endMin: 1440, title: 'flight', allDay: false },
        { date: '2026-08-05', startMin: 0, endMin: 120, title: 'flight', allDay: false },
      ]);
  });

  it('gives a multi-day event a full block for each day in between', () => {
    const spans = expandToLocalDays(timed('offsite', '2026-08-04T14:00:00-04:00', '2026-08-06T11:00:00-04:00'), NY);
    expect(spans).toEqual([
      { date: '2026-08-04', startMin: 840, endMin: 1440, title: 'offsite', allDay: false },
      { date: '2026-08-05', startMin: 0, endMin: 1440, title: 'offsite', allDay: false },
      { date: '2026-08-06', startMin: 0, endMin: 660, title: 'offsite', allDay: false },
    ]);
  });

  // An event ending exactly at midnight must not produce a zero-width block
  // on the following day. `endMin > startMin` is part of BusyBlock's contract,
  // and a 0..0 block would break assignLanes' clustering.
  it('does not emit an empty block when an event ends exactly at midnight', () => {
    expect(expandToLocalDays(timed('late', '2026-08-04T22:00:00-04:00', '2026-08-05T00:00:00-04:00'), NY))
      .toEqual([{ date: '2026-08-04', startMin: 1320, endMin: 1440, title: 'late', allDay: false }]);
  });

  // Google's all-day `end.date` is EXCLUSIVE. A one-day event is
  // 08-04 -> 08-05 and must produce exactly one block.
  it('expands a one-day all-day event to a single day', () => {
    expect(expandToLocalDays({
      status: 'confirmed', summary: 'Holiday',
      start: { date: '2026-08-04' }, end: { date: '2026-08-05' },
    }, NY)).toEqual([
      { date: '2026-08-04', startMin: 0, endMin: 1440, title: 'Holiday', allDay: true },
    ]);
  });

  it('expands a multi-day all-day event up to but excluding its end date', () => {
    expect(expandToLocalDays({
      status: 'confirmed', summary: 'Conference',
      start: { date: '2026-08-04' }, end: { date: '2026-08-07' },
    }, NY).map((b) => b.date)).toEqual(['2026-08-04', '2026-08-05', '2026-08-06']);
  });

  // Wall-clock is the right model for a calendar grid: on spring-forward the
  // local day is 23 real hours, but 01:00-04:00 still reads as 60..240.
  it('uses wall-clock minutes across a DST spring-forward', () => {
    expect(expandToLocalDays(timed('early', '2026-03-08T01:00:00-05:00', '2026-03-08T04:00:00-04:00'), NY))
      .toEqual([{ date: '2026-03-08', startMin: 60, endMin: 240, title: 'early', allDay: false }]);
  });

  it('falls back to a generic title when Google omits the summary', () => {
    const [block] = expandToLocalDays({
      status: 'confirmed',
      start: { dateTime: '2026-08-04T09:00:00-04:00' },
      end: { dateTime: '2026-08-04T10:00:00-04:00' },
    }, NY);
    expect(block.title).toBe('Busy');
  });

  it('returns nothing for an event missing either end', () => {
    expect(expandToLocalDays({ status: 'confirmed', summary: 'broken', start: {}, end: {} }, NY)).toEqual([]);
    expect(expandToLocalDays({ status: 'confirmed', summary: 'broken' }, NY)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run --config vitest.config.ts electron/busyBlocks.test.ts
```

Expected: FAIL — `expandToLocalDays is not a function`.

- [ ] **Step 3: Extend the contract file**

Append to `electron/busyBlocks.d.cts`:

```ts
/**
 * One block per local day the event touches, in chronological order.
 *
 * Not clipped to any range and not merged with other events — `normalizeEvents`
 * does both. Returns `[]` for an event missing either end.
 *
 * All-day events use Google's convention that `end.date` is EXCLUSIVE.
 */
export declare function expandToLocalDays(event: GoogleEvent, timeZone: string): BusyBlock[];
```

- [ ] **Step 4: Write the implementation**

Insert into `electron/busyBlocks.cjs`, above `module.exports`:

```js
const MINUTES_PER_DAY = 1440;
const DEFAULT_TITLE = 'Busy';

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' + n days, without touching the machine timezone. */
function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

/**
 * An RFC3339 instant read as wall-clock in `timeZone`.
 *
 * `hourCycle: 'h23'` is load-bearing: without it V8 formats local midnight as
 * hour "24", which would place a midnight event at minute 1440 of the previous
 * day instead of minute 0 of the correct one.
 */
function zonedParts(iso, timeZone) {
  const at = new Date(iso);
  const parts = {};
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (const p of fmt.formatToParts(at)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function expandToLocalDays(event, timeZone) {
  const start = event.start || {};
  const end = event.end || {};
  const title = event.summary || DEFAULT_TITLE;

  if (start.date && end.date) {
    // Google's all-day end.date is EXCLUSIVE.
    const out = [];
    for (let d = start.date; d < end.date; d = addDays(d, 1)) {
      out.push({ date: d, startMin: 0, endMin: MINUTES_PER_DAY, title, allDay: true });
    }
    return out;
  }

  if (!start.dateTime || !end.dateTime) return [];

  const from = zonedParts(start.dateTime, timeZone);
  const to = zonedParts(end.dateTime, timeZone);
  const out = [];
  for (let d = from.date; d <= to.date; d = addDays(d, 1)) {
    const startMin = d === from.date ? from.minute : 0;
    const endMin = d === to.date ? to.minute : MINUTES_PER_DAY;
    // An event ending exactly at midnight lands here with 0..0 on the day
    // after it really occupied. BusyBlock requires endMin > startMin, and a
    // zero-width block would confuse assignLanes' clustering.
    if (endMin > startMin) out.push({ date: d, startMin, endMin, title, allDay: false });
  }
  return out;
}
```

Add `expandToLocalDays` to the `module.exports` object.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run --config vitest.config.ts electron/busyBlocks.test.ts
```

Expected: PASS, 19 tests.

- [ ] **Step 6: Prove the midnight guard is load-bearing**

Temporarily change `hourCycle: 'h23'` to `hour12: false` and re-run. The test *"puts a midnight start at minute 0"* must FAIL with `1440` where `0` was expected. Restore `hourCycle: 'h23'` and confirm the suite passes again.

If that test does NOT fail, the environment already normalizes hour 24 and the guard is unproven on this machine — say so in your report rather than deleting the comment; it is still required on other ICU builds.

- [ ] **Step 7: Run the whole suite and typecheck**

```bash
npm test && npx tsc -b
```

Expected: 1455 tests / 74 files (1444 + 11). `tsc -b` exit 0.

- [ ] **Step 8: Commit**

```bash
git add electron/busyBlocks.cjs electron/busyBlocks.d.cts electron/busyBlocks.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): flatten events onto local days

An event is a pair of instants; a BusyBlock is minutes from local
midnight on one named day. This is where that conversion happens, and
where a mistake would shift every meeting by hours while still looking
like a plausible number.

Overnight and multi-day events split at local midnight. An event
ending exactly at midnight emits nothing on the following day, because
BusyBlock requires endMin > startMin and a zero-width block would
confuse assignLanes. All-day events follow Google's exclusive end.date.
Wall-clock minutes are used across DST, which is the right model for a
calendar grid.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Clip to the range and merge overlaps

The merge is the single likeliest source of a wrong number: two overlapping meetings must contribute their union, never the sum of their durations, or the day reports less free time than it has.

**Files:**
- Modify: `electron/busyBlocks.cjs`
- Modify: `electron/busyBlocks.d.cts`
- Test: `electron/busyBlocks.test.ts`

**Interfaces:**
- Consumes: `shouldSkipEvent`, `expandToLocalDays` from Tasks 1–2.
- Produces: `normalizeEvents(events: GoogleEvent[], options: { rangeStart: string; rangeEnd: string; timeZone: string }): BusyBlock[]` — disjoint per `(date, allDay)` group, sorted by `date` then `startMin`. **Guarantees at most one all-day block per date.**

- [ ] **Step 1: Write the failing tests**

Append to `electron/busyBlocks.test.ts` (and add `normalizeEvents` to the import):

```ts
const RANGE = { rangeStart: '2026-08-03', rangeEnd: '2026-08-10', timeZone: NY };

describe('normalizeEvents', () => {
  it('drops events the skip rules reject', () => {
    expect(normalizeEvents([
      { ...timed('standup', '2026-08-04T09:00:00-04:00', '2026-08-04T09:15:00-04:00'), status: 'cancelled' },
      { ...timed('lunch', '2026-08-04T12:00:00-04:00', '2026-08-04T13:00:00-04:00'), transparency: 'transparent' },
    ], RANGE)).toEqual([]);
  });

  // THE critical case. Sum would be 120 minutes; the union is 90.
  it('merges two overlapping meetings into their union, not their sum', () => {
    const out = normalizeEvents([
      timed('standup', '2026-08-04T09:00:00-04:00', '2026-08-04T10:00:00-04:00'),
      timed('1:1', '2026-08-04T09:30:00-04:00', '2026-08-04T10:30:00-04:00'),
    ], RANGE);
    expect(out).toEqual([
      { date: '2026-08-04', startMin: 540, endMin: 630, title: 'standup, 1:1', allDay: false },
    ]);
    expect(out[0].endMin - out[0].startMin).toBe(90);
  });

  it('merges a meeting wholly contained in another without shrinking it', () => {
    expect(normalizeEvents([
      timed('offsite', '2026-08-04T09:00:00-04:00', '2026-08-04T17:00:00-04:00'),
      timed('demo', '2026-08-04T11:00:00-04:00', '2026-08-04T11:30:00-04:00'),
    ], RANGE)).toEqual([
      { date: '2026-08-04', startMin: 540, endMin: 1020, title: 'offsite, demo', allDay: false },
    ]);
  });

  // Back-to-back is a touch, not an overlap. Capacity is identical either
  // way, so keeping them separate loses nothing and shows the user two
  // meetings instead of one invented three-hour block.
  it('keeps back-to-back meetings separate', () => {
    expect(normalizeEvents([
      timed('standup', '2026-08-04T09:00:00-04:00', '2026-08-04T10:00:00-04:00'),
      timed('1:1', '2026-08-04T10:00:00-04:00', '2026-08-04T11:00:00-04:00'),
    ], RANGE)).toEqual([
      { date: '2026-08-04', startMin: 540, endMin: 600, title: 'standup', allDay: false },
      { date: '2026-08-04', startMin: 600, endMin: 660, title: '1:1', allDay: false },
    ]);
  });

  it('never merges an all-day event into a timed one', () => {
    const out = normalizeEvents([
      { status: 'confirmed', summary: 'Holiday', start: { date: '2026-08-04' }, end: { date: '2026-08-05' } },
      timed('standup', '2026-08-04T09:00:00-04:00', '2026-08-04T10:00:00-04:00'),
    ], RANGE);
    expect(out.filter((b) => b.allDay)).toHaveLength(1);
    expect(out.filter((b) => !b.allDay)).toEqual([
      { date: '2026-08-04', startMin: 540, endMin: 600, title: 'standup', allDay: false },
    ]);
  });

  it('collapses several all-day events on one date into a single block', () => {
    const out = normalizeEvents([
      { status: 'confirmed', summary: 'Holiday', start: { date: '2026-08-04' }, end: { date: '2026-08-05' } },
      { status: 'confirmed', summary: 'Conference', start: { date: '2026-08-04' }, end: { date: '2026-08-05' } },
    ], RANGE);
    expect(out).toEqual([
      { date: '2026-08-04', startMin: 0, endMin: 1440, title: 'Holiday, Conference', allDay: true },
    ]);
  });

  it('merges across days independently', () => {
    const out = normalizeEvents([
      timed('a', '2026-08-04T09:00:00-04:00', '2026-08-04T10:00:00-04:00'),
      timed('b', '2026-08-05T09:00:00-04:00', '2026-08-05T10:00:00-04:00'),
    ], RANGE);
    expect(out.map((b) => b.date)).toEqual(['2026-08-04', '2026-08-05']);
    expect(out.map((b) => b.title)).toEqual(['a', 'b']);
  });

  it('drops a day before the range and keeps the first day of it', () => {
    const out = normalizeEvents([
      timed('before', '2026-08-02T09:00:00-04:00', '2026-08-02T10:00:00-04:00'),
      timed('first', '2026-08-03T09:00:00-04:00', '2026-08-03T10:00:00-04:00'),
    ], RANGE);
    expect(out.map((b) => b.title)).toEqual(['first']);
  });

  // rangeEnd is EXCLUSIVE, matching CalendarCache's documented contract.
  it('excludes the range end date and keeps the day before it', () => {
    const out = normalizeEvents([
      timed('last', '2026-08-09T09:00:00-04:00', '2026-08-09T10:00:00-04:00'),
      timed('after', '2026-08-10T09:00:00-04:00', '2026-08-10T10:00:00-04:00'),
    ], RANGE);
    expect(out.map((b) => b.title)).toEqual(['last']);
  });

  it('keeps only the in-range days of an event that straddles the range edge', () => {
    const out = normalizeEvents([
      timed('long', '2026-08-02T22:00:00-04:00', '2026-08-03T02:00:00-04:00'),
    ], RANGE);
    expect(out).toEqual([
      { date: '2026-08-03', startMin: 0, endMin: 120, title: 'long', allDay: false },
    ]);
  });

  it('returns blocks sorted by date then start', () => {
    const out = normalizeEvents([
      timed('later', '2026-08-05T14:00:00-04:00', '2026-08-05T15:00:00-04:00'),
      timed('earlier', '2026-08-04T09:00:00-04:00', '2026-08-04T10:00:00-04:00'),
      timed('midday', '2026-08-04T12:00:00-04:00', '2026-08-04T13:00:00-04:00'),
    ], RANGE);
    expect(out.map((b) => b.title)).toEqual(['earlier', 'midday', 'later']);
  });

  it('returns an empty array for no events, and still normalizes real input', () => {
    expect(normalizeEvents([], RANGE)).toEqual([]);
    expect(normalizeEvents([timed('one', '2026-08-04T09:00:00-04:00', '2026-08-04T10:00:00-04:00')], RANGE))
      .toEqual([{ date: '2026-08-04', startMin: 540, endMin: 600, title: 'one', allDay: false }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run --config vitest.config.ts electron/busyBlocks.test.ts
```

Expected: FAIL — `normalizeEvents is not a function`.

- [ ] **Step 3: Extend the contract file**

Append to `electron/busyBlocks.d.cts`:

```ts
export interface NormalizeOptions {
  rangeStart: string; // 'YYYY-MM-DD' inclusive
  rangeEnd: string;   // 'YYYY-MM-DD' EXCLUSIVE
  timeZone: string;   // IANA zone the blocks are flattened against
}

/**
 * Disjoint, day-clipped, merged blocks, sorted by date then start.
 *
 * Overlaps merge to their UNION and join their titles, so `blocked by:` stays
 * truthful after a merge and a day never reports less free time than it has.
 * Back-to-back events are a touch, not an overlap, and stay separate.
 *
 * Timed and all-day blocks are merged in separate groups — they are
 * distinguished by `allDay` and filtered separately downstream, so merging
 * across the two would destroy that distinction. A consequence worth relying
 * on: there is AT MOST ONE all-day block per date.
 */
export declare function normalizeEvents(events: GoogleEvent[], options: NormalizeOptions): BusyBlock[];
```

- [ ] **Step 4: Write the implementation**

Insert into `electron/busyBlocks.cjs`, above `module.exports`:

```js
/**
 * Fold a date-and-allDay group into disjoint blocks.
 *
 * Strictly `<`, not `<=`: back-to-back meetings touch but do not overlap, and
 * fusing them would invent a single block the user never scheduled while
 * changing no capacity figure.
 */
function mergeGroup(blocks) {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out = [];
  for (const block of sorted) {
    const last = out[out.length - 1];
    if (last && block.startMin < last.endMin) {
      last.endMin = Math.max(last.endMin, block.endMin);
      last.title = `${last.title}, ${block.title}`;
    } else {
      out.push({ ...block });
    }
  }
  return out;
}

function normalizeEvents(events, options) {
  const { rangeStart, rangeEnd, timeZone } = options;
  const groups = new Map();

  for (const event of events) {
    if (shouldSkipEvent(event)) continue;
    for (const block of expandToLocalDays(event, timeZone)) {
      // ISO dates compare correctly as strings. rangeEnd is EXCLUSIVE.
      if (block.date < rangeStart || block.date >= rangeEnd) continue;
      const key = `${block.date}:${block.allDay}`;
      const list = groups.get(key);
      if (list) list.push(block);
      else groups.set(key, [block]);
    }
  }

  const out = [];
  for (const group of groups.values()) out.push(...mergeGroup(group));
  return out.sort(
    (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin),
  );
}
```

Add `normalizeEvents` to the `module.exports` object.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run --config vitest.config.ts electron/busyBlocks.test.ts
```

Expected: PASS, 31 tests.

- [ ] **Step 6: Prove the merge test discriminates**

Temporarily change `mergeGroup`'s condition from `block.startMin < last.endMin` to `false` (never merge) and re-run. The test *"merges two overlapping meetings into their union, not their sum"* must FAIL. Then change it to `block.startMin <= last.endMin` and confirm *"keeps back-to-back meetings separate"* FAILS. Restore the original and confirm all pass.

Report both observed failures. A merge test that passes under a broken merge is the one failure this module cannot afford.

- [ ] **Step 7: Run the whole suite and typecheck**

```bash
npm test && npx tsc -b
```

Expected: 1467 tests / 74 files (1455 + 12). `tsc -b` exit 0.

- [ ] **Step 8: Commit**

```bash
git add electron/busyBlocks.cjs electron/busyBlocks.d.cts electron/busyBlocks.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): clip and merge normalized blocks

Overlapping meetings contribute their union, never the sum of their
durations — the sum would report a day as busier than it is and, once
the numbers drive resolveSlot, refuse gaps that exist. Merged blocks
join their titles so the "blocked by" line stays truthful.

Back-to-back meetings touch but do not overlap, and stay separate:
capacity is identical either way, and fusing them would invent a block
the user never scheduled.

Timed and all-day blocks merge in separate groups, since they are
filtered separately downstream. That leaves at most one all-day block
per date, which the grid relies on.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The fetch range

Spec §7.2. The old design fixed the range at `[Monday, +28d)` because the planner could not navigate. It can now, so the range has to follow — while staying ONE contiguous range, because the all-or-nothing cache rule depends on it.

**Files:**
- Create: `src/lib/calendarRange.ts`
- Test: `src/lib/calendarRange.test.ts`

**Interfaces:**
- Consumes: `addDays` from `src/lib/dates.ts`.
- Produces:
  - `interface DateRange { rangeStart: string; rangeEnd: string }`
  - `fetchRange(mondayOfCurrentWeek: string, visitedMonday: string, previousEnd?: string): DateRange`
  - `coversWeek(range: DateRange, monday: string): boolean`
  - constants `BASE_BACK_DAYS = 7`, `BASE_FORWARD_DAYS = 56`, `MAX_FORWARD_DAYS = 182`

- [ ] **Step 1: Write the failing test**

Create `src/lib/calendarRange.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  fetchRange, coversWeek,
  BASE_BACK_DAYS, BASE_FORWARD_DAYS, MAX_FORWARD_DAYS,
} from './calendarRange';
import { addDays } from './dates';

const M = '2026-08-03'; // a Monday

describe('fetchRange', () => {
  it('covers one week back and eight weeks forward by default', () => {
    expect(fetchRange(M, M)).toEqual({
      rangeStart: addDays(M, -BASE_BACK_DAYS),
      rangeEnd: addDays(M, BASE_FORWARD_DAYS),
    });
  });

  it('leaves the range alone for a week already inside it', () => {
    const base = fetchRange(M, M);
    expect(fetchRange(M, addDays(M, 21), base.rangeEnd)).toEqual(base);
  });

  // The visited week must be covered COMPLETELY, not just its Monday. A range
  // ending on the visited Monday leaves Tue-Sun reading as unknown.
  it('extends far enough to cover the whole visited week, not just its Monday', () => {
    const visited = addDays(M, 63); // week +9, past the 8-week base
    const out = fetchRange(M, visited, addDays(M, BASE_FORWARD_DAYS));
    expect(out.rangeEnd).toBe(addDays(visited, 7));
    expect(coversWeek(out, visited)).toBe(true);
  });

  it('never gives back ground it already covers', () => {
    const wide = addDays(M, 100);
    expect(fetchRange(M, M, wide).rangeEnd).toBe(wide);
  });

  it('caps the end at 26 weeks past the current Monday', () => {
    const out = fetchRange(M, addDays(M, 300));
    expect(out.rangeEnd).toBe(addDays(M, MAX_FORWARD_DAYS));
  });

  it('caps an already-wide previous end too', () => {
    expect(fetchRange(M, M, addDays(M, 400)).rangeEnd).toBe(addDays(M, MAX_FORWARD_DAYS));
  });

  it('never extends backward for a week before the range', () => {
    const out = fetchRange(M, addDays(M, -70));
    expect(out.rangeStart).toBe(addDays(M, -BASE_BACK_DAYS));
  });

  // Leaving the app open across Sunday midnight must roll the window forward
  // rather than stranding it on last week's anchor.
  it('re-anchors the start when the current Monday advances', () => {
    const next = addDays(M, 7);
    const out = fetchRange(next, next, addDays(M, BASE_FORWARD_DAYS));
    expect(out.rangeStart).toBe(addDays(next, -BASE_BACK_DAYS));
  });

  it('always returns a positive-width range', () => {
    for (const visited of [M, addDays(M, -70), addDays(M, 300)]) {
      const out = fetchRange(M, visited);
      expect(out.rangeEnd > out.rangeStart, visited).toBe(true);
    }
  });
});

describe('coversWeek', () => {
  const base = fetchRange(M, M);

  it('accepts a week wholly inside the range', () => {
    expect(coversWeek(base, addDays(M, 14))).toBe(true);
  });

  it('accepts the first week of the range', () => {
    expect(coversWeek(base, base.rangeStart)).toBe(true);
  });

  it('rejects a week before the range', () => {
    expect(coversWeek(base, addDays(base.rangeStart, -7))).toBe(false);
  });

  // The end is exclusive, so a week starting ON rangeEnd is outside, and so is
  // the last week that would run past it.
  it('rejects a week that starts inside but ends past the range', () => {
    expect(coversWeek(base, addDays(base.rangeEnd, -3))).toBe(false);
  });

  it('accepts the last week that fits exactly', () => {
    expect(coversWeek(base, addDays(base.rangeEnd, -7))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run --config vitest.config.ts src/lib/calendarRange.test.ts
```

Expected: FAIL — cannot resolve `./calendarRange`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/calendarRange.ts`:

```ts
import { addDays } from './dates';

/** Half-open: `rangeEnd` is EXCLUSIVE, matching CalendarCache. */
export interface DateRange {
  rangeStart: string;
  rangeEnd: string;
}

/** One week back, so the RecapPanel week is covered — a past day reports what it HELD. */
export const BASE_BACK_DAYS = 7;
/** Eight weeks forward covers ordinary planning without a refetch. */
export const BASE_FORWARD_DAYS = 56;
/** 26 weeks. Beyond this Phase declines to extend; see spec §7.2. */
export const MAX_FORWARD_DAYS = 182;

/**
 * The range a fetch should cover.
 *
 * ONE contiguous range, never a union of disjoint ones: the cache is replaced
 * only if every calendar and every page succeeds, because a half-fetch renders
 * the missing calendar's meetings as FREE TIME. A patchwork cache would
 * destroy that guarantee.
 *
 * Every bound is anchored to `mondayOfCurrentWeek`, not to the previous range,
 * so the arithmetic is stable across refetches and the window rolls forward on
 * its own when the app is left open past a Sunday midnight.
 *
 * The end grows and never shrinks within one anchor, so bouncing between this
 * week and week +10 refetches once rather than thrashing. It never grows
 * backward: history is not planning input.
 */
export function fetchRange(
  mondayOfCurrentWeek: string,
  visitedMonday: string,
  previousEnd?: string,
): DateRange {
  const rangeStart = addDays(mondayOfCurrentWeek, -BASE_BACK_DAYS);
  const cap = addDays(mondayOfCurrentWeek, MAX_FORWARD_DAYS);

  // The visited week must be covered COMPLETELY — +7, not +0, or Tue..Sun of
  // the week you navigated to would read as unknown.
  const wanted = [
    addDays(mondayOfCurrentWeek, BASE_FORWARD_DAYS),
    addDays(visitedMonday, 7),
    previousEnd ?? '',
  ].reduce((a, b) => (b > a ? b : a));

  return { rangeStart, rangeEnd: wanted > cap ? cap : wanted };
}

/** True when every day of the week beginning `monday` is inside `range`. */
export function coversWeek(range: DateRange, monday: string): boolean {
  return monday >= range.rangeStart && addDays(monday, 7) <= range.rangeEnd;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run --config vitest.config.ts src/lib/calendarRange.test.ts
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Prove the "whole visited week" test discriminates**

Temporarily change `addDays(visitedMonday, 7)` to `addDays(visitedMonday, 0)` and re-run. *"extends far enough to cover the whole visited week"* must FAIL. Restore it. Report the observed failure.

- [ ] **Step 6: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
```

Expected: 1481 tests / 75 files (1467 + 14). `tsc -b` exit 0.

```bash
git add src/lib/calendarRange.ts src/lib/calendarRange.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): the fetch range follows week navigation

The 2026-07-26 design fixed the range at [Monday, +28d) and justified
it with "the planner is fixed to weekOf(today)". Plan.tsx navigates
freely now, so six weeks out every day would report its nominal
availability window as free — the exact over-commitment this feature
exists to prevent.

Still ONE contiguous range rather than a union, because the cache is
all-or-nothing: a half-fetch renders a missing calendar's meetings as
free time, and a patchwork cache would destroy that guarantee. Grows
forward only, caps at 26 weeks, and re-anchors on the current Monday so
an app left open past Sunday midnight rolls forward instead of
stranding.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The cache table

Spec §7.5–7.6. Three invariants, each inherited rather than invented: outside `persist()`, behind `ifOwner`, and out of the backup.

`ifOwner` lives in the store and arrives in plan 3 — this task builds the table and its access module, and documents the requirement at the call site so plan 3 cannot miss it.

**Files:**
- Modify: `src/db/types.ts`
- Modify: `src/db/db.ts`
- Create: `src/db/calendarCache.ts`
- Test: `src/db/calendarCache.test.ts`
- Modify: `src/db/db.test.ts`

**Interfaces:**
- Consumes: `BusyBlock` from `src/db/types.ts`.
- Produces:
  - `interface CalendarCache` in `src/db/types.ts`
  - `loadCalendarCache(): Promise<CalendarCache | undefined>`
  - `saveCalendarCache(cache: CalendarCache): Promise<void>`
  - `clearCalendarCache(): Promise<void>`

- [ ] **Step 1: Add the type**

In `src/db/types.ts`, directly below the existing `BusyBlock` interface, add:

```ts
/**
 * The device-local calendar snapshot.
 *
 * Lives OUTSIDE AppState and outside persist() for the same reason `assets`
 * does: persist() is a full clear + bulkPut of four tables, so folding this in
 * would rewrite every cached event on every checkbox tick. Writes are surgical
 * and go through src/db/calendarCache.ts.
 *
 * Excluded from backup export and import — meeting titles must not land in a
 * phase-goals-*.json the user might share, and on import the cache is left
 * untouched because it is derived device state, not user data.
 */
export interface CalendarCache {
  rangeStart: string;    // 'YYYY-MM-DD' inclusive
  rangeEnd: string;      // 'YYYY-MM-DD' EXCLUSIVE
  blocks: BusyBlock[];
  fetchedAt: string;     // ISO instant, for the staleness label
  // Provenance: any mismatch invalidates the cache. Without it, an account
  // switch, a changed calendar selection or a machine timezone change leaves
  // stale blocks rendering as current fact.
  accountId: string;
  calendarIds: string[]; // sorted
  timeZone: string;      // IANA zone the blocks were flattened against
  // `allDayBlocks` is deliberately NOT provenance: all-day blocks are always
  // cached and the preference is applied at read time in capacity.ts, so
  // toggling it never requires a refetch.
}
```

- [ ] **Step 2: Add the table**

In `src/db/db.ts`, add the field declaration beside the others (after `assets!: Table<Asset, string>;`):

```ts
  calendarCache!: Table<CalendarCacheRow, string>;
```

Add above the class:

```ts
/**
 * Single-row table. The fixed key is what makes "at most one cache" a schema
 * property rather than a convention every writer has to remember.
 */
export type CalendarCacheRow = CalendarCache & { key: string };
export const CALENDAR_CACHE_KEY = 'current';
```

Extend the existing type import on `src/db/db.ts:2` — add `CalendarCache` to it:

```ts
import type { Goal, Habit, Task, Session, AppState, PlanReview, AvailabilityWindow, Asset, CalendarCache } from './types';
```

Then add a new version AFTER `version(5)` — do not edit v5, which is `assets`:

```ts
    this.version(6).stores({
      goals: 'id',
      habits: 'id',
      tasks: 'id',
      settings: 'key',
      sessions: 'id',
      planReview: 'week',
      assets: 'id',
      calendarCache: 'key',
    });
```

Finally, add a comment inside `persist()` immediately after the existing `assets` comment:

```ts
  // calendarCache is excluded for the same reason, and additionally because it
  // is derived device state that a backup restore must not resurrect.
```

- [ ] **Step 3: Write the failing test**

Create `src/db/calendarCache.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { loadCalendarCache, saveCalendarCache, clearCalendarCache } from './calendarCache';
import type { CalendarCache } from './types';

const CACHE: CalendarCache = {
  rangeStart: '2026-07-27',
  rangeEnd: '2026-09-28',
  blocks: [{ date: '2026-08-04', startMin: 540, endMin: 600, title: 'standup', allDay: false }],
  fetchedAt: '2026-08-04T13:41:00.000Z',
  accountId: 'me@example.com',
  calendarIds: ['primary'],
  timeZone: 'America/New_York',
};

beforeEach(async () => {
  await db.calendarCache.clear();
});

describe('calendarCache', () => {
  it('is absent before anything is written', async () => {
    expect(await loadCalendarCache()).toBeUndefined();
  });

  it('round-trips a cache', async () => {
    await saveCalendarCache(CACHE);
    expect(await loadCalendarCache()).toEqual(CACHE);
  });

  // The whole point of the fixed key. A second cache row would let a stale
  // range be read back as current.
  it('replaces the previous cache rather than adding a second row', async () => {
    await saveCalendarCache(CACHE);
    await saveCalendarCache({ ...CACHE, accountId: 'other@example.com' });
    expect(await db.calendarCache.count()).toBe(1);
    expect((await loadCalendarCache())?.accountId).toBe('other@example.com');
  });

  it('clears the cache', async () => {
    await saveCalendarCache(CACHE);
    await clearCalendarCache();
    expect(await loadCalendarCache()).toBeUndefined();
    expect(await db.calendarCache.count()).toBe(0);
  });

  it('does not leak its storage key back to callers', async () => {
    await saveCalendarCache(CACHE);
    expect(Object.keys((await loadCalendarCache())!)).not.toContain('key');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
npx vitest run --config vitest.config.ts src/db/calendarCache.test.ts
```

Expected: FAIL — cannot resolve `./calendarCache`.

- [ ] **Step 5: Write the implementation**

Create `src/db/calendarCache.ts`:

```ts
import type { CalendarCache } from './types';
import { db, CALENDAR_CACHE_KEY } from './db';

/**
 * The ONLY module that touches the `calendarCache` table.
 *
 * Mirrors the rule for db/assets.ts, and for the same reason: these writes are
 * surgical and must never be folded into persist(), which is a full clear +
 * bulkPut of the four app-data tables.
 *
 * Every caller in the renderer MUST wrap these writes in the store's `ifOwner`
 * — a tab that does not hold the Web Lock never writes at all. Refreshing is
 * gated on ownership too, not merely the write.
 */
export async function loadCalendarCache(): Promise<CalendarCache | undefined> {
  const row = await db.calendarCache.get(CALENDAR_CACHE_KEY);
  if (!row) return undefined;
  const { key: _key, ...cache } = row;
  return cache;
}

/** Clear-then-put in one transaction, so there is never a moment with two rows. */
export async function saveCalendarCache(cache: CalendarCache): Promise<void> {
  await db.transaction('rw', db.calendarCache, async () => {
    await db.calendarCache.clear();
    await db.calendarCache.put({ ...cache, key: CALENDAR_CACHE_KEY });
  });
}

export async function clearCalendarCache(): Promise<void> {
  await db.calendarCache.clear();
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx vitest run --config vitest.config.ts src/db/calendarCache.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 7: Prove the backup leaves the cache alone**

In `src/db/db.test.ts`, add `db.calendarCache.clear()` to the `Promise.all([...])` in `beforeEach`.

Then add this test inside the existing backup `describe` block (next to *"round-trips availability and allDayBlocks through a backup"*):

```ts
  // Spec §7.6: the cache is device-local derived data, not user data. An
  // import must not resurrect a stale calendar, and export must not put
  // meeting titles in a file the user might share. exportState itself is
  // untestable here — it drives DOM download APIs absent under
  // environment: 'node' — so the export side is guaranteed by construction:
  // exportState builds an explicit literal that has no calendarCache key.
  it('leaves the calendar cache untouched across an import', async () => {
    await saveCalendarCache({
      rangeStart: '2026-07-27', rangeEnd: '2026-09-28', blocks: [],
      fetchedAt: '2026-08-04T13:41:00.000Z', accountId: 'me@example.com',
      calendarIds: ['primary'], timeZone: 'America/New_York',
    });
    const backup = { goals: [goal('g1')], habits: [], tasks: [], sessions: [], pxPerDay: 40 };
    await importStateFromFile(fileOf(JSON.stringify(backup)));
    expect((await loadCalendarCache())?.accountId).toBe('me@example.com');
  });
```

Add the import at the top of `src/db/db.test.ts`:

```ts
import { loadCalendarCache, saveCalendarCache } from './calendarCache';
```

- [ ] **Step 8: Run, typecheck, and commit**

```bash
npm test && npx tsc -b
```

Expected: 1487 tests / 76 files (1481 + 5 + 1). `tsc -b` exit 0.

```bash
git add src/db/types.ts src/db/db.ts src/db/calendarCache.ts src/db/calendarCache.test.ts src/db/db.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): a device-local cache table

Dexie version(6) — v5 is assets, which the design doc predated. Three
invariants, each inherited rather than invented: the cache lives
outside AppState and outside persist(), because persist is a full clear
+ bulkPut of four tables and would rewrite every cached event on a
checkbox tick; writes go through one module, as assets do; and the
backup neither exports nor restores it, so meeting titles cannot land
in a file the user shares and an import cannot resurrect a stale
calendar.

The fixed row key makes "at most one cache" a schema property rather
than something every writer has to remember.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Fix the two defects in the busy path

Spec §9.2. `DayBlocks.tsx:34` says the busy path is *"currently unexercised. It still has to be correct when it lights up."* It is not correct, in two ways, and both would produce a grid that contradicts the day header beside it.

The fix extracts the logic into `src/lib` first, per the convention that pure logic lives there with a sibling test and views stay thin. That is also what makes it testable without jsdom or a `DndContext` wrapper.

**Files:**
- Create: `src/lib/busyLayout.ts`
- Test: `src/lib/busyLayout.test.ts`
- Modify: `src/views/plan/DayBlocks.tsx`
- Modify: `docs/superpowers/specs/2026-08-04-google-calendar-producer-design.md`

**Interfaces:**
- Consumes: `BusyBlock` from `src/db/types.ts`; `DAY_START_MIN`, `DAY_END_MIN` from `src/lib/grid.ts`.
- Produces: `interface BusySpan { key: string; title: string; startMin: number; endMin: number }` and `dayBusySpans(date: string, blocks: BusyBlock[], allDayBlocks: boolean): BusySpan[]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/busyLayout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dayBusySpans } from './busyLayout';
import { DAY_START_MIN, DAY_END_MIN } from './grid';
import type { BusyBlock } from '../db/types';

const DAY = '2026-08-04';

function timed(title: string, startMin: number, endMin: number, date = DAY): BusyBlock {
  return { date, startMin, endMin, title, allDay: false };
}
function allDay(title: string, date = DAY): BusyBlock {
  return { date, startMin: 0, endMin: 1440, title, allDay: true };
}

describe('dayBusySpans', () => {
  it('ignores blocks belonging to other days', () => {
    const spans = dayBusySpans(DAY, [timed('here', 540, 600), timed('elsewhere', 540, 600, '2026-08-05')], true);
    expect(spans.map((s) => s.title)).toEqual(['here']);
  });

  it('passes timed blocks through with their own bounds', () => {
    expect(dayBusySpans(DAY, [timed('standup', 540, 600)], true))
      .toEqual([{ key: `busy:${DAY}:0`, title: 'standup', startMin: 540, endMin: 600 }]);
  });

  // DEFECT 1. The old code built `busy` as EITHER the all-day block OR the
  // timed ones, so an all-day event made every meeting disappear from the
  // column while capacity.ts's blockedBy went on listing them. The grid and
  // the header contradicting each other is the failure this product exists to
  // avoid.
  it('keeps timed events visible on a day that also has an all-day event', () => {
    const spans = dayBusySpans(DAY, [allDay('Conference'), timed('standup', 540, 600)], true);
    expect(spans.map((s) => s.title)).toEqual(['Conference', 'standup']);
  });

  // DEFECT 2. The old code used find(), which silently dropped every all-day
  // event after the first.
  it('collapses several all-day events into one span with joined titles', () => {
    const spans = dayBusySpans(DAY, [allDay('Conference'), allDay('Holiday')], true);
    expect(spans).toEqual([
      { key: `busy:${DAY}:allday`, title: 'Conference, Holiday', startMin: DAY_START_MIN, endMin: DAY_END_MIN },
    ]);
  });

  it('spans the whole day for an all-day event', () => {
    const [span] = dayBusySpans(DAY, [allDay('Holiday')], true);
    expect(span.startMin).toBe(DAY_START_MIN);
    expect(span.endMin).toBe(DAY_END_MIN);
  });

  it('puts the all-day span first, so it lands in lane 0', () => {
    const spans = dayBusySpans(DAY, [timed('standup', 540, 600), allDay('Holiday')], true);
    expect(spans[0].title).toBe('Holiday');
  });

  // Matches capacity.ts, which filters `(allDayBlocks || !b.allDay)`. With the
  // preference off, an all-day event consumes nothing and shows nothing.
  it('drops all-day events when the preference is off, keeping timed ones', () => {
    const spans = dayBusySpans(DAY, [allDay('Conference'), timed('standup', 540, 600)], false);
    expect(spans.map((s) => s.title)).toEqual(['standup']);
  });

  it('gives every span a distinct key', () => {
    const spans = dayBusySpans(DAY, [allDay('Holiday'), timed('a', 540, 600), timed('b', 660, 720)], true);
    expect(new Set(spans.map((s) => s.key)).size).toBe(spans.length);
  });

  it('returns nothing for a day with no blocks, and still lays out a real day', () => {
    expect(dayBusySpans(DAY, [], true)).toEqual([]);
    expect(dayBusySpans(DAY, [timed('standup', 540, 600)], true)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run --config vitest.config.ts src/lib/busyLayout.test.ts
```

Expected: FAIL — cannot resolve `./busyLayout`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/busyLayout.ts`:

```ts
import type { BusyBlock } from '../db/types';
import { DAY_START_MIN, DAY_END_MIN } from './grid';

/** One calendar event as the grid needs it: geometry plus a label. */
export interface BusySpan {
  key: string;
  title: string;
  startMin: number;
  endMin: number;
}

/**
 * The calendar events one day column draws.
 *
 * Two rules, and they exist because the grid must never contradict the day
 * header beside it — `capacity.ts`'s `blockedBy` filters on exactly
 * `(allDayBlocks || !b.allDay)`, and this must agree with it:
 *
 * 1. **Timed events always render**, including on a day that also carries an
 *    all-day event. The previous inline version returned either the all-day
 *    block or the timed ones, so a day header could read
 *    `blocked by: standup, 1:1, offsite` above a column showing one slab.
 * 2. **All all-day events on a date collapse into ONE full-height span** with
 *    joined titles. The previous version took only the first, silently
 *    dropping the rest. Joining mirrors how overlapping blocks join titles in
 *    `electron/busyBlocks.cjs`.
 *
 * The all-day span comes first so `assignLanes` — which sorts by start, then
 * end — puts it in lane 0 with the timed events beside it.
 *
 * A full-height span is 1440px on the remastered grid, which is a lot of
 * column. The all-day LANE in the grid remaster's plan 3 is where these
 * belong; this function is what that plan will re-point rather than rewrite.
 */
export function dayBusySpans(date: string, blocks: BusyBlock[], allDayBlocks: boolean): BusySpan[] {
  const forDay = blocks.filter((b) => b.date === date);
  const spans: BusySpan[] = forDay
    .filter((b) => !b.allDay)
    .map((b, i) => ({ key: `busy:${date}:${i}`, title: b.title, startMin: b.startMin, endMin: b.endMin }));

  if (!allDayBlocks) return spans;

  const allDay = forDay.filter((b) => b.allDay);
  if (allDay.length === 0) return spans;

  return [
    {
      key: `busy:${date}:allday`,
      title: allDay.map((b) => b.title).join(', '),
      startMin: DAY_START_MIN,
      endMin: DAY_END_MIN,
    },
    ...spans,
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run --config vitest.config.ts src/lib/busyLayout.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Prove both defect tests discriminate**

Reproduce the old behaviour temporarily by replacing the body of `dayBusySpans` with:

```ts
  const forDay = blocks.filter((b) => b.date === date);
  const timedBlocks = forDay.filter((b) => !b.allDay);
  const allDayEvent = allDayBlocks ? forDay.find((b) => b.allDay) : undefined;
  return allDayEvent
    ? [{ key: `busy:${date}:allday`, title: allDayEvent.title, startMin: DAY_START_MIN, endMin: DAY_END_MIN }]
    : timedBlocks.map((b, i) => ({ key: `busy:${date}:${i}`, title: b.title, startMin: b.startMin, endMin: b.endMin }));
```

Re-run. **Both** *"keeps timed events visible…"* and *"collapses several all-day events…"* must FAIL. Restore the real implementation and confirm all 10 pass. Report both observed failures — a test that passes against the old code would not be pinning either defect.

- [ ] **Step 6: Make `DayBlocks` delegate**

In `src/views/plan/DayBlocks.tsx`:

Add to the imports:

```ts
import { dayBusySpans } from '../../lib/busyLayout';
```

Replace the whole block from `const dayBlocks = blocks.filter(...)` through the end of the `const busy: DayItem[] = ...` assignment (currently lines 83–112) with:

```ts
  const busy: DayItem[] = dayBusySpans(date, blocks, allDayBlocks).map((span) => ({
    key: span.key,
    kind: 'busy' as const,
    title: span.title,
    startMin: span.startMin,
    endMin: span.endMin,
    done: false,
    estimated: true,
    goalId: null,
    id: null,
  }));
```

Then update the stale doc comment at the top of the file. Replace:

```
 * `blocks` is always `[]` in this slice (Plan.tsx has no real calendar feed
 * yet — that arrives in a later task), so the busy/all-day path below is
 * currently unexercised. It still has to be correct when it lights up.
```

with:

```
 * `blocks` is still `[]` from Plan.tsx until the renderer wiring lands, but
 * the layout rules are no longer inline and unexercised: they live in
 * `src/lib/busyLayout.ts` with a sibling test that pins the two defects this
 * path used to carry.
```

Remove `DAY_END_MIN` and `DAY_START_MIN` from the `../../lib/grid` import if they are now unused — `noUnusedLocals` is on and `tsc -b` will fail otherwise.

- [ ] **Step 7: Verify nothing regressed**

```bash
npx vitest run --config vitest.config.ts src/views/plan src/lib/grid.test.ts
npx tsc -b
```

Expected: all pass; `tsc -b` exit 0.

- [ ] **Step 8: Record the decision in the spec**

The spec's §9.2 named the two defects but not the chosen behaviour. In `docs/superpowers/specs/2026-08-04-google-calendar-producer-design.md`, append to §9.2:

```markdown
**Resolution (decided during implementation).** Both are fixed in
`src/lib/busyLayout.ts`, extracted from `DayBlocks` so the rules are pure and
testable without a `DndContext`:

- Timed events always render, including on a day that carries an all-day
  event, so the column agrees with `blockedBy`.
- All all-day events on a date collapse into **one** full-height span with
  joined titles, mirroring how overlapping blocks join titles in
  `electron/busyBlocks.cjs`. `normalizeEvents` already guarantees at most one
  all-day block per date, but `dayBusySpans` does not rely on that.

The all-day span is emitted first so `assignLanes` places it in lane 0.
```

- [ ] **Step 9: Run the whole suite and commit**

```bash
npm test && npx tsc -b
```

Expected: 1497 tests / 77 files (1487 + 10). `tsc -b` exit 0.

```bash
git add src/lib/busyLayout.ts src/lib/busyLayout.test.ts src/views/plan/DayBlocks.tsx docs/superpowers/specs/2026-08-04-google-calendar-producer-design.md
git commit -m "$(cat <<'EOF'
fix(plan): correct the busy path before it lights up

DayBlocks warned that its calendar path was "currently unexercised. It
still has to be correct when it lights up." It was not.

With allDayBlocks on, the column showed either the all-day block or the
timed ones, never both — so a day could read "blocked by: standup, 1:1,
offsite" above a single slab labelled offsite. And find() kept only the
first all-day event, silently dropping the rest.

Both rules move to src/lib/busyLayout.ts, which is what makes them
testable at all: the inline version needed jsdom and a DndContext to
reach. Timed events now always render, and all-day events on a date
collapse into one span with joined titles, mirroring how overlapping
blocks join titles in the normalizer.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Verification sweep

**Files:** none created or modified unless a check fails.

- [ ] **Step 1: Full suite from clean**

```bash
npm test
```

Expected: **1497 tests / 77 files**, all passing. If `src/views/goals/BoardCard.keyboard.test.tsx` fails, re-run it alone (`npx vitest run --config vitest.config.ts src/views/goals/BoardCard.keyboard.test.tsx`); it is a known pre-existing flake under parallel load. Any OTHER failure is real — investigate before proceeding.

- [ ] **Step 2: Typecheck and production build**

```bash
npx tsc -b && npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Confirm the Electron shell still boots**

```bash
npx electron . --version 2>/dev/null || echo "skipped"
```

Then confirm `electron/main.cjs` is **unmodified** by this plan. `8777b84` is
the spec commit, i.e. the last commit before Task 1:

```bash
git diff --stat 8777b84..HEAD -- electron/main.cjs
```

Expected: empty output. This plan adds main-process modules but wires none of them; `main.cjs` changes in plan 2.

- [ ] **Step 4: Confirm no forbidden dependency crept in**

```bash
grep -rn "require('electron')\|from 'electron'" electron/*.cjs electron/*.ts 2>/dev/null | grep -v main.cjs
grep -rn "fetch(\|https\?://" electron/busyBlocks.cjs
```

Expected: no output from either. Everything this plan adds is pure.

- [ ] **Step 5: Confirm the seam holds**

```bash
grep -rn "googleapis\|GoogleEvent" src/ --include="*.ts" --include="*.tsx"
```

Expected: no output. `src/` must never see Google's shapes — it receives `BusyBlock[]` only.

- [ ] **Step 6: Confirm the duplicated type still agrees**

Compare the `BusyBlock` interface in `src/db/types.ts` against the one in `electron/busyBlocks.d.cts`. Field names, types and the `endMin` exclusivity comment must match. This cannot be automated across the process seam — read both and confirm.

- [ ] **Step 7: Report**

Write a short summary: test count delta, anything surprising, every deliberate-failure check from Tasks 2, 3, 4 and 6 with the failure actually observed, and any Minor left open.

---

## What this plan deliberately does NOT do

Named so a reviewer does not read them as omissions:

- **No `blocks` reach `Plan.tsx`.** Every call site still passes `[]`. The nine threading sites in spec §9.1 are plan 3.
- **No OAuth, no network, no IPC, no preload.** Plan 2.
- **`main.cjs` is untouched.** Nothing `require`s `busyBlocks.cjs` yet; it is proven by its tests, not by a caller.
- **No settings UI**, and the `allDayBlocks` checkbox stays removed. Plan 3.
- **The all-day lane** stays a grid-remaster plan 3 concern; `busyLayout.ts` is written to be re-pointed rather than rewritten.
