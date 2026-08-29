// Versioned local backups on disk, as a deep module.
//
// One folder, one file per snapshot, no cloud and no index: the FILE NAME is
// the whole record — `phase-backup-<YYYYMMDD>-<HHmmss>-<reason>.json` — so a
// backup folder opened in Finder is already sorted, already dated and already
// says why each snapshot was taken. A sidecar manifest would be a second
// opinion about what is on disk, and the one that goes stale first.
//
// Nothing here knows what a backup CONTAINS. The renderer builds the same JSON
// the Export menu item writes (`buildBackupText` in src/db/db.ts), and this
// module moves bytes — exactly the split syncFiles.cjs makes with the journal.
// That is what lets a backup be restored through the ordinary import path
// rather than through a second, parallel reader.
//
// Writes are atomic by rename, for the same reason `state.json` is: a snapshot
// half-written when the app was force-quit is precisely the file someone will
// reach for later.

const fs = require('node:fs');
const path = require('node:path');

/** The closed vocabulary the file name is built from. */
const BACKUP_REASONS = ['auto', 'manual', 'pre-import'];

const NAME_RE = /^phase-backup-(\d{8})-(\d{6})-(auto|manual|pre-import)\.json$/;

/**
 * The one gate on a renderer-supplied name.
 *
 * `read` never joins an arbitrary string onto the backup directory: a name has
 * to match the exact pattern this module WRITES, which contains no separator,
 * no dot segment and no extension but `.json`. Traversal is therefore refused
 * by construction rather than by scrubbing.
 */
function isBackupName(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

function parseName(name) {
  const match = NAME_RE.exec(name);
  if (!match) return null;
  return { name, stamp: `${match[1]}-${match[2]}`, reason: match[3] };
}

function two(n) {
  return String(n).padStart(2, '0');
}

/** Local time, because that is the clock the person reading Finder is on. */
function stampOf(date) {
  return (
    `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`
    + `-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  );
}

/**
 * Whole days since the epoch, from the stamp's own digits.
 *
 * `Date.UTC` on the Y/M/D triple, deliberately: this number is only ever
 * compared against another one built the same way, so the offset cancels and
 * no timezone can move a backup between buckets. Parsing the stamp as a local
 * `Date` would make retention depend on the DST rules of the day the file was
 * written, which is a real source of "why did it keep two from Sunday".
 */
function dayNumberOfStamp(stamp) {
  const year = Number(stamp.slice(0, 4));
  const month = Number(stamp.slice(4, 6));
  const day = Number(stamp.slice(6, 8));
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function dayNumberOfDate(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function monthNumberOfStamp(stamp) {
  return Number(stamp.slice(0, 4)) * 12 + Number(stamp.slice(4, 6)) - 1;
}

function monthNumberOfDate(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

// The tiers. Every one of them is a KEEP rule; a file is deleted only because
// no tier claimed it, which is the direction that fails safe.
const RECENT_DAYS = 1;      // today and yesterday, in full
const DAILY_DAYS = 14;      // then the newest of each day
const WEEKLY_WEEKS = 8;     // then the newest of each seven-day bucket
const MONTHLY_MONTHS = 12;  // then the newest of each calendar month
const MIN_KEEP = 5;         // and never fewer than this, whatever the tiers say
const PRE_IMPORT_KEEP = 20; // a pre-import snapshot is only ever aged out by count

/**
 * Which backups survive, and which are dropped.
 *
 * Pure, and exported so the policy can be asserted directly rather than
 * inferred from what a folder looks like after thirty writes.
 *
 * A "week" here is a seven-day bucket counted off the epoch, not an ISO week.
 * Nothing downstream names the week, so the only property that matters is that
 * the buckets are contiguous and equal — and floor(day/7) is that, without a
 * calendar rule to get wrong.
 *
 * The three tiers CLAIM their buckets whichever tier did the keeping, so a
 * snapshot kept by the daily rule also spends its week and its month. Without
 * that, one busy Tuesday would keep a daily copy, a weekly copy and a monthly
 * copy of itself.
 */
function planRetention(entries, now) {
  const nowDay = dayNumberOfDate(now);
  const nowWeek = Math.floor(nowDay / 7);
  const nowMonth = monthNumberOfDate(now);
  const sorted = [...entries].sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));

  const days = new Set();
  const weeks = new Set();
  const months = new Set();
  let preImports = 0;

  const keep = [];
  const drop = [];
  sorted.forEach((entry, index) => {
    const day = dayNumberOfStamp(entry.stamp);
    const week = Math.floor(day / 7);
    const month = monthNumberOfStamp(entry.stamp);
    const dayAge = nowDay - day;
    const monthAge = nowMonth - month;

    let kept = false;
    // The one reason that is not about age. A pre-import snapshot is the state
    // that the app's only irreversible action replaced, so it ages out by
    // COUNT and never by calendar — the import you need to walk back from may
    // well be the one you made a year ago.
    if (entry.reason === 'pre-import' && preImports < PRE_IMPORT_KEEP) {
      preImports += 1;
      kept = true;
    }
    if (!kept && dayAge <= RECENT_DAYS) kept = true;
    if (!kept && dayAge <= DAILY_DAYS && !days.has(day)) kept = true;
    if (!kept && nowWeek - week <= WEEKLY_WEEKS && !weeks.has(week)) kept = true;
    if (!kept && monthAge <= MONTHLY_MONTHS && !months.has(month)) kept = true;
    // The floor, applied last so it can only ever ADD to what the tiers kept.
    // A folder pruned to nothing is not a backup folder; five is small enough
    // to cost nothing and large enough that a bad clock cannot empty it.
    if (!kept && index < MIN_KEEP) kept = true;

    if (kept) {
      days.add(day);
      weeks.add(week);
      months.add(month);
      keep.push(entry.name);
    } else {
      drop.push(entry.name);
    }
  });

  return { keep, drop };
}

function createBackupStore(opts = {}) {
  const dir = opts.dir;
  const now = opts.now || (() => new Date());

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Newest first. An absent or unreadable folder is EMPTY, never a throw. */
  function list() {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const entries = [];
    for (const name of names) {
      const parsed = parseName(name);
      if (!parsed) continue;
      let bytes = 0;
      try {
        bytes = fs.statSync(path.join(dir, name)).size;
      } catch {
        // Vanished between readdir and stat: report it as it was found rather
        // than dropping a row the user can still see in Finder.
      }
      entries.push({ ...parsed, bytes });
    }
    return entries.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
  }

  function prune() {
    const { drop } = planRetention(list(), now());
    const pruned = [];
    for (const name of drop) {
      try {
        fs.unlinkSync(path.join(dir, name));
        pruned.push(name);
      } catch {
        // A file that will not delete is a disk problem, not a backup problem.
        // Leaving it costs space and nothing else; failing the write it was
        // pruning FOR would cost the snapshot.
      }
    }
    return pruned;
  }

  return {
    /** Where backups land, resolved once by the caller that owns the path. */
    dir,

    list,

    /**
     * Write one snapshot, then prune. Throws only when the SNAPSHOT itself
     * could not be written — a failed prune is swallowed above, because a
     * backup that landed is a success whatever the folder looks like after.
     */
    write(text, reason) {
      if (typeof text !== 'string') throw new TypeError('backup text must be a string');
      if (!BACKUP_REASONS.includes(reason)) throw new TypeError(`unknown backup reason: ${reason}`);
      ensureDir();

      // A second snapshot inside one second must not silently replace the
      // first — a pre-import taken right after a manual one is exactly that
      // case. Step the stamp forward until the name is free; the files stay
      // ordered, and the pattern stays the single one `isBackupName` knows.
      const started = now();
      let stamp = stampOf(started);
      let name = `phase-backup-${stamp}-${reason}.json`;
      for (let bump = 1; fs.existsSync(path.join(dir, name)) && bump <= 60; bump += 1) {
        stamp = stampOf(new Date(started.getTime() + bump * 1000));
        name = `phase-backup-${stamp}-${reason}.json`;
      }

      const full = path.join(dir, name);
      const tmp = `${full}.tmp`;
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, full);

      return { name, stamp, reason, bytes: Buffer.byteLength(text), pruned: prune() };
    },

    /** `null` for a refused name, an absent file, or an unreadable one. */
    read(name) {
      if (!isBackupName(name)) return null;
      try {
        return fs.readFileSync(path.join(dir, name), 'utf8');
      } catch {
        return null;
      }
    },
  };
}

module.exports = { createBackupStore, planRetention, isBackupName, BACKUP_REASONS };
