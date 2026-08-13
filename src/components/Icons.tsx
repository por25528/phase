/**
 * The app's icons, on one grid.
 *
 * Every icon here is drawn in a 24×24 box, stroked in `currentColor` at 1.8
 * with round caps and joins, and rendered through `Icon` so none of that can
 * drift per-file. Filled icons (the checkpoint diamond, the dot clusters, the
 * sparkle) pass `fill` and set `stroke="none"` — a dot has no stroke to match.
 *
 * ── Why these are SVGs and not characters ────────────────────────────────────
 *
 * Most of these used to be Unicode glyphs typed straight into the JSX: `✕` to
 * close, `✓` to complete, `✎` to rename, `⠿` to drag, `▶` to expand, `⋯` for
 * the overflow menu. None of them were in the font.
 *
 * Inter is self-hosted and subsetted (`@fontsource-variable/inter`), and its
 * `unicode-range` declarations cover Latin, Greek, Cyrillic and Vietnamese plus
 * a short list of individually-named symbols. U+2715, U+2713, U+270E, U+283F,
 * U+25B6, U+25C6, U+22EF, U+2726, U+26A0 and U+2192 are in none of them — so
 * every one of those characters was resolved by the browser's per-glyph
 * fallback, off whatever face the OS happened to offer. The app's icons were
 * therefore drawn by macOS on a Mac, by Segoe UI Symbol on Windows, and by
 * whatever fontconfig picked on Linux, at three different weights and three
 * different optical sizes, none of them Inter.
 *
 * Two consequences were visible rather than theoretical:
 *
 *  - `⚠` (U+26A0) and `✦` (U+2726) carry Emoji_Presentation-capable defaults,
 *    so on a stock macOS the overdue-project warning could resolve to Apple
 *    Color Emoji — a full-colour glyph in a monochrome UI, ignoring `text-warn`
 *    entirely, because a colour emoji does not take `currentColor`.
 *  - Inter's Latin subset names U+2191 and U+2193 explicitly but NOT U+2190 or
 *    U+2192. So in the shortcuts overlay, `↑/↓` rendered in Inter and `←/→`
 *    rendered in the fallback — two faces, adjacent, in one table.
 *
 * Sizes are numbers, not classes, because an icon's box is geometry rather
 * than type: `size` sets the SVG's own width/height so the 1.8 stroke scales
 * with it, and no arbitrary `w-[Npx]` gets added to the Tailwind scale.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────────
 *
 * The checkmark inside `TodayCheckbox` and `GoalTree`'s `LeafCheckbox` stays
 * where it is, on a 12 grid at stroke 2.4. It is not an icon in this set's
 * sense — it is a control's internal mark, drawn at 11-12px on a filled accent
 * chip, and the heavy relative weight is optical compensation for that size.
 * Re-drawing it on the 24 grid at 1.8 would render it at 0.8px and it would
 * disappear. `IconCheck` below is for a standalone tick in a line of text,
 * which is a different job at a different size.
 *
 * Keycap symbols (`⌘`, `⌥`, `⇧`) also stay as characters: they name physical
 * keys, they have no icon equivalent, and substituting a drawing for the
 * symbol printed on the key would be worse. They are set in `font-mono`, whose
 * macOS stack (SF Mono, Menlo) covers them.
 */

import type { ReactNode } from 'react';

type IconProps = {
  /** Edge length in px. The 1.8 stroke scales with it — 14px reads ≈1.05px. */
  size?: number;
  className?: string;
};

function Icon({
  size = 14,
  className = '',
  fill = 'none',
  stroke = 'currentColor',
  children,
}: IconProps & { fill?: string; stroke?: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-shrink-0 ${className}`}
      // Icons never carry the name — the control around them does, via
      // aria-label or its own text. `focusable` is for legacy IE/Edge, where
      // an SVG is a tab stop by default.
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// ── Actions ───────────────────────────────────────────────────────────────────

/** Close, dismiss, delete, unschedule — was `✕` (U+2715). */
export function IconX(p: IconProps) {
  return <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
}

/** A standalone tick in a line of text — was `✓` (U+2713). */
export function IconCheck(p: IconProps) {
  return <Icon {...p}><path d="M5 12.5l4.5 4.5L19 6.5" /></Icon>;
}

/** Rename — was `✎` (U+270E) in the tree, and a local `PencilIcon` in Habits. */
export function IconPencil(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
  );
}

/** Add — was `＋` (U+FF0B, the FULLWIDTH plus, which no Latin subset carries). */
export function IconPlus(p: IconProps) {
  return <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
}

/**
 * Search. Was `⌕` — U+2315, whose name is TELEPHONE RECORDER. It is a common
 * stand-in for a magnifier because it looks vaguely like one in some faces, but
 * it is not one, and like the rest of these it was not in Inter either.
 */
export function IconSearch(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.3 15.3L21 21" />
    </Icon>
  );
}

/** Reclaim space — was `⌫` (U+232B). */
export function IconBackspace(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M20 5.5h-9.2L3 12l7.8 6.5H20a1.8 1.8 0 0 0 1.8-1.8V7.3A1.8 1.8 0 0 0 20 5.5Z" />
      <path d="M18 9.5l-5 5M13 9.5l5 5" />
    </Icon>
  );
}

// ── Direction ─────────────────────────────────────────────────────────────────

/**
 * Expand / collapse. Was `▶` (U+25B6) in three places and a hand-rolled 8×8
 * `<path d="M2 1 L6 4 L2 7">` at stroke 1.4 in a fourth — the same control,
 * drawn four ways. Call sites rotate it 90° for the open state.
 */
export function IconChevronRight(p: IconProps) {
  return <Icon {...p}><path d="M9.5 5.5L16 12l-6.5 6.5" /></Icon>;
}

/** Was `→` (U+2192), which Inter does not carry even though `↑`/`↓` are. */
export function IconArrowRight(p: IconProps) {
  return <Icon {...p}><path d="M4 12h15M12.5 5.5L19 12l-6.5 6.5" /></Icon>;
}

/** Export. */
export function IconArrowDown(p: IconProps) {
  return <Icon {...p}><path d="M12 4.5v14M5.5 12L12 18.5 18.5 12" /></Icon>;
}

/** Import. */
export function IconArrowUp(p: IconProps) {
  return <Icon {...p}><path d="M12 19.5v-14M5.5 12L12 5.5 18.5 12" /></Icon>;
}

/** Reopen — undo a completion, put the goal back in play. */
export function IconRotate(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5" />
      <path d="M4.2 4.6v4.2h4.2" />
    </Icon>
  );
}

/** Working hours — the availability window everything free is measured against. */
export function IconClock(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.4V12l3.2 2" />
    </Icon>
  );
}

/**
 * Open this as its own workspace — the `↗` the inspector offers on a container.
 *
 * Deliberately not a plain right arrow: `IconArrowRight` already means "then"
 * in the date span two rows below it, and the two would sit close enough to be
 * read as the same mark.
 */
export function IconArrowUpRight(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M7 17 17 7M8.4 7H17v8.6" />
    </Icon>
  );
}

/**
 * A date — a deadline, a due day, the thing a date popover edits.
 *
 * Distinct from `IconClock`, which means a DURATION or a window: the inspector
 * puts them on adjacent rows ("Aug 12" and "45m"), so they cannot share a mark
 * without the two properties reading as one.
 */
export function IconCalendar(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3.2" y="5" width="17.6" height="16" rx="2.2" />
      <path d="M3.2 10h17.6M8 3.2v3.6M16 3.2v3.6" />
    </Icon>
  );
}

/**
 * An open task — the hollow ring the compact inspector leads its status row
 * with. `LeafStatusBox` draws the tickable square on a tree row; this is the
 * read-only mark beside a word, and it never toggles anything by itself.
 */
export function IconCircle(p: IconProps) {
  return <Icon {...p}><circle cx="12" cy="12" r="8.2" /></Icon>;
}

// ── Indicators ────────────────────────────────────────────────────────────────

/**
 * A milestone — was `◆` (U+25C6) filled and `◇` (U+25C7) hollow.
 *
 * A milestone here is a real node that counts in the roll-up, so it gets a
 * solid mark; `filled` false is the "could be one, isn't" state in the task
 * panel's toggle.
 */
export function IconDiamond({ filled = true, ...p }: IconProps & { filled?: boolean }) {
  return (
    <Icon {...p} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 3.4L20.6 12 12 20.6 3.4 12Z" />
    </Icon>
  );
}

/**
 * Was `⚠` (U+26A0) — a codepoint with an emoji presentation default, so it
 * could render as a full-colour glyph that ignores `text-warn`.
 */
export function IconWarning(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M10.3 4.2 1.2 17.6a2 2 0 0 0 1.7 3h18.2a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 17.2h.01" />
    </Icon>
  );
}

/** Break a step into subtasks — was `✦` (U+2726), also emoji-capable. */
export function IconSparkle(p: IconProps) {
  return (
    <Icon {...p} fill="currentColor" stroke="none">
      <path d="M12 2.5c.6 5.1 4.4 8.9 9.5 9.5-5.1.6-8.9 4.4-9.5 9.5-.6-5.1-4.4-8.9-9.5-9.5 5.1-.6 8.9-4.4 9.5-9.5Z" />
    </Icon>
  );
}

// ── Dot clusters ──────────────────────────────────────────────────────────────
// Dots are filled, so there is no stroke to match — the shared grid still is.

/** The overflow menu — was `⋯` (U+22EF). */
export function IconDots(p: IconProps) {
  return (
    <Icon {...p} fill="currentColor" stroke="none">
      <circle cx="5.5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18.5" cy="12" r="1.6" />
    </Icon>
  );
}

/**
 * Drag handle — was `⠿` (U+283F, a BRAILLE PATTERN) in the tree, while the
 * plan sidebar already had this exact icon drawn properly. Same affordance,
 * two implementations, one of them a braille character.
 */
export function IconGrip(p: IconProps) {
  return (
    // Taller than wide, 8 across by 14 down. Everything else in this set is
    // drawn to fill the square, but a grip that fills a square reads as a
    // dotted box — the handle it replaced was 10×16 for that reason, and the
    // proportion is the thing that says "grab here", not the dots.
    <Icon {...p} fill="currentColor" stroke="none">
      <circle cx="8" cy="5" r="1.6" />
      <circle cx="16" cy="5" r="1.6" />
      <circle cx="8" cy="12" r="1.6" />
      <circle cx="16" cy="12" r="1.6" />
      <circle cx="8" cy="19" r="1.6" />
      <circle cx="16" cy="19" r="1.6" />
    </Icon>
  );
}

// ── Views ─────────────────────────────────────────────────────────────────────

/** The Goals board — three horizon columns. Lucide `columns-3`. */
export function IconColumns(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </Icon>
  );
}

/** The Goals timeline — spans against a calendar. Lucide `gantt-chart`. */
export function IconTimeline(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 6h10M4 12h16M4 18h7" />
    </Icon>
  );
}

// ── Theme ─────────────────────────────────────────────────────────────────────

export function IconSun(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  );
}

export function IconMoon(p: IconProps) {
  return <Icon {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></Icon>;
}
