import type { AvailabilityWindow } from '../db/types';
import { parseD } from './dates';

export const MINUTES_PER_DAY = 1440;

// All seven days 09:00–18:00 (absent dow = off). The weekend is in the default
// deliberately: a planner is installed on a Saturday as often as any other day,
// and nothing on first run asks about working hours, so a Mon–Fri default met
// a Saturday installer with "No time left today" and an empty Today — a product
// that says it cannot help on the day it was chosen. Turning the weekend BACK
// off is a discoverable edit in Settings; the reverse — a hidden weekday-only
// default — is not something a new user can find.
// Frozen (array and each window) because this same array/object identity is
// both the store's initial `availability` value and the fallback every
// `parseAvailability` call returns — nothing mutates it today, but an
// in-place sort or edit of `state.availability` down the line would
// otherwise corrupt this constant for the rest of the process.
export const DEFAULT_AVAILABILITY: AvailabilityWindow[] = Object.freeze([
  Object.freeze({ dow: 0, startMin: 540, endMin: 1080 }),
  Object.freeze({ dow: 1, startMin: 540, endMin: 1080 }),
  Object.freeze({ dow: 2, startMin: 540, endMin: 1080 }),
  Object.freeze({ dow: 3, startMin: 540, endMin: 1080 }),
  Object.freeze({ dow: 4, startMin: 540, endMin: 1080 }),
  Object.freeze({ dow: 5, startMin: 540, endMin: 1080 }),
  Object.freeze({ dow: 6, startMin: 540, endMin: 1080 }),
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
