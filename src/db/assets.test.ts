import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { allAssetIds, clearAssets, deleteAssets, getAsset, putAsset } from './assets';
import { persist } from './db';
import type { AppState, Asset } from './types';

const state: AppState = { goals: [], habits: [], tasks: [], sessions: [] };

function asset(id: string, bytes = [1, 2, 3]): Asset {
  return {
    id,
    mime: 'image/webp',
    bytes: new Blob([new Uint8Array(bytes)], { type: 'image/webp' }),
    width: 2,
    height: 2,
    createdAt: '2026-08-01',
  };
}

beforeEach(async () => {
  await clearAssets();
});

describe('assets table', () => {
  it('round-trips a Blob including its type and decoded bytes', async () => {
    const original = asset('a_round-trip', [0, 1, 2, 255]);

    await putAsset(original);
    const loaded = await getAsset(original.id);

    expect(loaded).toBeDefined();
    expect(loaded!.bytes.size).toBe(original.bytes.size);
    expect(loaded!.bytes.type).toBe(original.bytes.type);
    expect(new Uint8Array(await loaded!.bytes.arrayBuffer())).toEqual(
      new Uint8Array(await original.bytes.arrayBuffer()),
    );
  });

  it('lists written asset ids', async () => {
    await putAsset(asset('a_one'));
    await putAsset(asset('a_two'));

    expect((await allAssetIds()).sort()).toEqual(['a_one', 'a_two']);
  });

  it('deletes only the named assets', async () => {
    await putAsset(asset('a_keep'));
    await putAsset(asset('a_drop'));

    await deleteAssets(['a_drop']);

    expect(await getAsset('a_drop')).toBeUndefined();
    expect(await getAsset('a_keep')).toBeDefined();
  });

  it('clears the table', async () => {
    await putAsset(asset('a_one'));
    await putAsset(asset('a_two'));

    await clearAssets();

    expect(await allAssetIds()).toEqual([]);
  });

  it('returns undefined for an unknown id', async () => {
    await expect(getAsset('a_unknown')).resolves.toBeUndefined();
  });

  it('leaves assets alone when persist rewrites AppState', async () => {
    const original = asset('a_survives-persist', [9, 8, 7]);
    await putAsset(original);

    await persist(state);

    const loaded = await getAsset(original.id);
    expect(loaded).toBeDefined();
    expect(new Uint8Array(await loaded!.bytes.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
  });
});
