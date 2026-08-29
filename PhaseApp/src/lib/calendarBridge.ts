import type { BusyBlock } from '../db/types';

/**
 * The renderer's view of the producer. These types MUST stay identical to
 * `electron/calendarIpc.d.cts`; the two sides cannot import from each other —
 * main is CJS under Node, the renderer is ESM under Vite — so the duplication
 * is deliberate. Change one, change the other.
 */
export interface CalendarStatus {
  /** Some credential set is usable: the build's, the user's, or both. */
  configured: boolean;
  connected: boolean;
  /** False when the OS keychain is unavailable; secret writes will fail. */
  available: boolean;
  /** The store exists but cannot be decrypted; the UI offers a reset. */
  corrupt: boolean;
  /**
   * This build ships its own OAuth client, so nothing has to be pasted. Never
   * the credential itself — only whether one exists.
   */
  managed: boolean;
  /** The user saved their own OAuth client, which overrides the managed one. */
  custom: boolean;
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
