import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const nativeRequire = createRequire(import.meta.url);
const { createSyncFiles } =
  nativeRequire('./syncFiles.cjs') as typeof import('./syncFiles.cjs');

let dir: string;
const started: { stop(): void }[] = [];

function open(pollMs = 50) {
  const files = createSyncFiles({ dir, pollMs });
  started.push(files);
  return files;
}

beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'phase-sync-')), 'Phase');
  vi.useFakeTimers();
});

afterEach(() => {
  for (const files of started.splice(0)) files.stop();
  vi.useRealTimers();
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

describe('createSyncFiles', () => {
  it('creates the container directory on start', () => {
    expect(fs.existsSync(dir)).toBe(false);
    open().start(() => {});
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('writes state.json atomically and reads it back', () => {
    const files = open();
    files.start(() => {});
    files.writeState('{"hello":1}');
    expect(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).toBe('{"hello":1}');
    // The temp file is renamed over, never left beside the real one — a
    // half-written state.json is the corrupt-read case the design must avoid.
    expect(fs.existsSync(path.join(dir, 'state.json.tmp'))).toBe(false);
  });

  it('replaces an existing state.json rather than appending to it', () => {
    const files = open();
    files.start(() => {});
    files.writeState('{"a":1}');
    files.writeState('{"b":2}');
    expect(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).toBe('{"b":2}');
  });

  it('writes state even when start() was never called', () => {
    open().writeState('{"a":1}');
    expect(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).toBe('{"a":1}');
  });

  it('fires the callback once for a journal that already exists', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ops-phone.jsonl'), 'one\n');
    const seen: string[] = [];
    open().start((text) => seen.push(text));
    expect(seen).toEqual(['one\n']);
    vi.advanceTimersByTime(500);
    expect(seen).toEqual(['one\n']);
  });

  it('fires again after the journal is appended to', () => {
    const seen: string[] = [];
    open().start((text) => seen.push(text));
    expect(seen).toEqual([]);
    fs.writeFileSync(path.join(dir, 'ops-phone.jsonl'), 'one\n');
    vi.advanceTimersByTime(50);
    expect(seen).toEqual(['one\n']);
    fs.appendFileSync(path.join(dir, 'ops-phone.jsonl'), 'two\n');
    vi.advanceTimersByTime(50);
    expect(seen).toEqual(['one\n', 'one\ntwo\n']);
  });

  it('says nothing and throws nothing when there is no journal', () => {
    const seen: string[] = [];
    const files = open();
    expect(() => files.start((text) => seen.push(text))).not.toThrow();
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([]);
    expect(files.readJournal()).toBeNull();
  });

  it('readJournal returns the raw text — parsing belongs to the ingester', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ops-phone.jsonl'), '{"half":');
    expect(open().readJournal()).toBe('{"half":');
  });

  it('stop() ends the polling', () => {
    const seen: string[] = [];
    const files = open();
    files.start((text) => seen.push(text));
    files.stop();
    fs.writeFileSync(path.join(dir, 'ops-phone.jsonl'), 'one\n');
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([]);
  });

  it('defaults the directory to the plain iCloud Drive folder', () => {
    const previous = process.env.PHASE_SYNC_DIR;
    delete process.env.PHASE_SYNC_DIR;
    try {
      expect(createSyncFiles({}).dir).toBe(
        path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Phase'),
      );
    } finally {
      if (previous !== undefined) process.env.PHASE_SYNC_DIR = previous;
    }
  });

  it('lets PHASE_SYNC_DIR override the default', () => {
    const previous = process.env.PHASE_SYNC_DIR;
    process.env.PHASE_SYNC_DIR = '/tmp/phase-sync-env';
    try {
      expect(createSyncFiles({}).dir).toBe('/tmp/phase-sync-env');
    } finally {
      if (previous === undefined) delete process.env.PHASE_SYNC_DIR;
      else process.env.PHASE_SYNC_DIR = previous;
    }
  });
});
