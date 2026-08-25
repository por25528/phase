import { PhaseICloud } from 'phase-icloud';
import type { FileBridge } from './FileBridge';

/**
 * `FileBridge` over the Capacitor plugin — pure adapter, shape-shifting only.
 * The plugin speaks Capacitor's options-object dialect ({ text }, { line });
 * the store speaks `FileBridge`. Nothing else may happen here: logic added to
 * this file would run on device and not in the browser, which is exactly the
 * split the bridge exists to prevent.
 */
export function createICloudBridge(): FileBridge {
  return {
    readStateFile: () => PhaseICloud.readStateFile().then((r) => r.text),
    readJournal: () => PhaseICloud.readJournal().then((r) => r.text),
    appendOp: (line) => PhaseICloud.appendOp({ line }),
    rewriteJournal: (text) => PhaseICloud.rewriteJournal({ text }),
    onChange: (cb) => {
      const handle = PhaseICloud.addListener('filesChanged', cb);
      return () => {
        void handle.then((h) => h.remove());
      };
    },
  };
}
