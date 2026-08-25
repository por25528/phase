import type { StepStatus } from '../db/types';
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
