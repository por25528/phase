// The file side of the PhasePhone bridge.
//
// Two files in one folder, one writer each: the Mac owns `state.json`, the
// phone owns `ops-phone.jsonl`. Nothing here parses either of them — this
// module moves bytes and says when the journal changed; `syncIngest` owns
// what a line means, and it is the only thing that can decide a line is
// malformed. That split is why a truncated tail is not this module's problem.
//
// The default directory is the PLAIN iCloud Drive folder, which works today
// with no Apple Developer account. Moving to a real app container later is a
// one-env-var change (`PHASE_SYNC_DIR`), which is exactly why the override
// exists and why nothing above this module knows the path at all.
//
// Change detection is a POLL, not `fs.watch`. The file arrives from iCloud
// rather than from a local editor, and `fs.watch` on a synced folder reports
// unreliably across the download; a stat every few seconds is the boring
// thing that works. The signature is mtime AND size, because a journal
// appended twice inside one filesystem timestamp tick still changes length.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STATE_FILE = 'state.json';
const JOURNAL_FILE = 'ops-phone.jsonl';
const DEFAULT_POLL_MS = 5000;

function defaultDir() {
  return (
    process.env.PHASE_SYNC_DIR ||
    path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Phase')
  );
}

function createSyncFiles(opts = {}) {
  const dir = opts.dir || defaultDir();
  const pollMs = opts.pollMs || DEFAULT_POLL_MS;
  const statePath = path.join(dir, STATE_FILE);
  const journalPath = path.join(dir, JOURNAL_FILE);

  let timer = null;
  let signature = null;

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true });
  }

  /** `null` for an absent or unreadable journal — never a throw, never ''. */
  function readJournal() {
    try {
      return fs.readFileSync(journalPath, 'utf8');
    } catch {
      return null;
    }
  }

  function currentSignature() {
    try {
      const stat = fs.statSync(journalPath);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return null;
    }
  }

  function poll(onJournalChange) {
    const next = currentSignature();
    if (next === null || next === signature) return;
    const text = readJournal();
    // The stat moved but the read failed: leave the signature alone so the
    // next tick tries again rather than treating the file as consumed.
    if (text === null) return;
    signature = next;
    onJournalChange(text);
  }

  return {
    /** Exposed so main.cjs can log where sync is pointed without recomputing it. */
    dir,

    start(onJournalChange) {
      ensureDir();
      poll(onJournalChange);
      timer = setInterval(() => poll(onJournalChange), pollMs);
      // Sync must never be the reason the app will not quit.
      if (typeof timer.unref === 'function') timer.unref();
    },

    readJournal,

    /**
     * Atomic by rename: iCloud may read this file at any moment, and a
     * partially written `state.json` is precisely the corrupt-read case the
     * phone would have to fall back from. The temp file is a sibling so the
     * rename stays within one filesystem.
     */
    writeState(text) {
      ensureDir();
      const tmp = `${statePath}.tmp`;
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, statePath);
    },

    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createSyncFiles, STATE_FILE, JOURNAL_FILE };
