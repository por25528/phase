// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNoteDraft } from './useNoteDraft';

// Mutable so tests can simulate an undo becoming armed mid-test, and capture
// the flush the hook registers so a test can invoke it the way the store's
// destructive actions do — without pulling in the real store.
const storeMock = vi.hoisted(() => ({
  pendingUndo: null as { label: string } | null,
  flush: null as (() => void) | null,
}));
vi.mock('../state/store', () => ({
  useAppStore: () => ({ pendingUndo: storeMock.pendingUndo }),
  registerPendingNoteFlush: (flush: () => void) => {
    storeMock.flush = flush;
    return () => { if (storeMock.flush === flush) storeMock.flush = null; };
  },
}));

afterEach(() => {
  cleanup();
  storeMock.pendingUndo = null;
  storeMock.flush = null;
});

function Harness({ save }: { save: (id: string, md: string) => void }) {
  const [subject, setSubject] = useState('n1');
  const stored = subject === 'n1' ? 'first' : 'second';
  const draft = useNoteDraft(subject, stored, save);
  // The hook reads pendingUndo at render time, so a test that flips
  // storeMock.pendingUndo mid-test needs a way to force a re-render without
  // the harness taking props of its own.
  const [, bump] = useState(0);
  return (
    <div onBlur={draft.onBlur}>
      <input
        aria-label="note"
        value={draft.value}
        onChange={(e) => draft.onChange(e.target.value)}
      />
      <button type="button" onClick={() => setSubject('n2')}>switch</button>
      <button type="button" onClick={() => bump((n) => n + 1)}>rerender</button>
    </div>
  );
}

describe('useNoteDraft', () => {
  it('saves after the debounce with the subject it was typed against', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    render(<Harness save={save} />);

    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'typed' } });
    expect(save).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(900); });
    expect(save).toHaveBeenCalledWith('n1', 'typed');
    vi.useRealTimers();
  });

  it('flushes the old subject before reseeding from the new one', () => {
    const save = vi.fn();
    render(<Harness save={save} />);

    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'unsaved' } });
    fireEvent.click(screen.getByText('switch'));

    expect(save).toHaveBeenCalledWith('n1', 'unsaved');
    expect((screen.getByLabelText('note') as HTMLInputElement).value).toBe('second');
  });

  it('does not save when the draft never changed', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    render(<Harness save={save} />);

    act(() => { vi.advanceTimersByTime(900); });
    expect(save).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // A debounce timer must never spend an undo the user did not knowingly use
  // (CLAUDE.md: "Note autosave is held while pendingUndo is live"). Kills the
  // `shouldFlushNoteSave` guard removal at useNoteDraft.ts:45.
  it('holds a debounced save while an undo is pending', () => {
    storeMock.pendingUndo = { label: 'Deleted "X"' };
    vi.useFakeTimers();
    const save = vi.fn();
    render(<Harness save={save} />);

    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'typed' } });
    act(() => { vi.advanceTimersByTime(900); });

    expect(save).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // Once the undo is spent (or expires), the held draft must still reach
  // storage on its own — without any further typing — or a note silently
  // vanishes the moment its window closes. This is the only case that can
  // catch `pendingUndo` being dropped from the effect's dependency array at
  // useNoteDraft.ts:79: without it, clearing pendingUndo alone would never
  // re-arm the debounce timer.
  it('saves the held draft once the undo is spent, without further typing', () => {
    storeMock.pendingUndo = { label: 'Deleted "X"' };
    vi.useFakeTimers();
    const save = vi.fn();
    render(<Harness save={save} />);

    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'typed' } });
    act(() => { vi.advanceTimersByTime(900); });
    expect(save).not.toHaveBeenCalled();

    storeMock.pendingUndo = null;
    fireEvent.click(screen.getByText('rerender'));
    act(() => { vi.advanceTimersByTime(900); });

    expect(save).toHaveBeenCalledWith('n1', 'typed');
    vi.useRealTimers();
  });

  // Blur is an explicit departure, so it must flush even with an undo armed —
  // losing typing is worse than losing an unused undo.
  it('blurs save even with an undo armed', () => {
    storeMock.pendingUndo = { label: 'Deleted "X"' };
    const save = vi.fn();
    render(<Harness save={save} />);

    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'typed' } });
    fireEvent.blur(screen.getByLabelText('note'));

    expect(save).toHaveBeenCalledWith('n1', 'typed');
  });

  // The registry handshake is how a destructive store action (removeNode,
  // removeNodes, removeGoal) flushes the mounted editor before it snapshots
  // for undo. Covers the 'unmount' reason from the hook side.
  it("the store's destructive flush saves the draft even with an undo armed", () => {
    storeMock.pendingUndo = { label: 'Deleted "X"' };
    const save = vi.fn();
    render(<Harness save={save} />);

    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'typed' } });
    act(() => { storeMock.flush!(); });

    expect(save).toHaveBeenCalledWith('n1', 'typed');
  });
});
