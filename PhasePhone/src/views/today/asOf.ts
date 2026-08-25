import { clockLabel } from '@app/lib/clock';
import { fmtD } from '@app/lib/dates';

/**
 * Ten minutes. Below it the phone is looking at what the Mac has, and saying
 * so would be noise on every screen of every session; above it the projection
 * is a REPORT of a moment that has passed, and the page has to say which.
 */
export const STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * The quiet "as of" stamp, or `null` when the canonical file is current.
 *
 * A stamp from an earlier day names the DAY, not the minute: `as of 09:12` on
 * a Thursday morning, for a file written on Tuesday, is the most misleading
 * form of a true statement.
 */
export function asOfLabel(writtenAt: string | null, now: Date): string | null {
  if (!writtenAt) return null;
  const written = new Date(writtenAt);
  const age = now.getTime() - written.getTime();
  if (Number.isNaN(age) || age < STALE_AFTER_MS) return null;
  const sameDay =
    written.getFullYear() === now.getFullYear()
    && written.getMonth() === now.getMonth()
    && written.getDate() === now.getDate();
  if (sameDay) return `as of ${clockLabel(written.getHours() * 60 + written.getMinutes())}`;
  const day = `${written.getFullYear()}-${String(written.getMonth() + 1).padStart(2, '0')}-${String(written.getDate()).padStart(2, '0')}`;
  return `as of ${fmtD(day)}`;
}
