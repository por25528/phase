const ASSET_REF = /asset:([A-Za-z0-9_-]+)/g;

export function assetIdsInMarkdown(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(ASSET_REF)) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function stripAssetRefs(markdown: string): string {
  return markdown.replace(ASSET_REF, '');
}
