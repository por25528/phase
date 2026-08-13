# Student execution assistant and top command shelf — verification

This document records both the original student-execution vertical slice and
the later top-command-shelf macOS gate. The first section covers the slice implemented by
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

---

# Top command shelf — macOS acceptance pass (2026-08-13)

Verification record for `docs/superpowers/plans/2026-08-13-top-command-shelf.md`
(commits `abf51f8..dc3ef69`), run on 2026-08-13 from clean HEAD `dc3ef69` on
macOS (Darwin 25.5.0, macOS 26.5.2 build 25F84), arm64, Electron 43.0.0,
electron-builder 26.15.3, Node 26.5.0, Vitest 3.2.6. This section supersedes
the "Electron smoke run" above for the desktop behavior: the shelf build keeps
the Hub hidden in the background instead of quitting on close.

## Environment (observed, read-only)

- Display arrangement: one active display — built-in Liquid Retina
  2560 × 1664, `CGGetActiveDisplayList` returns a single display with bounds
  1470 × 956 points, Main Display = Yes, Mirror = Off, no external display.
- Reduce Motion: `defaults read com.apple.universalaccess reduceMotion` → `0`
  (off). Observed, never altered, and left unchanged.
- Command–Space conflict: the macOS Spotlight binding is disabled
  (`com.apple.symbolichotkeys` key `64` `enabled => false`, parameters
  32/49/1048576 = Space + Command). No conflict recorded; no system shortcut
  was changed.

## Automated gates (all run from clean HEAD)

- **Focused shelf gate** (the 13 files in Task 10 Step 1):
  Test Files **13 passed (13)**, Tests **165 passed (165)**.
- **`npm test`**: Test Files **149 passed (149)**, Tests **2769 passed (2769)**.
- **`npx tsc -b`**: exit 0.
- **`npm run build`**: Vite built clean; emits `dist/index.html` and
  `dist/assistant.html`.
- **`npm run build:mac`**: electron-builder emits
  `release/mac-arm64/Phase.app` and `release/Phase-0.0.0-arm64.dmg` (code
  signing skipped, identity set to null).
- **`git diff --check`**: clean.
- **Security scan** (`rg` for implementation placeholders, AppKit/window-level
  fallbacks, and parameterized `ipcRenderer.send`/`ipcRenderer.invoke` calls over
  `src electron assistant.html`): no hits (rg exits 1).
- **Scope scan** (`rg` for `from 'state|db'|initStore|persist|Dexie|tabLock`
  over `src/assistant`, `AssistantSurface.tsx`, `useAssistantSendoff.ts`):
  3 hits, all in comment lines that state the invariant in the negative:
  `src/assistant/main.tsx:8`, `src/assistant/AssistantOverlay.tsx:12`, and
  `src/assistant/entryBoundary.test.ts:10` ("no store, no Dexie, no tab lock",
  "No initStore, no persistence, no tab lock"). Reviewed manually: these are
  documentation, not runtime imports, and all three predate this plan's
  commits. `AssistantSurface.tsx` and `useAssistantSendoff.ts` are clean, and
  `entryBoundary.test.ts` — which walks the real runtime import graph from the
  overlay entry and fails on any path to `src/state`, `src/db`, or `App.tsx` —
  passes, so the shelf renderer graph has no runtime reach to the store or db.

## Acceptance items

Each of the plan's twelve macOS acceptance items is tagged **automated**,
**observed**, or **still manual**:

1. **Command–Space summons the shelf; the Hub stays behind; the command field is
   focused** — still manual. Reason: the harness cannot produce a physical ⌘Space
   press. The synthesized accessibility key event (delivered to the frontmost
   app) did not summon the shelf and no shelf renderer was spawned, but
   synthesized events are not a reliable proxy for a physical press on an
   OS-registered hotkey, so this is inconclusive by construction — not evidence
   of a shortcut failure. Spotlight's binding is disabled (above), so no conflict
   was reported. Needs a human keypress.
2. **Command–Space again hides once and returns focus to the underlying app** —
   still manual (same reason as item 1).
3. **Escape hides without “Good luck!”** — still manual; requires a visible shelf.
   The “no send-off on escape” behavior is pinned by `useAssistantSendoff.test.tsx`
   (only a matching `activeFocus.ref` enters `message`; escape/blur never do).
4. **Clicking away blurs and hides** — still manual (requires a visible shelf).
   Blur-hide is pinned by `electron/assistantWindowController.test.ts`
   ("hides on blur and a second invocation can be represented by isShowing").
5. **Start recommended session → button disables, “Good luck!” appears only after
   the matching active-focus reference arrives, shelf disappears without a white
   flash** — still manual for the live click-through, automated for the
   mechanics: `useAssistantSendoff.test.tsx` pins the matching-`WorkRef`-only
   acknowledgment, duplicate-start refusal, 160 ms message / 500 ms hold / 180 ms
   out / 1000 ms fallback, and the refusal path; `AssistantHost.test.tsx` pins the
   published active-focus reference; `electron/assistantIpc.test.ts` rejects
   missing or malformed refs. The no-white-flash claim needs a human to watch it.
6. **Reopen shows Focus session with the same task, elapsed work, expected-time
   text, Complete session, and Take break** — still manual for the live
   surface; the rendering branches are pinned by `AssistantSurface.test.tsx`.
7. **Reduce Motion repeat: no translation, message ~350 ms** — still manual.
   Reduce Motion is observed off (0) and was not altered; exercising the reduced
   path requires a human to toggle the system setting and restore it, which this
   run must not do. The 350 ms reduced-motion path is pinned by
   `useAssistantSendoff.test.tsx` ("reduced motion closes at exactly 350ms with
   no leaving choreography"); the same file separately pins the 1000 ms fallback.
8. **Closing the Hub hides it; menu bar and Command–Space still work** — still
   manual. The Hub window is present in the accessibility tree, but confirming
   the hidden-background lifecycle needs an eyes-on pass and physical keys.
9. **Menu-bar Open Phase / Open assistant / Settings each open exactly once** —
   still manual. Reason: the Orca computer-use provider reports no menubar or
   menu surface support (`surfaces.menubar: false`, `surfaces.menus: false`), so
   the Tray menu cannot be driven or read by the harness. Menu construction and
   single-routing are pinned by `electron/menuBar.test.ts`.
10. **Launch Phase at login toggle reflects the OS result, left in the user's
    state** — still manual. The Hub's web content is not exposed in the
    accessibility tree (only the window chrome is), so the in-app Settings
    switch cannot be read or toggled by the harness, and the run must not leave
    an unintended change it cannot observe. The component is pinned by
    `LaunchAtLoginSettings.test.tsx` (optimistic value, OS-truthful restore,
    `null`-refusal warning, browser no-op).
11. **Second display, fullscreen app, another Space, Stage Manager, sleep/wake,
    monitor reconnect** — still manual. Reason: this machine has a single
    built-in display (Mirror Off), so none of these environments exist to test
    against; they were not fabricated.
12. **Command–Q and Quit Phase fully exit and release Command–Space** — still
    manual for the in-app routes (physical keys / tray). The clean quit path was
    observed at the process level: the prior Phase instance
    (`/Applications/Phase.app`) quit via `tell application "Phase" to quit` with
    zero remaining processes before the release app was launched.

### Remaining physical acceptance gate

A human should run items 1–12 above from the installed build. The shortest
high-value pass is: summon/toggle with Command–Space; verify Escape and blur;
start and reopen a session; close the Hub and use all menu-bar actions; confirm
launch-at-login preserves the chosen OS state; then exercise Reduce Motion,
fullscreen/Spaces/Stage Manager, display reconnect, and both quit routes.

## Observed (launch-level)

- The previous Phase instance was quit cleanly before launch; no Phase processes
  remained.
- `open release/mac-arm64/Phase.app` launched (main PID 76663); the Hub window
  “Phase” (1280 × 909) appeared and rendered, so the built app starts.
- The pre-warmed shelf was not observable: the Quartz window list for the app
  shows only the Hub window plus the app's menu-bar surfaces, and only one
  renderer process (the Hub) is alive. Whether the hidden shelf window had not
  completed pre-warm or had been discarded by the designed `render-process-gone`
  recovery could not be determined without a successful summon, and is not
  claimed either way.
- No error output was captured in the unified log for the app's processes (the
  app writes no console output that the unified log retains).

## Design status

`docs/superpowers/specs/2026-08-13-top-command-shelf-design.md` line 5 reads
exactly:

```
**Status:** Approved on 2026-08-13; implementation governed by the macOS acceptance gate
```
