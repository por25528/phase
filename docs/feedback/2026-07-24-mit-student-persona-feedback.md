# Phase — persona feedback

**Persona:** MIT CS sophomore, double-loaded — half the week is coursework (psets,
a systems project, an exam every couple weeks), the other half is a startup (two
cofounders, ~40 design-partner users, closing a seed).
**Method:** ran Phase for a week against both tracks.
**Date:** 2026-07-24

---

## TL;DR

For clean, decomposable, deadline-shaped **study** goals, Phase is the most *honest*
planner I've tried and I'd keep using it for coursework tomorrow. For the **startup**
— where progress is metrics that move while I sleep, and half my thinking happens away
from my laptop — its philosophical purity currently works against me.

Give me a **numeric/target leaf type** and **capture on my phone**, and this becomes the
first tool that holds both halves of my life in one place.

---

## What clicked immediately

- **The progress model is honest, and I respect it.** A goal's % only moves when a
  *leaf checkbox* gets ticked — logging time, adding a milestone, or tagging a task does
  nothing to the number. Every other tool lets me *feel* productive by reorganizing.
  Phase won't let me lie to myself. For coursework this is perfect: "Finish pset 7"
  genuinely decomposes into checkable leaves, and the roll-up tells the truth.
- **The four horizon columns (Now → Next → Later → Someday) are the right primitive** —
  and the **hard cap of 3 projects in Now** is what makes them bite. My problem isn't
  listing goals, it's deciding what I'm *not* doing this month. A tool that physically
  refuses to let me pretend I'm actively pushing on six things is doing me a favor I
  won't do for myself. The Timeline's *"N Now projects overlap — Now is crowded"* warning
  reinforces it. **Keep this non-negotiable — don't ship a "raise the limit" escape hatch.**
  The friction is the feature.
- **The weekly "Plan your week" ritual is the standout.** The last-week recap (Done /
  Removed), *"points behind pace"*, and **Break a step into day-sized tasks** is a proper
  GTD weekly review, and it maps to how I actually chunk a pset the night before. Snapshotting
  last week's commitments *once* so I can't retroactively rewrite my own history — exactly the
  accountability I need.
- **"Import a plan an AI made for you."** The Goals empty state invites an AI-generated
  plan and there's a JSON import behind it. I'd rather have Claude decompose a project into
  a tree and pipe it in than hand-build twenty leaves. For a CS student this is *the* feature.
- **Local-first, keyboard-driven, offline.** `1/2/3` to switch views, `T` for today, a
  global capture shortcut. Fast, and it's mine. I trust IndexedDB + JSON export more than
  another SaaS that'll get acquired and sunset.

## Where it breaks down for the *startup* half

The core of my feedback: **Phase models my coursework beautifully and my startup poorly**,
and it's because of the very thing I praised.

- **Startup progress isn't a checkbox tree.** My real goals are "$2k MRR," "10 design-partner
  interviews," "cut activation time in half." Those are metrics/outcomes, not leaves you tick.
  To fit them into Phase I invented sub-tasks so the % had something to average — and now the
  number is theater, exactly what the app's honesty is supposed to prevent.
  **Ask: a numeric/target leaf** (`7/10 interviews`, `$1.4k/$2k`) that rolls up proportionally.
  This one addition makes the startup track first-class.
- **The roll-up is unweighted, and it misleads me.** Progress averages equally *per branch*,
  so "Ship v1 backend" and "Pick a logo" as siblings each count 50%. My projects are lopsided by
  nature — one giant leaf and five trivial ones — and the % flatters the trivial work.
  **Ask: optional weights** (even just S/M/L) on leaves/branches.
- **Time is journaling-only.** I log hours obsessively, but Sessions never touch progress and
  never surface against the plan. Since I live in a time-blocked calendar, the disconnect is
  jarring. I'd want *"you planned 8 steps and logged 3 hours across 2 of them"* in the weekly recap.
- **No sync is a real cost for the startup, not the studies.** Coursework lives on my laptop and
  that's fine. But startup thoughts hit me walking between buildings — and there's no phone. I get
  the single-writer / tab-lock stance and even like the principle, but read + quick-capture on
  mobile that reconciles later is the difference between "tool I open on Sunday" and "tool I live in."
  This is the one constraint that might make me churn.

## Smaller friction

- **AI-import seams.** Imported projects land with **unconfirmed dates** and I clear a
  *"N projects have unconfirmed dates → Review"* banner one project at a time. Two fixes:
  **(1) publish/expose the import JSON schema** so I can prompt an LLM to emit the exact shape
  in one shot; **(2) confirm-all dates in a single action** instead of per-project.
- **Cold start.** As a technical user I was fine, but the empty board gives no sense of *how deep*
  to decompose. One seeded example project I could delete would've saved 15 minutes of "am I doing
  this right?"
- **"Worth considering" vs "commitments"** on Today is a smart split — but I only understood it
  *after* doing a weekly plan. Before that, everything's a suggestion and the distinction is invisible.
- **Carryover is manual triage.** Unfinished work surfaces in **"Needs a decision"** (Replan /
  Break down / Remove) with no auto-roll. That's *correct* — auto-carry is how a task list rots into
  a graveyard — but during exam week when triage itself is the luxury I don't have, I'd kill for a
  single **"bump everything open to next week"** keyboard action so I can review it Sunday, not
  Wednesday at 1am.
- **Import replaces everything** (with a confirm). As someone who'd want to merge a laptop and
  lab-machine export, replace-only is scary. Merge matters the day I trust this with a semester of data.

## If I were prioritizing your backlog

1. **Numeric/target leaves** — unlocks the entire startup use case. Highest leverage.
2. **Read-only mobile + quick capture** — "Sunday tool" → "tool I live in."
3. **Optional leaf weights** — makes the honest % actually honest for lopsided projects.
4. **Publish the import JSON schema + confirm-all dates** — makes the AI-import path promptable.
5. Surface **logged time against the weekly plan** in the recap.

## Bottom line

The AI-import + 3-project-cap combo means Phase fits *both* my tracks more than I first gave it
credit for. The remaining gap is the same one throughout: **startup goals are metrics, not
checkboxes.** Close that with a numeric leaf and give me capture on my phone, and this is the first
tool that holds coursework and a company in one honest place. That's rare — and you're closer to it
than anyone else I've tried.
