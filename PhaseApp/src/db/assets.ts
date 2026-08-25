import type { Asset } from './types';
import { db } from './db';

export async function putAsset(asset: Asset): Promise<void> {
  await db.assets.put(asset);
}

export async function getAsset(id: string): Promise<Asset | undefined> {
  return await db.assets.get(id);
}

export async function allAssetIds(): Promise<string[]> {
  return await db.assets.toCollection().primaryKeys() as string[];
}

export async function deleteAssets(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.assets.bulkDelete(ids);
}

export async function clearAssets(): Promise<void> {
  await db.assets.clear();
}
