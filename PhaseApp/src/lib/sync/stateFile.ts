import type { AppState } from '../../db/types';
import type { StateFileMeta } from './ops';

/**
 * `state.json` — the canonical file the Mac writes and the phone reads.
 *
 * It is the five entity arrays of `AppState` plus a `meta` block, and nothing
 * else: no assets (image bytes would be rewritten on every tick, the same
 * reason `assets` lives outside `persist()`), no device preferences (the
 * phone has its own), no migration snapshots. The backup file remains the
 * complete record; this file is a transport.
 */
export type SyncSlices = AppState;

export interface StateFile extends SyncSlices {
  meta: StateFileMeta;
}

export function buildStateFile(slices: SyncSlices, meta: StateFileMeta): string {
  const file: StateFile = {
    goals: slices.goals,
    habits: slices.habits,
    tasks: slices.tasks,
    sessions: slices.sessions,
    lives: slices.lives,
    meta,
  };
  return JSON.stringify(file, null, 2);
}

function isEntityArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string')
  );
}

/**
 * `null` means "keep your previous good copy" — the caller's contract, per the
 * design's corrupt/mid-write rule. Anything less than five well-formed entity
 * arrays and a numbered generation is corrupt; there is no partial salvage,
 * because a projection built on half a file would LOOK like data loss.
 */
export function parseStateFile(text: string): StateFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<StateFile>;
  const meta = candidate.meta as Partial<StateFileMeta> | undefined;
  if (
    !meta ||
    typeof meta.generation !== 'number' ||
    typeof meta.writtenAt !== 'string' ||
    (meta.ingestedThroughOpId !== null && typeof meta.ingestedThroughOpId !== 'string')
  ) {
    return null;
  }
  for (const key of ['goals', 'habits', 'tasks', 'sessions', 'lives'] as const) {
    if (!isEntityArray(candidate[key])) return null;
  }
  return {
    goals: candidate.goals as StateFile['goals'],
    habits: candidate.habits as StateFile['habits'],
    tasks: candidate.tasks as StateFile['tasks'],
    sessions: candidate.sessions as StateFile['sessions'],
    lives: candidate.lives as StateFile['lives'],
    meta: { generation: meta.generation, writtenAt: meta.writtenAt, ingestedThroughOpId: meta.ingestedThroughOpId },
  };
}
