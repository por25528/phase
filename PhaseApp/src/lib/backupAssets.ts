import type { Asset } from '../db/types';
import { todayStr } from './dates';

export interface BackupAsset {
  id: string;
  mime: string;
  width: number;
  height: number;
  data: string;
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64_CHUNK_SIZE = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_SIZE);
    for (const byte of chunk) binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(data: string): Uint8Array | null {
  if (!BASE64.test(data)) return null;
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function encodeAssets(assets: Asset[]): Promise<BackupAsset[]> {
  return await Promise.all(assets.map(async ({ id, mime, width, height, bytes }) => ({
    id,
    mime,
    width,
    height,
    data: bytesToBase64(new Uint8Array(await bytes.arrayBuffer())),
  })));
}

function decodeAsset(raw: unknown): Asset | null {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<BackupAsset>;
    const { id, mime, width, height, data } = value;
    if (
      typeof id !== 'string' || id.length === 0
      || typeof mime !== 'string' || mime.length === 0
      || typeof width !== 'number' || !Number.isInteger(width) || width <= 0
      || typeof height !== 'number' || !Number.isInteger(height) || height <= 0
      || typeof data !== 'string'
    ) return null;

    const bytes = base64ToBytes(data);
    if (!bytes) return null;
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return {
      id,
      mime,
      bytes: new Blob([buffer], { type: mime }),
      width,
      height,
      createdAt: todayStr(),
    };
  } catch {
    return null;
  }
}

export function decodeAssets(raw: unknown): Asset[] {
  try {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const assets: Asset[] = [];
    for (const entry of raw) {
      const asset = decodeAsset(entry);
      if (!asset || seen.has(asset.id)) continue;
      seen.add(asset.id);
      assets.push(asset);
    }
    return assets;
  } catch {
    return [];
  }
}
