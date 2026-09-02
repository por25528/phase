import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../state/store';
import { TodayCheckbox } from '../components/TodayCheckbox';
import { stampLabel } from '../components/sectionLabel';
import { RuleHeader } from '../components/RuleHeader';
import { TaskRow } from '../components/TaskRow';
import { NowDivider } from './today/NowDivider';
import { IconArrowRight, IconWarning } from '../components/Icons';
import { buildDailyWork, nowDividerIndex, type DailyWorkItem } from '../lib/dailyWork';
import { attentionItems, carriedFrom, carryOverRows, looseRows, surfaceReason } from '../lib/todaySurface';
import { spansOn } from '../lib/scheduled';
import { executionAdvice } from '../lib/executionAdvisor';
import { expectedTimeFor, type WorkRef } from '../lib/expectedTime';
import { fieldCls } from '../components/dialogStyles';
import { expectedTimeLabel } from '../lib/assistantProtocol';
import { proposalMinutes, proposeReplan, slippedWork } from '../lib/replan';
import { ReplanPreview } from './today/ReplanPreview';
import { clockLabel } from '../lib/clock';
import { fmtMinutes } from '../lib/effort';
import { loggedForItemOn } from '../lib/actuals';
import { dayStamp, greeting } from '../lib/today';
import { useLocalDate } from '../hooks/useLocalDate';
import { dayLabel, dayVerb, offerHeading, todayPlan, type ProposalRow } from '../lib/todayPlan';
import { backlogGroups, dueChip, type BacklogItem } from '../lib/backlog';
import { weekOf } from '../lib/plan';
import { aimFor } from '../lib/slot';
import { primaryBtn, rowBtn, rowBtnPrimary } from '../components/dialogStyles';

/**
 * What to do now.
 *
 * Phase could already compute the next open leaf, the week's commitments,
 * capacity, pace and blocked states — and scattered those answers across goal
 * cards, a focus summary, a sidebar rail, a goal header and calendar blocks.
 * The Plan grid was the closest thing to an execution surface, and at 10:10 on
 * a Tuesday it showed seven days when two blocks mattered.
 *
 * Four zones, in this order, and nothing else: the one thing in front of you,
 * the rest of the day, what to do with the time still free, and at most three
 * exceptions. No portfolio analytics, no habit configuration, no dashboard
 * cards — a surface that answers one question stops answering it the moment it
 * also answers nine others.
 */
export function Today({
  onCapture,
}: {
  /**
   * Open task capture. Optional because only the empty state spends it: the
   * shell owns the ⌘N host, and a page that renders rows has no business
   * carrying a second way in.
   */
  onCapture?: () => void;
}) {
  const { goals, tasks, sessions, allDayBlocks, busyBlocks, actions } = useAppStore();
  const today = useLocalDate();
  const [nowMinute, setNowMinute] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMinute(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const sections = useMemo(() => buildDailyWork(goals, tasks, today), [goals, tasks, today]);
  /*
   * The sittings already on a date, curried once for the two consumers that
   * ask. Both the advisor and the offer below it scan forward for a day with
   * room, and handing them the same accessor is what stops them measuring the
   * day two different ways.
   */
  const placedOn = useCallback(
    (date: string) => spansOn(goals, tasks, date),
    [goals, tasks],
  );
  // "Do this first" — the same pin the shelf holds, view-local for the same
  // reason the shelf's dials are: surfaces do not share ephemeral lenses. A
  // pin set from the shelf must not leak here, and one set here must not
  // leak to the shelf.
  const [pinned, setPinned] = useState<WorkRef | null>(null);
  const [doFirstOpen, setDoFirstOpen] = useState(false);
  /**
   * The one recommendation authority. Today used to choose its own top row
   * with `nowFocus` directly; routing through the advisor keeps this page and
   * the assistant answering "what now" identically, because they are the same
   * projection.
   */
  const advice = useMemo(
    () => executionAdvice({
      goals, tasks, sessions, blocks: busyBlocks, placedOn, allDayBlocks,
      today, week: weekOf(today), now: { date: today, minute: nowMinute },
      ...(pinned ? { pinned } : {}),
    }),
    [goals, tasks, sessions, placedOn, allDayBlocks, busyBlocks, today, nowMinute, pinned],
  );
  const primary = advice.kind === 'work' ? advice.primary : null;
  const attention = useMemo(
    () => attentionItems(goals, sections, today),
    [goals, sections, today],
  );
  const [replanOpen, setReplanOpen] = useState(false);
  const slipped = useMemo(() => slippedWork(goals, tasks, today), [goals, tasks, today]);
  // Proposed lazily: the search walks fourteen days of gaps per item, and the
  // strip only needs the count until someone asks what would happen.
  const proposal = useMemo(
    () => (replanOpen
      ? proposeReplan({
        goals, tasks, today, blocks: busyBlocks, allDayBlocks,
        now: { date: today, minute: nowMinute },
      })
      : { moves: [], unplaceable: [] }),
    [replanOpen, goals, tasks, today, allDayBlocks, busyBlocks, nowMinute],
  );

  const open = useMemo(() => sections.commitments.filter((i) => !i.done), [sections]);
  // The advisor's primary rendered from today's own rows when it is one of
  // them — the checkbox, the clock and the estimate belong to the commitment.
  const primaryItem = primary
    ? [...open, ...sections.carryOvers].find((i) => i.key === primary.key) ?? null
    : null;
  // "Rest of today" means the REST. The Now block above it is already showing
  // the primary; listing it again put the same task on screen twice, and the
  // section's own name promised otherwise.
  const rest = primary ? open.filter((i) => i.key !== primary.key) : open;
  /**
   * The day's weight, for the header.
   *
   * Commitments plus carry-overs — the two populations this page holds you to,
   * and never the free-time offer, which is work you have not agreed to yet.
   * A carry-over promoted to primary is counted once: `sections.carryOvers` and
   * `sections.commitments` are disjoint, so the primary is in exactly one of
   * them. It takes the UNCAPPED carry-over total rather than `carried.rows`,
   * because a header stating "5 left" over eight rows' worth of work would be
   * the cap leaking into a figure that is supposed to be the whole day.
   */
  const leftCount = open.length + sections.carryOvers.length;
  // Indexed against the list it is drawn in, not the one it was derived from.
  const divider = nowDividerIndex(rest, nowMinute);
  const doneCount = sections.completedToday.length;
  // Reserve one clock column for every task row whenever any commitment carries a clock.
  const anyTimed = open.some((i) => i.startMin !== undefined);
  // What the page is already saying, so the offer below does not repeat it —
  // the carry-overs included, now that the section below lists them and offers
  // the same placement under the same word. This is the advisor's own `seen`
  // set, restated: `executionAdvisor` excludes commitments AND carry-overs from
  // its own `todayPlan` call, and a page that excluded less than the advisor it
  // is required to agree with would re-offer work another section is showing.
  const shown = useMemo(
    () => new Set([...open, ...sections.carryOvers].map((i) => i.key)),
    [open, sections],
  );

  // What to do with the time that is still free — the answer this surface used
  // to withhold on exactly the day it mattered most.
  const offer = useMemo(
    () => todayPlan({
      goals, tasks, blocks: busyBlocks, placedOn, allDayBlocks,
      today, week: weekOf(today), now: { date: today, minute: nowMinute },
      exclude: shown,
    }),
    [goals, tasks, placedOn, allDayBlocks, busyBlocks, today, nowMinute, shown],
  );

  // The work the page used to name and refuse to show. Below the day's own
  // plan, which outranks yesterday's leftovers, and above the exceptions. The
  // primary is excluded because a carry-over is a candidate the advisor may
  // lead with, and Now is already showing that row.
  const carried = useMemo(
    () => carryOverRows(sections.carryOvers, today, primary ? new Set([primary.key]) : new Set()),
    [sections, today, primary],
  );

  /**
   * The loose tasks with no date on them — work that used to reach this page
   * only if the free-time offer happened to have room for it. Fed by
   * `backlogGroups`' own loose bucket, so this section cannot disagree with
   * the rail about membership; excluded is everything the page already shows,
   * offer rows included, so a task never appears twice.
   */
  const loose = useMemo(() => {
    const seen = new Set(shown);
    if (primary) seen.add(primary.key);
    if (offer.kind === 'offer') for (const row of offer.rows) seen.add(row.key);
    return looseRows(backlogGroups(goals, tasks, weekOf(today), today), seen);
  }, [goals, tasks, today, shown, offer, primary]);

  function complete(item: DailyWorkItem): void {
    if (item.kind === 'task') actions.toggleTask(item.id);
    else actions.toggleLeaf(item.id);
  }

  /** A loose row is always a task — a step cannot be loose; it has a tree. */
  function completeLoose(item: BacklogItem): void {
    if (item.kind === 'task') actions.toggleTask(item.id);
  }

  /**
   * Book a proposed row. Both actions resolve the slot themselves and toast
   * when the item will not fit contiguously, so there is no optimistic UI here
   * and no second way to say "no room".
   */
  function place(row: ProposalRow, date: string): void {
    /*
     * Aim at the start of the ordinary day, clamped forward to the clock on
     * today.
     *
     * This was `isToday ? nowMinute : 0`, and the `0` only ever worked because
     * a window fenced `resolveSlot` and swallowed it. With the fence gone a
     * bare 0 books midnight, so `ORDINARY_DAY` is the AIM instead — which is
     * what `aimFor` is, and which also folds in the today clamp this line used
     * to spell out.
     */
    const aim = aimFor(date, { date: today, minute: nowMinute });
    if (row.kind === 'task') actions.scheduleTask(row.id, date, aim);
    else if (row.goalId) actions.scheduleNode(row.goalId, row.id, date, aim);
  }

  /**
   * Open the thing a row names — what a plain click does in every section.
   *
   * Typed as the three fields opening needs rather than as `DailyWorkItem`,
   * because the offer rows are `ProposalRow`s and open exactly the same way.
   * The only difference between the two is how each spells "belongs to no
   * project" — `string | null` on one, `string | undefined` on the other — and
   * that is a fact about their storage, not about opening.
   */
  function openItem(item: { kind: 'step' | 'task'; id: string; goalId?: string | null }): void {
    if (item.kind === 'step' && item.goalId) actions.openProject(item.goalId, item.id);
    else actions.revealInPlan('task', item.id);
  }

  /**
   * The verb that books an offer — the carry-over `Today` button, for the day
   * the offer is actually about.
   *
   * `relative z-10` is not decoration: `TaskRow`'s stretched click target
   * covers `meta`, so an interactive child there has to sit above it or the
   * row swallows the press. `startSessionButton` already does exactly this.
   */
  function planButton(row: ProposalRow, date: string) {
    return (
      <button
        type="button"
        onClick={() => place(row, date)}
        aria-label={`Plan “${row.title}” ${dayLabel(date, today)}`}
        className={`relative z-10 quiet-control ${rowBtn}`}
      >
        {dayVerb(date, today)}
      </button>
    );
  }

  /** Begin a calm focus session on the primary. Time logs at completion, never here. */
  function startSession(ref: WorkRef, title: string): void {
    const started = actions.startFocus(ref, expectedTimeFor(ref, { goals, tasks, sessions }));
    if (!started) actions.showToast(`Couldn't start a session on "${title}" — one is already running`);
  }

  /**
   * The page's one filled control. Everything else Today offers — Replan,
   * booking a carry-over, booking an offer — moves work AROUND the day; this is
   * the only button that starts doing any of it, and it was rendering as the
   * third identical outlined button on the page.
   */
  function startSessionButton(ref: WorkRef, title: string) {
    return (
      <button
        type="button"
        onClick={() => startSession(ref, title)}
        aria-label={`Start session on “${title}”`}
        className={`relative z-10 ${rowBtnPrimary}`}
      >
        Start session
      </button>
    );
  }

  // A free-time primary is the offer's own first row, promoted: booking it is
  // still the row's plain click, so the answer and the action stay one thing.
  const offerInfo = offer.kind === 'offer' ? offer : null;
  const primaryOffer = primary && !primaryItem && offerInfo
    ? offerInfo.rows.find((row) => row.key === primary.key) ?? null
    : null;
  const restOffers = offerInfo
    ? offerInfo.rows.filter((row) => row.key !== primary?.key)
    : [];

  const stamp = dayStamp(today);

  return (
    /* ── The frame ──
       Today is a MEASURED OBJECT, not text on a field.

       The page used to be a 720px column pinned to the top-left of an
       unbounded background, with roughly 60% of the frame unclaimed and
       nothing anywhere to say where the page ended and the void began — a
       surface that reads as still loading. The grid below bounds the reading
       column with a hairline on each side and fills everything outside it,
       plus the tail under the last row, with `.hatch`. The margin becomes
       MATERIAL: a short day reads as ruled paper with room left on it rather
       than as a page that ran out, which is exactly the state a new database
       opens in.

       `flex-1` on the tail is what makes the frame reach the bottom of the
       viewport on a sparse day and stop at the content on a full one. It
       needs the height to travel: `App.tsx` gives Today's wrapper the main
       region's remaining height for this one view and nothing else. */
    <div className="flex-1 min-h-0 grid grid-cols-[1fr_minmax(0,720px)_1fr]">
      <div className="hatch border-r border-line" aria-hidden="true" />

      <div className="flex flex-col min-w-0">
        {/* ── The day ──
            A stamp and a headline, and the two are as far apart as this app's
            type scale goes: 11px mono against 34px semibold. The range IS the
            composition — the old header ran 11px to 19.6px and read as drift.

            The stamp is `dayStamp`, split into two cells so the weekday can
            invert against the date it names, the way a date stamp is inked.
            It also finally says which WEEK you are standing in — every other
            surface in this app is addressed by week and Today never was.

            The one figure on the reading edge is still the day's WEIGHT:
            everything committed to today plus everything that slipped into it.
            No section states that total, and it is the answer to the question
            you open this page already asking. */}
        <div className="px-[18px] pt-[22px] pb-[20px] border-b border-line">
          <span className="inline-flex items-stretch mb-[15px] rounded-[4px] border border-line-2 overflow-hidden">
            <span className={`px-[8px] py-[3px] bg-fill text-paper font-semibold ${stampLabel}`}>
              {stamp.dow}
            </span>
            <span className={`px-[8px] py-[3px] border-l border-line-2 text-muted ${stampLabel}`}>
              {stamp.span}
            </span>
          </span>

          <div className="flex items-baseline justify-between gap-[16px]">
            <h1 className="text-mast font-semibold tracking-[-0.028em] leading-[1.05]">
              {greeting(new Date().getHours())}
            </h1>
            {leftCount > 0 && (
              <span className="flex-none text-ui text-muted tabular-nums">{leftCount} left</span>
            )}
          </div>
        </div>

      {/* ── What slipped ──
          Above Now, because a day planned on top of yesterday's unfinished work
          is a day that will slip again. `Replan` opens a preview and moves
          nothing on its own.

          It used to be a filled `bg-warn-tint` card carrying bold warn text and
          a white button, which made a secondary condition the loudest object on
          the page — louder than the one thing worth doing, directly below it.
          The status is now carried by the MARK alone: a warn triangle, neutral
          chrome, ordinary ink. Nothing about how urgent this is has changed;
          what changed is that it no longer outranks the work. */}
      {slipped.length > 0 && (
        <div className="px-[18px] py-[10px] border-b border-line flex flex-wrap items-center gap-x-[9px] gap-y-[4px]">
          <span className="flex-none inline-flex text-warn" aria-hidden="true">
            <IconWarning size={14} />
          </span>
          <span className="text-ui text-ink">
            {slipped.length} task{slipped.length === 1 ? '' : 's'} unfinished
          </span>
          <span className="text-meta text-muted tabular-nums">
            {fmtMinutes(slipped.reduce((n, s2) => n + s2.minutes, 0))}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setReplanOpen(true)}
            className={rowBtn}
          >
            Replan
          </button>
        </div>
      )}

      {/* ── Now ──
          One answer, from the one recommendation authority. A commitment
          renders with its own checkbox and clock; a free-time primary is the
          offer's first row promoted, so its click still books it. */}
      {(primaryItem || primaryOffer || !offerInfo) && (
      <section aria-label="Now" className="pb-[10px]">
        {primary && primaryItem ? (
          <>
            {/* The label is the emphasis now. The row below carries the clock,
                the estimate and the title exactly as every other row does, so
                the one thing worth doing sits on the same axis as the rest. */}
            <RuleHeader label={primary.reason === 'scheduled-now' ? 'Now' : 'Next'} />
            <div className="px-[10px] pt-[6px]">
            <TaskRow
              index={1}
              title={primaryItem.title}
              subtitle={primaryItem.goalTitle}
              emphasis
              time={
                anyTimed
                  ? (primaryItem.startMin === undefined ? '' : clockLabel(primaryItem.startMin))
                  : undefined
              }
              onOpen={() => openItem(primaryItem)}
              lead={
                <TodayCheckbox
                  checked={false}
                  onToggle={() => complete(primaryItem)}
                  ariaLabel={`Mark "${primaryItem.title}" as done`}
                />
              }
              meta={
                <>
                  <span className="tabular-nums">{expectedTimeLabel(primary.expected)}</span>
                  {startSessionButton(primary.ref, primary.title)}
                </>
              }
            />
            </div>
          </>
        ) : primary && primaryOffer && offerInfo ? (
          <>
            {/* The free time IS the reason this row leads, so the heading that
                names it moves up here with the row it explains. The capacity
                sentence sits on the far end of the section rule rather than on
                a line of its own: the eyebrow slot says WHAT a section is, and
                "no time left today, but Monday has 9h" is why the offer exists
                — a fact about the section, which is exactly what that slot is
                for, and one line saved above the row it explains. */}
            <RuleHeader label="Free time" right={offerHeading(offerInfo, today)} />
            <div className="px-[10px] pt-[6px]">
            {/* The column is reserved and the NUMBER withheld: a free-time row
                is work you have not agreed to, and numbering it would enrol it
                in the committed queue. Dropping the column too would just
                misalign it. */}
            <TaskRow
              index={null}
              title={primaryOffer.title}
              subtitle={primaryOffer.goalTitle}
              emphasis
              reserveLead
              time={anyTimed ? '' : undefined}
              /* Opens, like every other row on this page. The booking is the
                 button in `meta`; it used to be this click, which bound the one
                 action that writes a block to the largest target on the page. */
              onOpen={() => openItem(primaryOffer)}
              meta={
                <>
                  <span className="tabular-nums">{expectedTimeLabel(primary.expected)}</span>
                  {planButton(primaryOffer, offerInfo.date)}
                  {startSessionButton(primary.ref, primary.title)}
                </>
              }
            />
            </div>
          </>
        ) : doneCount > 0 ? (
          /* A finished day. No verb here: `Done today` is rendering the record
             directly below, so the page is not empty and does not need filling
             — and offering to add work is a strange thing to say to someone who
             has just cleared the board. */
          <p className="px-[18px] pt-[14px] text-ui text-muted">Nothing left today — {doneCount} done.</p>
        ) : (
          /* The genuinely empty day, and the first screen a new database shows.
             It used to be one grey sentence naming a shortcut in prose, on a
             page with nothing else on it — the shortcut was the only way in and
             it was written as if it were punctuation. The sentence states the
             fact, the button IS the invitation, and `⌘N` sits on the button as
             a key rather than inside a paragraph as a word. Same verb as the
             header's `+ Add` on this view (`addAction.ts`: Today makes a task),
             so the two cannot advertise different things. */
          <div className="px-[18px] pt-[14px]">
            <p className="text-ui text-muted">Nothing committed to today.</p>
            {onCapture && (
              <button type="button" onClick={onCapture} className={`mt-[10px] ${primaryBtn}`}>
                Add a task
                <kbd className="ml-[8px] font-mono text-kbd tracking-[.04em] text-paper/70 border border-paper/25 rounded-[4px] px-[4px] py-[1px]">
                  ⌘N
                </kbd>
              </button>
            )}
          </div>
        )}
        {primary && (
          <div className="px-[10px] pt-[6px]">
            {doFirstOpen ? (
              <input
                autoFocus
                aria-label="Do this first"
                placeholder="e.g. Review chapter 3"
                className={fieldCls}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const title = (e.target as HTMLInputElement).value.trim();
                    if (title) {
                      const created = actions.insertWorkBefore(primary.ref, title);
                      if (created) setPinned(created);
                    }
                    setDoFirstOpen(false);
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    setDoFirstOpen(false);
                  }
                }}
                onBlur={() => setDoFirstOpen(false)}
              />
            ) : (
              <button type="button" className={rowBtn} onClick={() => setDoFirstOpen(true)}>
                Do first
              </button>
            )}
          </div>
        )}
      </section>
      )}

      {/* ── Today's plan ──
          Shown whenever an open commitment remains after the Next item is
          removed. `nowFocus` deliberately returns null once everything timed
          is behind us, so the remaining list still shows a single unticked
          10:00 standup at six in the evening. */}
      {rest.length > 0 && (
        <section aria-label="Today’s plan" className="pb-[10px]">
          <RuleHeader label="Rest of today" />
          {/* Numbered CONTINUOUSLY from the row above, not restarted: `rest` is
              literally the committed list with the primary removed, so the two
              sections are one queue split by a rendering rule, and printing
              `01` twice for it would be the split leaking into the numbering.
              It starts at 1 when the row above is an offer or absent. */}
          <ul className="px-[10px] pt-[6px]">
            {rest.map((item, i) => (
              <li key={item.key}>
                {/* Where the day turns from behind you to ahead, and says when. */}
                {i === divider && i > 0 && <NowDivider nowMinute={nowMinute} />}
                <TaskRow
                  index={i + (primaryItem ? 2 : 1)}
                  title={item.title}
                  subtitle={item.goalTitle}
                  time={
                    anyTimed
                      ? (item.startMin === undefined ? '' : clockLabel(item.startMin))
                      : undefined
                  }
                  onOpen={() => openItem(item)}
                  lead={
                    <TodayCheckbox
                      checked={false}
                      onToggle={() => complete(item)}
                      ariaLabel={`Mark "${item.title}" as done`}
                    />
                  }
                  meta={
                    <>
                      {/* Why this row is here at all. Absent where the row
                          already says it — a block at 14:00 does not need a
                          chip reading "placed today". */}
                      {surfaceReason(item) && <span>{surfaceReason(item)}</span>}
                      {item.estimateMin !== undefined && (
                        <span className="tabular-nums">{fmtMinutes(item.estimateMin)}</span>
                      )}
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Free time ──
          One row per project, never a project's whole queue: this is a choice
          between commitments, and the moment it lists everything open it is a
          second backlog rail on a page that is not the backlog. */}
      {offerInfo && restOffers.length > 0 && (
        <section aria-label="Free time" className="pb-[10px]">
          {/* When the primary above already carries the free-time heading,
              repeating the sentence would say it twice about the same time —
              so the capacity line belongs to whichever of the two is showing
              it, and never to both. */}
          <RuleHeader
            label={primaryOffer ? 'Also possible' : 'Free time'}
            right={primaryOffer ? undefined : offerHeading(offerInfo, today)}
          />
          {/* Deliberately UNNUMBERED, and this is the one place the mockup was
              wrong: it ran `01`, `02` straight down the page across both
              sections. `Next` is work you committed to and `Free time` is work
              `todayPlan` is OFFERING — a single sequence spanning the two
              asserts they are one queue, which is the exact distinction the
              offer exists to draw. */}
          <ul className="px-[10px] pt-[6px]">
            {restOffers.map((row) => {
              const chip = dueChip(row.due, today);
              return (
                <li key={row.key}>
                  <TaskRow
                    index={null}
                    title={row.title}
                    subtitle={row.goalTitle}
                    reserveLead
                    time={anyTimed ? '' : undefined}
                    /* Opens. The verb below books — see `planButton`. */
                    onOpen={() => openItem(row)}
                    meta={
                      <>
                        {chip && (
                          <span className={chip.overdue ? 'text-warn' : undefined}>{chip.text}</span>
                        )}
                        {row.estimateMin !== undefined && (
                          <span className="tabular-nums">{fmtMinutes(row.estimateMin)}</span>
                        )}
                        {planButton(row, offerInfo.date)}
                      </>
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── Carried over ──
          One row per slipped commitment, oldest first. The verb is `place`,
          the same one the offer rows above use, so "put this on today" means
          exactly one thing on this page — and `scheduleTask`/`scheduleNode`
          vacate the stale sitting and arm the undo without help. */}
      {carried.rows.length > 0 && (
        <section aria-label="Carried over" className="pb-[10px]">
          {/* The only section whose rows are CAPPED, so the only one whose total
              says something the rows cannot. `+N more` below states the same
              arithmetic from the other end and stays: it sits with the rows it
              is withholding, where a reader counting them will look. */}
          <RuleHeader label="Carried over" right={carried.rows.length + carried.overflow} />
          {/* Its own sequence, restarted. These are slipped commitments — a
              different population from today's, which is why the section
              exists at all — so continuing today's count would merge two
              lists that `buildDailyWork` keeps disjoint on purpose. */}
          <ul className="px-[10px] pt-[6px]">
            {carried.rows.map((item, i) => (
              <li key={item.key}>
                <TaskRow
                  index={i + 1}
                  title={item.title}
                  subtitle={item.goalTitle}
                  onOpen={() => openItem(item)}
                  lead={
                    <TodayCheckbox
                      checked={false}
                      onToggle={() => complete(item)}
                      ariaLabel={`Mark "${item.title}" as done`}
                    />
                  }
                  meta={
                    <>
                      {/* No `surfaceReason` chip: the heading is the reason. */}
                      {carriedFrom(item, today) && <span>{carriedFrom(item, today)}</span>}
                      <button
                        type="button"
                        onClick={() => place(
                          {
                            key: item.key,
                            kind: item.kind,
                            id: item.id,
                            ...(item.goalId ? { goalId: item.goalId } : {}),
                            title: item.title,
                            goalTitle: item.goalTitle ?? '',
                          },
                          today,
                        )}
                        aria-label={`Plan “${item.title}” today`}
                        className={`relative z-10 quiet-control ${rowBtn}`}
                      >
                        Today
                      </button>
                    </>
                  }
                />
              </li>
            ))}
          </ul>
          {carried.overflow > 0 && (
            /* Static text. A link here would be the dead end this section
               retires — five rows have already been shown. */
            <p className="px-[18px] mt-[4px] text-meta text-muted">
              +{carried.overflow} more
            </p>
          )}
        </section>
      )}

      {/* ── Loose tasks ──
          Work captured with no project and no date. It used to reach this page
          only through the free-time offer — five rows shared with every
          project, drawn only when the day had room — so a bare captured task
          was invisible on the one surface that answers "what now". Below the
          committed sections, because unfiled work outranks nothing you agreed
          to; the verb is the same `place` every other section uses. */}
      {loose.rows.length > 0 && (
        <section aria-label="Loose tasks" className="pb-[10px]">
          {/* Capped like `Carried over`, so the total says what the rows cannot. */}
          <RuleHeader label="Loose tasks" right={loose.rows.length + loose.overflow} />
          {/* Unnumbered: a rank is a claim about order, and undated loose
              tasks arrive in capture order, which claims nothing. */}
          <ul className="px-[10px] pt-[6px]">
            {loose.rows.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                <TaskRow
                  index={null}
                  title={item.title}
                  onOpen={() => openItem(item)}
                  lead={
                    <TodayCheckbox
                      checked={false}
                      onToggle={() => completeLoose(item)}
                      ariaLabel={`Mark "${item.title}" as done`}
                    />
                  }
                  meta={
                    <>
                      {item.estimateMin !== undefined && (
                        <span className="tabular-nums">{fmtMinutes(item.estimateMin)}</span>
                      )}
                      {planButton(
                        {
                          key: `${item.kind}:${item.id}`,
                          kind: item.kind,
                          id: item.id,
                          ...(item.goalId ? { goalId: item.goalId } : {}),
                          title: item.title,
                          goalTitle: '',
                        },
                        today,
                      )}
                    </>
                  }
                />
              </li>
            ))}
          </ul>
          {loose.overflow > 0 && (
            /* Static, like `Carried over`'s: five rows are already a decision. */
            <p className="px-[18px] mt-[4px] text-meta text-muted">
              +{loose.overflow} more
            </p>
          )}
        </section>
      )}

      {/* ── Attention ── */}
      {attention.length > 0 && (
        <section aria-label="Attention" className="pb-[10px]">
          <RuleHeader label="Attention" />
          <ul className="px-[10px] pt-[6px]">
            {attention.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => a.goalId && actions.openProject(a.goalId, a.nodeId)}
                  className="w-full text-left flex items-center gap-[8px] px-[8px] py-[6px] rounded-[6px] transition-colors duration-150 hover:bg-hover"
                >
                  <span className="text-warn flex-none inline-flex" aria-hidden="true">
                    <IconWarning size={13} />
                  </span>
                  <span className="flex-1 min-w-0 truncate text-ui text-ink-soft">{a.text}</span>
                  <span className="flex-none text-faint inline-flex" aria-hidden="true">
                    <IconArrowRight size={12} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Done today ──
          Last, because work that is done cannot outrank work that is not.
          It renders only when something was actually finished, so it is a
          record of the day and never filler on an empty one.

          No cap, unlike `Carried over`: that section's input is unbounded
          backlog, this one's is bounded by a day of one person's work, and
          telling someone who finished eleven things that five of them counted
          would undercut the only section that exists to show what they did.

          The order is `buildDailyWork`'s and makes NO chronological claim —
          `doneAt` is a date with no time in it. Sorting this list by when
          things were finished needs a completion timestamp, which the spec
          refuses; read that refusal before reaching for one. */}
      {sections.completedToday.length > 0 && (
        <section aria-label="Done today" className="pb-[10px]">
          <RuleHeader label="Done today" />
          {/* Unnumbered. A rank is a claim about ORDER, and this list makes no
              chronological claim — `doneAt` is a date with no time in it. */}
          <ul className="px-[10px] pt-[6px]">
            {sections.completedToday.map((item) => {
              const logged = loggedForItemOn(sessions, item, today);
              return (
                <li key={item.key}>
                  <TaskRow
                    index={null}
                    title={item.title}
                    subtitle={item.goalTitle}
                    completed
                    onOpen={() => openItem(item)}
                    lead={
                      <TodayCheckbox
                        checked
                        onToggle={() => complete(item)}
                        ariaLabel={`Mark "${item.title}" as not done`}
                      />
                    }
                    meta={
                      logged > 0
                        ? <span className="tabular-nums">{fmtMinutes(logged)}</span>
                        : undefined
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

        {/* Ruled paper under the last row. It is what stops a short day — and
            a brand-new database, which is the first screen anyone sees —
            reading as a page that ran out. */}
        <div className="hatch flex-1 min-h-[60px]" aria-hidden="true" />

        {/* Inside the column rather than beside it: the grid has exactly three
            tracks, and a dialog is not a fourth. It is fixed-position either
            way, so where it sits in the tree costs nothing. */}
        <ReplanPreview
          open={replanOpen}
          proposal={proposal}
          onCancel={() => setReplanOpen(false)}
          onApply={() => {
            const moved = actions.applyReplan(proposal.moves);
            setReplanOpen(false);
            if (moved) {
              actions.showToast(`Moved ${proposal.moves.length} task${proposal.moves.length === 1 ? '' : 's'} · ${fmtMinutes(proposalMinutes(proposal))}`);
            }
          }}
        />
      </div>

      <div className="hatch border-l border-line" aria-hidden="true" />
    </div>
  );
}
