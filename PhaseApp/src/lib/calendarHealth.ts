import type { CalendarStatus, CalendarFetchFailure } from './calendarBridge';
import { CALENDAR_STALE_MS } from '../views/plan/useCalendarRefresh';

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
  // Before `connected`, because a revoked token can leave the producer still
  // reporting a stored connection it can no longer use.
  if (lastError === 'reauth-required') return 'reauth-required';
  if (!status.connected) return 'not-connected';
  if (!coversWeek) return 'out-of-range';
  if (!fetchedAt) return 'out-of-range';
  const age = nowMs - Date.parse(fetchedAt);
  // A timestamp that will not parse is not evidence of freshness. `NaN` fails
  // every comparison, so it has to be caught rather than compared.
  if (!Number.isFinite(age) || age >= CALENDAR_STALE_MS) return 'stale';
  return 'ok';
}

/**
 * The caveat shown beside the week's figures, or `null` for the states where
 * they need no qualification.
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
    // Age belongs beside the Refresh button in Settings, not in the header.
    // 'no-integration' likewise: a permanent notice about a feature this build
    // cannot offer is noise rather than information.
    case 'stale':
    case 'no-integration':
    case 'ok':
      return null;
  }
}
