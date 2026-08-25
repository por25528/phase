/**
 * The two files the companion touches, and nothing else.
 *
 * The phone READS `state.json` and WRITES `ops-phone.jsonl`. That asymmetry is
 * the whole sync design — the Mac owns canonical state, the phone owns its own
 * journal — so this interface has no `writeState` and never will: a method to
 * write the state file would be the one door through which the single-writer
 * rule could be broken.
 *
 * Two implementations satisfy it: `localBridge` (localStorage, for the browser
 * and for tests) and, on device, the Capacitor iCloud plugin. Keeping the
 * contract here rather than in either of them is what lets the store be tested
 * without a phone and shipped without a change.
 */
export interface FileBridge {
  /** `null` means the Mac has never exported — a first run, not an error. */
  readStateFile(): Promise<string | null>;
  /** `''` when the journal is absent. An absent journal is the empty one. */
  readJournal(): Promise<string>;
  /** Durably append one serialized op, newline-terminated. */
  appendOp(line: string): Promise<void>;
  /** Replace the whole journal — how compaction drops ingested ops. */
  rewriteJournal(text: string): Promise<void>;
  /** Fires when either file changed underneath us. Returns an unsubscribe. */
  onChange(cb: () => void): () => void;
}
