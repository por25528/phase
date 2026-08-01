// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const noteActionMocks = vi.hoisted(() => ({
  addAsset: vi.fn(),
}));

const assetMocks = vi.hoisted(() => ({
  getAsset: vi.fn(),
}));

vi.mock('../state/store', () => ({ actions: noteActionMocks }));
vi.mock('../db/assets', () => assetMocks);

import { insertPastedAsset, NoteEditor, roundTrip } from './NoteEditor';

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

afterEach(() => {
  cleanup();
  noteActionMocks.addAsset.mockReset();
  assetMocks.getAsset.mockReset();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  assetMocks.getAsset.mockResolvedValue(undefined);
});

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

  it('serializes asset image refs without escaping them', () => {
    expect(roundTrip('![](asset:a_1)')).toBe('![](asset:a_1)');
  });

  it('preserves image alt text', () => {
    expect(roundTrip('![a shot](asset:a_1)')).toBe('![a shot](asset:a_1)');
  });

  it('preserves raw HTML as literal text and remains idempotent', () => {
    const source = '<span data-x="1">hello</span>';
    const once = roundTrip(source);

    expect(once).toBe('&lt;span data-x="1"&gt;hello&lt;/span&gt;');
    expect(roundTrip(once)).toBe(once);
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

  it('inserts an image node and serializes its asset reference for an image paste', async () => {
    noteActionMocks.addAsset.mockResolvedValue('a_pasted');
    const onChange = vi.fn();
    render(<NoteEditor docKey="g1" value="before" onChange={onChange} placeholder="" ariaLabel="Notes" />);
    const editor = screen.getByLabelText('Notes');
    const file = new File(['image bytes'], 'shot.png', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [{ type: 'image/png', getAsFile: () => file }],
        getData: () => '',
      },
    });

    editor.dispatchEvent(event);

    await waitFor(() => expect(editor.querySelector('.note-image')).not.toBeNull());
    expect(event.defaultPrevented).toBe(true);
    expect(noteActionMocks.addAsset).toHaveBeenCalledWith(file);
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('![](asset:a_pasted)'));
  });

  it('inserts a slow paste at the current selection after the document changes', async () => {
    const replaceRangeWith = vi.fn().mockReturnValue('transaction');
    const image = 'image-node';
    const state = {
      selection: { from: 1, to: 1 },
      schema: { nodes: { image: { create: vi.fn().mockReturnValue(image) } } },
      tr: { replaceRangeWith },
    };
    const dispatch = vi.fn();
    const view = { isDestroyed: false, state, dispatch } as unknown as Parameters<typeof insertPastedAsset>[0];
    let resolveAsset!: (id: string) => void;
    const pendingAsset = new Promise<string>((resolve) => {
      resolveAsset = resolve;
    });

    const insertion = pendingAsset.then((id) => insertPastedAsset(view, id));
    state.selection = { from: 8, to: 8 };
    resolveAsset('a_slow');
    await insertion;

    expect(replaceRangeWith).toHaveBeenCalledWith(8, 8, image);
    expect(dispatch).toHaveBeenCalledWith('transaction');
  });

  it('falls back to the missing-image placeholder when an asset image fails to load', async () => {
    assetMocks.getAsset.mockResolvedValue({
      id: 'a_corrupt',
      mime: 'image/png',
      bytes: new Blob(['not an image'], { type: 'image/png' }),
      width: 1,
      height: 1,
      createdAt: '2026-08-01',
    });
    const createObjectURL = vi.fn().mockReturnValue('blob:a_corrupt');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    const onChange = vi.fn();
    render(<NoteEditor docKey="g1" value="![](asset:a_corrupt)" onChange={onChange} placeholder="" ariaLabel="Notes" />);
    const editor = screen.getByLabelText('Notes');

    await waitFor(() => expect(editor.querySelector('img')).not.toBeNull());
    const image = editor.querySelector('img');
    if (!image) throw new Error('Expected the asset image');
    fireEvent.error(image);

    expect((await screen.findByRole('img', { name: 'Image unavailable' })).textContent).toBe('Image unavailable');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders a healthy asset as an image', async () => {
    assetMocks.getAsset.mockResolvedValue({
      id: 'a_good',
      mime: 'image/png',
      bytes: new Blob(['image bytes'], { type: 'image/png' }),
      width: 1,
      height: 1,
      createdAt: '2026-08-01',
    });
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:a_good'), revokeObjectURL: vi.fn() });
    render(<NoteEditor docKey="g1" value="![](asset:a_good)" onChange={() => {}} placeholder="" ariaLabel="Notes" />);

    await waitFor(() => expect(screen.getByLabelText('Notes').querySelector('img')).not.toBeNull());
  });
});
