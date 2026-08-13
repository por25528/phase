import { useState } from 'react';
import {
  acceleratorFromEvent, formatAccelerator, type ShortcutStatus,
} from '../../lib/assistantAccelerator';

/**
 * The assistant-shortcut section of Settings: the current chord as key caps, a
 * `Change` action, and status copy that tells the truth.
 *
 * The truth-telling is the point. `Command+Space` usually belongs to macOS
 * Spotlight, so the realistic first-run state is a conflict — and the rule is
 * that a conflict is SAID, in words, while the field stays editable. Phase
 * never registers a different chord on its own: a shortcut the user did not
 * choose firing a window they did not expect is the failure mode this copy
 * exists to prevent.
 */

interface Props {
  accelerator: string;
  /** Registration status from the desktop shell; null in the browser. */
  status: ShortcutStatus | null;
  onSave(next: string): void;
}

function Chord({ accelerator }: { accelerator: string }) {
  return (
    <span className="inline-flex items-center gap-[4px]">
      {formatAccelerator(accelerator).map((cap, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <kbd
          key={`${cap}-${i}`}
          className="font-mono text-kbd tracking-[.04em] border border-line-2 rounded-[4px] px-[5px] py-[2px] text-ink-soft"
        >
          {cap}
        </kbd>
      ))}
    </span>
  );
}

function statusCopy(status: ShortcutStatus | null): { text: string; warning: boolean } | null {
  if (!status) return null;
  if (status.conflict) {
    const still = status.active
      ? ` ${status.active} still works.`
      : ' No shortcut is active right now.';
    return {
      warning: true,
      text: `${status.requested ?? 'That shortcut'} couldn't be registered — another app owns it. `
        + `On a Mac, Command+Space is usually Spotlight. Choose a different chord, or free that one up.${still}`,
    };
  }
  if (status.registered) {
    return { warning: false, text: 'Active everywhere while Phase is running.' };
  }
  return null;
}

export function AssistantShortcutSettings({ accelerator, status, onSave }: Props) {
  const [capturing, setCapturing] = useState(false);
  const [staged, setStaged] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const copy = statusCopy(status);

  if (!capturing) {
    return (
      <div className="flex flex-col gap-[8px]">
        <div className="flex items-center gap-[10px]">
          <Chord accelerator={accelerator} />
          <button
            type="button"
            onClick={() => {
              setStaged(null);
              setHint(null);
              setCapturing(true);
            }}
            className="text-ui font-semibold text-ink px-[10px] py-[5px] rounded-field border border-line-2 bg-panel hover:bg-hover"
          >
            Change
          </button>
        </div>
        {copy && (
          <p className={`text-meta ${copy.warning ? 'text-warn' : 'text-muted'}`}>{copy.text}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex items-center gap-[10px]">
        <input
          aria-label="New shortcut"
          readOnly
          autoFocus
          value={staged ? formatAccelerator(staged).join(' ') : ''}
          placeholder="Press the new shortcut"
          onKeyDown={(event) => {
            event.preventDefault();
            const chord = acceleratorFromEvent(event);
            if (!chord) {
              setHint('That needs a modifier — hold ⌘, ⌃ or ⌥ with a key.');
              return;
            }
            setHint(null);
            setStaged(chord);
          }}
          className="w-[220px] rounded-field border border-line-2 bg-field px-[10px] py-[5px] text-ui text-ink placeholder:text-faint focus:outline-none"
        />
        <button
          type="button"
          disabled={staged === null}
          onClick={() => {
            if (staged) onSave(staged);
            setCapturing(false);
          }}
          className="text-ui font-semibold text-ink px-[10px] py-[5px] rounded-field border border-line-2 bg-panel hover:bg-hover disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setCapturing(false)}
          className="text-ui text-muted px-[10px] py-[5px] rounded-field hover:bg-hover"
        >
          Cancel
        </button>
      </div>
      {hint && <p className="text-meta text-muted">{hint}</p>}
    </div>
  );
}
