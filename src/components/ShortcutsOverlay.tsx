// The `?` cheat sheet. A lightweight dialog (not a modalRegistry Modal) so it
// never interferes with the ⌘N capture-suppression logic; Escape and a backdrop
// click both dismiss it, wired from App's global key handler and onClose here.

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['1'], label: 'Today' },
  { keys: ['2'], label: 'Goals' },
  { keys: ['3'], label: 'Timeline' },
  { keys: ['5'], label: 'Plan' },
  { keys: ['4'], label: 'Plan your week (old planner)' },
  { keys: ['T'], label: 'Jump to today' },
  { keys: ['⌘', 'N'], label: 'Add a task' },
  { keys: ['?'], label: 'This cheat sheet' },
  { keys: ['Esc'], label: 'Close drawer or dialog' },
];

// Context keys — they act only on a focused step inside the planner, so the
// overlay groups them separately rather than implying they work everywhere.
const PLANNER_KEYS: { keys: string[]; label: string }[] = [
  { keys: ['1–7'], label: 'Put the focused step on that weekday' },
  { keys: ['0'], label: 'Any day this week' },
];

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-[16px]">
      <dt className="text-[.86rem] text-ink-soft">{label}</dt>
      <dd className="flex items-center gap-[4px]">
        {keys.map((key) => (
          <kbd
            key={key}
            className="font-mono text-[.72rem] min-w-[22px] text-center px-[6px] py-[2px] rounded-[6px] border border-line-2 bg-field text-ink-soft"
          >
            {key}
          </kbd>
        ))}
      </dd>
    </div>
  );
}

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/40 px-[20px]"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[360px] bg-panel border border-line rounded-card shadow-card p-[20px]"
      >
        <div className="flex items-center justify-between mb-[14px]">
          <h2 className="font-disp text-[1.05rem] font-semibold tracking-[-0.01em]">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="text-muted hover:text-ink text-[.9rem] px-[6px] py-[2px] rounded-[6px] hover:bg-hover"
          >
            ✕
          </button>
        </div>
        <dl className="flex flex-col gap-[9px]">
          {SHORTCUTS.map((shortcut) => (
            <ShortcutRow key={shortcut.label} keys={shortcut.keys} label={shortcut.label} />
          ))}
        </dl>
        <div className="mt-[14px] pt-[12px] border-t border-line-soft">
          <h3 className="font-mono text-[.6rem] tracking-[.1em] uppercase text-muted font-semibold mb-[9px]">
            While planning a step
          </h3>
          <dl className="flex flex-col gap-[9px]">
            {PLANNER_KEYS.map((shortcut) => (
              <ShortcutRow key={shortcut.label} keys={shortcut.keys} label={shortcut.label} />
            ))}
          </dl>
        </div>
        <p className="mt-[14px] text-[.72rem] text-faint leading-[1.5]">
          ⌘ is Ctrl on Windows and Linux. Shortcuts pause while you're typing in a field.
        </p>
      </div>
    </div>
  );
}
