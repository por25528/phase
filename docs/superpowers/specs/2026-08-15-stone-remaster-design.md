# Stone: a token remaster

Phase's visual identity is warm editorial paper — `#FAF9F7` off-white, a
terracotta `#C04E2D` accent, Fraunces on the wordmark. It is coherent and it was
built deliberately. It does not read as a professional tool, and that is the only
complaint being answered here.

This is a **token swap**. Every screen changes appearance; no screen changes
shape. Layout, density, spacing, copy, icons and component logic are untouched,
with two named exceptions that were consented to explicitly (§5, §9).

## The problem

Three things, in descending order of how much they matter.

**The palette is warm and the accent is loud.** `--c-accent: 192 78 45` is a
saturated terracotta carrying 101 usages — tab underlines, checkbox fill, focus
rings, selected rows. Beside `--c-warn` (`158 89 44`, 200 usages) the two sit
nine degrees apart on the hue wheel, so "this is the action" and "this is
trouble" are told apart mostly by context. On a warm `#FAF9F7` page the whole
app reads as stationery.

**There is one type role too few and six type sizes too many.** `fontSize`
carries 17 keys. Four of them live inside `0.1rem` of each other at the small
end (`micro` .52, `eyebrow` .56, `tiny` .6, `kbd` .62), and `eyebrow`,
`compact`, `h3` are used once or twice each. Meanwhile `font-mono` is applied
across a dozen files — every section label, every key hint, every tabular stat —
and names only a system stack, so the one face on every section header is
whatever the OS supplies — SF Mono here, Consolas on Windows, Liberation Mono
on Linux, at three different widths. The `tracking-[.11em]` tuned against those
labels is correct only on the machine that tuned it.

**Nothing else is broken.** The audit is worth stating plainly because it bounds
this work: there are zero emojis, zero literal hex colours, zero unicode glyph
icons, 17 hand-drawn SVG icons on a consistent 24×24 / 1.8-stroke grid, colour
already restricted to action and status with neutral chrome throughout, and row
actions already collapsed behind `⋯`. `designScale.test.ts` fails the build on
most of the ways those could regress. The hygiene work is done.

## What this is not

**Not a redesign.** No component moves, no surface gains or loses a control, no
copy changes. If a screenshot before and after differs in anything but colour,
type and corner radius, something went wrong.

**Not the mockup's stat strip.** The `Planned / To place / Free` panel that made
the browser mockups feel like an instrument panel is a mockup device. It is not
a Phase component, it has no store action behind it, and building it is a
feature wearing a token change.

**Not a progress bar on the board card.** One was drawn in the mockups to show
the accent working. `2026-08-10-remaster-round-2-audit.md` rejected it on
grounds that still hold: `effort.ts`'s sentence is the deliberate honest
default and a percentage silently changes basis.

**Not the spacing scale.** Round 2 found 152 distinct arbitrary px spacing
values and correctly sequenced that work last, because it touches many files and
conflicts with every other edit. It is still last. This spec does not touch
spacing.

**Not a serif app.** The serif reaches three roles and stops (§3). Serifs are
drawn for 16px and up; putting one on an 11px label in a 249px rail fills the
brackets in and makes the densest surface the least legible.

## 1. The palette — Stone

Warm neutrals with the saturation pulled out, and a slate accent that reads as
ink until you look twice. Ratios below are computed, not estimated, and §10
pins them in a test.

### Light

| Token | Value | Hex | Note |
|---|---|---|---|
| `--c-bg` | `247 247 245` | `#F7F7F5` | |
| `--c-panel` | `255 255 255` | `#FFFFFF` | |
| `--c-panel-bright` | `255 255 255` | `#FFFFFF` | |
| `--c-field` | `255 255 255` | `#FFFFFF` | |
| `--c-ink` | `26 26 24` | `#1A1A18` | |
| `--c-ink-hover` | `51 50 46` | `#33322E` | |
| `--c-ink-soft` | `70 68 62` | `#46443E` | |
| `--c-muted` | `110 108 102` | `#6E6C66` | 4.90:1 bg · 5.26:1 panel |
| `--c-faint` | `146 143 136` | `#928F88` | 3.01:1 bg · 3.23:1 panel |
| `--c-faint-2` | `200 197 190` | `#C8C5BE` | |
| `--c-line` | `233 232 228` | `#E9E8E4` | |
| `--c-line-2` | `216 214 208` | `#D8D6D0` | |
| `--c-line-soft` | `240 239 235` | `#F0EFEB` | |
| `--c-check` | `139 136 127` | `#8B887F` | 3.30:1 bg · 3.54:1 panel |
| `--c-hover` | `242 241 238` | `#F2F1EE` | |
| `--c-hover-deep` | `233 232 227` | `#E9E8E3` | |
| `--c-fill` | `26 26 24` | `#1A1A18` | |
| `--c-dot` | `51 50 46` | `#33322E` | |
| `--c-dot-off` | `228 226 220` | `#E4E2DC` | |
| `--c-track` | `237 236 232` | `#EDECE8` | |
| `--c-accent` | `58 74 92` | `#3A4A5C` | 8.46:1 bg · 9.08:1 panel |
| `--c-accent-deep` | `44 58 73` | `#2C3A49` | |
| `--c-accent-soft` | `139 154 170` | `#8B9AAA` | |
| `--c-accent-contrast` | `255 255 255` | `#FFFFFF` | 9.08:1 on accent |
| `--c-accent-tint` | `232 236 240` | `#E8ECF0` | |
| `--c-paper` | `247 247 245` | `#F7F7F5` | |
| `--c-chip` | `241 240 236` | `#F1F0EC` | |
| `--c-chip-ink` | `102 100 94` | `#66645E` | 5.19:1 on chip |
| `--c-raised` | `255 255 255` | `#FFFFFF` | one step up from chip |
| `--c-warn` | `161 84 31` | `#A1541F` | 4.73:1 on warn-tint · 5.11:1 bg |
| `--c-warn-tint` | `246 237 228` | `#F6EDE4` | |

### Dark — warm charcoal

**This overturns the OLED decision, deliberately.** The current dark theme is
pure black (`--c-bg: 0 0 0`). Pure black beside a warm light theme is two
identities in one app, and the OLED battery argument that justified it is worth
little on a desktop Mac app whose panels are overwhelmingly LCD or mini-LED.
The cost is real and is paid in §2.

| Token | Value | Hex | Note |
|---|---|---|---|
| `--c-bg` | `20 19 17` | `#141311` | |
| `--c-panel` | `30 29 27` | `#1E1D1B` | |
| `--c-panel-bright` | `38 36 33` | `#262421` | |
| `--c-field` | `30 29 27` | `#1E1D1B` | |
| `--c-ink` | `235 231 222` | `#EBE7DE` | |
| `--c-ink-hover` | `214 210 201` | `#D6D2C9` | |
| `--c-ink-soft` | `181 176 165` | `#B5B0A5` | |
| `--c-muted` | `142 137 126` | `#8E897E` | 4.86:1 panel |
| `--c-faint` | `114 109 98` | `#726D62` | 3.24:1 panel |
| `--c-faint-2` | `74 70 62` | `#4A463E` | |
| `--c-line` | `44 42 38` | `#2C2A26` | |
| `--c-line-2` | `59 56 49` | `#3B3831` | |
| `--c-line-soft` | `35 34 32` | `#232220` | |
| `--c-check` | `110 106 96` | `#6E6A60` | 3.11:1 panel |
| `--c-hover` | `38 36 33` | `#262421` | |
| `--c-hover-deep` | `50 47 42` | `#322F2A` | |
| `--c-fill` | `235 231 222` | `#EBE7DE` | |
| `--c-dot` | `220 216 207` | `#DCD8CF` | |
| `--c-dot-off` | `53 50 44` | `#35322C` | |
| `--c-track` | `42 40 36` | `#2A2824` | |
| `--c-accent` | `159 178 198` | `#9FB2C6` | 7.83:1 panel |
| `--c-accent-deep` | `184 199 214` | `#B8C7D6` | deeper = lighter on dark |
| `--c-accent-soft` | `74 87 104` | `#4A5768` | |
| `--c-accent-contrast` | `20 24 29` | `#14181D` | 8.40:1 on accent |
| `--c-accent-tint` | `34 40 47` | `#22282F` | |
| `--c-paper` | `16 15 14` | `#100F0E` | |
| `--c-chip` | `38 36 33` | `#262421` | |
| `--c-chip-ink` | `154 149 138` | `#9A958A` | |
| `--c-raised` | `58 55 48` | `#3A3730` | |
| `--c-warn` | `201 136 75` | `#C9884B` | 5.42:1 on warn-tint · 5.74:1 panel |
| `--c-warn-tint` | `42 32 24` | `#2A2018` | |

**The accent keeps one hue family across both themes**, lightness flipped — the
convention the terracotta pair already used (`#C04E2D` light, `#E1613B` dark).
A dark accent in a different hue would make "action" a different channel
depending on the theme.

**Accent and warn are now far apart.** Slate `#3A4A5C` against amber-brown
`#A1541F` cannot be confused; the old terracotta/warn pair sat nine degrees
apart. This is the palette's main functional gain, not just an aesthetic one.

### Shadows and the scrim

```
light  --shadow-card:  0 1px 2px rgba(26, 26, 24, .05)
       --shadow-today: 0 2px 6px rgba(26, 26, 24, .07)
       --scrim:        rgba(20, 19, 17, .30)

dark   --shadow-card:  0 1px 2px rgba(0, 0, 0, .45)
       --shadow-today: 0 2px 8px rgba(0, 0, 0, .55)
       --scrim:        rgba(10, 9, 8, .62)
```

Dark's scrim can lighten from `.66` to `.62`: the panel is now 8% lighter than
the page rather than 5%, so the surface itself carries more of the separation
and the scrim has less to do alone.

## 2. Project identity — six restated hues

Six hues, assigned by hash (`lib/projectColour.ts`), used only for the 3px rail
and tinted background on calendar blocks and board cards.

| Token | Hex | Name | Rel. luminance |
|---|---|---|---|
| `--c-proj-0` | `#4A8078` | teal | .182 |
| `--c-proj-1` | `#626FA3` | indigo | .165 |
| `--c-proj-2` | `#8C6280` | plum | .160 |
| `--c-proj-3` | `#72794F` | moss | .177 |
| `--c-proj-4` | `#53788F` | steel | .170 |
| `--c-proj-5` | `#9B7160` | clay | .196 |

Declared once rather than per theme, as today.

**The warm charcoal panel is what set these values, and it is the cost of §1.**
WCAG 1.4.11 applies (a 3px non-text element), so every hue must clear 3:1
against both panels. The old OLED panel (`#0D0D0E`, L ≈ .0045) permitted a band
of `L ∈ [0.113, 0.30]`. The warm panel (`#1E1D1B`, L ≈ .0122) raises the floor
to **`L ≥ 0.137`**. The first Stone-key set drawn against OLED failed: plum sat
at 2.70:1. Every value above was lifted into `[0.160, 0.196]`, which clears
**≥3.38:1 on `#1E1D1B`** and **≥4.26:1 on `#FFFFFF`**. They are perceptibly
more pastel than the set drawn for OLED, and that is not a mistake to correct.

Still deliberately far from `--c-accent`: accent means ACTION, warn means
TROUBLE, project identity is a third channel and must not be read as either.

## 3. The three faces

| Role | Family | Package | Used for |
|---|---|---|---|
| `font-disp` | Fraunces Variable | `@fontsource-variable/fraunces` *(installed)* | wordmark, page title, note headings — **and nothing else** |
| `font-ui` | Public Sans Variable | `@fontsource-variable/public-sans` | every other glyph in the app |
| `font-mono` | IBM Plex Mono | `@fontsource/ibm-plex-mono` | section labels, key hints, counters, times, dates |

**Inter is removed.** Public Sans replaces it wholesale. Import sites:
`src/main.tsx` and `src/assistant/main.tsx`.

**IBM Plex Mono has no variable build on fontsource** — only static weights.
Ship `400` and `500` and no more; mono appears on labels, key hints and
counters, none of which need a third weight. This is the one place the font
strategy differs from the rest of the app.

**Public Sans, not a more characterful sans, on purpose.** Its design brief was
legibility and neutrality for documents people must not misread. That is the
"textbook" quality being aimed at, and character in the body face would compete
with Fraunces above it.

**Fraunces is display-only and the boundary is hard.** Three roles: the
wordmark, a page title (`text-page` on `TaskPage`, `AreaPage`), and headings
typed inside a note (`.note-prose h1/h2/h3`). Row titles, card titles, property
labels, buttons and section labels are all `font-ui`. This is the rule §9's
guard rewrite has to encode.

## 4. The type scale — 17 keys to 11

Root stays `14px`. Six keys collapse onto a survivor.

| Key | Now | Stone | px @14 | Role |
|---|---|---|---|---|
| `root` | 14px | 14px | 14 | body base |
| `micro` | .52rem | **.625rem** | 8.75 | mono section labels, eyebrows |
| `eyebrow` | .56rem | → `micro` | | *alias, used 2×* |
| `tiny` | .6rem | → `meta` | | *alias, used 9×* |
| `kbd` | .62rem | → `meta` | | *alias, used 5×* |
| `badge` | .68rem | → `meta` | | *alias, used 7×* |
| `meta` | .72rem | **.75rem** | 10.5 | counters, dates, secondary metadata |
| `compact` | .76rem | → `ui` | | *alias, used 2×* |
| `ui` | .8rem | **.8rem** | 11.2 | default control text |
| `body` | .84rem | **.875rem** | 12.25 | default reading text, row titles |
| `lead` | .9rem | **.95rem** | 13.3 | note body at full measure |
| `title` | .98rem | **1rem** | 14 | card titles |
| `h3` | 1.05rem | → `title` | | *alias, used 1×* |
| `h2` | 1.2rem | **1.15rem** | 16.1 | note headings, dialog titles |
| `h1` | 1.4rem | **1.4rem** | 19.6 | view headings |
| `wordmark` | 1.5rem | **1.2rem** | 16.8 | the mark |
| `page` | 1.75rem | **1.85rem** | 25.9 | document title |

**Size and face are orthogonal — do not read a Fraunces role off this table.**
A size token sets size only; the face comes from context per §3. `text-h1` is
the Goals view heading in `font-ui` *and* a heading typed inside a note in
`font-disp`, because `.note-prose h1` selects on the container, not the size.
The three Fraunces roles in §3 are the complete list, and `h1` on a view
heading is not one of them.

`wordmark` drops from 21px to 16.8px. A serif mark at 21px in a 48px header bar
was competing with the view title beneath it; at 16.8px it sits with the nav
rather than above it.

`page` rises so it stays clear of `h1`, preserving the existing rule that a
document's own title outranks a heading typed inside it.

**No `fontSize` key may share a name with a `colors` key.** That rule stands
unchanged and is why `badge` was never called `chip`.

## 5. Section labels — a rule change

Today a section label is `text-meta font-semibold text-muted`, sentence case, UI
face, and `2026-08-10-remaster-round-2-audit.md` explicitly rejected promoting
it. That rejection was about *size*, and it still holds. This changes *voice*.

```
was:  text-meta font-semibold text-muted                    "Now"
is:   text-micro font-medium text-muted font-mono
      uppercase tracking-[.11em]                            "NOW"
```

**Why it earns the exception.** Phase's labels name regions of a working
surface — `Now`, `Free time`, `Carried over`, `Done today`, `Attention`. In the
mono voice they stop reading as prose headings and start reading as the legend
on an instrument, which is the entire quality the remaster is chasing. The
label also gets quieter, not louder: 10.08px semibold sentence case becomes
8.75px medium uppercase, so it recedes behind the content it introduces while
becoming more distinct from it.

**This is a component-touching change** and the second of the two consented
exceptions to token-only scope. Approximately 12 sites: `Today.tsx` ×7, plus
`Plan.tsx`, `Backlog.tsx`, `Goals.tsx` and the project tabs. It requires the
`uppercase` guard rewrite in §9.

Uppercase remains forbidden everywhere except (a) the three weekday strips and
(b) a label carrying `font-mono`. Uppercase without mono stays a build failure.

## 6. Corner radii

| Token | Now | Stone | Uses | Applies to |
|---|---|---|---|---|
| `[4px]` | 4px | 4px | 36 | checkbox, status marks, tiny chips |
| `[6px]` | 6px | 6px | 74 | menu items, quiet-control hit areas, nav |
| `rounded-field` | 9px | **8px** | 79 | buttons, inputs, popovers, rows |
| `[11px]` | 11px | **deleted** | 4 | — |
| `rounded-card` | 14px | **12px** | 21 | cards, modals, panels |
| `rounded-full` | 999px | 999px | 10 | badges, pills |

`[11px]` is the only true stray and its four sites resolve to `field` or `card`
by which they sit in. Controls staying rounder-than-nothing but less round than
surfaces is correct and deliberate — round 2 rejected swapping them and that
stands.

## 7. What does not change

Stated so a reader does not go looking. Every one of these was checked and is
already correct:

- **No emojis anywhere.** Already banned and already absent.
- **17 SVG icons**, 24×24 grid, 1.8 stroke, `currentColor`. No icon library is
  needed; the set already matches Feather/Lucide conventions. Two inline SVGs
  in `GoalTree.tsx` stay inline.
- **Colour is already restricted** to action (`accent`), trouble (`warn`) and
  data identity (`proj-*`). Chrome and navigation are already fully neutral.
- **Row actions are already behind `⋯`** (`lib/rowActions.ts` / `RowActions.tsx`).
- **Destructive actions already have friction** — the undo toast for reversible
  deletes, and a typed-`REPLACE` confirmation for the one irreversible action
  (`ConfirmImportModal.tsx`). Adding typed confirmation to ordinary deletes
  would contradict the undo invariant in `CLAUDE.md`.

## 8. Files

| File | Change |
|---|---|
| `src/index.css` | every `--c-*` in `:root` and `.dark`; shadows; scrim; `.note-prose`; `.quiet-control` radius |
| `tailwind.config.js` | `fontSize`, `fontFamily`, `borderRadius` |
| `src/main.tsx` | drop Inter import, add Public Sans + IBM Plex Mono |
| `src/assistant/main.tsx` | same |
| `package.json` | `+public-sans`, `+ibm-plex-mono`, `−inter` |
| `src/lib/designScale.test.ts` | guard rewrites (§9) |
| `src/lib/projectColour.test.ts` | new band, new dark panel |
| `src/lib/paletteContrast.test.ts` | **new** (§10) |
| ~12 section-label sites | §5 |
| 4 `[11px]` sites | §6 |

## 9. Guards that must change

`designScale.test.ts` is the reason this remaster is safe to attempt, and three
of its rules are now wrong.

1. **`font-disp` outside `App.tsx` fails.** Fraunces now has three roles.
   Replace the single-site rule with an allowlist: `font-disp` is permitted on
   the wordmark, on `text-page` titles, and on `.note-prose` headings in
   `index.css`. Anywhere else still fails.
2. **`uppercase` outside the three weekday strips fails.** Replace with:
   permitted in the three weekday strips, or on an element also carrying
   `font-mono`. Uppercase in the UI face still fails.
3. **The radius allowlist contains `[11px]`.** Remove it, so a reintroduction
   fails the build.
4. The Inter subsetting comments in `designScale.test.ts` and `Icons.tsx` refer
   to a font that will no longer be installed. Update the prose.

`projectColour.test.ts` currently asserts 3:1 against `#0D0D0E`. It must assert
against `#1E1D1B`, and the documented band moves from `[0.113, 0.30]` to
`[0.137, 0.30]`. **Updating this test is not optional bookkeeping** — it is the
thing that would otherwise let a future edit quietly reintroduce a hue that
fails on the new panel.

## 10. Tests

`paletteContrast.test.ts` is new, and it exists because every ratio in §1 is
currently a comment. Comments do not fail builds.

For both themes, assert:

- `muted` ≥ 4.5:1 against `panel` **and** `bg` — secondary copy carries most of
  the app's information
- `faint` ≥ 3:1 against `panel` and `bg` — the non-text floor
- `check` ≥ 3:1 against `panel` and `bg` — WCAG 1.4.11; this is the app's
  primary action and it was invisible once already
- `accent` ≥ 4.5:1 against `panel` and `bg`
- `accent-contrast` ≥ 4.5:1 against `accent`
- `warn` ≥ 4.5:1 against `warn-tint` and against `panel`
- `chip-ink` ≥ 4.5:1 against `chip`
- `ink` ≥ 7:1 against `panel` (AAA — it is the reading colour)

Parse the values straight from `index.css` so the test reads what ships rather
than a duplicated table.

Existing suites must pass unchanged. Any test asserting a specific hex or a
specific `text-*` class is asserting the old identity and should be read
carefully before it is edited — if a component test fails, the question is
whether the token moved or the component did.

## 11. Staging

**Commit 1 — tokens.** `index.css`, `tailwind.config.js`, fonts, the six
aliased `fontSize` keys pointed at their survivors, `[11px]`'s four sites,
guard rewrites, `paletteContrast.test.ts`. Visually final. No `.tsx` changes
beyond the four radius sites.

**Commit 2 — section labels.** The ~12 sites and the `uppercase` guard change.
Separate because it is the one change that alters a documented voice, and it
should be reviewable and revertible on its own.

**Commit 3 — CLAUDE.md.** The bullets listing `designScale.test.ts`'s rules,
the section-label definition, the OLED dark description and the accent
rationale all describe a palette that will no longer exist.

**Commit 4 — alias deletion (optional, later).** Delete the six alias keys and
update the ~26 call sites. Purely mechanical, no visual change. Deferred so the
result can be judged before committing to the sweep.

## Out of scope

- The `Planned / To place / Free` stat strip — a mockup device, not a component
- A progress bar on the board card — rejected by round 2, still rejected
- A logo mark or glyph — an asset, not a token
- Serif in the note body — display-only was chosen deliberately
- The spacing scale and its 152 arbitrary px values — round 2 sequenced this
  last, and it still is
- Skeleton loading states, ellipsis truncation rules, typed confirmation on
  ordinary deletes, bento card sizing — all outside the chosen scope, and the
  last two conflict with standing invariants
