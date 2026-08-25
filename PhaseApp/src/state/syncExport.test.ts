import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSyncExporter, type ExportDeps } from './syncExport';
import { parseStateFile, type SyncSlices } from '../lib/sync/stateFile';
import type { SyncMeta } from '../db/db';
import type { Goal } from '../db/types';

function goal(id: string): Goal {
  return { id, title: id, start: '2026-01-01', deadline: '2026-12-31', nodes: [], column: 0 };
}

function harness(opts: { meta?: SyncMeta; slices?: Partial<SyncSlices>; failWrite?: boolean } = {}) {
  let meta: SyncMeta = opts.meta ?? { generation: 0, ingestedThroughOpId: null };
  const written: string[] = [];
  const slices: SyncSlices = {
    goals: [goal('g1')],
    habits: [],
    tasks: [],
    sessions: [],
    lives: [],
    ...opts.slices,
  };

  const deps: ExportDeps = {
    getSlices: () => slices,
    loadMeta: vi.fn(async () => meta),
    saveMeta: vi.fn(async (next: SyncMeta) => {
      meta = next;
    }),
    writeState: vi.fn(async (text: string) => {
      if (opts.failWrite) throw new Error('disk went away');
      written.push(text);
    }),
    now: () => '2026-08-25T09:00:00.000Z',
  };

  return { deps, written, meta: () => meta };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createSyncExporter', () => {
  it('coalesces a burst of schedules into one write', async () => {
    const h = harness();
    const exporter = createSyncExporter(h.deps, 1500);
    exporter.schedule();
    exporter.schedule();
    exporter.schedule();
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.deps.writeState).toHaveBeenCalledTimes(1);
    expect(h.meta().generation).toBe(1);
  });

  it('writes nothing until the debounce elapses', async () => {
    const h = harness();
    const exporter = createSyncExporter(h.deps, 1500);
    exporter.schedule();
    await vi.advanceTimersByTimeAsync(1400);
    expect(h.deps.writeState).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(h.deps.writeState).toHaveBeenCalledTimes(1);
  });

  it('flush writes immediately and cancels the pending debounce', async () => {
    const h = harness();
    const exporter = createSyncExporter(h.deps, 1500);
    exporter.schedule();
    await exporter.flush();
    expect(h.deps.writeState).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.deps.writeState).toHaveBeenCalledTimes(1);
  });

  it('bumps generation once per write and stamps writtenAt', async () => {
    const h = harness();
    const exporter = createSyncExporter(h.deps, 1500);
    await exporter.flush();
    await exporter.flush();
    expect(h.meta().generation).toBe(2);
    const file = parseStateFile(h.written[1]);
    expect(file?.meta).toEqual({
      generation: 2,
      writtenAt: '2026-08-25T09:00:00.000Z',
      ingestedThroughOpId: null,
    });
  });

  it('carries ingestedThroughOpId through untouched — export never claims an ingest', async () => {
    const h = harness({ meta: { generation: 4, ingestedThroughOpId: 'op-9' } });
    const exporter = createSyncExporter(h.deps, 1500);
    await exporter.flush();
    expect(parseStateFile(h.written[0])?.meta).toEqual({
      generation: 5,
      writtenAt: '2026-08-25T09:00:00.000Z',
      ingestedThroughOpId: 'op-9',
    });
  });

  it('writes the five entity arrays it was handed', async () => {
    const h = harness();
    const exporter = createSyncExporter(h.deps, 1500);
    await exporter.flush();
    expect(parseStateFile(h.written[0])?.goals.map((g) => g.id)).toEqual(['g1']);
  });

  it('leaves generation unbumped when the write fails, so the next schedule retries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({ failWrite: true });
    const exporter = createSyncExporter(h.deps, 1500);
    await expect(exporter.flush()).resolves.toBeUndefined();
    expect(h.deps.saveMeta).not.toHaveBeenCalled();
    expect(h.meta().generation).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('never rejects out of a debounced write either — sync must not break the app', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({ failWrite: true });
    const exporter = createSyncExporter(h.deps, 1500);
    exporter.schedule();
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.deps.writeState).toHaveBeenCalledTimes(1);
    expect(h.meta().generation).toBe(0);
  });

  it('reads the slices at WRITE time, not at schedule time', async () => {
    let goals = [goal('early')];
    const h = harness();
    const deps: ExportDeps = { ...h.deps, getSlices: () => ({ ...h.deps.getSlices(), goals }) };
    const exporter = createSyncExporter(deps, 1500);
    exporter.schedule();
    goals = [goal('late')];
    await vi.advanceTimersByTimeAsync(1500);
    expect(parseStateFile(h.written[0])?.goals.map((g) => g.id)).toEqual(['late']);
  });
});
