# Project Page and Notes Design

**Date:** 2026-08-01
**Status:** Approved, ready for planning

## Goal

Replace the project drawer with a full page. Give a step somewhere to be opened
and written into. Turn `notes` from a plain textarea into a markdown document
that accepts pasted images. Delete `Milestone`.

## Scope

In scope: `src/components/GoalDrawer.tsx` (deleted), `src/components/GoalTree.tsx`,
`src/views/Goals.tsx` and `src/views/goals/*`, a new `src/views/Project.tsx` with
`src/views/project/*`, `src/state/store.ts`, `src/db/db.ts`, `src/db/types.ts`,
`src/lib/search.ts`, `src/lib/goalImport.ts`, `src/lib/pct.ts`, `src/lib/board.ts`,
`src/lib/timeline.ts`, `src/App.tsx`, and four new `src/lib` modules.

Out of scope: URL/history routing, a per-project timeline tab, a `/` slash-command
menu, wikilinks and backlinks, step-level notes search ranking beyond plain
substring match, and any change to the Plan or Timeline views beyond the
milestone→checkpoint rename and the `openProject` call-site update.

## Decisions taken

| Question | Decision |
|---|---|
| Container | Full page, tabbed. Not a modal, not a split, not a properties rail |
| Tabs | `Steps` and `Notes` only |
| Milestones | Deleted. Folded into steps as `checkpoint?: boolean` |
| Do checkpoints count toward pct | **Yes.** Existing percentages shift once at migration |
| Notes at which level | Project doc (wide) **and** step doc (panel) |
| How a step opens | A new `◈` control on the row. The row click is not reassigned |
| Editor | Tiptap/ProseMirror, markdown as the stored form |
| Image storage | Blobs in a new `assets` table, outside `AppState` |
| Images in backups | Always inlined as base64 |
| Image input | Clipboard paste |

## Motivating problems

Each of these is recorded in the repo already:

- `ideas/ux-ui.md` UX-19 — "the drawer is a centred modal called a drawer."
- `PRODUCT_UX_REVIEW.md` A-1 — the drawer stays mounted while closed, keeping
  `aria-modal="true"` in the tree permanently and its close button tabbable.
- `docs/audits/2026-07-22-usability-audit.md` #7 — step dates exist on `GoalNode`
  but the drawer shows none of them.
- Same audit, #4 — "span ≠ plan is never explained anywhere."
- Same audit, on milestones — "users expect hitting it to count."
- `PRODUCT_UX_REVIEW.md` on retrieval — notes are unsearchable; "where did that
  note about late days go?" has no answer.

---

## Part 1 — The page

### 1.1 Routing

`ViewName` gains `'project'`. No router dependency; navigation stays in the store.

```ts
view: ViewName                              // + 'project'
openGoalId: string | null                   // now the routed project
projectTab: 'steps' | 'notes'               // new
openStepId: string | null                   // new — the step panel's subject
focusNodeId: string | null                  // renamed from drawerFocusNodeId
```

`drawerFocusNodeId` is renamed `focusNodeId`, since no drawer remains. The two
node fields are distinct and both are needed: `focusNodeId` scrolls a row into
view and pulses it, and clears after the pulse; `openStepId` is what the panel
is showing, and persists until the panel is closed.

`openDrawer(goalId, nodeId?)` is renamed `openProject(goalId, nodeId?)` and keeps
its signature and its ancestor-expansion behaviour. Every existing call site —
`CommandPalette`, `Timeline`, `BoardCard` — is a rename only.

**When `nodeId` is supplied, `openProject` sets both fields** — the row is
scrolled to and pulsed, *and* the step panel opens on it. A ⌘K hit on a step
therefore lands on that step's notes, dates and estimate, not merely on a
highlighted row. This is what makes note search useful for step-level notes.

`‹ Projects` and Escape both return to `view: 'goals'`, restore board scroll
position, and focus the card that was opened. When the step panel is open,
Escape closes the panel first.

`GoalDrawer.tsx` is deleted in full: the `role="dialog"`, the hand-rolled focus
trap, the body scroll lock, and the `close-drawer` special-case ahead of the
modal check in `App.tsx`. A page needs none of it, and A-1 and UX-19 both
disappear with the file.

### 1.2 Layout

Sticky header, carried over from `DrawerHeader` unchanged in content: title
(inline-editable), start→deadline with `Confirm`/`Clear dates`, days-left,
horizon, the progress bar, and the pace line. The pace line is the best
information design in the app and is not touched.

Below it, a two-tab bar (`Steps`, `Notes`), then a full-width body.

Below `md`, the existing bottom tab bar continues to work and the page is simply
a page — strictly better than an 88vh modal containing its own scroll region.

### 1.3 What is deliberately not built

A `Timeline` tab. The global Timeline view already renders this project's lane;
a per-project duplicate is a second surface to keep in sync that answers no new
question. Additive later if wanted.

---

## Part 2 — Steps and checkpoints

### 2.1 The step panel

Opened by a new `◈` control on the step row. **No existing gesture is
reassigned:** plain click still toggles done (`GoalTree.tsx:458`), double-click
still renames, ⌘/⇧-click still selects via the capture phase, Space and Enter
are unchanged.

The `◈` uses the `.quiet-control` class — carrying its `@media (hover: hover)`
gate and 24px target floor, and requiring a literal `group` ancestor — with one
exception: **when a step has notes, its `◈` is always visible.** That is how
notes stay discoverable without hovering across every row.

The panel shows, for the selected node:

| Field | Source | Note |
|---|---|---|
| Title | `title` | inline-editable |
| Checkpoint | `checkpoint` | toggle |
| Span | `start` / `deadline` | labelled *span*; first UI these have ever had |
| Plan | `plannedWeek` / `plannedDay` | labelled *plan*, stated as distinct from span |
| Estimate | `estimateMin` | reuses `EstimateControl` |
| Time logged | `sessions` | reuses `LogTimeControl` |
| Notes | `notes` (new on `GoalNode`) | the same editor, narrower |

Surfacing span and plan side by side with distinct labels is the fix for audit
#4 and #7.

Below ~900px the panel becomes a full-width sheet rather than a column.

### 2.2 Milestones become checkpoints

`GoalNode` gains `checkpoint?: boolean`. `Milestone` is deleted from
`types.ts`, `db.ts`, `goalImport.ts`, the export schema, and the store actions
(`addMilestone`, `updateMilestone`, `removeMilestone`).

Migration, as one undoable write: each `Milestone` becomes a root-level
`GoalNode` with `checkpoint: true`, `done: false`, and `start` and `deadline`
both set to `milestone.date`. The Timeline's `◆` markers read the flag instead
of the array.

### 2.3 The pct consequence, stated plainly

`CLAUDE.md` records that milestones never affect the pct roll-up. A checkpoint
is a node, so it does. Two consequences, both accepted:

1. **Existing percentages shift once.** A 6-step project with 2 milestones
   becomes 0/8 and its headline number drops. This is the audit's own
   recommendation followed through — "users expect hitting it to count" — and it
   is a single undoable write.
2. **`goalPctBasis` may flip from `weighted` to `equal`** on projects where every
   step was previously estimated, because migrated checkpoints carry no
   estimate. The basis is already disclosed beside the number, so the figure
   does not become misleading; it becomes differently derived, and says so.

The `CLAUDE.md` invariant is updated in the same change: scheduling metadata
still never affects pct, and a checkpoint is not scheduling metadata — it is a
step.

---

## Part 3 — Notes

### 3.1 Editor

Tiptap (ProseMirror) with `tiptap-markdown`. `goal.notes` stays a markdown
`string`, so existing notes load with no migration. `GoalNode` gains
`notes?: string` with identical semantics.

Both use the same editor component at different widths. Like every other field
on `GoalNode`, `notes` never affects the pct roll-up.

**In:** headings 1–3, bold, italic, strike, inline code, bullet and numbered
lists, code block, blockquote, horizontal rule, links, images, and markdown
input rules (`## `, `- `, `**x**`).

**Out, on purpose:**

- **Task lists.** In Phase a checkbox is the only thing that moves a percentage.
  A checkbox in a note that moves nothing recreates the milestone problem in a
  new place.
- Tables, wikilinks, backlinks, mentions, comments, a `/` menu.

### 3.2 The `assets` table

```ts
// db.ts version(5): assets: 'id'
interface Asset {
  id: string;        // 'a_' + id
  mime: string;      // image/webp, image/png, image/jpeg
  bytes: Blob;
  width: number;
  height: number;
  createdAt: string; // 'YYYY-MM-DD'
}
```

**`assets` is not part of `AppState` and not in `persist()`.** `persist` is a
`clear()` + `bulkPut` of all four tables in one transaction; image bytes inside
the goal object would mean every checkbox tick rewrites every screenshot ever
pasted. Paste performs one surgical `db.assets.put()`, gated by `ifOwner` so a
non-owning tab still writes nothing, and latching `persistFailed` on failure like
any other write.

Markdown references assets as `![alt](asset:a_xyz)`. A resolver maps ids to
`URL.createObjectURL` and **revokes on unmount.**

**On paste, images are downscaled to 2000px on the long edge and re-encoded as
WebP,** with no prompt. A raw Retina screenshot is ~4MB; this yields ~200KB,
which is the difference between a usable backup and an unusable one.

### 3.3 Assets are append-only

Removing an image from a note never deletes the blob. `withUndo` snapshots
exactly one slice of `AppState`, and assets are not in it, so an eager delete
would let undo restore a note pointing at a blob that no longer exists.

This is the same reasoning already written into `types.ts` for why
`Session.nodeId` is allowed to dangle after a step is deleted: cascading is not
safe until multi-slice undo exists, and an orphan is inert by comparison.

A **Reclaim space** action beside Export sweeps blobs referenced by no note and
reports the total recovered. Manual and explicit; never automatic.

### 3.4 Export and import

Export inlines every referenced asset into an `assets` array as
`{ id, mime, width, height, data }` with `data` base64. One file remains the
whole truth.

Import decodes to Blobs and **clears the asset table first**, consistent with
`importBackup` already being a generation boundary that clears `undoStack` and
`pendingUndo`.

Base64 costs ~33% inflation. With §3.2 downscaling, a heavy semester lands in
single-digit MB.

### 3.5 Autosave must not eat the undo window

`setAndPersist` (`store.ts:206`) drops every non-surgical undo entry on each
ordinary write and clears `pendingUndo` in the same write. Note autosave firing
on a timer would therefore consume the 5-second undo toast for a project deleted
moments earlier.

Sweeping is *correct* — a whole-slice restore armed against the previous `goals`
array would overwrite the note text just typed. So the fix is not to exempt note
writes. Instead:

- Debounce note writes at 800ms, flushing on blur, tab switch, navigation, and
  unload.
- **Hold the flush entirely while `pendingUndo` is live**, then flush once it
  clears (5s maximum).

Keystrokes live in component state meanwhile, so nothing is lost. Unlike ticking
a checkbox, autosave is not an action the user knowingly took, and it must not
silently spend their undo.

### 3.6 Search

`search.ts` indexes note markdown with `asset:` refs stripped. A hit opens the
project page on the `Notes` tab, or the step panel, reusing
`openProject(goalId, nodeId)`.

`isEditableTarget` (`appKeyboard.ts:29`) already tests `isContentEditable`, so
typing digits in the editor will not trigger view shortcuts. No change needed.

---

## Part 4 — Testing

New pure modules, each with a sibling test per the `src/lib` convention:

| Module | Responsibility |
|---|---|
| `notes.ts` | extract `asset:` ids from markdown; strip refs for indexing |
| `imageScale.ts` | target dimensions from source + max edge (pure; canvas stays in the component) |
| `checkpoints.ts` | `Milestone[]` → checkpoint `GoalNode[]` |
| `backupAssets.ts` | base64 encode/decode and shape validation |

Existing tests requiring update:

| File | Why |
|---|---|
| `store.test.ts` | milestone actions deleted; `openDrawer` → `openProject` |
| `pct.test.ts` | checkpoints now count in the roll-up |
| `roadmap.test.ts`, `plan.test.ts` | reference milestones |
| `timeline.test.ts` | `◆` markers read the flag |
| `views.smoke.test.ts` | new `project` view |
| `GoalDrawer.progress.test.tsx` | becomes `ProjectPage.progress.test.tsx` |

Component tests click the child a person actually hits, never the row element —
the `◈` opener is clicked directly (`CLAUDE.md`, on `onClickCapture`).

`backupAssets.ts` carries the heaviest coverage of anything here, including a
full export → import → render cycle. It is the only place a bug means real data
loss.

## Risks

1. **Deleting `GoalDrawer` touches every caller** — `App.tsx`, `CommandPalette`,
   `Timeline`, `BoardCard`. Mitigated by keeping `openProject` signature-compatible.
2. **The pct shift at migration** — §2.3. Disclosed, undoable, one-time.
3. **Tiptap is the first non-trivial UI dependency** (~150KB). Negligible for
   Electron, acceptable for the browser build. Its prose styles must use theme
   tokens or `designScale.test.ts` fails the build on a literal hex.
4. **Blob round-tripping through the export** — see testing above.

## Sequencing

Three independently shippable pieces:

1. **Page, tabs, drawer deletion.** No data changes. Immediately better.
2. **Step panel and checkpoint migration.** First data change, fully undoable.
3. **Notes editor and assets.** Lands last, on a settled foundation, because it
   carries the only real data risk.
