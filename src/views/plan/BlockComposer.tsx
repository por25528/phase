import { useEffect, useRef } from 'react';
import { minuteToPx, PX_PER_MINUTE, Z_BLOCK_REVEALED } from '../../lib/grid';
import { clockLabel } from '../../lib/clock';
import { blockFootCls, blockPadCls, blockTimeCls, MIN_BLOCK_PX, FOOTER_BLOCK_PX } from './blockChrome';

/**
 * The inline title field for a block being drawn.
 *
 * It writes NOTHING. The field is local state and the parent only hears about
 * it through `onCommit`, so a stray click costs an empty field that Esc or
 * blur dismisses. Committing an empty title cancels rather than creating
 * "Untitled" — that is what lets the create gesture be a single click with no
 * confirmation step.
 *
 * `resolved` guards the three exits against each other: committing unmounts
 * the field, which fires `blur`, which would otherwise cancel the commit that
 * had just succeeded.
 *
 * **It is the block it is about to become.** Same capped spine, same padding,
 * same title size, and the span on the same footer rule where the block will
 * keep it. That is not decoration: a composer whose title measured 14px while
 * every bar on the grid measured 12px made the one field on the calendar the
 * one element that did not belong to the calendar.
 */
export function BlockComposer({
  startMin, durationMin, onCommit, onCancel, variant = 'block', label,
}: {
  startMin: number;
  durationMin: number;
  onCommit: (title: string) => void;
  onCancel: () => void;
  /**
   * `block` positions itself on the hour grid from `startMin`/`durationMin`.
   * `bar` is a static row for surfaces with no time axis — the month grid,
   * where the hour is chosen by `resolveSlot` rather than by the gesture.
   *
   * One component rather than two because the commit/cancel rules are the
   * subtle part (see `resolved` below); duplicating them for a different
   * shell is how the two would drift.
   */
  variant?: 'block' | 'bar';
  /** Shown instead of the span when there is no span to show. */
  label?: string;
}) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const resolved = useRef(false);

  useEffect(() => { fieldRef.current?.focus(); }, []);

  function finish(commit: boolean): void {
    if (resolved.current) return;
    resolved.current = true;
    const title = fieldRef.current?.value.trim() ?? '';
    if (commit && title) onCommit(title);
    else onCancel();
  }

  const isBar = variant === 'bar';
  const heightPx = Math.max(durationMin * PX_PER_MINUTE, MIN_BLOCK_PX);
  /*
   * The same threshold the bar uses, from the same constant. Below it there is
   * no room for a rule, so the field and the span share one row — which is
   * also the only shape `variant: 'bar'` has ever had.
   */
  const stacked = !isBar && heightPx >= FOOTER_BLOCK_PX;

  /*
   * The block variant prints the START, the same fact the bar it becomes
   * prints, for the same measured reason — see the footer note in
   * `EventBlock`. What you drew is confirmed by the composer's HEIGHT, which is
   * the span, drawn.
   *
   * The `bar` variant is a full-width row on the month grid, where there is no
   * time axis and therefore no drawn span at all — so it keeps the `label` its
   * caller hands it.
   */
  const span = label ?? clockLabel(startMin);

  return (
    <div
      className={`rounded-[6px] border border-accent bg-panel overflow-hidden text-badge leading-[1.2] ${
        isBar
          ? 'mb-[6px] flex items-baseline gap-[8px] px-[5px] py-[2px]'
          : `absolute left-[2px] right-[2px] ${blockPadCls}`
      }`}
      style={isBar ? undefined : {
        top: `${minuteToPx(startMin)}px`,
        height: `${heightPx}px`,
        zIndex: Z_BLOCK_REVEALED,
      }}
      /*
       * The blocks' own buttons stop propagation so a pointerdown does not
       * start a drag. Typing in a field inside the grid needs that too — and
       * it needs `preventDefault` as well, which it did not have.
       *
       * Without it, a press anywhere on the composer's own body moved focus
       * off the input, `onBlur` fired, and `finish(false)` threw away
       * everything typed. On a two-hour block that is ~130px of the composer's
       * own surface that silently cancelled it. `preventDefault` keeps focus
       * where it is; blur still cancels, which is correct and is what makes
       * this a one-click gesture with no confirmation step — what is fixed is
       * that the composer counted as "somewhere else".
       *
       * Not applied when the target IS the field: a press there is how you
       * place the caret, and suppressing it would break selection and
       * click-to-position inside your own title.
       */
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target !== fieldRef.current) e.preventDefault();
      }}
    >
      {/*
        NO spine, and the padding that would hold one is kept anyway.
        A composer already wears `border-accent` on all four sides — that is
        what says "you are editing this" — and an accent spine inside an accent
        border stacks two 3px and 1px marks of the same colour into one heavy
        black edge that reads as a rendering fault. The gap stays, so the title
        sits at exactly the x the bar's title will, and committing DRAWS the
        spine into a space already reserved for it.
      */}

      <div className={isBar ? 'contents' : 'relative h-full flex flex-col'}>
        <input
          ref={fieldRef}
          type="text"
          aria-label="Title for the new block"
          placeholder="What is this?"
          /*
           * `text-badge` on the INPUT, not on the wrapper.
           *
           * `index.css` sets `input, select { font-size: 14px }` in
           * `@layer base`. The wrapper's `text-badge` (12px) is inherited, and
           * inheritance loses to any rule that matches the element — so the
           * title being typed was 14px while the bar it became was 12px, and
           * the field was the only thing on the grid that did not measure like
           * the grid. Fixed here rather than in the base rule, which is right
           * for every dialog field in the app.
           */
          className={`w-full bg-transparent outline-none font-medium text-badge text-ink placeholder:text-faint ${
            stacked ? 'flex-1 min-h-0' : ''
          }`}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
          }}
          onBlur={() => finish(false)}
        />
        {stacked ? (
          <>
            {/*
              The two exits, stated — in the BODY, at its foot.
              The composer documented NEITHER before this: Enter and Escape both
              worked and neither was ever mentioned, on a surface with ~130px of
              blank body to say it in. The move is `dialogRuleHint`'s, where the
              affordance becomes a sentence.
              It is not on the rule's reading edge, where it belongs by every
              other convention in this app, for one reason: a week column is
              ~105px and the rule has room for exactly ONE mono cell. The span
              wins that cell, because the composer's job is to prefigure the bar
              it becomes and the bar keeps its time there. So the hint takes the
              dead space instead — which is the space this whole change is about.
              `faint`, because it is an instruction and not a value.
            */}
            <div aria-hidden="true" className={`${blockTimeCls} text-faint flex-none truncate`}>
              ↵ add · esc
            </div>
            {/*
              The footer rule — the bar's own, on the bar's own edges, so the
              composer prefigures where the span will sit rather than parking it
              under the title and moving it on commit.
            */}
            <div className={blockFootCls}>
              <span data-testid="composer-span" className={`${blockTimeCls} text-ink-soft truncate`}>
                {span}
              </span>
            </div>
          </>
        ) : (
          <div
            data-testid="composer-span"
            className={`${blockTimeCls} text-ink-soft truncate ${isBar ? 'flex-none order-first' : 'flex-none'}`}
          >
            {span}
          </div>
        )}
      </div>
    </div>
  );
}
