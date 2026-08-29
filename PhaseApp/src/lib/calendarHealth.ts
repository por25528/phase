import type { CalendarStatus, CalendarFetchFailure } from './calendarBridge';

/**
 * How old a cache may get before a window focus is worth a refetch.
 *
 * This is NOT a poll interval — nothing runs on a timer. Meetings move on
 * human timescales, and a quarter of an hour is short enough that a meeting
 * added on a phone shows up by the time you look at the planner again.
 *
 * It lives here, in `lib`, rather than beside the hook that acts on it:
 * `lib` is the pure layer and must not import from `views`, and it is this
 * module — the one that judges staleness — that the number belongs to. The
 * hook imports it, which is the direction the dependency should run.
 */
export const CALENDAR_STALE_MS = 15 * 60 * 1000;

/**
 * How old the data may get before the header says so out loud.
 *
 * `CALENDAR_STALE_MS` earns no caveat: blocks that were true fifteen minutes
 * ago are almost certainly still true, and a notice that flickers on every
 * dropped wifi association is one people learn to ignore. Two hours is a
 * different claim — a machine that has not reached Google since before lunch
 * is drawing this afternoon's grid out of this morning's events, and that is
 * worth one quiet line.
 *
 * Bounded deliberately, and well inside a working day: the failure this exists
 * to end is silence, not noise.
 */
export const CALENDAR_UNREACHED_MS = 2 * 60 * 60 * 1000;

/**
 * The fetch failures that mean "try again", as opposed to the two that mean
 * the data is genuinely gone.
 *
 * `not-connected` and `reauth-required` are absent because they are not
 * transient: the store drops the blocks on those, and `calendarHealth` reports
 * them ahead of anything about age. Everything here leaves the last known good
 * blocks on screen, which is why it needs an age before it is worth saying.
 */
const TRANSIENT: ReadonlySet<CalendarFetchFailure> = new Set<CalendarFetchFailure>([
  'request-failed', 'malformed-data', 'invalid-time-zone', 'corrupt',
  'no-calendars', 'invalid-range', 'not-configured',
]);

/**
 * Why the week header's figures may not be the whole truth.
 *
 * Ordered by what the user would have to DO about it, which is also the order
 * the checks run in: you cannot connect before configuring, and you cannot
 * cover a week with a token that has expired.
 */
export type CalendarHealth =
  | 'no-integration'  // a browser — there is no producer to ask
  | 'not-configured'  // no OAuth client at all: none shipped, none saved
  | 'not-connected'   // configured, but no account has consented
  | 'reauth-required' // the refresh token was revoked, expired, or is for another client
  | 'beyond-horizon'  // connected and healthy, but this week is past what a fetch reaches
  | 'out-of-range'    // this week is not in the cache yet, and could be
  | 'refresh-failed'  // the blocks on screen are real, but the last refresh did not land
  | 'out-of-date'     // nothing failed by name; the data is simply old
  | 'stale'           // covered, and past the refresh interval but not yet worth saying
  | 'ok';

export interface CalendarHealthInput {
  status: CalendarStatus | null;
  /** The reason the last fetch failed, if it did. */
  lastError: CalendarFetchFailure | null;
  /** Whether the cached range covers the week being rendered. */
  coversWeek: boolean;
  /** Whether that week is past anything a fetch could ever reach. */
  beyondHorizon: boolean;
  fetchedAt: string | null;
  nowMs: number;
}

export function calendarHealth(input: CalendarHealthInput): CalendarHealth {
  const { status, lastError, coversWeek, beyondHorizon, fetchedAt, nowMs } = input;
  if (!status) return 'no-integration';
  if (!status.configured) return 'not-configured';
  // Before `connected`, because a revoked token — or one issued for an OAuth
  // client this build no longer uses — leaves the producer still reporting a
  // stored connection it can no longer spend.
  if (lastError === 'reauth-required') return 'reauth-required';
  if (!status.connected) return 'not-connected';
  if (!coversWeek) return beyondHorizon ? 'beyond-horizon' : 'out-of-range';

  // A timestamp that will not parse is not evidence of freshness. `NaN` fails
  // every comparison, so it has to be caught rather than compared.
  const age = fetchedAt === null ? Infinity : nowMs - Date.parse(fetchedAt);
  const settled = Number.isFinite(age) ? age : Infinity;

  // A named failure outranks a bare age: "didn't refresh" tells the user
  // something happened, where "may be out of date" only says time passed.
  if (lastError && TRANSIENT.has(lastError) && settled >= CALENDAR_STALE_MS) return 'refresh-failed';
  if (settled >= CALENDAR_UNREACHED_MS) return 'out-of-date';
  if (settled >= CALENDAR_STALE_MS) return 'stale';
  return 'ok';
}

/**
 * The caveat shown beside the week's figures, or `null` for the states where
 * they need no qualification.
 *
 * Each string names the FIX, not the diagnosis. "Provenance mismatch" is true
 * and useless; "calendar needs reconnecting" is what the user can act on.
 * Where there is no fix — a week past the horizon, data that is merely old —
 * it names the LIMIT instead, so the figures are read for what they are.
 */
export function calendarCaveat(health: CalendarHealth): string | null {
  switch (health) {
    case 'not-configured': return 'calendar not set up';
    case 'not-connected': return 'calendar not connected';
    case 'reauth-required': return 'calendar needs reconnecting';
    case 'out-of-range': return 'no calendar data for this week';
    // NOT "no data for this week", which reads as a promise that more is on
    // the way. Nothing is: the fetch range stops here by design.
    case 'beyond-horizon': return 'calendar reaches six months out';
    case 'refresh-failed': return "calendar didn't refresh";
    case 'out-of-date': return 'calendar may be out of date';
    // 'stale' is deliberately silent: the blocks shown were true minutes ago.
    // Age belongs beside the Refresh button in Settings until it grows past
    // `CALENDAR_UNREACHED_MS`, at which point 'out-of-date' says it here.
    // 'no-integration' likewise: a permanent notice about a feature this build
    // cannot offer is noise rather than information.
    case 'stale':
    case 'no-integration':
    case 'ok':
      return null;
  }
}
