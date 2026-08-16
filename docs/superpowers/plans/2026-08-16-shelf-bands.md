# Shelf Three-Band Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the assistant shelf's `shelf` presentation as three full-width bands — work, alternatives, dials — so the primary title gets 433px instead of 165px and the card's height stops depending on its content.

**Architecture:** `AssistantSurface.tsx` is fully controlled and stays so. Every change is markup and class strings inside that one component plus its test file; the `AssistantSnapshot` / `AssistantAction` protocol, every store action, and every colour token are untouched. The `embedded` (380px) presentation keeps its current stacked arrangement and its top-mounted dial strip — it lives inside a `max-h-[70vh] overflow-y-auto` panel, so a bottom status bar there would scroll out of view rather than pin. `electron/assistantWindow.cjs`'s `HEIGHT` is re-measured at the end, never recalculated.

**Tech Stack:** React 19, TypeScript, Tailwind (token-based), Vitest + Testing Library (jsdom), Electron for real-layout measurement.

## Global Constraints

Copied verbatim from `docs/superpowers/specs/2026-08-16-shelf-bands-design.md` and `CLAUDE.md`. Every task's requirements implicitly include this section.

- **No colour token values change.** Stone is inherited, not amended. No literal hex anywhere — `designScale.test.ts` fails the build on one.
- **No arbitrary `text-[Nrem]`.** Every size comes from the `fontSize` scale in `tailwind.config.js`.
- **Only `components/sectionLabel.ts` and the four weekday strips may spell `uppercase`.** `designScale.test.ts`'s uppercase guard is a FILE allowlist, not the `font-mono` co-occurrence rule its own doc comment describes — `font-mono` on the same line does not satisfy it. A new uppercase voice is declared in `sectionLabel.ts` and imported. Do not edit the guard.
- **Permitted corner radii only:** `[4px]`, `[6px]`, `rounded-field` (8px), `rounded-card` (12px), `rounded-full`.
- **`border-dashed` is reserved** for the drop preview and guessed-hour calendar blocks. Not used here.
- **The protocol is frozen:** no change to `AssistantAction`, `AssistantSnapshot`, or `AssistantFocusView` in `src/lib/assistantProtocol.ts`.
- **No store actions change.** `AssistantSurface` remains fully controlled.
- **The running-session button keeps the exact string `Complete session`.** The card carries two completion controls — the `TodayCheckbox` finishes the WORK, the button ends the SITTING — and `session` is the only word telling them apart.
- **The ring stays second**, after the checkbox, per the existing invariant. It is not moved right to make the gutter uniform.
- **A notice is a line ABOVE the body**, never a replacement for it. There is no state of the shelf with nothing to press.
- **`confirming` renders no checkbox and no ring.** Pinned by `AssistantSurface.test.tsx` "withholds it while a session is confirming".
- Run `npm test` and `npx tsc -b` before every commit.

## Working tree warning

At the time of writing, this repo had three files modified by a parallel session — `src/App.tsx`, `src/App.test.ts`, `src/components/HeaderMenu.tsx` — and HEAD had moved from `feat/focus-demand` to `main`. **Re-read `git status` and `git rev-parse --abbrev-ref HEAD` before the first commit.** Stage only the files each task names; never `git add -A`, never `git add .`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/components/assistant/AssistantSurface.tsx` | The one assistant surface, both presentations | Modify — band scaffolding, gutter, alternatives band, dial bar, skeleton, title truncation |
| `src/components/assistant/AssistantSurface.test.tsx` | Behaviour + voice pins | Modify — 3 rewritten assertions, 4 new |
| `scripts/shot-shelf.cjs` | Screenshots every shelf state at the real 620px in both themes | Create — jsdom has no layout, so 1:1 fidelity is unverifiable without it |
| `electron/assistantWindow.cjs` | Window geometry; `HEIGHT` is the clip budget | Modify — `HEIGHT` re-measured, comment rewritten |
| `docs/superpowers/specs/2026-08-15-stone-remaster-design.md` | The Stone token remaster | Modify — §5 exception table row amended |

`AssistantSurface.tsx` stays one file. It loses `OtherOptions` (~20 lines) and `optionRow`, and gains comparable band markup, so it does not grow meaningfully. Splitting it would separate the two presentations that must be read together to see why each branch exists.

---

## Task 1: Fix the skeleton's ink-token fill

The loading state fills its rows with `bg-fill`, which is the **ink** token — `#1A1A18` in light, `#EBE7DE` in dark. In light mode the shelf's loading state is three solid black bars. This is a token misuse, independent of the layout work, and ships first.

**Files:**
- Modify: `src/components/assistant/AssistantSurface.tsx:229-237`
- Test: `src/components/assistant/AssistantSurface.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Skeleton` keeps its name, its `role="status"`, its `aria-label="Preparing your next step"`, and its `data-testid="skeleton-row"` rows. Later tasks do not touch it.

- [ ] **Step 1: Write the failing test**

Add inside the top-level `describe('AssistantSurface', …)` block in `src/components/assistant/AssistantSurface.test.tsx`, directly after the existing `it('renders skeleton rows while loading, …')`:

```tsx
  /*
   * `bg-fill` is the INK token (#1A1A18 light, #EBE7DE dark), not a surface.
   * Filling the skeleton with it painted three solid black bars in light mode
   * — the loading state was the least Stone-conformant thing in the app.
   */
  it('fills skeleton rows with a surface token, never the ink token', () => {
    render(<AssistantSurface snapshot={{ status: 'loading' }} onAction={() => {}} />);
    for (const row of screen.getAllByTestId('skeleton-row')) {
      expect(row.className).toContain('bg-hover');
      expect(row.className).not.toContain('bg-fill');
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx -t "fills skeleton rows"`

Expected: FAIL — `expected 'h-8 rounded-field bg-fill' to contain 'bg-hover'`.

- [ ] **Step 3: Write the implementation**

Replace `Skeleton` in `src/components/assistant/AssistantSurface.tsx` (currently lines 229-237) with:

```tsx
/**
 * The loading state, shaped like the thing that replaces it.
 *
 * Rows are `bg-hover`, a SURFACE token. They were `bg-fill`, which is the ink
 * token — the same value `text-ink` resolves to — so the light theme's loading
 * state was three solid black bars.
 *
 * The three shapes are band 1 (the work), band 2 (the alternatives) and band 3
 * (the dials), in that order and at those heights, so the card does not reflow
 * into a different layout when the snapshot lands.
 */
function Skeleton() {
  return (
    <div role="status" aria-label="Preparing your next step" className="flex flex-col">
      <div className="px-4 pt-3.5 pb-3">
        <div data-testid="skeleton-row" className="h-[46px] rounded-field bg-hover" />
      </div>
      <div className="border-t border-line px-4 pt-2 pb-2.5">
        <div data-testid="skeleton-row" className="h-[42px] rounded-field bg-hover" />
      </div>
      <div className="border-t border-line bg-bg px-4 py-[7px]">
        <div data-testid="skeleton-row" className="h-[26px] rounded-[6px] bg-hover" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx`

Expected: PASS, including the pre-existing `renders skeleton rows while loading, not a spinner or a blank pane` (it asserts `>= 2` rows; there are still 3).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`

Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/assistant/AssistantSurface.tsx src/components/assistant/AssistantSurface.test.tsx
git commit -m "fix(shelf): the skeleton is a surface, not three bars of ink"
```

---

## Task 2: Band scaffolding and the dial bar

Move the shelf's padding off the root and onto each band, and move the dial strip from the top of the card to a bottom status bar. The captions become the parallel nouns `TIME` and `FOCUS` in the mono voice.

**Files:**
- Modify: `src/components/assistant/AssistantSurface.tsx:93-129` (`DialStrip`, `dialStripClass`), `:499-528` (the root render)
- Modify: `docs/superpowers/specs/2026-08-15-stone-remaster-design.md` (§5 exception table)
- Test: `src/components/assistant/AssistantSurface.test.tsx`

**Interfaces:**
- Consumes: `Skeleton` from Task 1 (unchanged).
- Produces:
  - `captionLabel` — a NEW export in `src/components/sectionLabel.ts`, imported by `AssistantSurface.tsx` and used twice inside `DialStrip`. It is NOT hand-rolled at the call site: `designScale.test.ts` allows only `sectionLabel.ts` to spell `uppercase`, and its rule is that a voice is declared once and imported.
  - `dialStripClass(shelf: boolean): string` — same signature as today. The `shelf` branch must NOT contain the substring `flex-col`; the embedded branch MUST. `AssistantSurface.test.tsx` "stacks the two dials embedded and keeps them side by side on the shelf" pins this via `radiogroup.parentElement.parentElement`, so the two wrapper `<div>`s inside `DialStrip` must stay exactly two deep.
  - `aboveBandCls(shelf: boolean): string` — padding for a line that sits ABOVE band 1 (the notice, the two advisory lines) with no bottom inset. Consumed in this task by the notice, and again in Task 4. NOTE: `bandCls` is deliberately NOT defined here — its first caller is `WorkBand` in Task 4, and `noUnusedLocals` is on, so defining it early makes this task fail `tsc -b` by construction.

- [ ] **Step 1: Write the failing tests**

Add inside the top-level `describe` block:

```tsx
  /*
   * The captions used to read "I've got" and "Focus" — one completes a
   * sentence with its control, the other names a thing. Two nouns of the same
   * kind is the fix. They take the mono voice because the bar is the
   * instrument's legend; that amends Stone §5's exception for this site, and
   * `captionLabel` is imported from `sectionLabel.ts` rather than spelled
   * here: `designScale.test.ts` allows only that file to write `uppercase`.
   */
  it('captions the dials as parallel nouns in the mono voice', () => {
    render(<AssistantSurface snapshot={ready()} onAction={() => {}} presentation="shelf" />);
    for (const word of ['Time', 'Focus']) {
      const caption = screen.getByText(word);
      expect(caption.className).toContain('font-mono');
      expect(caption.className).toContain('uppercase');
    }
    expect(screen.queryByText(/I’ve got/)).toBeNull();
  });

  /*
   * The dials are view state, the least important thing on the card, and they
   * held the position the eye lands on first. On the shelf they become a
   * bottom status bar. Embedded keeps them on top: that panel is
   * `max-h-[70vh] overflow-y-auto`, so a bottom bar there would scroll away
   * rather than pin.
   */
  it('puts the dial bar last on the shelf and first embedded', () => {
    const positionOfDials = () => {
      const bar = screen.getByRole('group', { name: 'How long you have' })
        .parentElement!.parentElement!;
      const card = bar.parentElement!;
      return [...card.children].indexOf(bar) === card.children.length - 1;
    };

    render(<AssistantSurface snapshot={ready()} onAction={() => {}} presentation="shelf" />);
    expect(positionOfDials()).toBe(true);
    cleanup();

    render(<AssistantSurface snapshot={ready()} onAction={() => {}} />);
    expect(positionOfDials()).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx -t "dial"`

Expected: FAIL — `captions the dials` fails on `Unable to find an element with the text: Time`; `puts the dial bar last` fails with `expected false to be true`.

- [ ] **Step 3: Add the caption export and the band helper**

In `src/components/sectionLabel.ts`, add a second export beside `sectionLabel`:

```ts
/**
 * A caption sitting beside its control, in the same mono voice.
 *
 * Not `sectionLabel`, and the difference is not cosmetic — the two are
 * identical strings today and must be free to diverge. A section label names a
 * REGION of a surface; this names the CONTROL to its right, and the assistant
 * shelf's bottom status bar is the one place both appear on the same card.
 *
 * It lives here rather than at its call site because `designScale.test.ts`
 * enforces that this file is the only one allowed to spell `uppercase` — the
 * rule being that a voice is declared once and imported, never hand-rolled.
 * Stone §5 originally kept this caption in the UI face for fear it would
 * compete with a region heading; once the dial strip became a status bar under
 * the content there was no heading beside it left to compete with, and the bar
 * reads as the legend on an instrument.
 */
export const captionLabel = sectionLabel;
```

Then in `src/components/assistant/AssistantSurface.tsx`, import it beside the existing `sectionLabel` import, and add below `SectionLabel`:

```tsx
/** The notice line, and the two advisory lines, sit ABOVE band 1 with no bottom inset. */
function aboveBandCls(shelf: boolean): string {
  return shelf ? 'px-4 pt-3' : 'px-3';
}
```

- [ ] **Step 4: Rewrite `DialStrip` and `dialStripClass`**

Replace `DialStrip` and `dialStripClass` (currently lines 93-129) with:

```tsx
function DialStrip({ timeLevel, focusLevel, onAction, shelf }: {
  timeLevel: TimeLevel;
  focusLevel: FocusLevel;
  onAction: Props['onAction'];
  shelf: boolean;
}) {
  return (
    <div className={dialStripClass(shelf)}>
      <div className="flex items-center gap-2.5">
        <span className={captionLabel}>Time</span>
        <SegmentedSwitch
          label="How long you have"
          size="sm"
          value={timeLevel}
          options={TIME_LEVELS.map((value) => ({ value, label: TIME_WORD[value] }))}
          onChange={(next) => onAction({ type: 'set-time-level', level: next })}
        />
      </div>
      <div className="flex items-center gap-2.5">
        <span className={captionLabel}>Focus</span>
        <SegmentedSwitch
          label="How much focus you have"
          size="sm"
          value={focusLevel}
          options={FOCUS_LEVELS.map((value) => ({ value, label: FOCUS_WORD[value] }))}
          onChange={(next) => onAction({ type: 'set-focus-level', level: next })}
        />
      </div>
    </div>
  );
}

/**
 * On the shelf this is band 3: a status bar under the content, on `bg-bg`,
 * with the hairline ABOVE it. Embedded it stays where it was, above the body
 * with the hairline below — `AssistantHost` renders inside a
 * `max-h-[70vh] overflow-y-auto` panel, so a bar at the bottom would scroll
 * out of view instead of pinning, which is the whole point of a status bar.
 *
 * The `flex-col` in the embedded branch and its absence in the shelf branch
 * are both load-bearing: the 380px host has nothing for a second
 * caption-plus-switch pair to live in on one line.
 */
function dialStripClass(shelf: boolean): string {
  return shelf
    ? 'flex items-center gap-4 border-t border-line bg-bg px-4 py-[7px]'
    : 'flex flex-col gap-1.5 border-b border-line px-3 pb-2 pt-3';
}
```

- [ ] **Step 5: Rewrite the root render**

Replace the final `return` of `AssistantSurface` (currently lines 499-527) with:

```tsx
  const body = (
    <>
      {snapshot.notice && (
        <p className={[
          aboveBandCls(shelf),
          shelf ? 'truncate' : '',
          'text-meta',
          snapshot.notice.tone === 'warning' ? 'text-warn' : 'text-muted',
        ].join(' ')}>
          {snapshot.notice.text}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {snapshot.activeFocus ? (
          <FocusPanel
            focus={snapshot.activeFocus}
            alternatives={snapshot.advice.kind === 'work' ? snapshot.advice.alternatives : []}
            onAction={onAction}
            shelf={shelf}
            focusLevel={snapshot.focusLevel}
          />
        ) : (
          <AdvicePanel
            snapshot={snapshot}
            shelf={shelf}
            pending={sendoff.pending}
            onAction={onAction}
            onStart={sendoff.start}
          />
        )}
      </div>
    </>
  );

  // The dial bar is LAST on the shelf and FIRST embedded — see dialStripClass.
  // The root carries no padding of its own any more: each band owns its inset,
  // which is what lets the hairlines between them run edge to edge.
  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden ${shelf ? '' : 'gap-2 pb-3'}`}>
      {!shelf && <DialStrip timeLevel={snapshot.timeLevel} focusLevel={snapshot.focusLevel} onAction={onAction} shelf={false} />}
      {body}
      {shelf && <DialStrip timeLevel={snapshot.timeLevel} focusLevel={snapshot.focusLevel} onAction={onAction} shelf />}
    </div>
  );
```

- [ ] **Step 6: Run the full surface suite**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx`

Expected: PASS, including the pre-existing `stacks the two dials embedded and keeps them side by side on the shelf`.

- [ ] **Step 7: Run the whole suite and typecheck**

Run: `npm test && npx tsc -b`

Expected: PASS. `src/components/assistant/AssistantHost.test.tsx` and `src/assistant/AssistantOverlay.test.tsx` query by accessible name and role only, so they are unaffected.

- [ ] **Step 8: Amend Stone §5**

In `docs/superpowers/specs/2026-08-15-stone-remaster-design.md`, in the five-row table under "**Five of those 36 are not section labels**", replace the row:

```
| `AssistantSurface.tsx:77` | "Focus", sitting beside its control |
```

with:

```
| ~~`AssistantSurface.tsx:77`~~ | "Focus", sitting beside its control — **amended 2026-08-16.** When the dial strip became a bottom status bar (`2026-08-16-shelf-bands-design.md` §4) this caption took the mono voice: in a status bar it competes with no region heading, and the bar reads as the instrument's legend. It is still written out in full rather than importing `sectionLabel`, because it is still a caption. The other four exceptions stand. |
```

- [ ] **Step 9: Commit**

```bash
git add src/components/assistant/AssistantSurface.tsx \
        src/components/assistant/AssistantSurface.test.tsx \
        docs/superpowers/specs/2026-08-15-stone-remaster-design.md
git commit -m "feat(shelf): the dials become a status bar under the work"
```

---

## Task 3: Truncate the primary title to one line

**This overturns a pinned decision.** `AssistantSurface.test.tsx` currently asserts `line-clamp-2` on the primary heading, in a test named "wraps a long primary title to two lines while quiet metadata truncates". The clamp was correct while the title had 165px and needed two lines to say anything; at 433px one line carries the name, and constant card height is worth more to a window that is fixed-height and **clips rather than scrolls**.

**Files:**
- Modify: `src/components/assistant/AssistantSurface.tsx:267` (`FocusPanel` heading), `:391` (`AdvicePanel` heading)
- Test: `src/components/assistant/AssistantSurface.test.tsx:415-428`

**Interfaces:**
- Consumes: nothing new from Task 2; `workTitle` is self-contained.
- Produces: `const workTitle: string` — the heading class string, used by both `FocusPanel` and `AdvicePanel` so the two cannot drift.

- [ ] **Step 1: Rewrite the pinned test**

In `src/components/assistant/AssistantSurface.test.tsx`, replace the whole existing test (currently lines 415-428):

```tsx
  it('wraps a long primary title to two lines while quiet metadata truncates', () => {
```

…through its closing `});`, with:

```tsx
  /*
   * OVERTURNS the previous pin, which required `line-clamp-2`.
   *
   * That was right when the title had 165px of a 620px window and needed two
   * lines to say anything. The band layout gives it 433px, and one line makes
   * the card's height independent of its content — which is what a window that
   * is fixed-height and CLIPS rather than scrolls actually wants. The full
   * string stays reachable on `title`.
   */
  it('truncates a long primary title to one line and keeps it in the tooltip', () => {
    const long = 'Write the extremely long literature review section that keeps growing '
      + 'until it no longer fits on one line at any sane width';
    render(
      <AssistantSurface
        snapshot={ready({
          advice: { kind: 'work', primary: work({ title: long }), alternatives: [] },
        })}
        onAction={() => {}}
        presentation="shelf"
      />,
    );
    const title = screen.getByRole('heading', { name: long });
    expect(title.className).toContain('truncate');
    expect(title.className).not.toContain('line-clamp-2');
    expect(title.getAttribute('title')).toBe(long);
    expect(screen.getByText('Algorithms').className).toContain('truncate');
  });

  /*
   * The same rule during a session: `FocusPanel` and `AdvicePanel` must not
   * disagree about how a title overflows, which is why both spend `workTitle`.
   */
  it('truncates the running session title the same way', () => {
    const long = 'Write the extremely long literature review section that keeps growing '
      + 'until it no longer fits on one line at any sane width';
    render(
      <AssistantSurface
        snapshot={ready({ activeFocus: focusView({ title: long }) })}
        onAction={() => {}}
        presentation="shelf"
      />,
    );
    const title = screen.getByRole('heading', { name: long });
    expect(title.className).toContain('truncate');
    expect(title.getAttribute('title')).toBe(long);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx -t "truncates"`

Expected: FAIL — `expected 'line-clamp-2 text-h2 font-semibold text-ink' to contain 'truncate'`.

- [ ] **Step 3: Add the shared heading class**

In `src/components/assistant/AssistantSurface.tsx`, directly below `aboveBandCls` (added in Task 2), add:

```tsx
/**
 * The primary title, in both panels, so the running state and the idle state
 * cannot disagree about how a name overflows.
 *
 * `truncate`, not `line-clamp-2`. The clamp was correct at 165px; at the band
 * layout's 433px one line carries the name, and a single line makes the card's
 * height independent of its content — which is what `HEIGHT` in
 * `electron/assistantWindow.cjs` is budgeting against, since that window clips
 * rather than scrolls. The full string stays on `title`.
 */
const workTitle = 'truncate text-h2 font-semibold text-ink leading-[1.25]';
```

- [ ] **Step 4: Point both headings at it**

In `FocusPanel`, replace (currently line 267):

```tsx
        <h2 className="line-clamp-2 text-h2 font-semibold text-ink">{focus.title}</h2>
```

with:

```tsx
        <h2 className={workTitle} title={focus.title}>{focus.title}</h2>
```

In `AdvicePanel`, replace (currently line 391):

```tsx
        <h2 className="line-clamp-2 text-h2 font-semibold text-ink">{primary.title}</h2>
```

with:

```tsx
        <h2 className={workTitle} title={primary.title}>{primary.title}</h2>
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm test && npx tsc -b`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/assistant/AssistantSurface.tsx src/components/assistant/AssistantSurface.test.tsx
git commit -m "feat(shelf): one line for the title, so the card's height is a constant"
```

---

## Task 4: Bands 1 and 2 — the gutter, the width, and the alternatives in the open

The heart of the change, and it lands as one commit because the two halves cannot compile apart: `FocusPanel` renders both bands, so band 1's rewrite references band 2's component.

**This overturns two pinned decisions.**

| Pinned | Where | Why it changes |
|---|---|---|
| The alternatives are absent during a running session | `AssistantSurface.test.tsx`, `withholds the column while a session is running` | `CLAUDE.md` records the reason as WIDTH — two full-length buttons needed the room — "not a decision to remove the ability to switch". Band 1 gives the width back, so the constraint is gone and the `Other options` disclosure with it. |
| The title's indent follows the controls | not directly pinned; `withholds it while a session is confirming` pins the controls' absence, which stays true | Withholding the CONTROLS withheld their ROOM, so the heading jumped 34px left the instant a session ended. The slots are reserved instead; `confirming` still renders neither control. |

**Files:**
- Modify: `src/components/assistant/AssistantSurface.tsx`
- Test: `src/components/assistant/AssistantSurface.test.tsx`

**Interfaces:**
- Consumes: `aboveBandCls` (Task 2), `workTitle` (Task 3).
- Defines `bandCls` (moved here from Task 2, where it had no caller and tripped `noUnusedLocals`).
- Produces:
  - `const GUTTER = 'w-[22px] shrink-0'` — the checkbox slot, occupied in every state.
  - `const RING_SLOT = 'w-[34px] shrink-0'` — the ring slot, occupied in all three session phases.
  - `const altRow: string` — the borderless alternative row. Replaces `optionRow`, which is deleted.
  - `function WorkBand({ checkbox, ring, eyebrow, title, subtitle, extra, actions, shelf })` — band 1.
  - `function AlternativesBand({ label, items, disabled, onPick, shelf })` — band 2.
- Deletes: `bodyClass`, `optionRow`, `Sidecar`, `OtherOptions`.

- [ ] **Step 1: Write the failing tests**

First, **replace** the existing test in `src/components/assistant/AssistantSurface.test.tsx` that begins:

```tsx
  it('withholds the column while a session is running', () => {
```

…through its closing `});`, with:

```tsx
  /*
   * OVERTURNS the previous pin, which required the alternatives to be absent
   * during a session.
   *
   * CLAUDE.md records why they were withheld: WIDTH — two full-length buttons
   * needed the room — "not a decision to remove the ability to switch". The
   * band layout gives the width back, so the constraint is gone and the
   * `Other options` disclosure with it. The label changes because the verb
   * does: you START work you have not begun, and you SWITCH TO one that
   * displaces a running sitting.
   */
  it('offers the alternatives to switch to while a session is running', () => {
    const onAction = vi.fn();
    const alternatives = [work({
      key: 'step:n2',
      ref: { kind: 'step', id: 'n2', goalId: 'g1' },
      title: 'Read chapter 5',
    })];
    render(
      <AssistantSurface
        snapshot={ready({ activeFocus: focusView(), advice: { kind: 'work', primary: work(), alternatives } })}
        onAction={onAction}
        presentation="shelf"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Other options' })).toBeNull();
    expect(screen.getByText('Switch to')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Complete session' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Read chapter 5/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: 'switch-focus',
      ref: { kind: 'step', id: 'n2', goalId: 'g1' },
    });
  });
```

Then **add** these four tests inside the same top-level `describe` block:

```tsx
  /*
   * Two labels, because they are two verbs. One band, because they are one
   * region — a reader must never have to look in two places for "what else
   * could I be doing".
   */
  it('labels the same band Or when nothing is running', () => {
    const alternatives = [work({ key: 'step:n2', title: 'Read chapter 5' })];
    render(
      <AssistantSurface
        snapshot={ready({ advice: { kind: 'work', primary: work(), alternatives } })}
        onAction={() => {}}
        presentation="shelf"
      />,
    );
    expect(screen.getByText('Or')).toBeTruthy();
    expect(screen.queryByText('Switch to')).toBeNull();
  });

  /*
   * The heading started at 71px during a session and 37px the instant it
   * ended, because the checkbox and the ring are both withheld in
   * `confirming`. The slots are reserved instead: the checkbox slot always,
   * the ring slot across all three session phases. `confirming` still renders
   * NEITHER control — the existing pin on that stands — it just keeps the room.
   */
  it('reserves the gutter in confirming so the title does not shift left', () => {
    const { container } = render(
      <AssistantSurface
        snapshot={ready({ activeFocus: focusView({ phase: 'confirming', proposedMinutes: 200 }) })}
        onAction={() => {}}
        presentation="shelf"
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(container.querySelector('[data-gutter]')).toBeTruthy();
    expect(container.querySelector('[data-ring-slot]')).toBeTruthy();
  });

  it('reserves the same two slots during an active session', () => {
    const { container } = render(
      <AssistantSurface
        snapshot={ready({ activeFocus: focusView({ phase: 'active' }) })}
        onAction={() => {}}
        presentation="shelf"
      />,
    );
    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect(container.querySelector('[data-gutter]')).toBeTruthy();
    expect(container.querySelector('[data-ring-slot]')).toBeTruthy();
  });

  /*
   * Idle work has no ring to reserve room for — that step happens only when
   * the whole card's content changes anyway.
   */
  it('reserves the checkbox slot but no ring slot when idle', () => {
    const { container } = render(
      <AssistantSurface snapshot={ready()} onAction={() => {}} presentation="shelf" />,
    );
    expect(container.querySelector('[data-gutter]')).toBeTruthy();
    expect(container.querySelector('[data-ring-slot]')).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx`

Expected: FAIL. `reserves the gutter…` fails with `expected null to be truthy`; `offers the alternatives to switch to…` fails with `Unable to find an element with the text: Switch to`.

- [ ] **Step 3: Replace `bodyClass` with the gutter constants and `WorkBand`**

In `src/components/assistant/AssistantSurface.tsx`, replace `bodyClass` **and its doc comment** (the block beginning `/**\n * The one primary/action arrangement…`) with:

```tsx
/**
 * A content band's padding. The card's padding used to live on the root as a
 * single `p-3`, which is why every band had to share one inset and no band
 * could carry a full-width hairline. Each band owns its own now, and the
 * hairlines run edge to edge.
 *
 * Stated in full rather than composed with `aboveBandCls`: appending an
 * override like `${bandCls(shelf)} pb-0` would leave which rule wins to the
 * order Tailwind happens to emit them in. `dialogStyles.ts` says it outright —
 * a class list is not a cascade, and that exact trap is why `DateField`'s
 * `size` prop exists.
 */
function bandCls(shelf: boolean): string {
  return shelf ? 'px-4 pt-3.5 pb-3' : 'px-3 py-2';
}

/**
 * The leading gutter, and why it is reserved rather than conditional.
 *
 * `confirming` renders no checkbox and no ring — that is a deliberate pin, and
 * it stands: the state is already asking "was that real work?", and a tick
 * there would answer a different question. But withholding the CONTROLS used
 * to withhold their ROOM too, so the shelf's most important line jumped 34px
 * left the instant a session ended.
 *
 * The checkbox slot is occupied in every state. The ring slot is occupied
 * across all three session phases — `active`, `break` AND `confirming` — so
 * the indent holds for as long as a session lasts, which is the interval over
 * which anyone actually watches this line. Idle work indents by the checkbox
 * alone; that step happens only when the whole card's content changes anyway.
 */
const GUTTER = 'w-[22px] shrink-0';
const RING_SLOT = 'w-[34px] shrink-0';

/**
 * Band 1: the work. One row — gutter, ring slot, the text column, the actions.
 *
 * Both panels render through this, which is the only reason the running state
 * and the idle state agree about where the title starts. `min-w-0` on the text
 * column is what lets `workTitle`'s `truncate` engage inside a flex row;
 * without it the column takes its content's width and the row overflows.
 */
function WorkBand({ checkbox, ring, eyebrow, title, subtitle, extra, actions, shelf }: {
  checkbox: ReactNode;
  ring: ReactNode;
  eyebrow: string;
  title: ReactNode;
  subtitle: ReactNode;
  extra?: ReactNode;
  actions: ReactNode;
  shelf: boolean;
}) {
  return (
    <div className={`${bandCls(shelf)} flex items-center gap-3`}>
      <div data-gutter className={GUTTER}>{checkbox}</div>
      {ring}
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <SectionLabel>{eyebrow}</SectionLabel>
        {title}
        {subtitle}
        {extra}
      </div>
      <div className="flex shrink-0 gap-2">{actions}</div>
    </div>
  );
}
```

- [ ] **Step 4: Replace `optionRow` and `Sidecar` with `altRow` and `AlternativesBand`**

Delete `optionRow` **and its doc comment**, and delete the whole `Sidecar` component **and its doc comment**. In their place put:

```tsx
/**
 * Band 2: what else you could be doing.
 *
 * The rows used to be `optionRow` — bordered boxes on `bg-panel` — while the
 * primary recommendation had no container at all, so the only things on the
 * card wearing a border were the ones you were being invited NOT to pick. They
 * are text rows on hairlines now, and the primary is the only emphasised thing
 * on the surface.
 *
 * One band, two labels: `Or` when nothing is running, `Switch to` when
 * something is. Two verbs, because starting work you have not begun and
 * displacing a running sitting are different acts — but one region, because a
 * reader must not have to look in two places for the same question.
 *
 * The row is still one button with the whole row as its hit area. `-mx-1`
 * against the row's own `px-1` keeps the hover surface aligned to the band's
 * text rather than to its padding box.
 */
const altRow =
  'flex w-full items-baseline gap-3 rounded-[6px] px-1 py-[5px] text-left '
  + 'hover:bg-hover disabled:opacity-40 disabled:pointer-events-none';

function AlternativesBand({ label, items, disabled, onPick, shelf }: {
  label: string;
  items: RecommendedWork[];
  disabled: boolean;
  onPick: (ref: RecommendedWork['ref']) => void;
  shelf: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className={`border-t border-line ${shelf ? 'px-4 pt-2 pb-2.5' : 'px-3 py-2'}`}>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-[2px] flex flex-col">
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            disabled={disabled}
            className={`${altRow} -mx-1 ${i ? 'border-t border-line-soft' : ''}`}
            onClick={() => onPick(item.ref)}
          >
            <span className="min-w-0 flex-1 truncate text-body text-ink-soft">{item.title}</span>
            <span className="shrink-0 text-meta text-muted">
              {item.goalTitle ? `${item.goalTitle} · ` : ''}{expectedTimeLabel(item.expected)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Delete `OtherOptions`**

Delete the whole `OtherOptions` component and its doc comment. Then check whether `useState` is still used anywhere in the file:

```bash
grep -n "useState" src/components/assistant/AssistantSurface.tsx
```

If the only remaining hit is the import line, remove `useState` from the `react` import so the build does not warn on an unused binding.

- [ ] **Step 6: Rewrite `FocusPanel`'s body**

In `FocusPanel`, replace everything from `const info = (` through the closing `);` of the `info` constant with:

```tsx
  // `running` is `focus.phase !== 'confirming'`. The ring SLOT is present in
  // all three session phases; the ring itself only when something is running.
  const ring = (
    <div data-ring-slot className={RING_SLOT}>
      {running && (
        <SessionRing
          state={ringState(focus.expected, focus.elapsedMin, focusLevel)}
          paused={focus.phase === 'break'}
        />
      )}
    </div>
  );
  const checkbox = running ? (
    <TodayCheckbox
      checked={false}
      ariaLabel={`Complete "${focus.title}"`}
      onToggle={() => onAction({ type: 'complete-work', ref: focus.ref })}
    />
  ) : null;
  const subtitle = focus.goalTitle
    ? <p className="truncate text-meta text-muted">{focus.goalTitle}</p>
    : null;
  const extra = focus.phase === 'confirming' ? (
    <p className="text-body text-ink">
      This session shows {fmtMinutes(focus.proposedMinutes ?? focus.elapsedMin)} — was that real work?
    </p>
  ) : (
    <p className="text-meta text-muted">
      {elapsedAgainstExpected(focus.elapsedMin, focus.expected, focusLevel)}
      {focus.phase === 'break' ? ' · On a break' : ''}
    </p>
  );
```

Leave the `const actions = …` block exactly as it is — the three phases, their button variants and their order are unchanged, and `Complete session` keeps its full label.

- [ ] **Step 7: Rewrite `FocusPanel`'s return**

Replace `FocusPanel`'s `return (…)` with:

```tsx
  return (
    <>
      <WorkBand
        shelf={shelf}
        checkbox={checkbox}
        ring={ring}
        eyebrow="Focus session"
        title={<h2 className={workTitle} title={focus.title}>{focus.title}</h2>}
        subtitle={subtitle}
        extra={extra}
        actions={actions}
      />
      <AlternativesBand
        label="Switch to"
        items={alternatives.slice(0, 2)}
        disabled={false}
        onPick={(ref) => onAction({ type: 'switch-focus', ref })}
        shelf={shelf}
      />
    </>
  );
```

- [ ] **Step 8: Rewrite `AdvicePanel`'s return**

Replace `AdvicePanel`'s `primaryColumn`, `startButton` and its whole `return (…)` with:

```tsx
  const alternatives = advice.alternatives.slice(0, MAX_ALTERNATIVES);

  return (
    <>
      {advice.beyondWindow && (
        <p className={`${aboveBandCls(shelf)} text-meta text-muted`}>
          Nothing that short left — this is next when you&apos;re ready.
        </p>
      )}
      {advice.beyondFocus && (
        <p className={`${aboveBandCls(shelf)} text-meta text-muted`}>
          Nothing light left — this is next when you&apos;re ready.
        </p>
      )}
      <WorkBand
        shelf={shelf}
        checkbox={
          <TodayCheckbox
            checked={false}
            ariaLabel={`Complete "${primary.title}"`}
            onToggle={() => onAction({ type: 'complete-work', ref: primary.ref })}
          />
        }
        ring={null}
        eyebrow={REASON_WORD[primary.reason]}
        title={<h2 className={workTitle} title={primary.title}>{primary.title}</h2>}
        subtitle={
          <p className="flex min-w-0 items-baseline gap-1.5 text-meta text-muted">
            {primary.goalTitle && <span className="truncate">{primary.goalTitle}</span>}
            {primary.goalTitle && <span aria-hidden>·</span>}
            <span className="shrink-0">{expectedTimeLabel(primary.expected)}</span>
          </p>
        }
        actions={
          <button type="button" disabled={pending} className={primaryBtn} onClick={() => onStart(primary.ref)}>
            Start session
          </button>
        }
      />
      <AlternativesBand
        label="Or"
        items={alternatives}
        disabled={pending}
        onPick={onStart}
        shelf={shelf}
      />
    </>
  );
```

`AdvicePanel`'s two early returns — `needs-hours` and `clear` — are unchanged.

- [ ] **Step 9: Confirm every deletion took**

Run:

```bash
grep -n "optionRow\|Sidecar\|OtherOptions\|bodyClass" src/components/assistant/AssistantSurface.tsx
```

Expected: no output.

- [ ] **Step 10: Run the surface suite**

Run: `npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx`

Expected: PASS, every test, no failures. If `shows two alternatives regardless of the focus dial` or `puts no checkbox on the alternatives` fail, the band is rendering the wrong item set — re-check Step 4 and Step 8.

- [ ] **Step 11: Run the whole suite and typecheck**

Run: `npm test && npx tsc -b`

Expected: PASS. `AssistantHost.test.tsx` and `AssistantOverlay.test.tsx` query by role and accessible name only, so they should be unaffected; if either fails, report it rather than editing them — they pin the embedded presentation this task is not supposed to change.

- [ ] **Step 12: Commit**

```bash
git add src/components/assistant/AssistantSurface.tsx src/components/assistant/AssistantSurface.test.tsx
git commit -m "feat(shelf): three bands, and the title gets the width back"
```

---

## Task 5: A screenshot harness, and 1:1 comparison against the mock

jsdom has no layout, so nothing so far proves the result matches the approved mockup. `scripts/measure-shelf.cjs` already renders the real overlay in Electron and reports heights; this adds the sibling that captures pixels.

**Files:**
- Create: `scripts/shot-shelf.cjs`
- Reuses: `scripts/measure-shelf-preload.cjs` (unchanged)

**Interfaces:**
- Consumes: nothing from earlier tasks at the code level; consumes their rendered output.
- Produces: PNGs at `<outDir>/<theme>-<state>.png` for review. No source file imports this.

- [ ] **Step 1: Build**

Run: `npm run build`

Expected: `✓ built in …`, `dist/assistant.html` present.

- [ ] **Step 2: Create the harness**

Create `scripts/shot-shelf.cjs`:

```js
// Screenshots the shelf card at its real width for every reachable state, in
// both themes, so a layout change can be compared against what was approved.
// jsdom has no layout and the component tests therefore cannot see any of this.
//
//   npm run build
//   npx electron scripts/shot-shelf.cjs [outDir]
//
// The sibling of scripts/measure-shelf.cjs: that one reports the card's height
// so HEIGHT stays a measurement, this one reports what the card looks like.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const OUT = process.argv[2] || path.join(__dirname, '..', 'shelf-shots')
const WIDTH = 620

const LONG = 'Draft the comparative literature review for the graduate seminar '
  + 'on nineteenth-century industrialization'

const work = (over = {}) => ({
  key: 'step:n1',
  ref: { kind: 'step', id: 'n1', goalId: 'g1' },
  title: LONG,
  goalTitle: 'Comparative Literature',
  reason: 'scheduled-now',
  expected: { kind: 'estimate', minutes: 45 },
  ...over,
})

// `ExpectedTime` is a discriminated union in src/lib/expectedTime.ts:34-43.
// The history arm is `{ kind, lowMin, highMin, confidence, sampleCount }` —
// all five required. `lowMinutes`/`highMinutes` are NOT the field names, and
// getting them wrong renders "Usually undefined–undefinedm" rather than
// throwing, which is exactly the kind of wrong a screenshot harness must not
// be. The three arms below cover all three of expectedTimeLabel's cases —
// Usually / Planned / Suggested — so one capture exercises every phrasing.
const ALTERNATIVES = [
  work({
    key: 'step:n2',
    ref: { kind: 'step', id: 'n2', goalId: 'g1' },
    title: 'Rewrite the pricing page hero',
    expected: { kind: 'history', lowMin: 45, highMin: 60, confidence: 'high', sampleCount: 6 },
  }),
  work({
    key: 'step:n3',
    ref: { kind: 'step', id: 'n3', goalId: 'g1' },
    title: 'Reply to the Figma thread',
    goalTitle: 'Website',
    expected: { kind: 'starter', minutes: 30 },
  }),
]

const base = {
  status: 'ready',
  timeLevel: 'medium',
  focusLevel: 'medium',
  activeFocus: null,
  notice: { tone: 'neutral', text: `Completed "${LONG}" · logged 45m` },
  advice: { kind: 'work', primary: work(), alternatives: ALTERNATIVES },
}

const focus = (over) => ({
  ref: { kind: 'step', id: 'n1', goalId: 'g1' },
  title: LONG,
  goalTitle: 'Comparative Literature',
  expected: { kind: 'estimate', minutes: 45 },
  ...over,
})

const STATES = {
  idle: {
    ...base,
    notice: null,
    advice: {
      kind: 'work',
      primary: work({ title: 'Review the onboarding copy' }),
      alternatives: ALTERNATIVES,
    },
  },
  sidecar: base,
  active: { ...base, notice: null, activeFocus: focus({ phase: 'active', elapsedMin: 12 }) },
  break: { ...base, notice: null, activeFocus: focus({ phase: 'break', elapsedMin: 24 }) },
  confirming: {
    ...base,
    notice: null,
    activeFocus: focus({ phase: 'confirming', elapsedMin: 200, proposedMinutes: 200 }),
  },
  clear: { ...base, notice: null, advice: { kind: 'clear' } },
  loading: { status: 'loading' },
}

// One window at a time means the app is momentarily windowless between states,
// and Electron's default `window-all-closed` behaviour would quit the run
// partway through. Same no-op guard as measure-shelf.cjs.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  for (const theme of ['dark', 'light']) {
    for (const [name, snapshot] of Object.entries(STATES)) {
      process.env.PHASE_SHELF_SNAPSHOT = JSON.stringify(snapshot)
      const win = new BrowserWindow({
        show: false,
        width: WIDTH,
        height: 900,
        // Without useContentSize, 620 is the FRAME and the card is measured a
        // few pixels narrow — the same reason the production window sets it.
        useContentSize: true,
        backgroundColor: theme === 'dark' ? '#141311' : '#F7F7F5',
        webPreferences: {
          contextIsolation: true,
          preload: path.join(__dirname, 'measure-shelf-preload.cjs'),
        },
      })
      win.webContents.on('preload-error', (_e, p, err) => console.error(`${name} PRELOAD ${p}: ${err && err.stack}`))
      win.webContents.on('did-fail-load', (_e, c, d) => console.error(`${name} LOAD ${c} ${d}`))
      await win.loadFile(path.join(__dirname, '..', 'dist', 'assistant.html'))
      await win.webContents.executeJavaScript(
        `document.documentElement.classList.toggle('dark', ${theme === 'dark'})`)
      await new Promise((r) => setTimeout(r, 1000))
      const h = await win.webContents.executeJavaScript(
        "document.querySelector('[data-shelf]')?.getBoundingClientRect().height ?? -1")
      if (!(h > 0)) {
        console.error(`${theme}/${name} NOT RENDERED`)
        win.destroy()
        continue
      }
      const img = await win.webContents.capturePage({
        x: 0, y: 0, width: WIDTH, height: Math.ceil(h),
      })
      fs.writeFileSync(path.join(OUT, `${theme}-${name}.png`), img.toPNG())
      console.log(`${theme}/${name} h=${h}`)
      win.destroy()
    }
  }
  app.exit(0)
})
```

- [ ] **Step 3: Add the output directory to gitignore**

Append to `.gitignore`:

```
shelf-shots/
```

- [ ] **Step 4: Capture**

Run: `npx electron scripts/shot-shelf.cjs`

Expected: 14 lines, `dark/idle h=…` through `light/loading h=…`, no `NOT RENDERED`. 14 PNGs in `shelf-shots/`.

- [ ] **Step 5: Compare against the approved mockup, band by band**

Open `shelf-shots/dark-idle.png` and `shelf-shots/light-idle.png`. Check each against the approved variant A:

| Check | Expected |
|---|---|
| Band order | work, hairline, alternatives, hairline, dial bar on `bg-bg` |
| Title | one line, ellipsis, no wrap at any state |
| Title left edge | identical in `active`, `break` and `confirming` |
| Alternative rows | no border, no background; hairline between the two only |
| Dial bar | `TIME` and `FOCUS` in mono caps, bottom of the card |
| Running buttons | `Take break` outlined, `Complete session` filled, filled one last |
| `loading` | three grey band-shaped rows, **no black bars in light** |
| Hairlines | run edge to edge, not inset |
| Alternative right-hand text | reads `Usually 45–60m` and `Website · Suggested 30m` — never `undefined`, which is what a mistyped `ExpectedTime` arm produces silently |

Fix any mismatch in `AssistantSurface.tsx` and re-run Step 4 before continuing.

- [ ] **Step 6: Verify the running-state title width claim**

The spec's ~247px figure for the running state is arithmetic and has to be checked. Run:

```bash
npx electron -e "
const {app,BrowserWindow}=require('electron');const path=require('node:path');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  process.env.PHASE_SHELF_SNAPSHOT=JSON.stringify({status:'ready',timeLevel:'medium',focusLevel:'medium',notice:null,
    advice:{kind:'work',primary:{key:'k',ref:{kind:'step',id:'n1',goalId:'g1'},title:'x',reason:'scheduled-now',expected:{kind:'estimate',minutes:45}},alternatives:[]},
    activeFocus:{ref:{kind:'step',id:'n1',goalId:'g1'},title:'Draft the comparative literature review for the graduate seminar',goalTitle:'Comparative Literature',phase:'active',elapsedMin:12,expected:{kind:'estimate',minutes:45}}});
  const w=new BrowserWindow({show:false,width:620,height:900,useContentSize:true,webPreferences:{contextIsolation:true,preload:path.join(process.cwd(),'scripts/measure-shelf-preload.cjs')}});
  await w.loadFile(path.join(process.cwd(),'dist/assistant.html'));
  await new Promise(r=>setTimeout(r,1000));
  console.log('TITLE_PX='+await w.webContents.executeJavaScript(\"document.querySelector('h2').getBoundingClientRect().width\"));
  app.exit(0);
});"
```

Expected: `TITLE_PX=` a number **greater than 165**. If it is at or below 165, the band layout has not delivered and the buttons must move to their own row inside `WorkBand` for the running state — **do not shorten `Complete session`**, per the Global Constraints.

- [ ] **Step 7: Commit**

```bash
git add scripts/shot-shelf.cjs .gitignore
git commit -m "test(shelf): a harness that shows the card, beside the one that measures it"
```

---

## Task 6: Re-measure `HEIGHT`

`HEIGHT` is 264, and its comment names `line-clamp-2` as the worst case — the input that no longer exists. The number is now wrong in the safe direction, which is exactly the condition under which nobody notices it. The comment in `electron/assistantWindow.cjs` is explicit that this is measured, never derived, and records a pass that shipped it 20px low from arithmetic.

**Files:**
- Modify: `electron/assistantWindow.cjs:5-63`

**Interfaces:**
- Consumes: the built `dist/` from Task 5.
- Produces: a new `HEIGHT` constant. No code imports the number; `assistantWindowController.test.ts` reads the module.

- [ ] **Step 1: Measure**

Run: `npm run build && npx electron scripts/measure-shelf.cjs`

Expected: one line per state and a final `TALLEST=<n>`. Record every figure — the comment quotes them.

- [ ] **Step 2: Rewrite the comment and the constant**

In `electron/assistantWindow.cjs`, replace the block from `// Compact and fixed:` down to and including `const HEIGHT = 264` with the following, substituting the real figures from Step 1 for every `<…>`:

```js
// Compact and fixed: the shelf is 620 wide and never grows, so a long list
// stays inside the pane instead of forming a tower under the shortcut.
//
// HEIGHT is a BUDGET, not the size of the pane. The card sizes to its own
// content (see `shelfSizing`), so a short state no longer paints the leftover
// space — on macOS the window behind it is transparent and a click there
// closes the shelf. What this number still has to guarantee is that the
// TALLEST state fits: a hugging card is clipped by the window edge rather than
// scrolled, so anything past this line is not merely awkward, it is invisible.
//
// MEASURED at 620 wide by `scripts/measure-shelf.cjs`, never derived. Run
// `npm run build` first; the tallest state it prints IS this number.
// Arithmetic against the type scale put it 20px low once already.
//
// The three-band layout (2026-08-16-shelf-bands-design.md) changed what the
// worst case IS, which is why this was re-measured rather than carried
// forward. The primary title is `truncate` now, not `line-clamp-2`, so the
// two-wrapped-line title that set the previous 264 cannot occur — a title is
// still free text with no length cap, but its height no longer depends on its
// length. Against that, the running states gained a row: the alternatives
// moved out of the `Other options` disclosure and into band 2, so `active`,
// `break` and `confirming` now render them in the open.
//
// Measured, with the same worst-case title as every pass before this one
// ("Draft the comparative literature review for the graduate seminar on
// nineteenth-century industrialization"):
//
//   confirming   <n>px
//   active       <n>px
//   sidecar      <n>px
//   beyondWindow <n>px
//   beyondFocus  <n>px
//
// The send-off is not in the list because it cannot be the tallest: it pins
// itself to the height of the card it is replacing (`onSendoffChange` in
// AssistantOverlay.tsx), so its footprint is one of the figures above by
// construction.
//
// If a state grows, measure it again.
const HEIGHT = <TALLEST>
```

- [ ] **Step 3: Verify the budget actually holds**

Run: `npx electron scripts/measure-shelf.cjs`

Expected: `TALLEST=<n>` where `<n>` is less than or equal to the new `HEIGHT`.

- [ ] **Step 4: Run the whole suite and typecheck**

Run: `npm test && npx tsc -b`

Expected: PASS, including `electron/assistantWindowController.test.ts`.

- [ ] **Step 5: Confirm nothing clips in the real window**

Run: `npm run app:dev`, press the assistant shortcut, and step through: idle with two alternatives, start a session, take a break, then let it reach `confirming`. In each, the dial bar must be fully visible at the bottom of the card with nothing cut off.

This is the one check the harness cannot make — `measure-shelf.cjs` measures the card, not the window that clips it.

- [ ] **Step 6: Commit**

```bash
git add electron/assistantWindow.cjs
git commit -m "fix(shelf): HEIGHT is measured against the layout that exists"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full suite**

Run: `npm test`

Expected: PASS, zero failures.

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`

Expected: no output, exit 0.

- [ ] **Step 3: Guard tests specifically**

Run: `npx vitest run --config vitest.config.ts src/lib/designScale.test.ts src/lib/paletteContrast.test.ts src/lib/projectColour.test.ts`

Expected: PASS. These fail the build on a literal hex, an arbitrary `text-[Nrem]`, a `fontSize`/`colors` key collision, an off-list corner radius, and `uppercase` spelled outside `components/sectionLabel.ts` or the four weekday strips.

That last one is a FILE allowlist, not a `font-mono` co-occurrence check — an earlier draft of this plan described it wrongly, and Task 2 hit the resulting build failure. `AssistantSurface.tsx` passes because it imports `captionLabel` and never spells `uppercase` itself, NOT because `font-mono` sits beside it. If this run fails here, the fix is to move the voice into `sectionLabel.ts` — never to edit the guard or extend its allowlist.

- [ ] **Step 4: Entry-boundary proof**

Run: `npx vitest run --config vitest.config.ts src/assistant/entryBoundary.test.ts`

Expected: PASS. The overlay's module graph must still be unable to reach the store, Dexie or the tab lock. Nothing in this plan adds an import, but the proof is cheap.

- [ ] **Step 5: Re-capture and review both themes**

Run: `npm run build && npx electron scripts/shot-shelf.cjs`

Review all 14 PNGs against the table in Task 5 Step 5 one final time.

- [ ] **Step 6: Confirm the working tree contains only this work**

Run: `git status --porcelain`

Expected: only `shelf-shots/` (ignored) and whatever the parallel session owns. If `src/App.tsx`, `src/App.test.ts` or `src/components/HeaderMenu.tsx` still show as modified, leave them alone — they are not this plan's.

---

## Self-Review

**Spec coverage:**

| Spec § | Task |
|---|---|
| §1 three bands | 2 (scaffolding, dial bar), 4 (bands 1 and 2) |
| §2 reserved gutter, `Complete session` full label | 4 (gutter), Global Constraints + Task 5 Step 6 (label) |
| §3 alternatives band, disclosure retired | 4 |
| §4 dial bar, `TIME`/`FOCUS`, Stone §5 amendment | 2 |
| §5 notice truncates | 2 Step 5 |
| §6 skeleton token | 1 |
| §7 title overflow, `HEIGHT` re-measured | 3, 6 |
| §8 the overturns | 3 (title), 4 (disclosure and gutter) — the disclosure overturn was found during planning and is named in Task 4 |
| §9 what does not change | Global Constraints; Task 7 Steps 3-4 |
| §10 tests | 1, 2, 3, 4 add them; 7 runs them |

**Placeholder scan:** the only `<…>` placeholders are in Task 7 Step 2, and they are measured figures that cannot be known before Step 1 runs — the step says exactly where each comes from. No "TBD", no "add error handling", no "similar to Task N".

**Type consistency:** `aboveBandCls(shelf: boolean)` is defined in Task 2 and consumed there (the notice) and in Task 4. `bandCls(shelf: boolean)` is defined in Task 4 beside its first caller — defining it in Task 2 tripped `noUnusedLocals` and made that task unable to typecheck standalone. `captionLabel` is a new export in `sectionLabel.ts`, imported by `AssistantSurface.tsx`. `workTitle` is defined in Task 3 and consumed in Task 4 by both panels. `GUTTER`, `RING_SLOT`, `altRow`, `WorkBand` and `AlternativesBand` are all defined and consumed within Task 4. `optionRow`, `Sidecar`, `OtherOptions` and `bodyClass` are all deleted, with Step 9 grepping to confirm no remaining reference.

**Task sizing:** Task 4 is the largest by some margin, and it is not splittable: `FocusPanel` renders both bands, so band 1's rewrite references band 2's component and the two halves do not compile apart. An earlier draft split them with a stub and left the tree red between commits; that traded a real review gate for a smaller diff and was reverted.
