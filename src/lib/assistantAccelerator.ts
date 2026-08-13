/**
 * The one vocabulary for the assistant's global shortcut.
 *
 * `Command+Space` is the deliberate default — it is where a launcher lives in
 * the hand — and it MAY collide with macOS Spotlight. That collision is a
 * visible state the Settings UI must say out loud, never an exception and
 * never permission to silently register something else: a shortcut the user
 * did not choose firing a window they did not expect is worse than a shortcut
 * that plainly says "taken".
 *
 * Everything here is pure string work over Electron's accelerator grammar; the
 * actual OS registration lives behind `electron/assistantShortcut.cjs`.
 */

export const DEFAULT_ASSISTANT_ACCELERATOR = 'Command+Space';

/** What registration reported. `active` may differ from `requested` after a conflict. */
export interface ShortcutStatus {
  requested: string;
  active: string | null;
  registered: boolean;
  conflict: boolean;
}

/** Real chording modifiers. Shift alone is typing, so it cannot anchor a chord. */
const ANCHOR_MODIFIERS = new Set(['Command', 'Control', 'Alt', 'Super']);
const ALL_MODIFIERS = new Set([...ANCHOR_MODIFIERS, 'Shift']);

/** The closed key vocabulary this feature offers. Electron accepts more; we don't. */
const KEYS = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  'Space', 'Tab', 'Up', 'Down', 'Left', 'Right',
  'Home', 'End', 'PageUp', 'PageDown',
  ',', '.', '/', ';', "'", '[', ']', '\\', '-', '=', '`',
]);

export function isValidAccelerator(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  const parts = value.split('+');
  if (parts.length < 2) return false;
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (!KEYS.has(key)) return false;
  if (modifiers.some((m) => !ALL_MODIFIERS.has(m))) return false;
  if (new Set(modifiers).size !== modifiers.length) return false;
  return modifiers.some((m) => ANCHOR_MODIFIERS.has(m));
}

/** A stored setting, made total: anything malformed reads as the default. */
export function parseStoredAccelerator(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || !isValidAccelerator(raw)) return DEFAULT_ASSISTANT_ACCELERATOR;
  return raw;
}

export interface CapturedKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** KeyboardEvent.key values that are themselves modifiers — a chord with no key yet. */
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Fn']);

function keyName(key: string): string | null {
  if (key === ' ') return 'Space';
  if (key === 'ArrowUp') return 'Up';
  if (key === 'ArrowDown') return 'Down';
  if (key === 'ArrowLeft') return 'Left';
  if (key === 'ArrowRight') return 'Right';
  if (key.length === 1) {
    const upper = key.toUpperCase();
    return KEYS.has(upper) ? upper : null;
  }
  return KEYS.has(key) ? key : null;
}

/**
 * The chord a captured keydown means, or null when it is not a usable chord:
 * no anchoring modifier, a modifier key still on its way down, or a key
 * outside the vocabulary.
 */
export function acceleratorFromEvent(event: CapturedKey): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return null;
  const key = keyName(event.key);
  if (!key) return null;
  const parts: string[] = [];
  if (event.metaKey) parts.push('Command');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

const GLYPH: Record<string, string> = {
  Command: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Super: '❖',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
};

/** The chord as the key caps a person reads, for a row of `<kbd>` elements. */
export function formatAccelerator(accelerator: string): string[] {
  return accelerator.split('+').map((part) => GLYPH[part] ?? part);
}
