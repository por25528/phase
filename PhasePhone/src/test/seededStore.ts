import { createPhoneStore, type PhoneStore } from '../state/phoneStore';

/**
 * A store over an in-memory bridge holding one `state.json` and an empty
 * journal, already refreshed.
 *
 * A component test asserts through the STORE, never through the bridge: the
 * bridge is where an op ends up, and the store is what the screen renders.
 */
export async function seededStore(stateText: string): Promise<PhoneStore> {
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
  return store;
}
