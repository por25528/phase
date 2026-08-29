/**
 * The renderer-side wrapper around the preload bridge for local backups — the
 * sibling of updateBridge.ts and shellBridge.ts, with the same rules.
 *
 * In the plain browser the preload does not exist, so the factory returns an
 * inert stub: `list` answers `[]`, `write` and `read` answer null forever, and
 * `available` says which world this is. Nothing here is a no-op that PRETENDS
 * to have worked — a caller can always tell a browser from a full disk, and
 * `available` is how it tells them apart before it words a message.
 *
 * The surface is a FIXED set of verbs, none of which accepts a channel name or
 * a path. A backup is named by its FILE NAME and nothing else; where the folder
 * lives is main's business and the renderer never learns it.
 *
 * Every call is caught. A backup folder that cannot be reached is a fact to
 * report in Settings, never an unhandled rejection in the middle of an edit —
 * the same rule the sync exporter follows for a companion feature.
 */

export type BackupReason = 'auto' | 'manual' | 'pre-import';

export interface BackupEntry {
  /** `phase-backup-<YYYYMMDD>-<HHmmss>-<reason>.json`. The whole record. */
  name: string;
  /** `<YYYYMMDD>-<HHmmss>`, in the local time the snapshot was taken. */
  stamp: string;
  reason: BackupReason;
  bytes: number;
}

export interface WrittenBackup extends BackupEntry {
  /** Names the retention pass dropped as this snapshot landed. */
  pruned: string[];
}

export interface PhaseBackupBridge {
  /** False in the plain browser: `list` is empty and nothing is ever written. */
  available: boolean;
  /** Newest first. Empty for a missing, unreadable or absent folder. */
  list(): Promise<BackupEntry[]>;
  /** The entry written, or null when the shell refused or the disk did. */
  write(text: string, reason: BackupReason): Promise<WrittenBackup | null>;
  /** One snapshot's JSON, by the name `list` gave. Null when refused. */
  read(name: string): Promise<string | null>;
}

interface BackupPreload {
  list(): Promise<unknown>;
  write(text: string, reason: BackupReason): Promise<unknown>;
  read(name: string): Promise<unknown>;
}

const REASONS: readonly BackupReason[] = ['auto', 'manual', 'pre-import'];

function preloadOf<T>(name: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as Record<string, T | undefined>)[name];
}

/**
 * A row is trusted only when it carries every field the list renders.
 *
 * The other side of this bridge is our own main process, so this is not
 * defence against a hostile sender — it is the same discipline `parseStateFile`
 * follows: a half-shaped row rendered as a restore target is worse than a row
 * that is simply not offered.
 */
function asEntry(raw: unknown): BackupEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<BackupEntry>;
  if (typeof value.name !== 'string' || value.name.length === 0) return null;
  if (typeof value.stamp !== 'string' || value.stamp.length === 0) return null;
  if (!REASONS.includes(value.reason as BackupReason)) return null;
  if (typeof value.bytes !== 'number' || !Number.isFinite(value.bytes)) return null;
  return { name: value.name, stamp: value.stamp, reason: value.reason as BackupReason, bytes: value.bytes };
}

function asWritten(raw: unknown): WrittenBackup | null {
  const entry = asEntry(raw);
  if (!entry) return null;
  const pruned = (raw as { pruned?: unknown }).pruned;
  return { ...entry, pruned: Array.isArray(pruned) ? pruned.filter((p): p is string => typeof p === 'string') : [] };
}

export function backupBridge(): PhaseBackupBridge {
  const preload = preloadOf<BackupPreload>('phaseBackups');
  if (!preload) {
    return {
      available: false,
      list: async () => [],
      write: async () => null,
      read: async () => null,
    };
  }
  return {
    available: true,
    async list() {
      try {
        const raw = await preload.list();
        if (!Array.isArray(raw)) return [];
        return raw.map(asEntry).filter((e): e is BackupEntry => e !== null);
      } catch {
        return [];
      }
    },
    async write(text, reason) {
      try {
        return asWritten(await preload.write(text, reason));
      } catch {
        return null;
      }
    },
    async read(name) {
      try {
        const raw = await preload.read(name);
        return typeof raw === 'string' ? raw : null;
      } catch {
        return null;
      }
    },
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The stamp, read back as a date and a time.
 *
 * Parsed from the digits rather than through `new Date(...)`: the stamp was
 * written from the LOCAL clock and carries no zone, so handing it to a Date
 * would be asking the runtime to guess one. A malformed stamp is printed
 * verbatim — a row whose label is a raw file name is still a row you can
 * restore, and inventing a plausible date for it would not be.
 */
export function describeBackup(stamp: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!match) return stamp;
  const [, year, month, day, hour, minute] = match;
  const name = MONTHS[Number(month) - 1];
  if (!name) return stamp;
  return `${Number(day)} ${name} ${year}, ${hour}:${minute}`;
}

/**
 * The stamp as a local-clock timestamp, or null when it is malformed.
 *
 * `new Date(y, m, d, …)` and never `Date.parse`: the stamp was WRITTEN from
 * the local clock with no zone on it, so the only reading that round-trips is
 * the one that puts it back in the same clock. This feeds one decision — how
 * long it has been since the last snapshot — so a null has to mean "unknown",
 * never "just now".
 */
export function stampToLocalMs(stamp: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

const REASON_LABEL: Record<BackupReason, string> = {
  auto: 'Automatic',
  manual: 'Manual',
  'pre-import': 'Before import',
};

/** Why the snapshot was taken, in the words the history list prints. */
export function backupReasonLabel(reason: BackupReason): string {
  return REASON_LABEL[reason];
}
