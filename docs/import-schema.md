# Phase — project import JSON schema

Phase can build a project (and its whole subgoal tree) from JSON you paste into
**Goals → Import project**. That screen also has a **Copy AI prompt** button and a
**Format reference** — this file is the same contract, published so you can point an
LLM at it or keep it open while you hand-write a plan.

The parser lives in [`src/lib/goalImport.ts`](../src/lib/goalImport.ts)
(`parseGoalImport`) and is the single source of truth; this doc mirrors it.

## Top level

Paste **one project object**, or an **array of project objects**. Parsing is
all-or-nothing: if any project is malformed the whole paste is rejected with a
message naming the offending `Goal #n`.

```jsonc
{
  "title": "Finish 6.1010 pset 7",          // REQUIRED, non-empty string
  "start": "2026-07-24",                     // optional, "YYYY-MM-DD"
  "deadline": "2026-08-05",                  // optional, "YYYY-MM-DD"
  "priority": "now",                         // optional → "now"
  "notes": "office hours Tue/Thu",           // optional string
  "subgoals": [ /* see below */ ]            // optional array
}
```

| Field      | Required | Type / values | Notes |
|------------|----------|---------------|-------|
| `title`    | **yes**  | non-empty string | The only hard requirement. |
| `start`    | no       | `YYYY-MM-DD`  | Kept only if valid; dropped otherwise. |
| `deadline` | no       | `YYYY-MM-DD`  | Kept only if valid; must be on/after `start`. |
| `priority` | no       | `now` \| `next` \| `later` \| `someday` | The commitment horizon. Missing/unknown → `now`. Legacy `highest`/`high`/`medium`/`later` still map to columns 0–3. |
| `notes`    | no       | string        | Free-form context; trimmed, dropped if blank. |
| `subgoals` | no       | array         | The subgoal tree (below). Omit for a project with no steps yet. |

An invalid `start`/`deadline` (bad calendar date, or `start` after `deadline`)
rejects the paste. Imported projects are added with their dates **confirmed** — you
can adjust them anytime in the project drawer.

## Subgoals — leaf **xor** container

Each entry in `subgoals` is one of:

- **A plain string** → one concrete, checkable step (a *leaf*).
  ```json
  "Write the recurrence"
  ```
- **An object with its own non-empty `subgoals`** → a *container* that groups
  steps. Containers hold children only — they never carry a checkbox or dates, and
  the project % rolls up purely from the leaves beneath them.
  ```json
  { "title": "Problem 3: DP", "subgoals": ["Write the recurrence", "Implement + memoize"] }
  ```
- **An object without `subgoals`** → a leaf that can also carry its own schedule.
  Dates are kept only when **both** `start` and `deadline` are valid.
  ```json
  { "title": "Ship publicly", "start": "2026-11-01", "deadline": "2026-11-15" }
  ```

A subgoal with no usable `title` is silently skipped. Nesting can go as deep as you
like; keep leaves small and actionable.

## Full example

```json
[
  {
    "title": "Finish 6.1010 pset 7",
    "priority": "now",
    "start": "2026-07-24",
    "deadline": "2026-08-05",
    "subgoals": [
      "Problem 1: recursion",
      "Problem 2: graph search",
      { "title": "Problem 3: dynamic programming", "subgoals": [
        "Write the recurrence",
        "Implement + memoize",
        "Test against the provided cases"
      ]},
      "Write up + submit"
    ]
  }
]
```

## Prompting an AI

Open **Goals → Import project → Copy AI prompt** for a ready-made instruction block
(it stamps today's date in), paste it into any assistant, then paste the reply back
into the same box. The assistant must return **only JSON** — no prose, no markdown
fences.
