# Student execution assistant — verification

Verification record for the vertical slice implemented by
`docs/superpowers/plans/2026-08-12-student-execution-assistant.md`
(commits `801203d..208ce96` plus this document's commit), run on
2026-08-12 on macOS (Darwin 25.5.0), Node/Vitest 3.2.6, Electron 43.

Each scenario below names its evidence. **Automated** means a test pins the
behaviour and the cited suite passed in the full run; **smoke** means it was
observed in the live Electron run described at the bottom; **manual** means it
still needs a human at the real keyboard, with the reason given.

## Scenario matrix

1. **No work and no working hours → calm `Set working hours` guidance, no fake zero.**
   Automated. `executionAdvisor.test.ts` — "preserves the no-hours verdict
   instead of inventing a zero-minute plan"; `AssistantSurface.test.tsx` —
   "says working hours are missing…"; `Today.freeTime.test.tsx` — "says nobody
   set working hours rather than claiming there is no time".

2. **Scheduled class work now → same primary in Today and assistant.**
   Automated. `executionAdvisor.test.ts` — "uses the current scheduled item as
   primary" and "returns the same primary key as nowFocus or proposalRows";
   `Today.freeTime.test.tsx` — "shows the advisor's primary as the top item".
   Both surfaces render the same `executionAdvice` projection, so agreement is
   structural, not coincidental.

3. **No commitment but open goals → first canonical free-time offer becomes primary.**
   Automated. `executionAdvisor.test.ts` — "uses the first todayPlan offer when
   the day has no commitments"; `Today.freeTime.test.tsx` — the promoted offer
   row still books on click ("books the step at the next free minute").

4. **University/Startup/Personal candidates → primary stays canonical; alternatives may diversify lives.**
   Automated. `executionAdvisor.test.ts` — "may diversify a quiet alternative
   by life without changing the primary" (third same-life candidate is passed
   over for the other life; primary and first alternative unmoved).

5. **Zero history → `Planned 45m` or `Start with 30m`, never "likely".**
   Automated. `expectedTime.test.ts` — estimate/starter fallbacks;
   `AssistantSurface.test.tsx` — "distinguishes history, planned estimate, and
   starter language" (history copy asserts the absence of "Planned", and no
   copy anywhere says "likely" — `rg -i '\blikely\b' src` returns nothing).

6. **Two comparable completed items → medium range.**
   Automated. `expectedTime.test.ts` — observed min/max rounded outward to five
   minutes, `confidence: 'medium'`, and multi-session summing before sampling.

7. **Five comparable completed items → high range.**
   Automated. `expectedTime.test.ts` — 25th/75th percentiles rounded outward,
   `confidence: 'high'`, `sampleCount: 5`.

8. **Start, hide overlay, reopen → active session survives.**
   Automated at both layers. `store.test.ts` — "initStore hydrates the active
   draft" (restart survival via the `activeFocusSession` settings row);
   `assistantIpc.test.ts` — "ready returns the cached sanitized snapshot…"
   (hide/reopen serves the cache and re-requests). The overlay itself holds no
   session state, so hiding it cannot lose anything.

9. **Break and continue → break time excluded.**
   Automated. `focusSession.test.ts` — "elapsed work excludes breaks",
   "pause and resume are idempotent".

10. **Normal complete → one Session appended, no task completion.**
    Automated. `store.test.ts` — "normal completion logs one session and clears
    the draft", "completing a session never completes the task";
    `AssistantHost.test.tsx` — "keeps completion and scheduling separate".

11. **Stale/restarted session → confirmation before history write.**
    Automated. `focusSession.test.ts` — needs-confirmation with no log request,
    and the history-aware threshold (`max(180, 2×highMin)`); `store.test.ts` —
    "stale completion parks the draft in confirming and appends nothing",
    "confirming a positive adjusted duration appends one session",
    "choosing Didn't happen appends nothing".

12. **Add, complete, and schedule commands → preview, then exactly one write.**
    Automated. `assistantCommands.test.ts` — parsing never writes, proposals
    carry explicit ids; `AssistantHost.test.tsx` — "a confirmed capture calls
    exactly one approved store action" (zero writes before Confirm, one after,
    and the spent proposal cannot double-write).

13. **Ambiguous title → choices, no guessed write.**
    Automated. `assistantCommands.test.ts` — "returns choices instead of
    guessing between two open lab reports" (the archived course's copy is not
    offered), "keeps the pending verb and date on an ambiguous schedule";
    `AssistantSurface.test.tsx` — "offers subject choices without guessing".

14. **`Command+Space` conflict → visible conflict; changing to an available chord activates it.**
    Automated at every seam: `assistantShortcut.test.ts` — registration
    returning false yields `{ registered: false, conflict: true }` without
    throwing, new chord registers before the old one unregisters, a conflicted
    change leaves the previous chord explicitly active;
    `AssistantShortcutSettings.test.tsx` — the conflict is said in words
    ("another app owns it", Spotlight named) while the field stays editable,
    and the still-working chord is named. **Manual remainder:** pressing the
    physical chord on a Mac where Spotlight owns ⌘Space and watching the
    Settings row report it — the OS-level `globalShortcut.register` refusal
    itself cannot run under Vitest. No silent fallback exists to observe:
    `assistantShortcut.cjs` has no second-choice path at all.

15. **Long title, missing goal/life, zero alternatives → layout remains stable.**
    Automated. `AssistantSurface.test.tsx` — "wraps a long primary title to two
    lines while quiet metadata truncates"; goalless/lifeless work renders in
    the loose-task tests; zero alternatives is the default fixture.

16. **Overlay loading → skeleton, not blank screen.**
    Automated. `AssistantSurface.test.tsx` — "renders skeleton rows while
    loading, not a spinner or a blank pane"; `assistantBridge.test.ts` — with
    no relay the overlay reports loading forever, never fake data.

## Automated gates

```
npm test          → Test Files 142 passed (142), Tests 2667 passed (2667)
npm run build     → tsc -b clean; vite build ✓; dist/index.html AND dist/assistant.html emitted
git diff --check  → clean
npx vitest run …  designScale, entryBoundary, assistantIpc, assistantShortcut → all pass
rg "TODO|FIXME|TBD|coming soon|confirmed\?:|homework table|chat history" src electron assistant.html
                  → no hits. The only "placeholder" matches in the new code are
                    two real input placeholder attributes (the assistant input's
                    example prompt and the shortcut capture field), reviewed manually.
```

Boundary and invariant guards specific to this slice, all in the suite:

- `src/assistant/entryBoundary.test.ts` walks the real import graph from the
  overlay entry and fails if any **runtime** path reaches `src/state/`,
  `src/db/`, or `App.tsx` (type-only imports are erased and exempt). It also
  proves `assistant.html` boots `src/assistant/main.tsx`, never `src/main.tsx`,
  and that the walker itself sees a non-trivial graph.
- `electron/assistantIpc.test.ts` pins sender-identity checks in both
  directions, structural payload validation (oversized strings, over-long
  arrays, unknown union members all rejected), the role split between the two
  preloads, that the overlay preload exposes no calendar API and requires
  nothing but `electron`, and that neither preload has a parameterised
  `send(channel, …)` escape hatch.
- `store.test.ts` pins: focus writes happen on transitions only, a non-owning
  tab never writes the focus or shortcut settings, and focus completion
  preserves an already-armed destructive undo.
- No timer-tick persistence exists to test against: elapsed time is arithmetic
  over the draft's timestamps (`focusSession.test.ts`, "no transition depends
  on a one-second interval"), and the only Dexie writes go through
  `saveActiveFocusSession` on explicit transitions.

## Electron smoke run

`vite` on :5173 (both `/` and `/assistant.html` served 200) plus
`VITE_DEV_SERVER_URL=http://localhost:5173 electron .`:

- The app launched cleanly; the process log contains no errors.
- The main window "Phase" appeared (1152×775); the assistant overlay window was
  created hidden, exactly as specified — it does not appear in the OS window
  list, while a second live renderer process confirms `assistant.html` loaded.
- Closing the shell exited fully (no lingering renderer processes), consistent
  with the pinned `window-all-closed → quit` and main-window-destroys-overlay
  behaviour.

Deeper scripted UI driving (clicking through the matrix in the live app) was
not possible in this environment: macOS Accessibility permission for the
automation harness is not granted, and granting it is a system-settings change
a human has to make. The remaining strictly-manual items are the physical
`Command+Space` press against live Spotlight (scenario 14's remainder) and an
eyes-on pass of the overlay's visual polish; every behavioural claim behind
them is covered by the unit and integration suites above.

## Deviations from the plan's letter

- `AssistantHost.test.tsx` was added (the plan's file map did not list a host
  test) to carry the Task 7 integration proofs that need interaction —
  one-write-per-confirm, schedule-failure honesty, switch-logs-first — since
  `App.test.ts` renders static markup only.
- `electron/assistantWindow.cjs`/`.d.cts` were added so the overlay window
  options and entry selection are pure and unit-testable, per Task 10 step 4's
  "add pure exported window-option helpers" option.
- The db-level focus/accelerator persistence tests live in `src/db/db.test.ts`
  (the real-Dexie suite) rather than `store.test.ts`, which mocks `db/db`.
