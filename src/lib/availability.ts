import type { AvailabilityWindow } from '../db/types';
import { parseD } from './dates';

export const MINUTES_PER_DAY = 1440;

/**
 * The default working week: all seven days, 08:00–20:00.
 *
 * Availability is no longer a FENCE. `resolveSlot` cannot see it — a manual
 * placement lands where it is aimed, at any minute of any day — so what these
 * windows still do is the other two jobs they always did: they are the
 * DENOMINATOR behind every capacity figure in the app (`weekCapacity`'s
 * `freeMin`, `9h left`, the gauge, `isOverCommitted`, `goalHealth`'s forecast)
 * and they are the AIM a from-a-distance placement points at (`aimFor`).
 *
 * Widened from 09:00–18:00 because a gate and a denominator want opposite
 * things from a default. As a gate, narrow was safe: it only ever refused, and
 * a refusal is visible and fixable. As a denominator, narrow is a false
 * statement — it prices a person's week at 63 hours and calls a perfectly
 * ordinary evening's work over-committed. Nothing on first run asks about
 * working hours, so whatever is here is what most weeks are measured against,
 * and the honest default is the span a person MIGHT work in rather than the
 * span an office keeps.
 *
 * The weekend is in the default for the reason it always was: a planner is
 * installed on a Saturday as often as any other day, and a Mon–Fri default met
 * a Saturday installer with "No time left today" and an empty Today. Turning
 * the weekend back off is a discoverable edit in Settings; the reverse — a
 * hidden weekday-only default — is not something a new user can find.
 *
 * Frozen (array and each window) because this same array/object identity is
 * both the store's initial `availability` value and the fallback every
 * `parseAvailability` call returns — nothing mutates it today, but an
 * in-place sort or edit of `state.availability` down the line would
 * otherwise corrupt this constant for the rest of the process.
 */
export const DEFAULT_START_MIN = 8 * 60;
export const DEFAULT_END_MIN = 20 * 60;

export const DEFAULT_AVAILABILITY: AvailabilityWindow[] = Object.freeze([
  Object.freeze({ dow: 0, startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN }),
  Object.freeze({ dow: 1, startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN }),
  Object.freeze({ dow: 2, startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN }),
  Object.freeze({ dow: 3, startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN }),
  Object.freeze({ dow: 4, startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN }),
  Object.freeze({ dow: 5, startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN }),
  Object.freeze({ dow: 6, startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN }),
]) as AvailabilityWindow[];

function isWindow(v: unknown): v is AvailabilityWindow {
  if (typeof v !== 'object' || v === null) return false;
  const w = v as Partial<AvailabilityWindow>;
  return Number.isInteger(w.dow) && (w.dow as number) >= 0 && (w.dow as number) <= 6
    && Number.isInteger(w.startMin) && Number.isInteger(w.endMin)
    && (w.startMin as number) >= 0
    && (w.startMin as number) < (w.endMin as number)
    && (w.endMin as number) <= MINUTES_PER_DAY;
}

/**
 * Total validation: a list is accepted only if EVERY entry is well-formed and
 * `dow` values are unique. Anything else returns the default — a partially
 * valid window set would silently produce wrong capacity, which is worse than
 * visibly falling back.
 */
export function parseAvailability(raw: unknown): AvailabilityWindow[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return DEFAULT_AVAILABILITY;
    }
  }
  if (!Array.isArray(value) || !value.every(isWindow)) return DEFAULT_AVAILABILITY;
  const dows = new Set(value.map((w) => w.dow));
  if (dows.size !== value.length) return DEFAULT_AVAILABILITY;
  return value.map((w) => ({ dow: w.dow, startMin: w.startMin, endMin: w.endMin }));
}

export function serializeAvailability(windows: AvailabilityWindow[]): string {
  return JSON.stringify(windows);
}

/** 0 = Monday … 6 = Sunday, matching weekDates(). */
export function dowOf(date: string): number {
  return (parseD(date).getDay() + 6) % 7;
}

export function windowForDate(
  date: string,
  windows: AvailabilityWindow[],
): AvailabilityWindow | null {
  const dow = dowOf(date);
  return windows.find((w) => w.dow === dow) ?? null;
}
