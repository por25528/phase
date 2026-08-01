import { describe, expect, it } from 'vitest';
import { assetIdsInMarkdown, stripAssetRefs } from './notes';

describe('assetIdsInMarkdown', () => {
  it('finds multiple asset refs on one line and inside link syntax', () => {
    const markdown = '![first](asset:a_one) and [second](asset:a_two)';

    expect(assetIdsInMarkdown(markdown)).toEqual(['a_one', 'a_two']);
  });

  it('ignores ordinary image URLs', () => {
    expect(assetIdsInMarkdown('![remote](https://example.com/image.png)')).toEqual([]);
  });

  it('returns no ids when markdown has no asset refs', () => {
    expect(assetIdsInMarkdown('plain prose')).toEqual([]);
  });
});

describe('stripAssetRefs', () => {
  it('removes opaque ids while keeping surrounding prose', () => {
    const stripped = stripAssetRefs('before ![a screenshot](asset:a_secret) after');

    expect(stripped).toBe('before ![a screenshot]() after');
    expect(stripped).not.toContain('a_secret');
  });
});
