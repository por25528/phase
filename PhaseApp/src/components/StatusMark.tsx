import type { Confidence, StepStatus } from '../db/types';
import { CONFIDENCE_RANK, CONFIDENCE_WORD } from '../lib/confidence';
import { IconCheck, IconCircle, IconDiamond } from './Icons';

/**
 * The mark beside a status word.
 *
 * Five states, four marks: `todo` and `doing` share the ring and are told
 * apart by the accent, because they are the same task at different moments —
 * where `blocked`, `parked` and `done` are the three ways it stops being work
 * you can pick up. `parked` is a short bar in `muted`, the same glyph the tree
 * row draws inside its box: it was a `faint` RING, which is the todo mark one
 * shade quieter, so the one state that must read as a decision read as the
 * absence of one. The mark never toggles anything; `LeafStatusBox` on the tree
 * row is the one tickable control, and giving another surface a second one is
 * how "ticking the checkbox is the only thing that moves a number" stops being
 * true.
 */
export function StatusMark({ status }: { status: StepStatus }) {
  if (status === 'done') return <IconCheck size={13} />;
  if (status === 'blocked') return <IconDiamond size={11} filled={false} />;
  if (status === 'parked') {
    return (
      <span className="w-[13px] h-[13px] inline-grid place-items-center" aria-hidden="true">
        <span className="w-[9px] h-[1.5px] rounded-full bg-muted" />
      </span>
    );
  }
  return <IconCircle size={13} className={status === 'doing' ? 'text-accent' : ''} />;
}

/**
 * The mark for a TOPIC where a step shows `StatusMark`: three bars of rising
 * height, lit to the rating. Unrated lights none; shaky one, in `warn`; okay
 * two, in `accent`; solid all three. `role="img"` — it is a readout, never a
 * control: rating happens on the shelf, and the task page is the correction
 * surface. The unlit bars are `check`, the untouched box's own border colour,
 * so an unrated topic reads as the same quiet as an unticked step.
 */
export function ConfidenceMark({ confidence, size = 13 }: { confidence: Confidence | null; size?: number }) {
  const lit = confidence === null ? 0 : CONFIDENCE_RANK[confidence];
  const color = confidence === 'shaky' ? 'bg-warn' : 'bg-accent';
  return (
    <span
      role="img"
      aria-label={confidence === null ? 'Not rated' : CONFIDENCE_WORD[confidence]}
      className="inline-flex items-end gap-[1.5px] shrink-0"
      style={{ width: size, height: size }}
    >
      {[0.45, 0.7, 1].map((h, i) => (
        <span
          key={i}
          className={`flex-1 rounded-full ${i < lit ? color : 'bg-check'}`}
          style={{ height: `${h * 100}%` }}
        />
      ))}
    </span>
  );
}
