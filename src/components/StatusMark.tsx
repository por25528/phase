import type { StepStatus } from '../db/types';
import { IconCheck, IconCircle, IconDiamond } from './Icons';

/**
 * The mark beside a status word.
 *
 * Four states, three marks: `todo` and `doing` share the ring and are told
 * apart by the accent, because they are the same task at different moments —
 * where `blocked` and `done` are the two ways it stops being work you can pick
 * up. The mark never toggles anything; `LeafStatusBox` on the tree row is the
 * one tickable control, and giving another surface a second one is how
 * "ticking the checkbox is the only thing that moves a number" stops being
 * true.
 */
export function StatusMark({ status }: { status: StepStatus }) {
  if (status === 'done') return <IconCheck size={13} />;
  if (status === 'blocked') return <IconDiamond size={11} filled={false} />;
  return <IconCircle size={13} className={status === 'doing' ? 'text-accent' : ''} />;
}
