import type { PluginListenerHandle } from '@capacitor/core';

/**
 * The phone half of the PhasePhone sync contract, as a Capacitor plugin.
 *
 * Two files live in the app's iCloud Drive folder, `Phase/`:
 *
 * - `state.json` — canonical state. The Mac is its ONLY writer; this plugin
 *   only ever reads it.
 * - `ops-phone.jsonl` — the phone's append-only journal. This plugin is its
 *   only writer; the Mac only reads it.
 *
 * The plugin carries no app logic — no parsing, no projection, no op
 * vocabulary. It moves bytes in and out of the container under
 * `NSFileCoordinator` and reports when iCloud changes them underneath us.
 * Everything about what those bytes MEAN lives in TypeScript.
 */
export interface PhaseICloudPlugin {
  /**
   * The whole of `state.json`, or `{ text: null }` when the Mac has never
   * exported (or the iCloud container is not available yet). Absence is a
   * normal state — the phone shows "never synced" — so it never rejects for
   * it. Only real IO failures reject.
   */
  readStateFile(): Promise<{ text: string | null }>;

  /** The whole journal; `{ text: '' }` when the file does not exist yet. */
  readJournal(): Promise<{ text: string }>;

  /**
   * Durably append one serialized op, newline-terminated. Read-modify-write of
   * the whole file under a coordinated write: the journal is compacted on every
   * append, so it stays a handful of lines.
   */
  appendOp(options: { line: string }): Promise<void>;

  /** Replace the journal wholesale — the phone's compaction path. */
  rewriteJournal(options: { text: string }): Promise<void>;

  /**
   * Fires when either file changes on disk from outside this process, i.e.
   * when iCloud lands a fresh `state.json` from the Mac. Carries no payload:
   * the listener re-reads.
   */
  addListener(eventName: 'filesChanged', listener: () => void): Promise<PluginListenerHandle>;
}
