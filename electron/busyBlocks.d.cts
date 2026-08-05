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
