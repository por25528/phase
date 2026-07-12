# Phase — Dark Mode + Board Insight Bar — Design

**Status:** approved design, ready for implementation planning
**Date:** 2026-07-12
**Scope:** Two focused, independent features — an app-wide **dark mode** (OLED character) and a **board insight bar** for the Goals/Kanban view. Both borrow Linear's *mechanics/management ergonomics*, not its visual style: Phase's warm light identity stays byte-for-byte unchanged.

## Summary

1. **Dark mode** — an additive second theme toggled from the header (System / Light / Dark). Implemented by flipping CSS variables under a `.dark` class, so no component markup changes and the light theme is provably identical to today's. Palette is OLED: pure-black base, faintly elevated surfaces, off-white text, terracotta accent retained.
2. **Board insight bar** — a compact management strip above the Goals columns showing **Board shape** (totals + per-column load), **Due soon** (deadlines within 14 days), and **Behind pace** (goals ≥10 pts behind schedule). All aggregation lives in a new pure, tested `src/lib` module; the view is thin.

## Goals

- Ship a dark theme that reads unmistakably as "Phase after dark" (accent + Fraunces/Inter type preserved) while the light theme is unchanged.
- Give the Goals board an at-a-glance "what needs me right now?" overview.
- Add no new heavy subsystems; respect the existing store/lib/view architecture and the locked light identity.

## Non-goals (explicitly out of scope)

- Command palette, board search, quick filters, keyboard-driven card navigation — considered and dropped this round.
- "Overall % complete" vanity metric on the insight bar — deliberately excluded in favor of attention signals.
- Any restyle of the **light** theme. Card layout, spacing, and light-mode colors do not change.
- Interactive insight metrics (click-to-filter) — the bar is informational in v1 (filters are out of scope, so there's nothing to drive).
- Theme in the Dexie backup — theme is a per-device preference, not user data (see Persistence).

## Constraints (carried from CLAUDE.md / plan docs)

- **Visual identity is locked.** Dark mode is authorized because it was explicitly requested; it must be *additive*. Light-theme output must be unchanged.
- **`goals` stays column-major.** The insight bar is read-only over `goals`; it never mutates state, so this is untouched.
- New pure logic goes in `src/lib` with a sibling `*.test.ts`; views stay thin and delegate.
- Dates are local `'YYYY-MM-DD'` strings compared lexicographically; never store `Date` objects.
- `tsconfig` has `noUnusedLocals`/`noUnusedParameters`. `npm test` + `npx tsc -b` green at every commit; conventional commit messages.

---

## Feature 1 — Dark mode

### 1.1 Behavior

Three theme states, cycled by a small sun/moon toggle in the header, placed in the right-hand cluster near `↓ EXPORT` / `↑ IMPORT`:

- **System** (default) — follows `prefers-color-scheme`, and reacts live if the OS flips while the app is open (via a `MediaQueryList` `change` listener).
- **Light** — force light.
- **Dark** — force dark.

The toggle shows the *effective* theme's icon and cycles System → Light → Dark → System. `aria-label` reflects the current state.

### 1.2 Persistence + no-FOUC

- Preference is stored in **`localStorage`** under key `phase-theme` (`'system' | 'light' | 'dark'`), **not** Dexie. Rationale: (a) it must be read *synchronously before first paint* to avoid a light-mode flash — Dexie load is async (~50 ms); (b) it's a per-device UI preference, like OS dark mode, and does not belong in a data backup. This is a deliberate, documented divergence from the `pxPerDay`-in-Dexie pattern.
- **No-FOUC inline script** in `index.html` `<head>`, before the module bundle: reads `phase-theme` (falling back to `matchMedia('(prefers-color-scheme: dark)')`), and if the effective theme is dark, adds `class="dark"` to `<html>` and sets `style="color-scheme: dark"`. It also updates the `theme-color` meta so the OS/browser chrome matches.
- On theme change at runtime, `setTheme` writes `localStorage`, toggles the `.dark` class + `color-scheme` on `<html>`, and updates the `theme-color` meta.

### 1.3 Theming mechanism — CSS-variable flip

Every color token in `tailwind.config.js` becomes an `rgb(var(--c-token) / <alpha-value>)` reference (the rgb-channel form is required so Tailwind's opacity modifiers, e.g. `bg-ink/40`, keep working). The channel triples are defined in `:root` (light) and overridden under `.dark`.

`tailwind.config.js` (illustrative):

```js
colors: {
  bg:    'rgb(var(--c-bg) / <alpha-value>)',
  panel: 'rgb(var(--c-panel) / <alpha-value>)',
  ink:   'rgb(var(--c-ink) / <alpha-value>)',
  accent:'rgb(var(--c-accent) / <alpha-value>)',
  // …one line per existing token, same names…
}
```

`src/index.css`:

```css
:root {
  --c-bg: 250 249 247;   /* #FAF9F7 — current light value, unchanged */
  --c-ink: 33 30 25;     /* #211E19 */
  /* …every token’s current hex, as space-separated RGB channels… */
}
.dark {
  --c-bg: 0 0 0;
  --c-ink: 236 235 232;
  /* …OLED values (table below)… */
}
```

Because light values equal today's exact hex, **light output is provably unchanged**. Component classes (`bg-panel`, `text-ink`, …) are never touched — they resolve to different values only when `<html>` carries `.dark`.

**Gotcha to handle:** the three `theme('colors.*')` call sites in `src/index.css`'s `@layer base` (`input/select` color, `::selection` background, `:focus-visible` outline) cannot use `theme()` anymore — `theme('colors.ink')` would inline the literal `rgb(var(--c-ink) / <alpha-value>)` string, and the `<alpha-value>` placeholder is only substituted for generated utilities, not raw CSS. Rewrite those three to use the variable directly, e.g. `color: rgb(var(--c-ink));`, `background: rgb(var(--c-accent-tint));`, `outline: 2px solid rgb(var(--c-accent));`. They then theme automatically.

**Elevation on black.** `shadow-card` / `shadow-today` use warm rgba drops that are invisible on `#000`. Convert the two `boxShadow` entries to CSS variables as well; in dark, use a subtle dark drop plus reliance on the existing `border-line` hairlines that cards already carry, so surfaces still separate.

### 1.4 Proposed OLED palette (dark values)

Starting proposal — exact values finalized during implementation against WCAG AA contrast. Semantics are preserved: `ink` is the strongest foreground (near-white in dark), `paper` is the inverted foreground (near-black in dark), so primary buttons (`bg-ink text-paper`) invert correctly.

| token | light (unchanged) | dark (proposed) |
|---|---|---|
| `bg` | `#FAF9F7` | `#000000` |
| `panel` | `#FFFFFF` | `#0D0D0E` |
| `panel-bright` | `#FFFFFF` | `#161618` |
| `field` | `#FFFFFF` | `#0D0D0E` |
| `ink` | `#211E19` | `#ECEBE8` |
| `ink-hover` | `#3A352C` | `#DAD8D3` |
| `ink-soft` | `#4A463C` | `#B7B4AD` |
| `muted` | `#85817A` | `#8B887F` |
| `faint` | `#B0ACA4` | `#5C5A54` |
| `faint-2` | `#C9C5BD` | `#47453F` |
| `line` | `#EAE8E3` | `#222224` |
| `line-2` | `#DEDBD3` | `#2E2E31` |
| `line-soft` | `#F0EEE9` | `#1A1A1C` |
| `hover` | `#F4F3EF` | `#161618` |
| `hover-deep` | `#EBE9E3` | `#202023` |
| `fill` | `#211E19` | `#ECEBE8` |
| `dot` | `#3B362B` | `#E3E1DB` |
| `dot-off` | `#E8E6DF` | `#2A2A2D` |
| `track` | `#EFEDE7` | `#1C1C1E` |
| `accent` | `#C8512F` | `#E1613B` |
| `accent-deep` | `#B34526` | `#C8512F` |
| `accent-soft` | `#D89A7E` | `#7A4130` |
| `accent-contrast` | `#FFF6EE` | `#FBEDE4` |
| `accent-tint` | `#F5E3DA` | `#2A1810` |
| `paper` | `#FAF9F7` | `#0A0A0B` |
| `chip` | `#F1EFEA` | `#1B1B1D` |
| `chip-ink` | `#6E6A61` | `#9A978F` |
| `warn` | `#A05A2C` | `#D08A4E` |
| `warn-tint` | `#F6EADF` | `#241A12` |

### 1.5 Hardcoded-color audit

A few spots bypass tokens and must be checked so they read correctly on black:

- **`text-white` on the toasts** (`src/App.tsx`, undo toast + toast) sit on `bg-ink`. In dark, `ink` becomes near-white → white-on-white. Fix: use `text-paper` (which inverts to near-black in dark), giving correct contrast in both themes.
- **`#b4453a`** delete-hover red (`BoardCard.tsx`) — reads acceptably on both; leave, or promote to a token if convenient. No behavior change required.
- **Tailwind built-ins** (`bg-white`, `text-black`) if any — grep and replace with the matching token so they flip.
- **Opacity modifiers on tokens** (`/NN`) — confirmed compatible with the rgb-channel form; grep to verify none rely on the old literal form.

### 1.6 Pure logic + store surface

- `src/lib/theme.ts` (+ `theme.test.ts`):
  - `type Theme = 'system' | 'light' | 'dark'`
  - `resolveTheme(pref: Theme, systemPrefersDark: boolean): 'light' | 'dark'` — pure, the unit-tested core.
  - `readStoredTheme(): Theme` and `applyTheme(effective: 'light' | 'dark'): void` — thin side-effect helpers (localStorage / DOM class / meta), not unit-tested.
- `src/state/store.ts`: add `theme: Theme` to `UIState` (default `'system'`), plus `actions.setTheme(next: Theme)` which persists to localStorage, applies to the DOM, and updates state so the header toggle re-renders. `theme` is UI state — it is **not** part of `AppState` and is not written through `setAndPersist`.
- `src/App.tsx`: header toggle button; subscribe once to the `prefers-color-scheme` `change` event so `System` reacts live.

### 1.7 Files touched (dark mode)

- `tailwind.config.js` — token → `rgb(var(--c-*) / <alpha-value>)`; shadows → vars.
- `src/index.css` — `:root` + `.dark` variable blocks; rewrite the 3 `theme('colors.*')` base rules to `rgb(var(--c-*))`.
- `index.html` — no-FOUC inline script + `theme-color` meta.
- `src/lib/theme.ts` + `src/lib/theme.test.ts` — new.
- `src/state/store.ts` — `theme` UI state + `setTheme`.
- `src/App.tsx` — header toggle; toast `text-white` → `text-paper`; system-pref listener.

---

## Feature 2 — Board insight bar

### 2.1 Content (exact definitions)

A compact strip rendering three attention signals. Thresholds reuse existing semantics so the bar and the cards always agree.

- **Board shape** — `total` goal count plus per-column distribution across the four priority columns, e.g. `12 goals · 5 / 3 / 2 / 2` (leftmost = Highest). Communicates load/WIP at a glance.
- **Due soon** — count of goals whose `deadline` falls within **14 days** of today (inclusive, not past-due), plus the single nearest upcoming deadline for context. "Within 14 days" is computed with the existing dates helpers on `'YYYY-MM-DD'` strings.
- **Behind pace** — count of goals where `Math.round(behindPaceBy(pct, start, deadline, today)) >= 10`. This mirrors `BoardCard` *exactly* — including the `Math.round` before the `>= 10` comparison — so a card showing its behind chip and the bar's count are guaranteed consistent (a value like 9.6 rounds to 10 and counts in both, not one).

Empty/zero states read plainly (e.g. `Nothing due soon`, `On pace`) rather than showing `0`.

### 2.2 Placement + behavior

- Sits between the Goals header (title + New/Import buttons) and the columns row in `src/views/Goals.tsx`.
- Rendered only when the board is non-empty (hidden alongside the dashed empty state).
- Informational in v1 — no interactivity. Built entirely from existing tokens (`panel`, `line`, `muted`, `ink`, plus `accent`/`warn` to draw the eye on the behind-pace count), so it themes into dark automatically with zero extra work.
- Responsive: the three signals wrap or scroll within their container on narrow screens; the page body never scrolls horizontally.

### 2.3 Pure logic + view

- `src/lib/boardInsights.ts` (+ `boardInsights.test.ts`):

  ```ts
  export interface BoardInsights {
    total: number;
    perColumn: number[];          // length = columnCount, index 0 = Highest
    dueSoonCount: number;
    nearestDeadline: string | null; // 'YYYY-MM-DD' of the soonest upcoming deadline, or null
    behindPaceCount: number;
  }

  export function computeBoardInsights(
    goals: Goal[],
    today: string,
    columnCount: number,
    dueSoonDays?: number,         // default 14
  ): BoardInsights;
  ```

  Pure; depends only on `goalPct` / `behindPaceBy` (existing `src/lib`) and date helpers. Tested for: per-column bucketing (including `column` absent ⇒ 0 and out-of-range clamped), due-soon window boundaries (today, +14, +15, past-due excluded), nearest-deadline selection, behind-pace threshold at the rounding boundary (e.g. 9.6 ⇒ counts, 9.4 ⇒ does not), and the empty-goals case.

- `src/views/goals/InsightBar.tsx` — thin presentational component taking `BoardInsights` (or `goals` + today and calling the lib) and rendering the three signals. `Goals.tsx` computes insights via `useMemo` over `goals` and mounts `<InsightBar>` above the `DndContext`.

### 2.4 Files touched (insight bar)

- `src/lib/boardInsights.ts` + `src/lib/boardInsights.test.ts` — new.
- `src/views/goals/InsightBar.tsx` — new.
- `src/views/Goals.tsx` — compute + mount the bar (non-empty branch only).

---

## Testing strategy

- **Unit (Vitest):** `theme.ts` (`resolveTheme` truth table across the 3 prefs × system dark/light) and `boardInsights.ts` (cases in 2.3). Keeps to the repo's pure-lib test discipline; no component tests.
- **Manual verification:**
  - Light theme pixel-identical to `main` (spot-check Today, Goals, Timeline, drawer).
  - Toggle cycles System → Light → Dark; persists across reload; **no light flash** on dark reload.
  - `System` follows an OS dark/light switch live.
  - OLED dark: cards separate from the black background, text is legible (no pure-white glare), accent/warn read correctly, toasts legible, focus rings visible.
  - Insight bar: counts match the cards (a card with a behind chip is counted; due-soon matches the deadline chips); hidden on the empty board; wraps cleanly on a narrow window.
- **Gates:** `npm test` and `npx tsc -b` green before each commit.

## Locked decisions

- Interpretation of "inspired by Linear": **mechanics, keep the look.**
- Board mechanic chosen: **insight bar only** (no palette/search/keyboard-nav).
- Insight contents: **Board shape, Due soon, Behind pace** (no overall-% metric).
- Dark palette character: **True black / OLED**, accent + type retained.
- Theme persistence: **localStorage**, per-device, not in the Dexie backup.
- Theming mechanism: **CSS-variable flip** under `.dark` (rgb-channel tokens), not `dark:` variants.

## Open questions

None blocking. Exact dark hex values in §1.4 are a proposal to be contrast-checked during implementation; the semantics and mechanism are fixed.
