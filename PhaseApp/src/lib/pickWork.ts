import type { WorkRef } from './expectedTime';
import type { ExecutionAdvice, RecommendedWork } from './executionAdvisor';

/**
 * The shelf's "pick a row" gesture, as a lens over the advice.
 *
 * Picking a row in the `Or` / `Switch to` band used to START a session on it.
 * That bound the one gesture that starts a clock to a row in a list of
 * CHOICES — the same mistake the checkbox rule refuses on that band for
 * completion — and on `Switch to` it also meant the running session ended and
 * a new one began in one press, with nothing in between to change your mind.
 *
 * A pick now only changes what the shelf is POINTING AT: the chosen row
 * becomes the primary and the old primary joins the alternatives, so `Start
 * session` is still the one thing that starts one. It is a lens, never a
 * ranking — membership is the advisor's, only the order moves, and it never
 * invents a row: a ref the advice does not hold (filtered by the focus lens,
 * finished since) leaves the advice untouched, so a stale choice silently
 * falls back to the advisor's own head.
 */
export function sameRef(a: WorkRef, b: WorkRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function promoteWork(advice: ExecutionAdvice, chosen: WorkRef | null): ExecutionAdvice {
  if (!chosen || advice.kind !== 'work') return advice;
  if (sameRef(advice.primary.ref, chosen)) return advice;
  const index = advice.alternatives.findIndex((item) => sameRef(item.ref, chosen));
  if (index === -1) return advice;
  const alternatives = [...advice.alternatives];
  const [picked] = alternatives.splice(index, 1);
  return { ...advice, primary: picked, alternatives: [advice.primary, ...alternatives] };
}

/**
 * What the `Switch to` band lists beside a RUNNING session: every row the
 * advisor holds, primary included, except the work already on the clock.
 * It used to list `alternatives` alone, which hid the advisor's head and —
 * when the running work was itself an alternative — offered to switch to the
 * task already running.
 */
export function switchCandidates(advice: ExecutionAdvice, running: WorkRef): RecommendedWork[] {
  if (advice.kind !== 'work') return [];
  return [advice.primary, ...advice.alternatives].filter((item) => !sameRef(item.ref, running));
}
