import type { GoogleEvent } from './busyBlocks.d.cts';
import type { HttpResponse } from './oauth.d.cts';

export interface GoogleClientDeps {
  /** The access token goes in an Authorization header, never in the URL. */
  httpGet(url: string, accessToken: string): Promise<HttpResponse>;
  getAccessToken(): Promise<string>;
}

export interface CalendarSummary {
  id: string;
  summary: string;
  primary: boolean;
}

export interface GoogleClient {
  listCalendars(): Promise<CalendarSummary[]>;
  /**
   * Raw events across every selected calendar, unnormalized.
   *
   * ALL-OR-NOTHING: any failed calendar or page rejects the whole call. A
   * partial result would render the missing calendar's meetings as free time.
   * An empty `calendarIds` returns `[]` without contacting Google. For a
   * non-empty call, the access token is fetched once before the walk and is
   * not refreshed mid-walk; if it expires during fan-out, the whole fetch
   * rejects rather than renewing it.
   */
  fetchEvents(input: {
    rangeStart: string;   // 'YYYY-MM-DD' local, inclusive
    rangeEnd: string;     // 'YYYY-MM-DD' local, EXCLUSIVE
    calendarIds: string[];
  }): Promise<GoogleEvent[]>;
}

export declare const CALENDAR_LIST_ENDPOINT: string;
export declare function EVENTS_ENDPOINT(calendarId: string): string;
/** One day each side; the largest real UTC offset is ±14h, so this is enough. */
export declare const QUERY_MARGIN_DAYS: number;
/** Runaway guard against a server that keeps handing back a page token. */
export declare const MAX_PAGES: number;

export declare function createGoogleClient(deps: GoogleClientDeps): GoogleClient;
