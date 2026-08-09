# Product remaster — slice plan

Source: `ideas/PRODUCT_REMASTER.md`. That document is a product specification, not
a mood board; this file is the order it gets built in and the record of what has
landed.

The spec's own advice (§24) is that the first milestone combines changes 1, 2, 3,
5 and the smallest viable portion of 7 — no AI, no calendar rewrite — because
that slice alone makes Phase feel faster and more intentional on every use. This
plan follows it, then works down the roadmap in §23 order.

Each slice is vertical and ships on its own: pure logic in `src/lib` with a
sibling test, thin views, `npm test` and `npx tsc -b` green, one commit.

## M1 — the first milestone

- [x] **S1 Vocabulary.** Project → Goal, Step → Task, sub-goal → Area in every
      user-facing string. Code identifiers (`GoalNode`, `openStepId`) stay put:
      §21.5/21.6 is about the primary UI, and renaming the store in the same
      breath would bury the visible change in a mechanical diff.
- [x] **S2 Header restraint (change 3).** The bar carries the wordmark, the nav,
      Search, Quick add and one utility trigger. Export / Reclaim space / Import
      / theme text leave the persistent chrome. Timeline stops being a global
      destination and becomes a view mode inside Goals.
- [x] **S3 Compact goal header (change 1).** 56–72px: title, deadline, health,
      remaining effort, small progress. The full-width bar, `Clear dates`,
      `Confirm`, pace prose and calibration move into a popover. Work above the
      fold on a 13-inch laptop.
- [x] **S4 Conventional task rows (change 2).** Checkbox completes, chevron
      expands, row click selects and opens the inspector, Enter/double-click
      edits the title. Aligned status / estimate / schedule columns.
- [x] **S5 Quick add (change 5).** One line, unscheduled by default, visible
      parsing of `#goal`, `~45m` and a date token. Replaces the modal.

## M2 — workspace and command layer

- [x] **S6 Real `Cmd+K` (change 4).** Verbs, not just navigation: create,
      complete, schedule, set status, move, open settings, export.
- [ ] **S7 Goal tabs (change 6).** Work / Board / Calendar / Notes over one task
      store, never duplicated arrays.
- [x] **S8 Remaining effort and health (change 9).** `12h 30m remaining · 8 of 14
      tasks · On track`, with the estimate-coverage qualifier stated. Landed
      with S3, which could not state a compact header without them.

## M3 — execution and planning

- [ ] **S9 Today (change 10).** Now / Today's plan / Attention, and the nav
      becomes Today · Plan · Goals.
- [ ] **S10 Replan unfinished (change 12).** Bounded, consequence-aware preview.
      Nothing moves silently.
- [ ] **S11 Plan rail and drag capacity (change 13).** Availability to Settings,
      stats to headers, capacity fit shown before the drop.
- [ ] **S12 Multiple work sessions per task (change 11).**

## M4 — creation, markers, AI, polish

- [ ] **S13 Type-aware creation (change 14).** Two fields, then a type-specific
      starting point.
- [ ] **S14 Milestones replace checkpoints.**
- [ ] **S15 Inline AI proposal / diff (change 8).** Retires the clipboard
      round-trip as the primary path.
- [ ] **S16 Visual system (change 15).** Type roles, spacing, radius, surfaces,
      interaction states, motion.
- [ ] **S17 Quality-of-life sweep.** The §19 P0 list that the slices above did
      not already absorb.
