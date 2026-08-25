import { describe, expect, it } from 'vitest';
import type { Asset } from '../db/types';
import { decodeAssets, encodeAssets } from './backupAssets';

function asset(id: string, bytes: number[]): Asset {
  return {
    id,
    mime: 'image/png',
    bytes: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
    width: 2,
    height: 2,
    createdAt: '2026-08-01',
  };
}

describe('backup assets', () => {
  it('round-trips a Blob byte for byte', async () => {
    const original = asset('a_round-trip', [0, 1, 2, 127, 128, 254, 255]);
    const [encoded] = await encodeAssets([original]);
    const [decoded] = decodeAssets([encoded]);

    expect(new Uint8Array(await decoded.bytes.arrayBuffer())).toEqual(
      new Uint8Array(await original.bytes.arrayBuffer()),
    );
  });

  it('drops malformed entries and never throws', async () => {
    const [valid] = await encodeAssets([asset('a_valid', [1, 2, 3])]);
    const malformed = [
      valid,
      { ...valid, id: undefined },
      { ...valid, data: 42 },
      { ...valid, data: 'not base64!' },
    ];

    expect(() => decodeAssets([null, ...malformed])).not.toThrow();
    expect(decodeAssets([null, ...malformed]).map((entry) => entry.id)).toEqual(['a_valid']);
  });
});
