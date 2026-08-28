// The release update check: one GET against GitHub's releases/latest,
// throttled to once a day by a stamp the caller persists. Pure logic —
// network, clock, and storage are injected, and nothing here may require
// `electron`. Every failure is logged and swallowed: an update notice is a
// nicety, and a nicety must never block or crash launch.

const DAY_MS = 24 * 60 * 60 * 1000;

/** [major, minor, patch] or null when the string is not a version. */
function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? '').trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  // Unparseable input compares equal: "no opinion" must never read as newer.
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function shouldCheck(checkedAt, now) {
  if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt)) return true;
  // A stamp from the future means the clock moved; distrust it.
  if (checkedAt > now) return true;
  return now - checkedAt >= DAY_MS;
}

function createUpdateCheck({ currentVersion, fetchLatest, readState, writeState, now, logError }) {
  const newerOf = (state) => {
    if (!state || typeof state.version !== 'string' || typeof state.url !== 'string') return null;
    if (compareVersions(state.version, currentVersion) <= 0) return null;
    return { version: state.version, url: state.url };
  };

  return {
    async check() {
      let state = null;
      try {
        state = readState();
      } catch (err) {
        logError('[phase-updates] stamp unreadable', err);
      }
      if (state && !shouldCheck(state.checkedAt, now())) return newerOf(state);
      try {
        const release = await fetchLatest();
        const tag = typeof release?.tag_name === 'string' ? release.tag_name : null;
        const url = typeof release?.html_url === 'string' ? release.html_url : null;
        const version = tag && url && parseVersion(tag) ? tag.replace(/^v/, '') : null;
        const next = { checkedAt: now(), version, url: version ? url : null };
        try {
          writeState(next);
        } catch (err) {
          logError('[phase-updates] stamp unwritable', err);
        }
        return newerOf(next);
      } catch (err) {
        // Offline, rate-limited, DNS — all the same: keep the last answer.
        logError('[phase-updates] check failed', err);
        return newerOf(state);
      }
    },
  };
}

module.exports = { compareVersions, shouldCheck, createUpdateCheck };
