import { useEffect, useRef } from 'react';
import { IconX } from './Icons';

// The `?` cheat sheet. A lightweight dialog (not a modalRegistry Modal) so it
// never interferes with the ⌘N capture-suppression logic; Escape and a backdrop
// click both dismiss it, wired from App's global key handler and onClose here.

// Listed in nav order, which is also the order the number keys select.
// Timeline is absent because it is not a destination any more — it is a mode
// inside Goals, reachable from the command palette.
const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['1'], label: 'Plan' },
  { keys: ['2'], label: 'Goals' },
  // No `t` here: it is a Plan-view key only (see PLANNER_KEYS below). The
  // app-level binding that used to sit here set a `selDate` nothing reads.
  { keys: ['⌘', 'K'], label: 'Search everything' },
  { keys: ['⌘', 'N'], label: 'Add a task' },
  { keys: ['⌘', 'Z'], label: 'Undo the last change' },
  { keys: ['?'], label: 'This cheat sheet' },
  { keys: ['Esc'], label: 'Close drawer or dialog' },
];

// Context keys — they act only inside the Plan view, so the overlay groups
// them separately rather than implying they work everywhere. `1`-`7` also
// require a focused backlog row; `[`, `]` and `t` work regardless of focus.
//
// `1` and `2` deliberately appear in both lists: with a backlog row focused
// they place work, because Plan's capture-phase listener consumes them before
// the view switcher above ever sees them. With nothing focused they fall
// through and switch view.
const PLANNER_KEYS: { keys: string[]; label: string }[] = [
  { keys: ['1–7'], label: 'Put the focused task on that weekday' },
  { keys: ['['], label: 'Previous week' },
  { keys: [']'], label: 'Next week' },
  { keys: ['t'], label: 'Back to this week' },
];

// Board keys — on a focused goal card. Alt rather than Cmd because ⌘← is
// Back in a browser and the board is a normal document.
const BOARD_KEYS: { keys: string[]; label: string }[] = [
  { keys: ['↵'], label: 'Open the goal' },
  { keys: ['⌥', '←/→'], label: 'Move to the previous / next horizon' },
  { keys: ['⌥', '↑/↓'], label: 'Move up / down within the horizon' },
];

// Task-tree keys, inside a goal's Work tab. Indent/outdent are chords rather
// than Tab: on Tab they made the tree a keyboard trap, and re-parented a task
// on the way. A chord also has to be documented somewhere to exist at all,
// which is what this block is for — and so does `X`, which took completion
// over from Space.
const TREE_KEYS: { keys: string[]; label: string }[] = [
  { keys: ['↑', '↓'], label: 'Move between tasks' },
  { keys: ['↵'], label: 'Rename the focused task' },
  { keys: ['X'], label: 'Check the focused task off' },
  { keys: ['Space'], label: 'Add the focused task to the selection' },
  { keys: ['⌘', 'click'], label: 'Add a task to the selection' },
  { keys: ['⇧', '↑/↓'], label: 'Extend the selection' },
  { keys: ['⌘', 'A'], label: 'Select every task' },
  { keys: ['⌫'], label: 'Delete the selection' },
  { keys: ['→', '←'], label: 'Expand or collapse a task' },
  { keys: ['S'], label: 'Cycle a task: to do → in progress → blocked' },
  { keys: ['⌘', '↵'], label: 'Add a task below this one' },
  { keys: ['⌘', ']'], label: 'Indent — make it a subtask' },
  { keys: ['⌘', '['], label: 'Outdent' },
];

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-[16px]">
      <dt className="text-body text-ink-soft">{label}</dt>
      <dd className="flex items-center gap-[4px]">
        {keys.map((key) => (
          <kbd
            key={key}
            className="font-mono text-meta min-w-[22px] text-center px-[6px] py-[2px] rounded-[6px] border border-line-2 bg-field text-ink-soft"
          >
            {key}
          </kbd>
        ))}
      </dd>
    </div>
  );
}

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /*
   * `aria-modal="true"` asserts that everything outside this dialog is inert.
   * Nothing here honoured that: focus was never moved in, never trapped, and
   * never restored, so a screen-reader user was told the rest of the page was
   * unavailable while their focus was still sitting in it — nothing reachable
   * at all. `Modal` does this; the Project surface is a page, not a sibling
   * dialog, so the cheat sheet was the one that only made the claim.
   */
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/40 px-[20px]"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[360px] bg-panel border border-line rounded-card shadow-card p-[20px]"
      >
        <div className="flex items-center justify-between mb-[14px]">
          <h2 className="font-disp text-h3 font-semibold tracking-[-0.01em]">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="text-muted hover:text-ink px-[6px] py-[2px] min-w-[24px] min-h-[24px] inline-flex items-center justify-center rounded-[6px] hover:bg-hover"
          >
            <IconX size={15} />
          </button>
        </div>
        <dl className="flex flex-col gap-[9px]">
          {SHORTCUTS.map((shortcut) => (
            <ShortcutRow key={shortcut.label} keys={shortcut.keys} label={shortcut.label} />
          ))}
        </dl>
        <div className="mt-[14px] pt-[12px] border-t border-line-soft">
          <h3 className="font-mono text-tiny tracking-[.1em] uppercase text-muted font-semibold mb-[9px]">
            While planning a task
          </h3>
          <dl className="flex flex-col gap-[9px]">
            {PLANNER_KEYS.map((shortcut) => (
              <ShortcutRow key={shortcut.label} keys={shortcut.keys} label={shortcut.label} />
            ))}
          </dl>
        </div>
        <div className="mt-[14px] pt-[12px] border-t border-line-soft">
          <h3 className="font-mono text-tiny tracking-[.1em] uppercase text-muted font-semibold mb-[9px]">
            On a goal card
          </h3>
          <dl className="flex flex-col gap-[9px]">
            {BOARD_KEYS.map((shortcut) => (
              <ShortcutRow key={shortcut.label} keys={shortcut.keys} label={shortcut.label} />
            ))}
          </dl>
        </div>
        <div className="mt-[14px] pt-[12px] border-t border-line-soft">
          <h3 className="font-mono text-tiny tracking-[.1em] uppercase text-muted font-semibold mb-[9px]">
            In a goal's tasks
          </h3>
          <dl className="flex flex-col gap-[9px]">
            {TREE_KEYS.map((shortcut) => (
              <ShortcutRow key={shortcut.label} keys={shortcut.keys} label={shortcut.label} />
            ))}
          </dl>
        </div>
        <p className="mt-[14px] text-meta text-muted leading-[1.5]">
          ⌘ is Ctrl on Windows and Linux. Shortcuts pause while you're typing in a field.
        </p>
      </div>
    </div>
  );
}
