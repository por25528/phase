// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNoteDraft } from './useNoteDraft';

vi.mock('../state/store', () => ({
  useAppStore: () => ({ pendingUndo: null }),
  registerPendingNoteFlush: () => () => {},
}));

afterEach(() => cleanup());

function Harness({ save }: { save: (id: string, md: string) => void }) {
  const [subject, setSubject] = useState('n1');
  const stored = subject === 'n1' ? 'first' : 'second';
  const draft = useNoteDraft(subject, stored, save);
  return (
    <div onBlur={draft.onBlur}>
      <input
        aria-label="note"
        value={draft.value}
        onChange={(e) => draft.onChange(e.target.value)}
      />
      <button type="button" onClick={() => setSubject('n2')}>switch</button>
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
});
