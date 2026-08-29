/** The one place the Download button points: the current release, pinned. */
const RELEASE = 'https://github.com/por25528/phase/releases';
const TAG = 'v0.1.0';

/** Apple silicon — the default, because it is what most Macs are now. */
export const DOWNLOAD_URL = `${RELEASE}/download/${TAG}/Phase-0.1.0-arm64.dmg`;
/** Intel, for the readers the default would leave stranded. */
export const DOWNLOAD_URL_INTEL = `${RELEASE}/download/${TAG}/Phase-0.1.0.dmg`;
/** Everything else — every tag, its notes and checksums. */
export const RELEASES_URL = RELEASE;

export const DOWNLOAD_NOTE = 'Free · macOS 13+ · .dmg';
