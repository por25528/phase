# Student Execution Assistant Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a student one trustworthy next action, a calm focus session, and a minimal global action window that can safely capture, schedule, and complete work without creating a second task system.

**Architecture:** Add one pure `executionAdvisor` that projects the ordering Phase already trusts, one pure focus-session state machine, and one conservative assistant-command interpreter. The ordinary renderer remains the only state owner and IndexedDB writer. A separate Electron overlay renders a serializable projection pushed over validated IPC and must never import the store or database. `Command+Space` is the default accelerator, is editable in Settings, and reports conflicts instead of silently choosing another shortcut.

**Tech Stack:** React 19, TypeScript 6, Vite 8 multi-page build, Vitest 3, Dexie 4, Electron 43, Tailwind CSS 3, existing Phase store/actions and custom stroke icon set.

---

## Product contract for this slice

This plan implements the smallest end-to-end version of the approved student execution system:

- The primary audience is a student balancing University, Startup, and Personal lives.
- The assistant shows one primary recommendation and at most two quiet alternatives.
- The primary follows existing Phase ordering. It does not introduce a competing weighted priority score.
- A stored `Session` is confirmed history. No `confirmed` field is added: manual logs are already explicit, and a calm focus draft becomes a `Session` only when the user completes or confirms it.
- Expected time is a range only when the student's own completed comparable work provides enough evidence. Otherwise the UI says `Planned 45m` or `Start with 30m`; it does not label either as a prediction.
- The focus session has no countdown. It shows an expected finishing window and exposes `Complete session`, `Take break`, `Continue`, and `Switch task`.
- The assistant is an action bar, not a chatbot. It keeps no chat history. Capture, schedule, and task-completion commands preview before writing; pressing `Complete session` is itself the confirmation for an ordinary focus log, while an implausibly long session asks again.
- Courses remain `Goal.type === 'study'`; assignments and homework remain ordinary tasks or leaf steps. Do not add a homework table.
- Habits stay quiet and never displace the main recommendation.
- The visual treatment stays neutral and minimal: existing typography tokens, grayscale chrome, thin borders, one focal point, no gradients, no glow, no emojis, and icons only from `src/components/Icons.tsx`.

## Scope boundary

Ship in this plan:

1. Personal expected-time guidance.
2. Canonical primary recommendation plus two alternatives.
3. Calm focus-session lifecycle and recovery after restart.
4. Conservative action commands with preview/confirm.
5. Shared minimal assistant surface inside the app and in a floating Electron window.
6. `Command+Space` default, editable shortcut, and visible conflict state.

Defer to later plans:

- syllabus paste/upload and course templates;
- grades, grade prediction, and a separate homework entity;
- weekly life budgets and coaching;
- proactive OS notifications;
- calendar-aware assistant recommendations beyond the busy-block seams already used by Today;
- mobile UI and sync;
- AI transcription or cloud inference;
- streaks, points, confetti, or other gamification.

## Invariants the implementation must preserve

- `src/state/store.ts` remains the only application-state writer. All `AppState` writes go through `setAndPersist`, `withUndo`, or an existing action.
- A context that does not own the Web Lock never writes. Every settings write remains behind `ifOwner`.
- The Electron overlay imports neither `src/state/**` nor `src/db/**`, calls neither `initStore` nor `persist`, and never acquires the tab lock.
- Time never changes completion or roll-up. Completing a focus session logs time only; it never checks the task.
- Status remains attention metadata and never changes roll-up.
- Recommendations inherit `backlogGroups`, `sortByDue`, `nowFocus`, `todayPlan`, `attentionItems`, `PLANNING_HORIZONS`, `no-hours`, and `no-forecast` semantics.
- Scheduling from the assistant calls `scheduleNode` or `scheduleTask`; it does not create another slot resolver.
- Normal focus completion calls `logSession`, preserving the existing undo contract. No timer tick writes to Dexie.
- The overlay projection excludes notes, asset blobs, calendar cache, OAuth data, and upstream error text.
- `Command+Space` may conflict with Spotlight. Failure is a visible state, not an exception and not permission to register a silent fallback.

## Final file map

Create:

- `src/lib/expectedTime.ts`
- `src/lib/expectedTime.test.ts`
- `src/lib/executionAdvisor.ts`
- `src/lib/executionAdvisor.test.ts`
- `src/lib/focusSession.ts`
- `src/lib/focusSession.test.ts`
- `src/lib/assistantCommands.ts`
- `src/lib/assistantCommands.test.ts`
- `src/lib/assistantProtocol.ts`
- `src/lib/assistantBridge.ts`
- `src/lib/assistantBridge.test.ts`
- `src/lib/assistantAccelerator.ts`
- `src/lib/assistantAccelerator.test.ts`
- `src/components/assistant/AssistantSurface.tsx`
- `src/components/assistant/AssistantSurface.test.tsx`
- `src/components/assistant/AssistantHost.tsx`
- `src/components/assistant/AssistantShortcutSettings.tsx`
- `src/components/assistant/AssistantShortcutSettings.test.tsx`
- `src/assistant/main.tsx`
- `src/assistant/AssistantOverlay.tsx`
- `src/assistant/entryBoundary.test.ts`
- `assistant.html`
- `electron/assistantIpc.cjs`
- `electron/assistantIpc.test.ts`
- `electron/assistantPreload.cjs`
- `electron/assistantShortcut.cjs`
- `electron/assistantShortcut.test.ts`
- `docs/assistant-verification.md`

Modify:

- `src/db/db.ts`
- `src/state/store.ts`
- `src/state/store.test.ts`
- `src/views/Today.tsx`
- `src/views/Today.freeTime.test.tsx`
- `src/components/SettingsModal.tsx`
- `src/lib/commands.ts`
- `src/lib/commands.test.ts`
- `src/App.tsx`
- `src/App.test.ts`
- `electron/preload.cjs`
- `electron/main.cjs`
- `vite.config.ts`

Do not modify the Dexie schema version and do not add a field to `Session`.

## Execution ownership

Claude Opus 5 owns implementation and final integration. Before editing, Opus must create an Orca Run for this plan and delegate **Task 1** below to a fresh OpenCode worker using model `opencode/deepseek-v4-flash-free`. The child task must be parented to Opus's execution task, use TDD, commit only Task 1 files, report `worker_done`, and be released after Opus reviews its diff and tests. Opus then executes Tasks 2–11 sequentially, using the plan's red/green/commit checkpoints.

## Task 1: Learn expected time from confirmed personal history

**DeepSeek-owned bounded task.** Do not edit any other production file in this task.

**Files:**

- Create: `src/lib/expectedTime.ts`
- Create: `src/lib/expectedTime.test.ts`

- [ ] **Step 1: Write failing tests for the evidence rules**

Define fixtures for goals, leaf steps, loose tasks, and sessions. Pin these cases:

```ts
describe('expectedTimeFor', () => {
  it('returns a high-confidence interquartile range from five comparable completed items');
  it('returns a wider medium-confidence range from two to four comparable completed items');
  it('sums multiple sessions for one completed item before treating it as one sample');
  it('ignores unfinished items, dangling sessions, other goals, and non-comparable titles');
  it('returns a planned estimate when fewer than two comparable samples exist');
  it('returns a 30 minute starter when history and estimate are both absent');
});
```

Run:

```bash
npx vitest run --config vitest.config.ts src/lib/expectedTime.test.ts
```

Expected: FAIL because `expectedTime.ts` does not exist.

- [ ] **Step 2: Implement a total, pure expected-time module**

Use this public contract:

```ts
export type WorkRef =
  | { kind: 'step'; id: string; goalId: string }
  | { kind: 'task'; id: string; goalId: string | null };

export type ExpectedTime =
  | {
      kind: 'history';
      lowMin: number;
      highMin: number;
      confidence: 'medium' | 'high';
      sampleCount: number;
    }
  | { kind: 'estimate'; minutes: number }
  | { kind: 'starter'; minutes: 30 };

export interface ExpectedTimeInput {
  goals: Goal[];
  tasks: Task[];
  sessions: Session[];
}

export function expectedTimeFor(
  ref: WorkRef,
  input: ExpectedTimeInput,
): ExpectedTime;
```

Implementation rules:

- Resolve the target from the live goal/task arrays; never trust a dangling reference.
- Treat every stored `Session` as confirmed because every producer is an explicit user action.
- Build samples from completed leaf steps and completed tasks only.
- Sum all sessions for the same target before adding one sample.
- Compare within the same goal. Normalize numbered repeated titles (`Problem set 3`, `Problem set 4`) by lower-casing, removing punctuation, replacing digit runs, and collapsing whitespace.
- Recognize only a small stable work-kind vocabulary (`problem set`, `reading`, `lab`, `essay`, `review`). Generic titles must match their normalized title, not every generic item in the goal.
- For 2–4 samples, use observed min/max rounded outward to five minutes and mark `medium`.
- For 5+ samples, use the 25th/75th percentiles rounded outward to five minutes and mark `high`.
- If evidence is insufficient, return the target's normalized estimate as `estimate`; otherwise return `{ kind: 'starter', minutes: 30 }`.
- Do not reuse `projectCalibration` as the range. It measures estimate ratio across all logged sessions and answers a different question.

- [ ] **Step 3: Run the focused suite**

```bash
npx vitest run --config vitest.config.ts src/lib/expectedTime.test.ts src/lib/actuals.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the bounded task**

```bash
git add src/lib/expectedTime.ts src/lib/expectedTime.test.ts
git commit -m "feat(assistant): learn expected work ranges"
```

Opus review gate: inspect the child diff, rerun the focused command, confirm no `Session.confirmed` field or unrelated file changed, then release the DeepSeek worker.

## Task 2: Build the canonical execution advisor

**Files:**

- Create: `src/lib/executionAdvisor.ts`
- Create: `src/lib/executionAdvisor.test.ts`
- Read/reuse: `src/lib/dailyWork.ts`
- Read/reuse: `src/lib/todaySurface.ts`
- Read/reuse: `src/lib/todayPlan.ts`
- Read/reuse: `src/lib/backlog.ts`

- [ ] **Step 1: Write failing canonical-order tests**

Pin the authority order rather than a numeric score:

```ts
describe('executionAdvice', () => {
  it('uses the current scheduled item as primary');
  it('uses the next scheduled item when nothing is running');
  it('uses the first untimed commitment when the day has no timed work');
  it('uses the first todayPlan offer when the day has no commitments');
  it('returns at most two unique alternatives');
  it('may diversify a quiet alternative by life without changing the primary');
  it('preserves the no-hours verdict instead of inventing a zero-minute plan');
  it('never recommends blocked, completed, archived, or non-planning-horizon work');
  it('returns the same primary key as nowFocus or proposalRows for the same input');
});
```

Add fit-query tests:

```ts
describe('workThatFits', () => {
  it('includes history ranges whose high end fits');
  it('includes planned estimates that fit');
  it('does not claim a starter-only item fits');
});
```

Run:

```bash
npx vitest run --config vitest.config.ts src/lib/executionAdvisor.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement one deep projection module**

Expose reason codes, not free-form ranking prose:

```ts
export type AdviceReason =
  | 'scheduled-now'
  | 'scheduled-next'
  | 'due'
  | 'committed-today'
  | 'committed-week'
  | 'carried-over'
  | 'free-time';

export interface RecommendedWork {
  key: string;
  ref: WorkRef;
  title: string;
  goalTitle?: string;
  lifeId?: string;
  reason: AdviceReason;
  expected: ExpectedTime;
}

export type ExecutionAdvice =
  | { kind: 'work'; primary: RecommendedWork; alternatives: RecommendedWork[] }
  | { kind: 'needs-hours' }
  | { kind: 'clear' };
```

Assembly rules:

1. Call `buildDailyWork`.
2. Let `nowFocus` select the primary from open commitments.
3. Preserve the remaining `commitments` order for the first alternative pool.
4. Call `todayPlan` with those commitment keys excluded and append its already ordered offer rows.
5. If there is no commitment, use the first offer row as primary.
6. Choose the next canonical candidate as alternative one. Alternative two may be the first later candidate belonging to another `lifeId`; this may diversify options but never changes the primary or makes an “under-served” claim.
7. Attach `expectedTimeFor` after ordering. Expected-time evidence never changes order.

Do not copy `sortByDue`, `attentionRank`, `PLANNING_HORIZONS`, or slot logic into this file.

- [ ] **Step 3: Run all touched ordering suites**

```bash
npx vitest run --config vitest.config.ts \
  src/lib/executionAdvisor.test.ts \
  src/lib/todayPlan.test.ts \
  src/lib/todaySurface.test.ts \
  src/lib/dailyWork.test.ts \
  src/lib/backlog.test.ts
```

Expected: PASS with existing constants unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/lib/executionAdvisor.ts src/lib/executionAdvisor.test.ts
git commit -m "feat(assistant): derive one canonical next action"
```

## Task 3: Model calm focus sessions without timer writes

**Files:**

- Create: `src/lib/focusSession.ts`
- Create: `src/lib/focusSession.test.ts`

- [ ] **Step 1: Write failing state-machine tests**

Cover:

- start creates an active draft with a frozen target title and optional expected-time evidence;
- elapsed work excludes breaks;
- pause and resume are idempotent;
- no transition depends on a one-second interval;
- normal completion returns one rounded, positive log request;
- an implausibly long session returns `needs-confirmation` and no log request;
- discard returns `null` and never fabricates a session;
- malformed persisted JSON parses to `null`.

Use the threshold:

```ts
export const STALE_FOCUS_MIN = 180;
```

If a history range exists, stale means the larger of 180 minutes or twice its high end.

Run:

```bash
npx vitest run --config vitest.config.ts src/lib/focusSession.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement pure transitions**

Use this persisted shape:

```ts
export interface ActiveFocusSession {
  id: string;
  ref: WorkRef;
  title: string;
  goalTitle?: string;
  startedAtMs: number;
  activeSinceMs: number | null;
  accumulatedMs: number;
  phase: 'active' | 'break' | 'confirming';
  expected: ExpectedTime;
  proposedMinutes?: number;
}
```

Export pure `startFocusSession`, `pauseFocusSession`, `resumeFocusSession`, `finishFocusSession`, `discardFocusSession`, `elapsedFocusMinutes`, `parseActiveFocusSession`, and `serializeActiveFocusSession` functions. Reject negative/non-finite timestamps, impossible phases, both changing target identity and preserving old accumulated time, or a persisted draft without a valid ref.

- [ ] **Step 3: Run the focused suite**

```bash
npx vitest run --config vitest.config.ts src/lib/focusSession.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/focusSession.ts src/lib/focusSession.test.ts
git commit -m "feat(assistant): model calm focus sessions"
```

## Task 4: Persist only focus transitions and log only confirmed completion

**Files:**

- Modify: `src/db/db.ts`
- Modify: `src/state/store.ts`
- Modify: `src/state/store.test.ts`

- [ ] **Step 1: Write failing database and store tests**

Add tests that prove:

1. `loadActiveFocusSession` returns `null` when absent or malformed.
2. `saveActiveFocusSession` writes/deletes only the `settings` row named `activeFocusSession`.
3. `initStore` hydrates the active draft.
4. start/pause/resume write the setting only on transition, never on elapsed-time reads.
5. normal completion calls the existing `logSession` path and clears the draft.
6. stale completion persists `phase: 'confirming'` and does not append a `Session`.
7. confirming a positive adjusted duration appends one `Session`; choosing `Didn't happen` appends none.
8. focus completion preserves an already armed destructive undo in the stack.
9. a non-owning second tab never writes the focus setting.

Run:

```bash
npx vitest run --config vitest.config.ts src/state/store.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Add surgical settings persistence**

In `src/db/db.ts`, add:

```ts
const ACTIVE_FOCUS_SESSION_KEY = 'activeFocusSession';

export async function loadActiveFocusSession(): Promise<ActiveFocusSession | null>;
export async function saveActiveFocusSession(value: ActiveFocusSession | null): Promise<void>;
```

`load` must pass the stored string through `parseActiveFocusSession`. `save(null)` deletes that settings row; `save(value)` stores the serialized JSON. Do not include this device-local in-progress draft in backup export/import and do not bump Dexie from version 7.

- [ ] **Step 3: Add focus state and actions to the main store**

Add `activeFocusSession: ActiveFocusSession | null` to `UIState`, initialize it to `null`, and load it in the `initStore` `Promise.all`. Add actions with boolean/result return values so UI never reports a refused write as success:

```ts
startFocus(ref: WorkRef, expected: ExpectedTime, nowMs?: number): boolean;
pauseFocus(nowMs?: number): boolean;
resumeFocus(nowMs?: number): boolean;
completeFocus(nowMs?: number): 'logged' | 'needs-confirmation' | 'refused';
confirmFocus(minutes: number | null): boolean;
discardFocus(): boolean;
```

Every draft transition updates in-memory UI state and calls `ifOwner(() => saveActiveFocusSession(...))`. `completeFocus` must call `actions.logSession` for the actual `Session` append, then clear the setting only if logging succeeded. Do not call `setAndPersist` on a timer and do not add a `confirmed` field to `Session`.

- [ ] **Step 4: Run persistence regressions**

```bash
npx vitest run --config vitest.config.ts \
  src/state/store.test.ts \
  src/db/db.test.ts \
  src/lib/actuals.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/db.ts src/state/store.ts src/state/store.test.ts
git commit -m "feat(assistant): persist focus transitions safely"
```

## Task 5: Interpret a small set of assistant actions conservatively

**Files:**

- Create: `src/lib/assistantCommands.ts`
- Create: `src/lib/assistantCommands.test.ts`
- Reuse: `src/lib/quickAdd.ts`
- Reuse: `src/lib/search.ts`

- [ ] **Step 1: Write failing parser and ambiguity tests**

Pin these inputs:

```text
What fits in 30m?
Add lab report Friday
Add reading notes for Algorithms tomorrow
Complete lab report
Move lab report to Saturday
```

Tests must prove:

- parsing never writes;
- trailing natural dates reuse `parseDateToken` and are removed only when valid;
- `for <goal>` resolves only an exact or unique goal match;
- incomplete or ambiguous object matches return choices instead of guessing;
- unknown verbs return an examples state rather than pretending to understand;
- `what fits` is read-only and excludes starter-only work from a `fits` claim;
- add, complete, and schedule return an explicit preview requiring confirmation.

Run:

```bash
npx vitest run --config vitest.config.ts src/lib/assistantCommands.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement a closed intent/proposal union**

Use a serializable union similar to:

```ts
export type AssistantIntent =
  | { kind: 'fits'; minutes: number }
  | { kind: 'capture'; draft: QuickAddParse }
  | { kind: 'complete'; query: string }
  | { kind: 'schedule'; query: string; date: string }
  | { kind: 'examples' };

export type AssistantProposal =
  | { kind: 'capture'; id: string; title: string; goalId: string | null; date: string | null; estimateMin?: number }
  | { kind: 'complete'; id: string; subject: AssistantSubject }
  | { kind: 'schedule'; id: string; subject: AssistantSubject; date: string }
  | { kind: 'choose-subject'; id: string; choices: AssistantSubject[] };
```

Keep the vocabulary closed to `fits`, `capture`, `complete`, and `schedule`. Do not add an LLM, network call, free-form mutation, or persistent conversation history.

On confirmation, the future host must map proposals only to existing store actions:

- capture → `addTask`;
- complete → `toggleLeaf` or `toggleTask`;
- schedule → `scheduleNode` or `scheduleTask` at the first available slot;
- fits → no write.

- [ ] **Step 3: Run related parser/search suites**

```bash
npx vitest run --config vitest.config.ts \
  src/lib/assistantCommands.test.ts \
  src/lib/quickAdd.test.ts \
  src/lib/search.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/assistantCommands.ts src/lib/assistantCommands.test.ts
git commit -m "feat(assistant): preview a small action vocabulary"
```

## Task 6: Build one controlled, minimal assistant surface

**Files:**

- Create: `src/lib/assistantProtocol.ts`
- Create: `src/components/assistant/AssistantSurface.tsx`
- Create: `src/components/assistant/AssistantSurface.test.tsx`
- Modify: `src/components/Icons.tsx` only if a missing Lucide-style stroke icon is genuinely required

- [ ] **Step 1: Define the serializable UI protocol**

`assistantProtocol.ts` owns the only data that may cross into the overlay:

```ts
export type AssistantSnapshot =
  | { status: 'loading' }
  | {
      status: 'ready';
      advice: ExecutionAdvice;
      activeFocus: AssistantFocusView | null;
      proposal: AssistantProposal | null;
      notice?: { tone: 'neutral' | 'warning'; text: string };
    };

export type AssistantAction =
  | { type: 'start-focus'; ref: WorkRef }
  | { type: 'pause-focus' }
  | { type: 'resume-focus' }
  | { type: 'complete-focus' }
  | { type: 'confirm-focus'; minutes: number | null }
  | { type: 'switch-focus'; ref: WorkRef }
  | { type: 'submit-input'; text: string }
  | { type: 'confirm-proposal'; id: string }
  | { type: 'choose-subject'; proposalId: string; subjectId: string }
  | { type: 'cancel-proposal' }
  | { type: 'close' };
```

The snapshot must contain no notes, asset IDs/blobs, raw calendar event titles, cache rows, tokens, secrets, or arbitrary URLs.

- [ ] **Step 2: Write failing component tests**

Use `// @vitest-environment jsdom`. Verify:

- loading renders skeleton rows, not a spinner or white screen;
- one primary recommendation is the focal heading;
- no more than two alternatives render with lower visual/semantic priority;
- expected-time copy distinguishes history, planned estimate, and starter language;
- active, break, and confirming focus states expose the approved verbs;
- proposals require an explicit `Confirm` action;
- a zero state gives examples without pretending to be a chat transcript;
- Escape emits one `close` action;
- long primary titles wrap to two lines while quiet metadata truncates;
- all icon buttons have accessible names.

Run:

```bash
npx vitest run --config vitest.config.ts src/components/assistant/AssistantSurface.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement the controlled surface**

`AssistantSurface` receives only `snapshot` and `onAction`. It must import neither the store nor the database. Layout:

1. one compact title/input row;
2. one primary recommendation with reason and honest time copy;
3. one neutral primary action (`Start session` or session-state verb);
4. at most two quiet alternatives;
5. current preview/confirmation, if any.

Use existing typography classes (`text-h2`, `text-title`, `text-body`, `text-ui`, `text-meta`, `text-kbd`), color tokens, `rounded-card`/`rounded-field`, and icons from `Icons.tsx`. Do not add literal hex/rgba values, arbitrary font sizes, gradients, glowing shadows, uppercase labels, emoji, or Unicode icon substitutes.

- [ ] **Step 4: Run component and design-scale suites**

```bash
npx vitest run --config vitest.config.ts \
  src/components/assistant/AssistantSurface.test.tsx \
  src/lib/designScale.test.ts \
  src/components/Icons.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistantProtocol.ts src/components/assistant src/components/Icons.tsx
git commit -m "feat(assistant): add the calm assistant surface"
```

If `Icons.tsx` did not change, omit it from `git add`.

## Task 7: Make Today and the in-app assistant share the same answer

**Files:**

- Create: `src/components/assistant/AssistantHost.tsx`
- Modify: `src/views/Today.tsx`
- Modify: `src/views/Today.freeTime.test.tsx`
- Modify: `src/lib/commands.ts`
- Modify: `src/lib/commands.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.ts`

- [ ] **Step 1: Write failing integration tests**

Prove:

- Today's top item has the same key as `executionAdvice.primary`;
- the primary offer is removed from the lower free-time list instead of duplicated;
- `Start session` calls `startFocus` for that exact ref;
- `Open assistant` exists in `Command+K` commands;
- browser/dev mode can open an in-app assistant even when no Electron bridge exists;
- confirm proposal calls exactly one approved store action;
- schedule failure remains a failure notice and does not show optimistic success;
- switching tasks logs the current non-stale session before starting the selected alternative;
- habits never become the primary recommendation.

Run:

```bash
npx vitest run --config vitest.config.ts \
  src/views/Today.freeTime.test.tsx \
  src/App.test.ts \
  src/lib/commands.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement the main-renderer controller**

`AssistantHost` is the sole adapter from `AssistantAction` to the store. It:

- derives `executionAdvice` from hydrated state and the local clock;
- holds only ephemeral input/proposal/notice UI state;
- converts an active focus draft into `AssistantFocusView`;
- runs `interpretAssistantInput` and builds previews;
- commits previews through `addTask`, `toggleLeaf`, `toggleTask`, `scheduleNode`, or `scheduleTask` only;
- republishes a fresh snapshot after each action;
- renders `AssistantSurface` in-app when `App` opens it.

Keep completion and scheduling separate: completing a session logs time; marking the work done remains its own previewed action.

- [ ] **Step 3: Integrate the shared primary into Today**

Replace Today's independently chosen top row with the advisor primary while preserving the existing `Rest of today`, free-time offer, replan preview, and attention sections. Remove the primary key from the lower lists. Add a quiet `Start session` action to the primary row; do not turn the page into cards or add analytics.

- [ ] **Step 4: Add the command-palette entry**

Add a registry command with the single consistent verb `Open assistant`. Handle it in `runPaletteCommand` by opening the in-app host. Do not bind `Command+Space` in `appKeyboard.ts`; Electron owns the global accelerator, and Chromium may never receive it.

- [ ] **Step 5: Run integration regressions**

```bash
npx vitest run --config vitest.config.ts \
  src/views/Today.freeTime.test.tsx \
  src/App.test.ts \
  src/lib/commands.test.ts \
  src/lib/executionAdvisor.test.ts \
  src/lib/todayPlan.test.ts \
  src/lib/todaySurface.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/assistant/AssistantHost.tsx src/views/Today.tsx \
  src/views/Today.freeTime.test.tsx src/lib/commands.ts src/lib/commands.test.ts \
  src/App.tsx src/App.test.ts
git commit -m "feat(assistant): share one answer across Today and assistant"
```

## Task 8: Add a validated renderer-to-overlay relay

**Files:**

- Create: `src/lib/assistantBridge.ts`
- Create: `src/lib/assistantBridge.test.ts`
- Create: `electron/assistantIpc.cjs`
- Create: `electron/assistantIpc.test.ts`
- Create: `electron/assistantPreload.cjs`
- Modify: `electron/preload.cjs`
- Modify: `electron/main.cjs`
- Modify: `src/components/assistant/AssistantHost.tsx`

- [ ] **Step 1: Write failing IPC security and drift tests**

Mirror `calendarIpc.test.ts` patterns. Pin:

- only the main window sender may publish `AssistantSnapshot`;
- only the overlay sender may submit `AssistantAction`;
- malformed, oversized, or unknown union members are rejected;
- `ready` requests the last sanitized snapshot;
- closing is accepted only from the overlay;
- preload and `assistantIpc.cjs` use the same `phase-assistant:*` channel set;
- the bridge exposes no token, filesystem path, arbitrary URL opener, generic IPC sender, or database operation.
- the overlay preload exposes no `phaseCalendar` API and no main-renderer publishing method.

Run:

```bash
npx vitest run --config vitest.config.ts electron/assistantIpc.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement the main-process relay as a deep module**

`createAssistantIpc` receives injected getters for `mainWindow` and `assistantWindow`. It owns the latest validated snapshot and exports registration/disposal. Use sender identity checks against `webContents.id` before forwarding.

Required channel responsibilities:

```text
phase-assistant:publish          main renderer -> validated cached snapshot
phase-assistant:ready            overlay -> receive cached snapshot or loading
phase-assistant:act              overlay -> validated action forwarded to main renderer
phase-assistant:close            overlay -> hide overlay
phase-assistant:request-snapshot main process -> main renderer subscription
phase-assistant:snapshot         main process -> overlay subscription
phase-assistant:action           main process -> main renderer subscription
```

Do not forward store state wholesale. Validate maximum string lengths and array counts at the seam.

- [ ] **Step 3: Expose role-specific narrow preload bridges**

Extend `electron/preload.cjs` with only the main-renderer methods: publish a validated snapshot, receive a requested-snapshot event, receive a validated overlay action, and configure the accelerator. Create `electron/assistantPreload.cjs` for the overlay with only: announce ready, receive snapshots, submit a validated action, and close. The overlay preload must not expose `phaseCalendar` at all. Every subscription returns an unsubscribe function. Neither preload may expose a `send(channel, value)` or `invoke(channel, value)` escape hatch.

`assistantBridge.ts` wraps the global and returns a safe browser stub when the preload is absent so Vite/web tests keep working.

Add `assistantBridge.test.ts` to pin the browser stub and unsubscribe behavior.

- [ ] **Step 4: Publish from the hydrated owner**

`AssistantHost` publishes only after hydration is `ready`, republishes after relevant state changes, and responds to `request-snapshot`. It remains the only action executor.

- [ ] **Step 5: Run IPC regressions**

```bash
npx vitest run --config vitest.config.ts \
  electron/assistantIpc.test.ts \
  electron/calendarIpc.test.ts \
  src/lib/assistantBridge.test.ts \
  src/App.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/assistantBridge.ts src/lib/assistantBridge.test.ts electron/assistantIpc.cjs \
  electron/assistantIpc.test.ts electron/assistantPreload.cjs electron/preload.cjs electron/main.cjs \
  src/components/assistant/AssistantHost.tsx
git commit -m "feat(assistant): relay assistant state without a second writer"
```

## Task 9: Register an editable global shortcut and surface conflicts

**Files:**

- Create: `src/lib/assistantAccelerator.ts`
- Create: `src/lib/assistantAccelerator.test.ts`
- Create: `electron/assistantShortcut.cjs`
- Create: `electron/assistantShortcut.test.ts`
- Create: `src/components/assistant/AssistantShortcutSettings.tsx`
- Create: `src/components/assistant/AssistantShortcutSettings.test.tsx`
- Modify: `src/db/db.ts`
- Modify: `src/state/store.ts`
- Modify: `src/state/store.test.ts`
- Modify: `src/components/SettingsModal.tsx`
- Modify: `electron/assistantIpc.cjs`
- Modify: `electron/assistantIpc.test.ts`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`

- [ ] **Step 1: Write failing accelerator tests**

Pin:

- default is exactly `Command+Space`;
- key capture requires a modifier and emits a valid Electron accelerator;
- bare keys, modifier-only input, and reserved malformed strings are rejected;
- registration returning `false` produces `{ registered: false, conflict: true }` without throwing;
- changing to a valid new accelerator registers it before unregistering the old one;
- if the new accelerator conflicts, the previous active accelerator remains explicit in status;
- `dispose` unregisters the active accelerator;
- malformed stored settings return the default;
- a non-owning tab does not save a shortcut setting.

Run:

```bash
npx vitest run --config vitest.config.ts \
  src/lib/assistantAccelerator.test.ts \
  electron/assistantShortcut.test.ts \
  src/state/store.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Add the device preference**

In `db.ts`, add total `loadAssistantAccelerator`/`saveAssistantAccelerator` helpers around the `assistantAccelerator` settings key. Add `assistantAccelerator` and an ephemeral shortcut status to `UIState`; load the preference during hydration and save changes through `ifOwner`.

Do not add the shortcut to backup export/import. It is a device/OS binding, not user work.

- [ ] **Step 3: Implement the Electron registration adapter**

`assistantShortcut.cjs` must be dependency-injected and unit-testable:

```js
function createAssistantShortcut({ register, unregister, onOpen }) {
  return {
    setAccelerator(requested) { /* returns requested, active, registered, conflict */ },
    dispose() {},
  }
}
```

The renderer pushes the hydrated preference through validated IPC. Electron cannot read Dexie directly. Register the new chord first; unregister the old chord only after success. On `will-quit`, dispose or call `globalShortcut.unregisterAll()`.

- [ ] **Step 4: Build minimal shortcut Settings UI**

Add an `Assistant shortcut` section below Working hours. Show the current chord in neutral `kbd` elements, a single `Change` action, and status copy. If `Command+Space` conflicts with Spotlight, say so plainly and keep the field editable. Never silently switch to another chord.

Keep the same action labels everywhere: `Change`, `Save`, `Cancel`.

Add a jsdom component test for default-chord rendering, capture validation, conflict copy, save, and cancel.

- [ ] **Step 5: Run focused tests**

```bash
npx vitest run --config vitest.config.ts \
  src/lib/assistantAccelerator.test.ts \
  src/components/assistant/AssistantShortcutSettings.test.tsx \
  electron/assistantShortcut.test.ts \
  electron/assistantIpc.test.ts \
  src/state/store.test.ts \
  src/lib/designScale.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/assistantAccelerator.ts src/lib/assistantAccelerator.test.ts \
  electron/assistantShortcut.cjs electron/assistantShortcut.test.ts \
  src/components/assistant/AssistantShortcutSettings.tsx \
  src/components/assistant/AssistantShortcutSettings.test.tsx src/components/SettingsModal.tsx \
  src/db/db.ts src/state/store.ts src/state/store.test.ts \
  electron/assistantIpc.cjs electron/assistantIpc.test.ts electron/main.cjs electron/preload.cjs
git commit -m "feat(assistant): add a configurable global shortcut"
```

## Task 10: Build the read-only floating Electron window

**Files:**

- Create: `assistant.html`
- Create: `src/assistant/main.tsx`
- Create: `src/assistant/AssistantOverlay.tsx`
- Create: `src/assistant/entryBoundary.test.ts`
- Modify: `vite.config.ts`
- Modify: `electron/main.cjs`
- Modify: `electron/assistantIpc.cjs`
- Modify: `electron/assistantIpc.test.ts`

- [ ] **Step 1: Write the failing architectural boundary test**

`entryBoundary.test.ts` must recursively follow relative imports from `src/assistant/main.tsx` and fail if the graph reaches:

```text
/src/state/
/src/db/
src/App.tsx
```

It must also assert that `assistant.html` points at `src/assistant/main.tsx`, not `src/main.tsx`.

Run:

```bash
npx vitest run --config vitest.config.ts src/assistant/entryBoundary.test.ts
```

Expected: FAIL because the entry does not exist.

- [ ] **Step 2: Add a second Vite entry**

Configure Rollup input for both `index.html` and `assistant.html`. The assistant entry imports `index.css`, `AssistantOverlay`, `AssistantSurface`, protocol types, and the bridge only. It initializes with `{ status: 'loading' }`, subscribes to snapshots, sends user actions through the bridge, and never calls `initStore`.

- [ ] **Step 3: Add the overlay window lifecycle**

In `electron/main.cjs`, keep a separate `assistantWindow` reference. Create it hidden after the main window with:

- neutral background color matching the canvas;
- `frame: false`;
- `show: false`;
- `skipTaskbar: true`;
- fixed compact dimensions and a sensible maximum height;
- the dedicated `electron/assistantPreload.cjs`, `contextIsolation: true`, and `nodeIntegration: false`;
- dev URL `/assistant.html` or production `dist/assistant.html`;
- hide on blur and Escape/close action;
- toggle on the registered global shortcut;
- ask the main renderer for a fresh snapshot whenever shown.

When the main window closes, destroy the overlay so the existing full-quit behavior remains true. On macOS activate, recreate both windows as needed.

- [ ] **Step 4: Add lifecycle tests**

Extend `assistantIpc.test.ts` or add pure exported window-option helpers so tests prove:

- the overlay loads `assistant.html`, never `index.html`;
- showing requests a snapshot;
- hiding does not destroy the main window;
- closing the main window destroys the overlay;
- external URLs are not openable from the overlay;
- `window-all-closed` behavior remains deliberate.

- [ ] **Step 5: Run build and boundary checks**

```bash
npx vitest run --config vitest.config.ts \
  src/assistant/entryBoundary.test.ts \
  electron/assistantIpc.test.ts \
  electron/assistantShortcut.test.ts
npm run build
```

Expected: tests PASS; `dist/index.html` and `dist/assistant.html` both exist; TypeScript and Vite build cleanly.

- [ ] **Step 6: Commit**

```bash
git add assistant.html src/assistant vite.config.ts electron/main.cjs \
  electron/assistantIpc.cjs electron/assistantIpc.test.ts
git commit -m "feat(assistant): add the read-only desktop overlay"
```

## Task 11: Verify the student workflow end to end

**Files:**

- Create: `docs/assistant-verification.md`
- Modify only files required by defects found during verification

- [ ] **Step 1: Write the manual verification matrix**

Document exact scenarios and results:

1. No work and no working hours → calm `Set working hours` guidance, no fake zero.
2. Scheduled class work now → same primary in Today and assistant.
3. No commitment but open goals → first canonical free-time offer becomes primary.
4. University/Startup/Personal candidates → primary stays canonical; alternatives may diversify lives.
5. Zero history → `Planned` or `Start with 30m`, never `likely`.
6. Two comparable completed items → medium range.
7. Five comparable completed items → high range.
8. Start, hide overlay, reopen → active session survives.
9. Break and continue → break time excluded.
10. Normal complete → one Session appended, no task completion.
11. Stale/restarted session → confirmation before history write.
12. Add, complete, and schedule commands → preview, then exactly one write.
13. Ambiguous title → choices, no guessed write.
14. `Command+Space` conflict → visible conflict; changing to an available chord activates it.
15. Long title, missing goal/life, zero alternatives → layout remains stable.
16. Overlay loading → skeleton, not blank screen.

- [ ] **Step 2: Run the full automated suite**

```bash
npm test
npm run build
git diff --check
```

Expected: all tests pass, both Vite entries build, and no whitespace errors.

- [ ] **Step 3: Run the Electron smoke test**

```bash
npm run app:dev
```

Manually verify the matrix above on macOS. Expect `Command+Space` to be unavailable on machines where Spotlight owns it; change the shortcut in Phase Settings and verify the new chord. Inspect DevTools for both windows and confirm the overlay has no IndexedDB/store initialization and no persistence calls.

- [ ] **Step 4: Re-run guards after any smoke-test fixes**

```bash
npx vitest run --config vitest.config.ts \
  src/lib/designScale.test.ts \
  src/assistant/entryBoundary.test.ts \
  electron/assistantIpc.test.ts \
  electron/assistantShortcut.test.ts
npm test
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Scan for prohibited placeholders and accidental scope**

```bash
rg -n "TODO|FIXME|TBD|placeholder|coming soon|confirmed\?:|homework table|chat history" \
  src electron assistant.html docs/assistant-verification.md
```

Expected: no unresolved implementation placeholders, no `Session.confirmed`, no new homework entity, and no chat-history persistence. Legitimate user-facing input placeholder attributes must be reviewed manually rather than deleted mechanically.

- [ ] **Step 6: Commit verification evidence**

```bash
git add docs/assistant-verification.md
git add -u
git commit -m "docs(assistant): verify the student execution workflow"
```

## Final acceptance checklist

- [ ] One recommendation authority: Today and overlay agree.
- [ ] Primary plus no more than two alternatives.
- [ ] Honest expected-time language at every evidence level.
- [ ] No timer tick writes.
- [ ] A stale session cannot poison history.
- [ ] Time logging never completes work.
- [ ] Capture, schedule, and task-completion commands preview before writing; normal focus completion is an explicit confirmation.
- [ ] Scheduling reuses existing store actions.
- [ ] Overlay dependency graph cannot reach store or database.
- [ ] IPC validates payload and sender in both directions.
- [ ] Shortcut defaults to `Command+Space`, is editable, and reports conflicts.
- [ ] No silent shortcut fallback.
- [ ] No gradients, glowing chrome, emojis, arbitrary font sizes, or inconsistent verbs.
- [ ] Skeleton loading and long-data resilience are covered.
- [ ] Full tests and build pass.
