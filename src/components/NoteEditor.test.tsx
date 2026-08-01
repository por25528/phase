// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteEditor, roundTrip } from './NoteEditor';

const SAMPLE = [
  '# Heading one',
  '',
  'Some **bold** and *italic* and `code`.',
  '',
  '## Heading two',
  '',
  '- first',
  '- second',
  '',
  '1. one',
  '2. two',
  '',
  '> a quote',
  '',
  '```',
  'const x = 1;',
  '```',
  '',
  '---',
  '',
  '[a link](https://example.com)',
].join('\n');

afterEach(() => cleanup());

describe('roundTrip', () => {
  it('preserves every supported construct', () => {
    const out = roundTrip(SAMPLE);
    expect(out).toContain('# Heading one');
    expect(out).toContain('## Heading two');
    expect(out).toContain('**bold**');
    expect(out).toContain('*italic*');
    expect(out).toContain('`code`');
    expect(out).toContain('- first');
    expect(out).toContain('1. one');
    expect(out).toContain('> a quote');
    expect(out).toContain('const x = 1;');
    expect(out).toContain('---');
    expect(out).toContain('[a link](https://example.com)');
  });

  it('is idempotent, so normalisation cannot drift', () => {
    const once = roundTrip(SAMPLE);
    expect(roundTrip(once)).toBe(once);
  });

  it('produces an empty string for an empty document', () => {
    expect(roundTrip('')).toBe('');
  });

  it('preserves task list syntax and its checked state', () => {
    const src = '- [ ] buy milk\n- [x] done thing';
    expect(roundTrip(src)).toBe(src);
  });

  it('keeps task items idempotent across repeated passes', () => {
    const once = roundTrip('- [ ] a\n- [x] b');
    expect(roundTrip(once)).toBe(once);
  });

  it('does not turn a plain bullet into a task item', () => {
    expect(roundTrip('- plain')).toBe('- plain');
  });

  it('handles a list mixing task and plain items', () => {
    const src = '- [ ] task one\n- plain two';
    const out = roundTrip(src);
    expect(out).toContain('- [ ] task one');
    expect(out).toContain('plain two');
  });
});

describe('NoteEditor', () => {
  it('exposes its accessible name', () => {
    render(<NoteEditor docKey="g1" value="hello" onChange={() => {}} placeholder="Notes…" ariaLabel="Project notes" />);
    expect(screen.getByLabelText('Project notes')).toBeTruthy();
  });

  it('does not fire onChange on mount', () => {
    const onChange = vi.fn();
    render(<NoteEditor docKey="g1" value="hello" onChange={onChange} placeholder="" ariaLabel="Notes" />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reseeds when docKey changes', () => {
    const { rerender } = render(<NoteEditor docKey="a" value="Note A" onChange={() => {}} placeholder="" ariaLabel="Notes" />);
    rerender(<NoteEditor docKey="b" value="Note B" onChange={() => {}} placeholder="" ariaLabel="Notes" />);
    expect(screen.getByLabelText('Notes').textContent).toContain('Note B');
  });
});
