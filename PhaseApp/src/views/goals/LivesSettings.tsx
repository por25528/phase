import { useState } from 'react';
import { useAppStore } from '../../state/store';
import { MAX_LIVES, sortedLives } from '../../lib/lives';
// There is no trash icon in this codebase. `IconX` is the removal glyph, and
// inventing a Unicode "🗑" fails `designScale.test.ts` outright.
import { IconX } from '../../components/Icons';

/**
 * Naming the two or three lives you are living at once.
 *
 * A rename commits on blur rather than behind a Save button, matching
 * `commitDates`: a form that autosaves on a valid change is the pattern this
 * app settled on. Deleting is undoable through the store, so there is no
 * confirmation dialog here — undo-instead-of-confirm, as everywhere else.
 */
export function LivesSettings() {
  const { lives, actions } = useAppStore();
  const [draft, setDraft] = useState('');

  return (
    <div>
      <ul className="flex flex-col gap-[6px] mb-[12px]">
        {sortedLives(lives).map((life) => (
          <li key={life.id} className="flex items-center gap-[6px]">
            <input
              aria-label="Life name"
              defaultValue={life.title}
              onBlur={(e) => {
                if (e.target.value.trim() !== life.title) actions.renameLife(life.id, e.target.value);
              }}
              className="flex-1 min-w-0 text-ui text-ink bg-panel border border-line-2 rounded-field px-[8px] py-[5px]"
            />
            <button
              type="button"
              aria-label={`Delete ${life.title}`}
              onClick={() => actions.removeLife(life.id)}
              className="text-faint hover:text-warn min-h-[24px] px-[6px] inline-flex items-center rounded-field hover:bg-hover"
            >
              <IconX />
            </button>
          </li>
        ))}
      </ul>

      {lives.length < MAX_LIVES ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (actions.addLife(draft)) setDraft('');
          }}
        >
          <input
            aria-label="New life name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a life — MIT, Startup…"
            className="w-full text-ui text-ink bg-panel border border-line-2 rounded-field px-[8px] py-[5px]"
          />
        </form>
      ) : (
        <p className="text-meta text-muted">Three is the most Phase will hold.</p>
      )}
    </div>
  );
}
