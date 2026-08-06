import type { BusyBlock } from './busyBlocks.d.cts';
import type { SecretStore } from './secrets.d.cts';
import type { CalendarSummary, GoogleClient } from './googleClient.d.cts';

export interface StatusResult {
  configured: boolean;
  connected: boolean;
  /** The store exists but cannot be decrypted; the UI offers a reset. */
  corrupt: boolean;
  /** Provenance only — the Google account's primary calendar id. Never a credential. */
  accountId: string | null;
  timeZone: string;
}

export type ConnectFailure =
  | 'not-configured'
  | 'reauth-required'
  | 'request-failed'
  | 'cancelled';

export type ConnectResult =
  | { ok: true }
  | { ok: false; reason: ConnectFailure };

export type FetchFailure =
  | 'not-configured'
  | 'not-connected'
  | 'reauth-required'
  | 'invalid-range'
  | 'no-calendars'
  | 'corrupt'
  | 'invalid-time-zone'
  | 'malformed-data'
  | 'request-failed';

export type FetchResult =
  | { ok: true; blocks: BusyBlock[]; fetchedAt: string; accountId: string | null; timeZone: string }
  | { ok: false; reason: FetchFailure };

export interface FetchInput {
  rangeStart: string;
  rangeEnd: string;
  calendarIds: string[];
}

export interface HandlerDeps {
  secrets: SecretStore;
  oauth: {
    isConnected(): boolean;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getAccessToken(): Promise<string>;
  };
  googleClient: GoogleClient;
  normalizeEvents(events: unknown[], options: { rangeStart: string; rangeEnd: string; timeZone: string }): BusyBlock[];
  /** The machine's IANA zone. Injected so no test depends on where it runs. */
  timeZone(): string;
  nowIso(): string;
}

export interface CalendarHandlers {
  status(): Promise<StatusResult>;
  configure(input: { clientId: string; clientSecret: string }): Promise<void>;
  connect(): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  listCalendars(): Promise<CalendarSummary[]>;
  reset(): Promise<void>;
  fetch(input: FetchInput): Promise<FetchResult>;
}

export declare const CHANNEL_PREFIX: string;
export declare function createCalendarHandlers(deps: HandlerDeps): CalendarHandlers;
/** `ipcMain` is typed loosely so the module never imports `electron`. */
export declare function registerCalendarIpc(
  ipcMain: { handle(channel: string, fn: (...args: any[]) => unknown): void },
  handlers: CalendarHandlers,
): void;
