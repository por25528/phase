// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const assetMocks = vi.hoisted(() => ({
  getAsset: vi.fn(),
}));

vi.mock('../db/assets', () => assetMocks);

import { useAssetUrl } from './useAssetUrl';

function asset(id: string) {
  return {
    id,
    mime: 'image/png',
    bytes: new Blob([id], { type: 'image/png' }),
    width: 1,
    height: 1,
    createdAt: '2026-08-01',
  };
}

describe('useAssetUrl', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn();
    revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    assetMocks.getAsset.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('resolves a known id to an object URL', async () => {
    assetMocks.getAsset.mockResolvedValue(asset('a_1'));
    createObjectURL.mockReturnValue('blob:a_1');

    const { result } = renderHook(() => useAssetUrl('a_1'));

    await waitFor(() => expect(result.current.url).toBe('blob:a_1'));
    expect(result.current.missing).toBe(false);
    expect(assetMocks.getAsset).toHaveBeenCalledWith('a_1');
  });

  it('revokes the object URL on unmount', async () => {
    assetMocks.getAsset.mockResolvedValue(asset('a_1'));
    createObjectURL.mockReturnValue('blob:a_1');

    const { result, unmount } = renderHook(() => useAssetUrl('a_1'));
    await waitFor(() => expect(result.current.url).toBe('blob:a_1'));

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:a_1');
  });

  it('revokes the previous URL before creating a replacement', async () => {
    const events: string[] = [];
    assetMocks.getAsset
      .mockResolvedValueOnce(asset('a_1'))
      .mockResolvedValueOnce(asset('a_2'));
    createObjectURL.mockImplementation(() => {
      const url = `blob:${createObjectURL.mock.calls.length}`;
      events.push(`create:${url}`);
      return url;
    });
    revokeObjectURL.mockImplementation((url: string) => events.push(`revoke:${url}`));

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useAssetUrl(id),
      { initialProps: { id: 'a_1' } },
    );
    await waitFor(() => expect(result.current.url).toBe('blob:1'));

    rerender({ id: 'a_2' });
    await waitFor(() => expect(result.current.url).toBe('blob:2'));

    expect(events).toEqual(['create:blob:1', 'revoke:blob:1', 'create:blob:2']);
  });

  it('reports an unknown id as missing without throwing', async () => {
    assetMocks.getAsset.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAssetUrl('not-found'));

    await waitFor(() => expect(result.current.missing).toBe(true));
    expect(result.current.url).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
