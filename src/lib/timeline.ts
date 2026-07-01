import { parseD, addDays } from './dates';

export function daysBetween(a: string, b: string): number {
  return Math.round((parseD(b).getTime() - parseD(a).getTime()) / 86400000);
}

export function clampSpan(
  start: string,
  deadline: string,
): { start: string; deadline: string } {
  return start <= deadline ? { start, deadline } : { start: deadline, deadline: start };
}

export function moveSpan(
  start: string,
  deadline: string,
  deltaDays: number,
): { start: string; deadline: string } {
  return { start: addDays(start, deltaDays), deadline: addDays(deadline, deltaDays) };
}

export function resizeStart(
  start: string,
  deadline: string,
  deltaDays: number,
): { start: string; deadline: string } {
  const next = addDays(start, deltaDays);
  return { start: next <= deadline ? next : deadline, deadline };
}

export function resizeEnd(
  start: string,
  deadline: string,
  deltaDays: number,
): { start: string; deadline: string } {
  const next = addDays(deadline, deltaDays);
  return { start, deadline: next >= start ? next : start };
}

export function snapDelta(deltaDays: number, unit: 'day' | 'week'): number {
  const size = unit === 'week' ? 7 : 1;
  // `|| 0` converts -0 to 0 when negative inputs round to zero
  return (Math.round(deltaDays / size) * size) || 0;
}

export function expectedPct(
  start: string,
  deadline: string,
  todayStr: string,
): number {
  const total = daysBetween(start, deadline);
  if (total <= 0) return 100;
  const elapsed = daysBetween(start, todayStr);
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

export function behindPaceBy(
  actualPct: number,
  start: string,
  deadline: string,
  todayStr: string,
): number {
  return Math.max(0, expectedPct(start, deadline, todayStr) - actualPct);
}
