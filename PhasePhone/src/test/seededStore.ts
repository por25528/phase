import { parseOpsJournal, type CompanionOp } from '@app/lib/sync/ops';
import { createPhoneStore, type PhoneStore } from '../state/phoneStore';

export type SeededStore = PhoneStore & {
  /** What the journal actually holds — the file the Mac will read. */
  journalOps(): CompanionOp[];
};

/**
 * A store over an in-memory bridge holding one `state.json` and an empty
 * journal, already refreshed.
 *
 * A component test asserts through the STORE for what the screen renders, and
 * through `journalOps()` for what the Mac will be handed. Those are two
 * different claims and a screen can get one right while getting the other
 * wrong.
 */
export async function seededStore(stateText: string): Promise<SeededStore> {
  let journal = '';
  const store = createPhoneStore({
    readStateFile: async () => stateText,
    readJournal: async () => journal,
    appendOp: async (line) => {
      journal += `${line}\n`;
    },
    rewriteJournal: async (text) => {
      journal = text;
    },
    onChange: () => () => {},
  });
  await store.refresh();
  return Object.assign(store, { journalOps: () => parseOpsJournal(journal) });
}
