# Notes Editor and Image Assets Implementation Plan (3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `notes` from a plain textarea into a live-rendered markdown document that accepts pasted images, and make notes searchable.

**Architecture:** Tiptap (ProseMirror) edits, but the stored form stays a **markdown string** in the existing `notes` field — so the backup remains readable, `⌘K` can index it, and the data outlives the editor. Images are Blobs in a new `assets` Dexie table that sits **outside `AppState`** and is written surgically, because `persist()` is a full clear + bulkPut of all four tables and image bytes inside a goal row would be rewritten on every checkbox tick.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, Dexie, Vitest, Tiptap.

**Source spec:** `docs/superpowers/specs/2026-08-01-project-page-and-notes-design.md` Part 3.

**Plans 1 and 2 have landed.** The project page, its Steps/Notes tabs, and `StepPanel` all exist. `NotesTab` currently renders one `<textarea>`; `StepPanel` has no notes section yet.

**Three shippable parts.** A is the editor with no images. B adds images. C adds search. Each is useful alone, and B is the only part carrying data-loss risk.

## Global Constraints

- Run `npm test` and `npx tsc -b` before every commit (`CLAUDE.md`, Conventions).
- Visual identity is locked. No new colours, no literal hex, no arbitrary `text-[Nrem]` — `designScale.test.ts` fails the build on all three. **Tiptap ships its own CSS; do not import it raw.** Style the editor with existing theme tokens.
- Hover-revealed controls use `.quiet-control`.
- New pure logic goes in `src/lib` with a sibling `*.test.ts`. Views never call `db` directly — except the asset layer, which gets its own module in `src/db` and is called through `actions`.
- **`assets` is never part of `AppState`** and never passes through `persist()`.
- A non-owning tab never writes: every asset write goes through `ifOwner`.
- An import is a generation boundary.
- Do not pin dependency versions this plan cannot verify — install, then report exactly what landed.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/components/NoteEditor.tsx` (create) | The Tiptap editor. Markdown in, markdown out. Used at two widths |
| `src/lib/noteAutosave.ts` (create) | Pure: when a pending note write may be flushed |
| `src/views/project/NotesTab.tsx` (modify) | Host the editor at project level |
| `src/views/project/StepPanel.tsx` (modify) | Host the editor at step level |
| `src/db/types.ts` (modify) | `GoalNode.notes`, and the `Asset` interface |
| `src/db/assets.ts` (create) | The ONLY module touching the `assets` table |
| `src/db/db.ts` (modify) | Dexie v5 `assets` store; async export; asset-aware import |
| `src/lib/imageScale.ts` (create) | Pure: target dimensions for a downscale |
| `src/lib/notes.ts` (create) | Pure: extract/strip `asset:` refs in markdown |
| `src/lib/backupAssets.ts` (create) | Pure: base64 encode/decode + shape validation |
| `src/state/store.ts` (modify) | `setNodeNotes`, asset actions, async `exportBackup`, autosave gate |
| `src/lib/search.ts` (modify) | Index note bodies; return a snippet |

---

# PART A — The markdown editor

## Task 1: Install Tiptap and prove the markdown round trip

**Files:**
- Modify: `package.json`
- Create: `src/components/NoteEditor.tsx`, `src/components/NoteEditor.test.tsx`

**Interfaces:**
- Produces:

```ts
export function NoteEditor({ docKey, value, onChange, placeholder, ariaLabel, className }: {
  /**
   * Identity of the document being edited — a goal id or a node id.
   *
   * The editor is uncontrolled after mount, so this is what tells it the
   * SUBJECT changed rather than the text. Hosts keep the component mounted and
   * swap subjects: without this, opening a second step shows the first step's
   * notes and saves them onto the wrong node. That exact bug already shipped
   * once here, in StepPanel's title.
   */
  docKey: string;
  value: string;            // markdown
  onChange: (markdown: string) => void;
  placeholder: string;
  ariaLabel: string;
  className?: string;
}): JSX.Element
```

**Feature set, deliberately small** (spec §3.1): headings 1–3, bold, italic, strike, inline code, bullet and ordered lists, code block, blockquote, horizontal rule, links, and markdown input rules so typing `## ` or `- ` or `**x**` works.

**Excluded on purpose, and this is a decision not an omission:**
- **Task lists.** In Phase a checkbox is the only thing that moves a percentage. A checkbox in a note that moves nothing recreates the milestone problem this codebase just spent a whole plan deleting.
- Tables, wikilinks, backlinks, mentions, and a `/` slash menu.

- [ ] **Step 1: Install**

```bash
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/markdown
```

**Use the first-party `@tiptap/markdown`, not the third-party `tiptap-markdown`.** Checked at planning time: Tiptap is on 3.29.2, and `@tiptap/markdown` is published at the same version with `peerDependencies` pinned to the exact `3.29.2` for both `@tiptap/core` and `@tiptap/pm`. The third-party package works too — its peer range is `^3.0.1` — but a floating range across a major that just shipped is a needless risk when a version-locked first-party option exists.

`@tiptap/markdown` also avoids pulling in `markdown-it-task-lists`, and task lists are deliberately out of scope here.

Do NOT hand-write versions into `package.json`. **Check what `StarterKit` v3 already bundles before adding extension packages** — in v3 several extensions that used to be separate are included, and installing a duplicate registers the node twice. Add only what is genuinely missing, and say in your report which extensions came from StarterKit and which you added.

- [ ] **Step 2: Write the failing round-trip test**

Create `src/components/NoteEditor.test.tsx` (`// @vitest-environment jsdom`). The critical property is **round-trip fidelity** — the editor must not quietly rewrite the user's document:

```tsx
const SAMPLE = [
  '# Heading one',
  '',
  'Some **bold** and *italic* and `code`.',
  '',
  '## Heading two',
  '',
  '- first',
  '- second',
  '',
  '1. one',
  '2. two',
  '',
  '> a quote',
  '',
  '```',
  'const x = 1;',
  '```',
  '',
  '---',
  '',
  '[a link](https://example.com)',
].join('\n');

/**
 * Parse `md` into a Tiptap document and serialize it straight back. Export a
 * tiny helper from NoteEditor.tsx that does this WITHOUT React — `@tiptap/markdown`
 * exposes parse/serialize on the editor's storage, and a headless `Editor`
 * instance is enough. A pure round-trip is far easier to assert on than one
 * driven through the DOM.
 */
function roundTrip(md: string): string { /* implement alongside NoteEditor */ }

it('preserves every supported construct', () => {
  const out = roundTrip(SAMPLE);
  expect(out).toContain('# Heading one');
  expect(out).toContain('## Heading two');
  expect(out).toContain('**bold**');
  expect(out).toContain('*italic*');
  expect(out).toContain('`code`');
  expect(out).toContain('- first');
  expect(out).toContain('1. one');
  expect(out).toContain('> a quote');
  expect(out).toContain('const x = 1;');
  expect(out).toContain('---');
  expect(out).toContain('[a link](https://example.com)');
});

it('is idempotent, so normalisation cannot drift', () => {
  const once = roundTrip(SAMPLE);
  expect(roundTrip(once)).toBe(once);
});

it('produces an empty string for an empty document', () => {
  expect(roundTrip('')).toBe('');
});
```

The idempotence test is the important one. If `@tiptap/markdown` normalises something — `*` bullets to `-`, `___` to `---`, fence style — that is acceptable ONLY if a second pass is stable, because otherwise a user's file mutates a little on every edit. Record any normalisation you observe in your report. **Anything genuinely lossy is a stop-and-report, not a test to relax.**

Then, through the DOM:

```tsx
it('exposes its accessible name', () => {
  render(<NoteEditor docKey="g1" value="hello" onChange={() => {}} placeholder="Notes…" ariaLabel="Project notes" />);
  expect(screen.getByLabelText('Project notes')).toBeTruthy();
});

it('does not fire onChange on mount', () => {
  const onChange = vi.fn();
  render(<NoteEditor docKey="g1" value="hello" onChange={onChange} placeholder="" ariaLabel="Notes" />);
  expect(onChange).not.toHaveBeenCalled();
});

it('reseeds when docKey changes', () => {
  const { rerender } = render(<NoteEditor docKey="a" value="Note A" onChange={() => {}} placeholder="" ariaLabel="Notes" />);
  rerender(<NoteEditor docKey="b" value="Note B" onChange={() => {}} placeholder="" ariaLabel="Notes" />);
  expect(screen.getByLabelText('Notes').textContent).toContain('Note B');
});
```

Use `rerender`, not a fresh `render` — remounting will not reproduce the stale-subject bug this guards.

- [ ] **Step 3: Implement `NoteEditor`**

Use `useEditor` from `@tiptap/react` with `StarterKit` (configured to drop what is out of scope) plus `Link` and `Markdown`. The `value` prop seeds the document; the component is **uncontrolled after mount** — do not fight the editor by resetting content on every render.

**Reseed only when `docKey` changes** — not on every `value` change, which would fight the user mid-keystroke. This is the same class of bug that made `StepPanel`'s title rename the wrong step: a component reused across two subjects keeps the first subject's state.

Style with theme tokens only, inside a `.note-prose` class in `src/index.css`. Do not import Tiptap's stylesheet.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/NoteEditor.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/NoteEditor.tsx src/components/NoteEditor.test.tsx src/index.css
git commit -m "feat(notes): add a markdown editor"
```

---

## Task 2: Autosave that never eats the undo window

**Files:**
- Create: `src/lib/noteAutosave.ts`, `src/lib/noteAutosave.test.ts`

**Interfaces:**
- Produces:

```ts
export const NOTE_SAVE_DEBOUNCE_MS = 800;
export function shouldFlushNoteSave(hasPendingUndo: boolean, reason: 'debounce' | 'blur' | 'unmount'): boolean;
```

**The problem this exists to solve.** `setAndPersist` (`store.ts:206`) drops every non-surgical undo entry on each ordinary write and clears `pendingUndo` in the same write. A note autosave firing on a timer would therefore consume the 5-second undo toast for a project deleted moments earlier.

**Sweeping is correct** — a whole-slice restore armed against the previous `goals` array would overwrite the note text just typed. So the fix is NOT to exempt note writes. Instead the save is **held** while an undo is pending, and flushed once it clears.

Unlike ticking a checkbox, autosave is not an action the user knowingly took, and it must not silently spend their undo.

- [ ] **Step 1: Write the failing test**

```ts
describe('shouldFlushNoteSave', () => {
  it('defers a debounced save while an undo is pending', () => {
    expect(shouldFlushNoteSave(true, 'debounce')).toBe(false);
  });
  it('saves on debounce when nothing is armed', () => {
    expect(shouldFlushNoteSave(false, 'debounce')).toBe(true);
  });
  it('always saves on unmount, even with an undo armed', () => {
    // Losing the user's typing is worse than losing an undo they may not use.
    expect(shouldFlushNoteSave(true, 'unmount')).toBe(true);
  });
  it('always saves on blur', () => {
    expect(shouldFlushNoteSave(true, 'blur')).toBe(true);
  });
});
```

That asymmetry is the whole design and must be stated in the module's doc comment: a *timer* must not spend the undo, but an explicit departure (blur, navigation, unmount) must not lose typing.

- [ ] **Step 2: Run, implement, verify**

Run: `npx vitest run src/lib/noteAutosave.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/lib/noteAutosave.ts src/lib/noteAutosave.test.ts
git commit -m "feat(notes): add the autosave gate"
```

---

## Task 3: Project notes and step notes

**Files:**
- Modify: `src/db/types.ts`, `src/state/store.ts`, `src/views/project/NotesTab.tsx`, `src/views/project/StepPanel.tsx`
- Test: `src/state/store.test.ts`, `src/views/project/StepPanel.test.tsx`, `src/views/project/Project.progress.test.tsx`

**Interfaces:**
- Produces: `setNodeNotes(nodeId: string, markdown: string): void` on `actions`.

Add `notes?: string` to `GoalNode` with the same semantics as `Goal.notes`, and a comment stating it never affects the pct roll-up — every other optional field on that type carries one.

- [ ] **Step 1: Write the failing tests**

Store:
- `setNodeNotes` writes markdown to the right node and leaves siblings alone.
- Setting empty markdown REMOVES the key rather than storing `''` — matching how `done`, `estimateMin` and `checkpoint` are handled.
- It does not change `done`, dates, or the percentage.

Components:
- `NotesTab` renders the editor seeded with the project's markdown, and typing routes through `setGoalNotes`.
- `StepPanel` gains a Notes section using the same editor at panel width.
- **Switching steps reseeds the editor** — open step A with notes, open step B with different notes, assert B's text shows. Mirror the `rerender()`-in-place technique used in `StepPanel.test.tsx`'s title test; remounting will not reproduce the bug.

- [ ] **Step 2: Implement**

Wire both hosts through `NOTE_SAVE_DEBOUNCE_MS` and `shouldFlushNoteSave`, reading `pendingUndo` from the store. Flush on blur and on unmount.

`NotesTab` keeps its `max-w-[720px]`; the step editor is narrower and that is expected — spec §3 puts the wide image canvas at project level and short "what actually happened" notes on a step.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc -b && npm test`

```bash
git add -u && git commit -m "feat(notes): markdown notes on projects and steps"
```

**Part A is complete and shippable here.**

---

# PART B — Images

## Task 4: The `assets` table

**Files:**
- Modify: `src/db/types.ts`, `src/db/db.ts`
- Create: `src/db/assets.ts`, `src/db/assets.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Asset {
  id: string;        // 'a_' + uid()
  mime: string;      // 'image/webp' | 'image/png' | 'image/jpeg'
  bytes: Blob;
  width: number;
  height: number;
  createdAt: string; // 'YYYY-MM-DD'
}

export async function putAsset(a: Asset): Promise<void>;
export async function getAsset(id: string): Promise<Asset | undefined>;
export async function allAssetIds(): Promise<string[]>;
export async function deleteAssets(ids: string[]): Promise<void>;
export async function clearAssets(): Promise<void>;
```

**`Asset` is NOT added to `AppState`, and `assets` is NOT touched by `persist()`.** That is the entire reason the table exists. `persist` is a full `clear()` + `bulkPut` of four tables in one transaction; image bytes in a goal row would be rewritten on every checkbox tick. Write this reasoning into `db.ts` beside the version bump.

Dexie: add `version(5)` with `assets: 'id'` alongside the existing four stores plus `settings` and `planReview`. A new store needs a version bump even though no index changes on the others.

`fake-indexeddb` is already a devDependency, so `assets.test.ts` can exercise real Blob round-trips.

- [ ] **Step 1: Write the failing test**

Cover: put→get returns an identical Blob (compare `size`, `type`, and the decoded bytes); `allAssetIds` lists what was written; `deleteAssets` removes only the named ids; `clearAssets` empties the table; getting an unknown id returns `undefined`.

- [ ] **Step 2: Implement, verify, commit**

```bash
git add src/db/assets.ts src/db/assets.test.ts src/db/db.ts src/db/types.ts
git commit -m "feat(assets): add the assets table"
```

---

## Task 5: Paste an image

**Files:**
- Create: `src/lib/imageScale.ts`, `src/lib/imageScale.test.ts`, `src/lib/notes.ts`, `src/lib/notes.test.ts`
- Modify: `src/components/NoteEditor.tsx`, `src/state/store.ts`

**Interfaces:**
- Produces:

```ts
export const MAX_IMAGE_EDGE = 2000;
export function scaledDimensions(w: number, h: number, maxEdge: number): { width: number; height: number };

export function assetIdsInMarkdown(md: string): string[];
export function stripAssetRefs(md: string): string;

// store
addAsset(file: Blob): Promise<string>;   // returns the asset id
```

Markdown references an image as `![alt](asset:a_xyz)`.

**On paste, downscale to 2000px on the long edge and re-encode as WebP, with no prompt.** A raw Retina screenshot is ~4MB; this yields ~200KB. That is the difference between a usable backup and an unusable one, and the spec chose "images always in the backup".

`scaledDimensions` is pure and returns the source dimensions unchanged when both edges are already within the limit — never upscale.

The canvas work stays in the component/store layer; `imageScale.ts` holds only the arithmetic.

- [ ] **Step 1: Write the failing tests**

`imageScale`: landscape, portrait, square, already-small (identity), and exactly-at-limit. Assert aspect ratio is preserved to within a pixel and that dimensions are integers ≥ 1.

`notes`: `assetIdsInMarkdown` finds every `asset:` ref including several on one line and inside link syntax; ignores ordinary image URLs; returns `[]` for none. `stripAssetRefs` removes the ref but keeps surrounding prose, so the search index does not contain opaque ids.

- [ ] **Step 2: Implement paste**

Handle `paste` in the editor: when the clipboard carries an image, prevent the default, downscale, `addAsset`, and insert `![](asset:<id>)`. Only clipboard paste is in scope — spec §3.2 chose that as the single input path. Do not build drag-drop or a file picker.

`addAsset` goes through `ifOwner` so a non-owning tab writes nothing, and latches `persistFailed` on failure like any other write.

- [ ] **Step 3: Verify and commit**

```bash
git add -u && git commit -m "feat(notes): paste images into notes"
```

---

## Task 6: Render images, and revoke their object URLs

**Files:**
- Modify: `src/components/NoteEditor.tsx`
- Create: `src/components/useAssetUrl.ts` (or inline if smaller), plus its test

An `asset:` ref is resolved by reading the Blob and calling `URL.createObjectURL`. **Every created URL must be revoked on unmount or replacement.** A missed revoke is a real leak: pasting screenshots through a long session would retain every Blob for the tab's lifetime.

A missing asset (id in the markdown, row absent) must render a visible, non-destructive placeholder — never a broken-image icon and never a silent blank. The markdown is the user's text and must not be rewritten to remove a ref just because the blob is gone.

- [ ] **Step 1: Write the failing test**

- resolving a known id yields a URL and renders an `img`
- unmounting revokes it (spy on `URL.revokeObjectURL`)
- changing the id revokes the previous URL before creating the next
- an unknown id renders the placeholder and does not throw

- [ ] **Step 2: Implement, verify, commit**

```bash
git add -u && git commit -m "feat(notes): render pasted images"
```

---

## Task 7: Assets in the backup

**Files:**
- Create: `src/lib/backupAssets.ts`, `src/lib/backupAssets.test.ts`
- Modify: `src/db/db.ts`, `src/state/store.ts`, `src/App.tsx`

**This is the only place a bug means real data loss. It gets the heaviest coverage in the plan.**

**Interfaces:**
- Produces:

```ts
export interface BackupAsset { id: string; mime: string; width: number; height: number; data: string } // base64
export async function encodeAssets(assets: Asset[]): Promise<BackupAsset[]>;
export function decodeAssets(raw: unknown): Asset[];   // validates shape; drops malformed entries
```

Export inlines every asset referenced by any note into an `assets` array. One file stays the whole truth.

Import decodes to Blobs and **clears the asset table first**, consistent with `importBackup` already being a generation boundary that clears `undoStack`, `pendingUndo` and the project-page pointers.

**`exportState` is currently synchronous and never touches Dexie.** Reading blobs makes it async. That changes its signature and its single caller, `exportBackup` in `store.ts:1866` — which already has a comment about an IndexedDB read there. Read that comment before changing it; it explains why the current shape avoids an await.

`App.tsx` calls `actions.exportBackup()` from three buttons. Confirm all three still behave, and that Export stays disabled until `hydration === 'ready'`.

- [ ] **Step 1: Write the failing tests**

- `encodeAssets` → `decodeAssets` round-trips a Blob byte-for-byte.
- `decodeAssets` drops entries with a missing field, a non-string `data`, or undecodable base64 — and never throws.
- Import of a backup with NO `assets` key succeeds (every existing backup file).
- **Full cycle:** seed an asset, export, clear the DB, import, and assert the asset renders. This is the test that matters.
- Only REFERENCED assets are exported; an orphan is omitted.

- [ ] **Step 2: Implement, verify, commit**

Run: `npx tsc -b && npm test && npm run build`

```bash
git add -u && git commit -m "feat(assets): include images in the backup"
```

---

## Task 8: Reclaim space

**Files:**
- Modify: `src/state/store.ts`, `src/App.tsx`
- Test: `src/state/store.test.ts`

**Assets are append-only. Removing an image from a note never deletes the blob.** `withUndo` snapshots exactly one slice of `AppState`, and assets are not in it — so an eager delete would let undo restore a note pointing at a blob that no longer exists.

This is the same reasoning already written into `types.ts` for why `Session.nodeId` is allowed to dangle after a step is deleted: cascading is not safe until multi-slice undo exists, and an orphan is inert by comparison.

So reclamation is **manual and explicit**: a `Reclaim space` action beside Export that sweeps blobs referenced by no note and reports how much was recovered.

- [ ] **Step 1: Write the failing tests**

- sweeping deletes only unreferenced assets
- an asset referenced by a STEP note is kept, not just project notes
- it reports the count and total bytes freed
- it is gated by `ifOwner` — a non-owning tab sweeps nothing
- it does not run automatically anywhere

- [ ] **Step 2: Implement, verify, commit**

```bash
git add -u && git commit -m "feat(assets): reclaim unreferenced images"
```

**Part B is complete and shippable here.**

---

# PART C — Search

## Task 9: Notes in the command palette

**Files:**
- Modify: `src/lib/search.ts`, `src/lib/search.test.ts`, `src/components/CommandPalette.tsx`
- Modify: `src/state/store.ts` if a new open-target is needed

`PRODUCT_UX_REVIEW.md` calls retrieval an adoption blocker — "where did that note about late days go?" has no answer today. `search.ts` currently indexes `title` and `context` only; notes are the surface that will hold the most text.

**Interfaces:**
- `SearchEntry` gains `body?: string` — the note markdown with `asset:` refs stripped via `stripAssetRefs`, so opaque ids never match a query.
- `SearchHit` gains `snippet?: string` — roughly 80 characters around the match. Without it a note hit shows a project title and no indication of why it matched, which is not useful.

**Scoring:** a body match must rank BELOW a title match and below a context match. Notes are long, so a hit there is weaker evidence. Reuse the existing `CONTEXT_WEIGHT` pattern and add a lower `BODY_WEIGHT`; do not disturb `DONE_PENALTY` / `ARCHIVED_PENALTY`, which are sort tiers rather than nudges.

**Where a hit opens:** a project-note hit opens the project page on the **Notes** tab; a step-note hit opens the page with that step's panel. `openProject(goalId, nodeId)` already sets `openStepId`, so the step case works; the project-note case needs the tab set, which `setProjectTab` can do.

- [ ] **Step 1: Write the failing tests**

- a query matching only note text returns that project, with a snippet containing the match
- a title match still outranks a body match for the same query
- `asset:` ids are not matchable
- a step note hit carries the right `nodeId`
- entries with no notes are unaffected, and existing ranking tests still pass unchanged

- [ ] **Step 2: Implement, verify, commit**

Run: `npx tsc -b && npm test && npm run build`

```bash
git add -u && git commit -m "feat(search): index note text"
```

---

## Task 10: Documentation

**Files:** `CLAUDE.md`

- [ ] **Step 1: Record the two new invariants**

Add to the Invariants section:

- **`assets` lives outside `AppState` and outside `persist()`.** A single write is a full clear + bulkPut of all four tables, so image bytes in a goal row would be rewritten on every checkbox tick. Asset writes are surgical, go through `ifOwner`, and are append-only — an orphaned blob is inert, and deleting one eagerly would let undo restore a note pointing at nothing, exactly as `Session.nodeId` is allowed to dangle.
- **Note autosave is held while `pendingUndo` is live.** `setAndPersist`'s sweep is correct and must not be exempted; instead a *timer* never spends the undo, while an explicit departure — blur, navigation, unmount — always saves, because losing typing is worse than losing an unused undo.

Also add `src/db/assets.ts` to the Layers list as the only module touching that table.

- [ ] **Step 2: Manual check**

Run `npm run dev` and confirm:
1. Type markdown in a project note — `## `, `- `, `**bold**` all transform live.
2. Paste a screenshot; it appears, and the file stays small (check the exported JSON size).
3. Reload; the image is still there.
4. Delete a project, then type in another project's notes within 5 seconds — the Undo toast must SURVIVE until you blur.
5. Export, clear the database, import — notes and images both return.
6. `⌘K` a word that appears only inside a note; the hit shows a snippet and opens the Notes tab.
7. Open a second tab: it must not write, and pasting there must not corrupt the first tab's data.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md && git commit -m "docs: record the asset and autosave invariants"
```

---

## Risks

1. **Blob round-tripping through the export** — the only path where a bug loses real data. Task 7's full export→clear→import→render cycle is the mitigation.
2. **Markdown round-trip fidelity.** `@tiptap/markdown` may normalise constructs. Task 1 requires normalisation to be idempotent and recorded; anything lossy is a stop-and-report.
3. **Tiptap is the first non-trivial UI dependency** (~150KB). Negligible for Electron, acceptable for the browser build. Its prose styles must use theme tokens or `designScale.test.ts` fails the build.
4. **Object-URL leaks.** Task 6 tests revocation explicitly because the failure is invisible until a long session degrades.
5. **The editor reused across two subjects.** Both `NoteEditor` hosts must reseed on identity change. This exact bug already shipped once, in `StepPanel`'s title.

## Self-review notes

| Spec requirement | Task |
|---|---|
| §3.1 markdown stored, rich editing | 1 |
| §3.1 task lists excluded, with reasoning | 1 |
| §3.2 `assets` table outside `AppState` | 4 |
| §3.2 `![](asset:id)`, downscale to WebP | 5 |
| §3.2 object URLs revoked | 6 |
| §3.3 append-only + Reclaim space | 8 |
| §3.4 export inlines base64, import clears first | 7 |
| §3.5 autosave held while `pendingUndo` is live | 2, 3 |
| §3.6 search indexes notes | 9 |
| §2.1 step notes in the panel | 3 |

**Beyond the spec, and required:** `exportState` is synchronous today and never reads Dexie. Inlining blobs makes it async, changing its signature and its caller — recorded in task 7 rather than discovered mid-implementation. And spec §3.6 asked only for indexing; a hit with no snippet shows a project title and no reason, so task 9 adds one.
