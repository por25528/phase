import { useEffect, useState } from 'react';
import { getAsset } from '../db/assets';

interface AssetUrlState {
  url: string | null;
  missing: boolean;
}

export function useAssetUrl(id: string | null): AssetUrlState {
  const [state, setState] = useState<AssetUrlState>({ url: null, missing: false });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setState({ url: null, missing: false });

    if (id === null) {
      return () => {
        cancelled = true;
      };
    }

    void getAsset(id).then((asset) => {
      if (cancelled) return;

      if (!asset) {
        setState({ url: null, missing: true });
        return;
      }

      objectUrl = URL.createObjectURL(asset.bytes);
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        return;
      }
      setState({ url: objectUrl, missing: false });
    }).catch(() => {
      if (!cancelled) setState({ url: null, missing: true });
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  return state;
}
